import type { FastifyInstance } from 'fastify'
import { v2, protos } from '@google-cloud/speech'
import { getSessionUser } from '../session.js'
import { recordCost, getSpeechLang } from '../db.js'
import { ASR_USD_PER_CALL } from '../services/cost.js'
import { normalizeLang } from '../services/tts.js'
import {
  CADRU_LINISTE,
  KEEPALIVE_CHECK_MS,
  RECONECTARI_MAX,
  RECONNECT_WINDOW_MS,
  alertaAdminUrechiChirp,
  clasificaEroareGoogle,
  noteazaEroareChirp,
  noteazaFallbackChirp,
  noteazaReconectareChirp,
  noteazaStreamChirp,
  trebuieCadruDeLiniste,
  trebuieFallbackDupaEroare,
} from '../services/urechiChirp.js'

// STREAMING ASR — Google Speech-to-Text v2 `_streamingRecognize`, with:
//   • advanced detection (chirp model — endpointing on the SERVER, not a local
//     RMS threshold),
//   • live PARTIAL results (interimResults) while Adrian speaks,
//   • voice activity events (SPEECH_ACTIVITY_BEGIN/END) → barge-in.
// The browser opens a WS to /api/asr-stream, sends PCM16 audio (LINEAR16,
// 16kHz, mono) in binary frames; we relay it to Google and push back
// {partial|final|speech_begin|speech_end}. The batch route /api/asr stays
// UNTOUCHED until cutover (zero duplication AFTER cutover, not during it).
//
// THE EARS NO LONGER DIE OF SILENCE (Adrian, Aug 2 — the live failure: Google
// «10 ABORTED: Stream timed out after receiving no more client requests» while
// nobody spoke). The client only streams when the local VAD hears voice
// (deliberate: silence isn't billed) — so an unfed Google stream used to idle
// out and die. Now:
//   1. KEEPALIVE — while the stream is open and no audio has flowed for
//      KEEPALIVE_IDLE_MS, we write a 100 ms frame of digital silence. Google
//      never idles out; the ear stays warm at ~1.2 billed seconds/minute.
//   2. TRANSPARENT RECONNECT — transient drops (idle timeout, UNAVAILABLE,
//      RST_STREAM, max stream lifetime) reopen the stream WITHOUT a word to
//      the client: the browser never declares the ear dead for those.
//   3. The client sees {type:'error'} ONLY on real persistent failure
//      (auth/config, or the reconnect budget exhausted) — and THAT is when the
//      admin gets paged instantly (see services/urechiChirp.ts). NU există
//      nicio ureche de rezervă (OpenAI extirpat, 3 aug): la eroare persistentă
//      auzul e JOS până la reparare — vechiul text „falls back to the paid
//      OpenAI ears" era fals și l-ar fi liniștit pe admin degeaba.

// Region + model come from the SINGLE source in services/asr.ts (the proven
// 'eu' multi-region — chirp_3 does NOT exist in us-central1 — and chirp_3
// everywhere). No local copies: the batch path and the streaming path can
// never drift apart.
import { GOOGLE_STT_REGION as REGION, GOOGLE_STT_MODEL as ASR_MODEL } from '../services/asr.js'
import { googleServiceAccount } from '../services/googleCreds.js'
import { pcm16InWav, transcrieGemini } from '../services/urecheGemini.js'
import { deschideUrecheaLive, urecheLiveDisponibila, type UrecheLive } from '../services/urecheLiveGemini.js'

// URECHEA PRINCIPALĂ = MODELUL SCUMP ÎN RAFALE (Adrian, 5 aug: „pune modelul
// scump pe ureche" — Gemini 3 Pro, precizie maximă „ca la Google, fără erori").
// Pro NU e model native-audio, deci NU poate face streaming full-duplex (codul
// urecheLiveGemini are dovada din producție că 3.x pe streaming iese MUT). Așa
// că urechea principală devine transcrierea în RAFALE (bucăți de ~3s) cu modelul
// GREU. Streaming-ul Live (partiale instant, native-audio 2.5) rămâne o treaptă
// restaurabilă instant prin env `URECHE_MOD=live`, fără să atingem creierul.
const URECHE_RAFALE_PRO = (process.env.URECHE_MOD || 'rafale') !== 'live'

let client: v2.SpeechClient | null = null
let projectId = ''
function getClient(): v2.SpeechClient | null {
  if (!client) {
    const creds = googleServiceAccount()
    if (!creds) return null
    projectId = creds.project_id ?? ''
    client = new v2.SpeechClient({
      credentials: creds as Record<string, unknown>,
      projectId: projectId || undefined,
      // regional endpoint — chirp lives on a region, not on global
      apiEndpoint: `${REGION}-speech.googleapis.com`,
    })
  }
  return client
}

