import type { FastifyInstance } from 'fastify'
import { v2, protos } from '@google-cloud/speech'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { recordCost } from '../db.js'
import { ASR_USD_PER_CALL } from '../services/cost.js'
import { normalizeLang } from '../services/tts.js'

// ASR ÎN STREAMING — Google Speech-to-Text v2 `_streamingRecognize`, cu:
//   • detecție avansată (model chirp — endpointing pe SERVER, nu prag RMS local),
//   • rezultate PARȚIALE live (interimResults) cât vorbește Adrian,
//   • evenimente de activitate vocală (SPEECH_ACTIVITY_BEGIN/END) → barge-in.
// Browserul deschide un WS la /api/asr-stream, trimite audio PCM16 (LINEAR16,
// 16kHz, mono) în cadre binare; noi îl releem la Google și împingem înapoi
// {partial|final|speech_begin|speech_end}. Ruta batch /api/asr rămâne NEATINSĂ
// până la cutover (zero dublură DUPĂ cutover, nu în timpul lui).

// REGIUNEA DOVEDITĂ (matrice live, 10 iul): chirp_3 NU EXISTĂ în us-central1 —
// Google: 'The model "chirp_3" does not exist in the location named
// "us-central1"'. Acceptat în 'us' și 'eu' (testat cu auto și ro-RO). 'eu' =
// latență minimă pentru Adrian și utilizatorii europeni.
const REGION = 'eu'
// Cel mai avansat model cerut de Adrian. chirp_2 e dovedit în batch; chirp_3 e
// Adrian confirmă: chirp_3 SUPORTĂ streaming → păstrăm chirp_3. Mic-ul mut la
// primul deploy NU e de la model — bug-ul e pe drum (WS/auth/format), de găsit.
const ASR_MODEL = 'chirp_3'

let client: v2.SpeechClient | null = null
let projectId = ''
function getClient(): v2.SpeechClient | null {
  if (!config.googleServiceAccountJson) return null
  if (!client) {
    const creds = JSON.parse(config.googleServiceAccountJson) as { project_id?: string }
    projectId = creds.project_id ?? ''
    client = new v2.SpeechClient({
      credentials: creds as Record<string, unknown>,
      projectId: projectId || undefined,
      // endpoint regional — chirp trăiește pe regiune, nu pe global
      apiEndpoint: `${REGION}-speech.googleapis.com`,
    })
  }
  return client
}

// STT ÎN STREAMING = OPȚIONAL, iar pe gazdă (VPS) NU e configurat — dovadă live
// (28 iul): în fișierul de mediu nu există GOOGLE_SERVICE_ACCOUNT_JSON. Fără el
// WS-ul de mai jos se închidea instant, iar BROWSERUL (nu codul nostru) tipărea
// în consola lui Adrian «WebSocket connection to
// 'wss://kelionai.app/api/asr-stream' failed» la FIECARE pornire de microfon.
// Eroarea aia nu se poate prinde din JS: singurul mod de a o face să dispară e
// ca browserul să NU mai deschidă WS-ul degeaba. De aceea expunem capabilitatea
// pe HTTP simplu (ruta /api/asr-stream/capability de mai jos), iar clientul o
// întreabă O SINGURĂ DATĂ pe încărcare de pagină.
// Predicat IEFTIN, intenționat fără `getClient()`: nu construim clientul Google
// (și nu riscăm o excepție de JSON stricat) doar ca să răspundem la o sondă
// publică. Oglindește exact garda din handler-ul WS (`!c || !projectId`).
function streamingAsrConfigured(): boolean {
  if (!config.googleServiceAccountJson) return false
  try {
    const creds = JSON.parse(config.googleServiceAccountJson) as { project_id?: string }
    return Boolean(creds.project_id)
  } catch {
    return false
  }
}

type GStream = ReturnType<v2.SpeechClient['_streamingRecognize']>
type Resp = protos.google.cloud.speech.v2.IStreamingRecognizeResponse