// STREAMING STT = OPTIONAL, and on the host (VPS) it is NOT configured — live
// proof (Jul 28): the env file has no GOOGLE_SERVICE_ACCOUNT_JSON. Without it
// the WS below closed instantly, and the BROWSER (not our code) printed
// «WebSocket connection to 'wss://kelionai.app/api/asr-stream' failed» in
// Adrian's console at EVERY microphone start. That error cannot be caught
// from JS: the only way to make it disappear is for the browser to STOP
// opening the WS in vain. That's why we expose the capability over plain HTTP
// (the /api/asr-stream/capability route below), and the client asks it ONCE
// per page load.
// A CHEAP predicate, intentionally without `getClient()`: we don't build the
// Google client just to answer a public probe. It mirrors exactly the guard
// in the WS handler (`!c || !projectId`).
function streamingAsrConfigured(): boolean {
  // URECHEA PRINCIPALĂ E GEMINI (Adrian, 4 aug: „am cerut auzul pe Gemini …
  // full duplex ultra rapid"): streamingul există dacă avem cheia Gemini SAU
  // (doar ca ultimă treaptă, fără cheie) contul de serviciu pentru Chirp.
  return urecheLiveDisponibila() || Boolean(googleServiceAccount()?.project_id)
}

type GStream = ReturnType<v2.SpeechClient['_streamingRecognize']>
type Resp = protos.google.cloud.speech.v2.IStreamingRecognizeResponse

export async function asrStreamRoutes(app: FastifyInstance): Promise<void> {
  // CAPABILITY PROBE — plain HTTP, no session, no cost, no Google.
  // The browser asks it before opening the microphone: if `streaming:false`,
  // it doesn't even try the WS and switches DIRECTLY to batch dictation
  // (/api/asr — tot Google; fără nicio rezervă OpenAI, extirpat 3 aug) — so
  // dictation KEEPS working, just without live partials, console stays clean.
  // When Google IS configured it returns `true` and streaming works EXACTLY as
  // before — this route changes nothing on the happy path.
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
        /* already closed */
      }
      return
    }
    // URECHEA PRINCIPALĂ = GEMINI LIVE (full-duplex). Chirp rămâne DOAR pentru
    // cazul fără cheie Gemini; garda veche se aplică doar pe treapta aia.
    const geminiPrimar = urecheLiveDisponibila()
    const c = geminiPrimar ? null : getClient()
    if (!geminiPrimar && (!c || !projectId)) {
      // SAFETY NET for clients that didn't get to ask the probe above (old
      // cached page, failed probe). The pair (1011, 'asr_not_configured') is a
      // CONTRACT with frontend/src/lib/micStream.ts: on receiving it, the
      // client remembers for the whole session that streaming doesn't exist
      // and falls back to batch silently — no error, no retries.
      app.log.warn('asr-stream: WS refuzat — nici cheie Gemini, nici service account')
      try {
        socket.close(1011, 'asr_not_configured')
      } catch {
        /* already closed */
      }
      return
    }
    const numeUreche = geminiPrimar ? (URECHE_RAFALE_PRO ? 'gemini-pro-rafale' : 'gemini-live') : 'chirp'
    app.log.info(`asr-stream: WS conectat (sesiune OK, ureche=${numeUreche}) — aștept audio`)

    // DIAGNOSTIC (Adrian, Aug 2 — „urechea NU PORNEȘTE deloc", live): the
    // browser's watchdog fired «silent» (audio left the browser) while the
    // server journal showed NOTHING. The blind spot: we counted nowhere how
    // much audio ACTUALLY arrives on the socket. Now every socket reports at
    // close how many frames/bytes of client audio it received — the next live
    // test says instantly WHICH leg is deaf:
    //   0 cadre  → the browser/VAD never sent (client leg);
    //   N cadre  → the audio arrives here, the break is downstream (Google leg).
    let cadreAudioClient = 0
    let octetiAudioClient = 0
    let primulCadruLa = 0

    let gStream: GStream | null = null
    let started = false
    let closed = false
    let langHint = ''
    // LIMBA CUNOSCUTĂ A USERULUI — rezerva pentru chirp_3 când clientul nu trimite
    // un hint valid, ca să NU cădem pe 'auto' (care stâlcea româna — Adrian, 3 aug).
    // Adminul e mereu 'ro'. Ceilalți useri primesc limba lor STOCATĂ (getSpeechLang
    // — aceeași sursă ca i18n și calea realtime): odată ce limba unui user e
    // stabilită (2 mesaje → salvată per-user), urechea lui e corectă chiar dacă
    // hint-ul clientului lipsește. Doar un user NOU, fără limbă încă stabilită,
    // rămâne pe 'auto' (nu-i știm încă limba). Citită o dată, la conectare.
    let userLangFallback = user.role === 'admin' ? 'ro' : ''
    if (user.role !== 'admin') {
      void getSpeechLang(user.email)
        .then((l) => {
          userLangFallback = String(l ?? '').slice(0, 5)
        })
        .catch(() => {
          /* fără limbă stocată → rămâne '' (auto) */
        })
    }
    // Keepalive + transparent reconnect state (Aug 2 — see the header block).
    let keepalive: ReturnType<typeof setInterval> | null = null
    let ultimulAudioLa = 0 // last time ANY frame (voice or silence) went to Google
    let reconectari = 0 // transparent reconnects inside the current window
    let fereastraStart = Date.now()
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    // URECHEA GEMINI (Adrian, 3 aug seara: „auzul trebuie să fie pe Gemini")
    // — la eroare PERSISTENTĂ Chirp (ex: rol IAM pierdut), auzul nu mai moare:
    // comutăm pe transcriere în RAFALE prin Gemini (bucăți de ~3s, doar finale,
    // fără parțiale — degradat, dar viu). Chirp rămâne calea întâi.
    let urecheGemini = false
    let bufferGemini: Buffer[] = []
    let octetiGemini = 0
    let geminiTimer: ReturnType<typeof setInterval> | null = null
    let geminiInLucru = false
    // URECHEA LIVE (principală): sesiunea full-duplex Gemini. Dacă Live pică,
    // plasa e urechea în rafale (pornesteUrecheaGemini) — tot Gemini.
    let urecheLive: UrecheLive | null = null

    const pornesteUrecheaLive = (): void => {
      if (urecheLive || urecheGemini || closed) return
      urecheLive = deschideUrecheaLive(langHint, {
        onPartial: (text) => send({ type: 'partial', transcript: text }),
        onFinal: (text) => {
          send({ type: 'final', transcript: text, lang: langHint || null })
          void recordCost(user.email, 'asr', ASR_USD_PER_CALL)
        },
        onVorbireIncepe: () => send({ type: 'speech_begin' }),
        onVorbireSeTermina: () => send({ type: 'speech_end' }),
        onEroare: (motiv) => {
          if (closed) return
          app.log.warn('asr-stream: urechea Live Gemini a picat (' + motiv + ') — comut pe rafale Gemini')
          urecheLive?.inchide()
          urecheLive = null
          pornesteUrecheaGemini()
        },
      })
      if (urecheLive) app.log.info('asr-stream: urechea Live Gemini deschisă (model din GEMINI_LIVE_MODEL sau implicit)')
    }

    const pornesteUrecheaGemini = (): void => {
      if (urecheGemini || closed) return
      urecheGemini = true
      geminiTimer = setInterval(() => {
        // sub 0,6s de vorbă nu chemăm modelul (zgomot/atingeri de buton)
        if (closed || geminiInLucru || octetiGemini < 19_200) return
        const pcm = Buffer.concat(bufferGemini)
        bufferGemini = []
        octetiGemini = 0
        geminiInLucru = true
        const wav = pcm16InWav(pcm, 16_000)
        void transcrieGemini(wav.toString('base64'), 'audio/wav', langHint || undefined)
          .then((r) => {
            if (closed) return
            if (r.ok && r.transcript) {
              send({ type: 'final', transcript: r.transcript, lang: langHint || null })
              void recordCost(user.email, 'asr', ASR_USD_PER_CALL)
            } else if (!r.ok) {
              app.log.warn('asr-stream: urechea Gemini a refuzat o rafală: ' + r.error)
            }
          })
          .finally(() => {
            geminiInLucru = false
          })
      }, 3_000)
    }

    const send = (obj: unknown): void => {
      try {
        socket.send(JSON.stringify(obj))
      } catch {
        /* channel down — cleanup handles it */
      }
    }

    const stopKeepalive = (): void => {
      if (keepalive) {
        clearInterval(keepalive)
        keepalive = null
      }
    }

    // The stream dies at ~10s unfed; while the speaker is silent the client
    // sends NOTHING (deliberate — silence isn't billed), so WE feed Google a
    // 100 ms silence frame instead. The ear stays warm; a mere pause never
    // kills the stream (nici n-ar avea pe ce să cadă — nu există rezervă).
    const armKeepalive = (): void => {
      stopKeepalive()
      keepalive = setInterval(() => {
        if (closed || !gStream) return
        const acum = Date.now()
        if (!trebuieCadruDeLiniste(ultimulAudioLa, acum)) return
        try {
          gStream.write({ audio: CADRU_LINISTE } as protos.google.cloud.speech.v2.IStreamingRecognizeRequest)
          ultimulAudioLa = acum
        } catch {
          /* the stream's own error handler classifies and reconnects */
        }
      }, KEEPALIVE_CHECK_MS)
    }

    const stopGoogle = (): void => {
      stopKeepalive()
      if (gStream) {
        try {
          gStream.end()
        } catch {
          /* already finished */
        }
        gStream = null
      }
    }

    const startGoogle = (): void => {
      if (started || closed) return
      started = true
      // startGoogle rulează DOAR pe treapta Chirp (fără cheie Gemini), unde
      // garda de la conectare a garantat deja clientul — dar tipul rămâne
      // nullabil din cauza ramurii Gemini, deci verificăm onest.
      if (!c) {
        send({ type: 'error', error: 'asr_not_configured' })
        return
      }
      const recognizer = `projects/${projectId}/locations/${REGION}/recognizers/_`
      let stream: GStream
      try {
        stream = c._streamingRecognize()
      } catch (e) {
        // Was a SILENT catch (the only log was the client dying «silent» 15s
        // later — the exact blind spot of the Aug 2 live failure).
        const detail = String((e as { message?: string })?.message ?? e).slice(0, 400)
        app.log.error('asr-stream: _streamingRecognize() a aruncat sincron: ' + detail)
        noteazaEroareChirp(clasificaEroareGoogle(e), 'streamingRecognize-throw: ' + detail)
        send({ type: 'error', error: 'asr_failed' })
        return
      }
      gStream = stream

      stream.on('data', (resp: Resp) => {
        // voice events (server-side endpointing) → barge-in + "no cut-off"
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
        // DIAGNOSTIC (Adrian, Jul 14): we surface the REAL Google message in
        // the server journal, so we see EXACTLY why Google rejects.
        // Aug 2: the message no longer goes blindly to the client. Classified
        // first — an idle timeout or a transient drop reopens the stream
        // TRANSPARENTLY (the ear does NOT die); only a real persistent
        // failure (auth/config, or the reconnect budget exhausted) reaches
        // the client AND pages the admin instantly.
        const detail = String((e as { message?: string })?.message ?? e).slice(0, 400)
        if (gStream !== stream && gStream !== null) return // late error from an already-replaced stream
        const cauza = clasificaEroareGoogle(e)
        noteazaEroareChirp(cauza, detail)
        if (gStream === stream) {
          gStream = null
          stopKeepalive()
        }
        started = false
        if (Date.now() - fereastraStart > RECONNECT_WINDOW_MS) {
          fereastraStart = Date.now()
          reconectari = 0
        }
        if (closed) return
        if (trebuieFallbackDupaEroare(cauza, reconectari, RECONECTARI_MAX)) {
          // Chirp e JOS persistent — dar auzul NU mai moare (Adrian, 3 aug:
          // „auzul trebuie să fie pe Gemini"): comutăm pe urechea Gemini în
          // rafale. Adminul tot e anunțat (Chirp rămâne de reparat), însă
          // clientul nu mai primește 'error' — microfonul curge mai departe.
          app.log.error(`asr-stream: eroare PERSISTENTĂ Chirp (${cauza}) — comut auzul pe urechea Gemini (rafale, fără parțiale): ` + detail)
          noteazaFallbackChirp(detail)
          pornesteUrecheaGemini()
          void alertaAdminUrechiChirp(cauza, detail + ' — auzul a comutat pe urechea Gemini (degradat, dar viu)')
          return
        }
        reconectari++
        noteazaReconectareChirp()
        app.log.warn(`asr-stream: eroare tranzitorie (${cauza}) — reconectare transparentă #${reconectari}: ` + detail)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          startGoogle()
        }, 300)
      })
      stream.on('end', () => {
        if (gStream === stream) {
          gStream = null
          stopKeepalive()
        }
        started = false // allows a restart on the same socket if Google closes the stream
      })

      // The FIRST request = config ONLY (no audio); then only {audio} frames.
      try {
        stream.write({
          recognizer,
          streamingConfig: {
            config: {
              model: ASR_MODEL,
              // anchor the language if Adrian has one set; otherwise auto.
              languageCodes: langHint ? [langHint] : ['auto'],
              // the browser sends raw PCM16 (LINEAR16, 16kHz, mono)
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
        noteazaStreamChirp()
        ultimulAudioLa = Date.now()
        armKeepalive() // Google never idles out from now on — see the header block
      } catch (e) {
        // Was a SILENT catch — same blind spot as above: a bad config write
        // killed the stream with NO journal trace and the client died «silent».
        const detail = String((e as { message?: string })?.message ?? e).slice(0, 400)
        app.log.error('asr-stream: scrierea configului către Google a aruncat: ' + detail)
        noteazaEroareChirp(clasificaEroareGoogle(e), 'config-write-throw: ' + detail)
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
            const clientLang = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(raw) ? normalizeLang(raw) : ''
            // Limba pentru chirp_3: întâi hint-ul clientului; dacă lipsește, limba
            // CUNOSCUTĂ a userului (admin → 'ro', ceilalți → limba lor stocată), ca
            // să NU cădem pe 'auto' (care stâlcea româna — „E surt hanspuskelion").
            // Un user nou, fără limbă stabilită, ajunge pe 'auto' (nu-i știm limba).
            langHint = clientLang || (userLangFallback ? normalizeLang(userLangFallback) : '')
            // Log de diagnostic: ce limbă folosește Chirp de fapt (măsurabil pe
            // următoarea încercare reală — 'auto' vs 'ro-RO' — fără a ghici).
            app.log.info(
              `asr-stream: limbă = ${langHint || 'auto'} (rol=${user.role}, hint client='${raw}', stocat='${userLangFallback}')`,
            )
            if (geminiPrimar && URECHE_RAFALE_PRO) pornesteUrecheaGemini()
            else if (geminiPrimar) pornesteUrecheaLive()
            else startGoogle()
          } else if (m.type === 'stop') {
            if (urecheLive) {
              urecheLive.inchide()
              urecheLive = null
            }
            stopGoogle()
            started = false // allows a new phrase on the same WS
          }
        } catch {
          /* invalid control message — ignored */
        }
        return
      }
      // binary audio → Google (starts lazy if the browser skipped "start")
      cadreAudioClient++
      octetiAudioClient += data.length
      if (!primulCadruLa) {
        primulCadruLa = Date.now()
        app.log.info(`asr-stream: primul cadru audio de la client (${data.length} bytes) — urechea primește semnal`)
      }
      // Urechea LIVE (principala): audio-ul curge direct în sesiunea Gemini.
      if (urecheLive) {
        urecheLive.scrieAudio(Buffer.from(data))
        return
      }
      // Pe urechea în rafale audio-ul se ADUNĂ pentru rafala următoare.
      if (urecheGemini) {
        bufferGemini.push(Buffer.from(data))
        octetiGemini += data.length
        return
      }
      if (geminiPrimar) {
        // clientul a sărit peste 'start' — pornim leneș urechea corectă
        if (URECHE_RAFALE_PRO) {
          pornesteUrecheaGemini()
          bufferGemini.push(Buffer.from(data))
          octetiGemini += data.length
          return
        }
        pornesteUrecheaLive()
        if (urecheLive) {
          ;(urecheLive as UrecheLive).scrieAudio(Buffer.from(data))
          return
        }
      }
      if (!started) startGoogle()
      if (gStream) {
        try {
          gStream.write({ audio: data } as protos.google.cloud.speech.v2.IStreamingRecognizeRequest)
          ultimulAudioLa = Date.now() // real voice also feeds the keepalive clock
        } catch {
          /* one lost chunk doesn't stop the stream */
        }
      }
    })

    const cleanup = (): void => {
      if (closed) return
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (geminiTimer) {
        clearInterval(geminiTimer)
        geminiTimer = null
      }
      if (urecheLive) {
        urecheLive.inchide()
        urecheLive = null
      }
      // THE VERDICT LINE (Aug 2): 0 cadre = the browser leg never spoke (VAD /
      // mic / muted client-side); N cadre = the audio DID arrive — the break
      // is downstream. One line per socket, at close.
      app.log.info(
        `asr-stream: WS închis — ${cadreAudioClient} cadre audio de la client ` +
          `(${(octetiAudioClient / 32 / 1000).toFixed(1)}s la 16kHz)` +
          (primulCadruLa ? '' : ' — NICIUN cadru primit pe acest socket'),
      )
      stopGoogle()
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  })
}