export async function asrStreamRoutes(app: FastifyInstance): Promise<void> {
  // SONDĂ DE CAPABILITATE — HTTP simplu, fără sesiune, fără cost, fără Google.
  // Browserul o cere înainte de a deschide microfonul: dacă `streaming:false`,
  // nici nu mai încearcă WS-ul și trece DIRECT pe dictarea batch (/api/asr, care
  // are fallback pe OpenAI în services/asr.ts) — deci dictarea CONTINUĂ să
  // meargă, doar că fără parțiale live, și consola rămâne curată.
  // Când Google E configurat întoarce `true` și streamingul merge EXACT ca până
  // acum — ruta asta nu schimbă nimic pe calea fericită.
  app.get('/api/asr-stream/capability', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { streaming: streamingAsrConfigured() }
  })

  app.get('/api/asr-stream', { websocket: true }, (socket, req) => {
    const user = getSessionUser(req)
    if (!user) {
      app.log.warn('asr-stream: WS refuzat — fără sesiune (cookie neparsat pe upgrade?)')
      try {
        socket.close(1008, 'unauthorized')
      } catch {
        /* deja închis */
      }
      return
    }
    const c = getClient()
    if (!c || !projectId) {
      // PLASĂ DE REZERVĂ pentru clienții care n-au apucat să întrebe sonda de mai
      // sus (pagină veche în cache, sondă căzută). Perechea (1011,
      // 'asr_not_configured') e un CONTRACT cu frontend/src/lib/micStream.ts: la
      // primirea ei, clientul memorează pentru toată sesiunea că streamingul nu
      // există și cade tăcut pe batch — fără eroare, fără reîncercări.
      app.log.warn('asr-stream: WS refuzat — Google STT neconfigurat (fără service account)')
      try {
        socket.close(1011, 'asr_not_configured')
      } catch {
        /* deja închis */
      }
      return
    }
    app.log.info('asr-stream: WS conectat (sesiune OK) — aștept audio')

    let gStream: GStream | null = null
    let started = false
    let closed = false
    let langHint = ''

    const send = (obj: unknown): void => {
      try {
        socket.send(JSON.stringify(obj))
      } catch {
        /* canal căzut — cleanup se ocupă */
      }
    }

    const stopGoogle = (): void => {
      if (gStream) {
        try {
          gStream.end()
        } catch {
          /* deja terminat */
        }
        gStream = null
      }
    }

    const startGoogle = (): void => {
      if (started || closed) return
      started = true
      const recognizer = `projects/${projectId}/locations/${REGION}/recognizers/_`
      let stream: GStream
      try {
        stream = c._streamingRecognize()
      } catch {
        send({ type: 'error', error: 'asr_failed' })
        return
      }
      gStream = stream

      stream.on('data', (resp: Resp) => {
        // evenimente de voce (endpointing pe server) → barge-in + „fără tăiat"
        const ev = resp.speechEventType
        if (ev === 'SPEECH_ACTIVITY_BEGIN' || ev === 2) send({ type: 'speech_begin' })
        else if (ev === 'SPEECH_ACTIVITY_END' || ev === 3) send({ type: 'speech_end' })
        for (const r of resp.results ?? []) {
          const transcript = r.alternatives?.[0]?.transcript ?? ''
          if (!transcript) continue
          if (r.isFinal) {
            send({ type: 'final', transcript, lang: r.languageCode ?? null })
            void recordCost(user.email, 'asr', ASR_USD_PER_CALL)
          } else {
            send({ type: 'partial', transcript })
          }
        }
      })
      stream.on('error', (e: unknown) => {
        // DIAGNOSTIC (Adrian, 14 iul): scoatem mesajul REAL Google la suprafață —
        // codul de dinainte trimitea doar „asr_failed" generic, iar loggerul {err}
        // nu apărea în jurnalul serverului. Acum mesajul intră ȘI în log (string) ȘI
        // în răspunsul WS (`detail`), ca să vedem EXACT de ce respinge Google.
        const detail = String((e as { message?: string })?.message ?? e).slice(0, 400)
        app.log.error('asr-stream: eroare Google streamingRecognize: ' + detail)
        send({ type: 'error', error: 'asr_failed', detail })
        gStream = null
        started = false // permite repornirea la următorul cadru — altfel ASR rămâne mut
      })
      stream.on('end', () => {
        gStream = null
        started = false // permite repornirea pe același socket dacă Google închide fluxul
      })

      // PRIMA cerere = DOAR config (fără audio); apoi doar cadre {audio}.
      try {
        stream.write({
          recognizer,
          streamingConfig: {
            config: {
              model: ASR_MODEL,
              // ancorează limba dacă Adrian are una stabilită; altfel auto.
              languageCodes: langHint ? [langHint] : ['auto'],
              // browserul trimite PCM16 brut (LINEAR16, 16kHz, mono)
              explicitDecodingConfig: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                audioChannelCount: 1,
              },
              features: { enableAutomaticPunctuation: true },
            },
            streamingFeatures: {
              interimResults: true,
              enableVoiceActivityEvents: true,
            },
          },
        } as protos.google.cloud.speech.v2.IStreamingRecognizeRequest)
      } catch {
        send({ type: 'error', error: 'asr_failed' })
        stopGoogle()
      }
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (closed) return
      // control (text JSON): {type:'start', lang} / {type:'stop'}
      if (!isBinary) {
        try {
          const m = JSON.parse(data.toString('utf8')) as { type?: string; lang?: string }
          if (m.type === 'start') {
            const raw = String(m.lang ?? '').trim()
            langHint = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(raw) ? normalizeLang(raw) : ''
            startGoogle()
          } else if (m.type === 'stop') {
            stopGoogle()
            started = false // permite o nouă frază pe același WS
          }
        } catch {
          /* mesaj de control invalid — ignorat */
        }
        return
      }
      // audio binar → Google (pornește lazy dacă browserul a sărit „start")
      if (!started) startGoogle()
      if (gStream) {
        try {
          gStream.write({ audio: data } as protos.google.cloud.speech.v2.IStreamingRecognizeRequest)
        } catch {
          /* o bucată pierdută nu oprește fluxul */
        }
      }
    })

    const cleanup = (): void => {
      if (closed) return
      closed = true
      stopGoogle()
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  })
}
