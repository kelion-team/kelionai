import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, getMeserieActiva, saveMessage } from '../db.js'
import { trackSpeechLang, langLabel } from '../services/lang.js'
import { getMeserie } from '../services/meserii.js'
import { openaiRealtimeAnswer } from '../services/realtime.js'
import { isQuotaError, alertOpenAiQuota } from '../services/openaiAlert.js'
import { runGoogleTool, refreshGoogleAccessToken } from '../services/google.js'
import { generateImage } from '../services/image.js'
import { brainComplete, describeScene } from '../services/brain.js'
import { SYSTEM_PROMPT } from './chat.js'

// ── VOCE LIVE (OpenAI Realtime) — endpointuri aduse în git ca sursă unică ────
// /api/realtime/session : proxy SDP. Clientul (browser WebRTC) trimite oferta
//   SDP + limba; backendul relayează la OpenAI cu cheia pe server și injectează
//   modelul + o singură voce masculină + persona în limba PERSISTATĂ a userului.
// /api/realtime/transcript : salvează în istoric ce s-a vorbit (pentru memorie
//   și continuitate între sesiuni), la fel ca o tură de chat.
//
// FĂRĂ tier gratuit: vocea cere utilizator logat (Adrian: „se scot minutele de
// test, userii cumpără să probeze"). Vocea de prezentare de pe landing (fără
// login, plătită din contul admin) e tratată separat, în alt endpoint.
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { sdp?: string; language?: string } }>(
    '/api/realtime/session',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      const raw = String(req.body?.sdp ?? '')
      if (!raw.trim()) return reply.code(400).send({ error: 'bad_request: sdp required' })
      // NU trim(): SDP-ul se termină obligatoriu cu \r\n — .trim() îl tăia și
      // parserul OpenAI (pion) dădea „unmarshal SDP: EOF" (cauza „nu mă aude").
      const offer = raw.endsWith('\n') ? raw : raw + '\r\n'

      // LIMBA (Adrian, 24 iul — regulă FINALĂ, obligatorie: „default pornirea
      // engleză; ADMIN = română mereu; restul userilor detectează și menține per
      // user"). ADMINUL (Adrian) vorbește ROMÂNĂ fix — pinăm și transcrierea pe
      // română, ca vorbirea lui să nu mai fie auzită greșit ca rusă (dovadă live:
      // Kelion îi răspundea în rusă). Restul: limba PERSISTATĂ dintr-o
      // interacțiune reală; dacă n-au una → GOL → pornesc în engleză și oglindesc.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      let lang: string
      if (isAdmin) {
        lang = 'ro'
      } else {
        lang = String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = ''
      }

      let meserieName: string | null = null
      const meserieId = await getMeserieActiva(user.email)
      if (meserieId != null) meserieName = getMeserie(meserieId)?.nume ?? null

      // hardLock = adminul (Adrian) — română MEREU, fără comutare pe italiană.
      const res = await openaiRealtimeAnswer(offer, lang, meserieName, isAdmin)
      if (!res.ok) {
        // Motivul REAL al refuzului (corpul erorii OpenAI) intră în log — altfel
        // în F12 se vede doar „502" și diagnoza e oarbă (Adrian, 24 iul).
        req.log.warn(
          { upstreamStatus: res.status, upstreamError: res.error, sdpLen: offer.length, sdpHead: offer.slice(0, 40) },
          'realtime upstream refuz',
        )
        // CONT FĂRĂ CREDIT (incident 24 iul: vocea moartă, descoperită abia la
        // test): anunțăm adminul pe email IMEDIAT, nu la următorul test manual.
        if (isQuotaError(res.error)) alertOpenAiQuota()
        const code = res.status === 503 ? 503 : 502
        return reply.code(code).send({ error: 'realtime_upstream', status: res.status })
      }
      // Clientul citește răspunsul ca text (answer SDP) → setRemoteDescription.
      return reply.header('content-type', 'application/sdp').send(res.sdp)
    },
  )

  // EXECUȚIA UNELTELOR DIN VOCE (autonomia vocii — Adrian, 24 iul). Modelul
  // Realtime cere o funcție pe dataChannel; clientul o trimite AICI; serverul o
  // rulează cu cheile lui (aceleași unelte ca chatul scris) și întoarce
  // rezultatul + eventualul screen_url pe care clientul îl pune pe monitor.
  app.post<{ Body: { name?: string; args?: unknown } }>(
    '/api/realtime/tool',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const name = String(req.body?.name ?? '').trim()
      const args = (req.body?.args ?? {}) as Record<string, unknown>
      if (!name) return reply.code(400).send({ error: 'bad_request' })

      // Token Google proaspăt (ca în chat) pentru uneltele Gmail/Calendar/etc.
      let token = user.googleAccessToken ?? ''
      if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
        const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
        if (refreshed) token = refreshed.accessToken
      }

      // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). Clientul capturează un cadru
      // din cameră și-l trimite în args.image; îl dăm unui model cu vedere și
      // întoarcem o descriere de rostit. Fără cameră/cadru → mesaj clar.
      if (name === 'look' || name === 'see') {
        const image = String((args as { image?: string }).image ?? '')
        const question = String(args.question ?? args.request ?? '').trim()
        if (!/^data:image\//.test(image)) {
          return reply.send({ output: JSON.stringify({ error: 'no_camera', hint: 'camera closed' }) })
        }
        const seen = await describeScene(image, question)
        return reply.send({ output: seen || JSON.stringify({ error: 'vision_unavailable' }) })
      }

      // ESCALADAREA ÎN VOCE: cererile grele merg la CREIER (modelul work). PÂNĂ pe
      // 25 iul asta era o A DOUA persona, hardcodată în română pentru toți userii,
      // fără memorie — divergentă de escaladarea din scris (Adrian: „softul are
      // dubluri de versiuni"). Acum pornește din ACEEAȘI personă (SYSTEM_PROMPT)
      // și limba REALĂ a userului, ca escaladarea din scris.
      if (name === 'ask_brain') {
        const request = String(args.request ?? '').trim()
        if (!request) return reply.send({ output: JSON.stringify({ error: 'empty_request' }) })
        const isAdmin = user.email.toLowerCase() === config.adminEmail
        let lang = isAdmin ? 'ro' : String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = 'en'
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          `VOICE ESCALATION: the fast voice model handed you a request it judged too hard. Answer it fully ` +
          `but CONCISELY, as plain text to be SPOKEN aloud (no markdown, no lists). Speak ONLY in ` +
          `${langLabel(lang)} — never switch, regardless of the language mixed into the request below.\n\n${request}`
        const answer = await brainComplete(prompt, 2000)
        return reply.send({ output: answer || JSON.stringify({ error: 'brain_unavailable' }) })
      }

      if (name === 'generate_image') {
        const prompt = String(args.prompt ?? '')
        if (!prompt) return reply.send({ output: JSON.stringify({ error: 'no_prompt' }) })
        const r = await generateImage(prompt)
        if ('error' in r) return reply.send({ output: JSON.stringify({ error: r.error }) })
        const url = `https://${req.headers.host ?? 'kelionai.app'}/api/image/${r.id}`
        return reply.send({ output: JSON.stringify({ shown: true, url }), screen: { url, title: 'Imagine' } })
      }

      const out = await runGoogleTool(name, args, token)
      // screen_url din rezultat → clientul deschide monitorul (ca în chat).
      let screen: { url: string; title: string } | undefined
      try {
        const j = JSON.parse(out) as { screen_url?: string }
        if (j.screen_url) {
          const url = /^https?:/i.test(j.screen_url)
            ? j.screen_url
            : `https://${req.headers.host ?? 'kelionai.app'}${j.screen_url}`
          screen = { url, title: name.replace(/_/g, ' ') }
        }
      } catch {
        /* rezultat non-JSON — doar text pentru model */
      }
      return reply.send({ output: out.slice(0, 6000), screen })
    },
  )

  app.post<{ Body: { role?: string; text?: string } }>(
    '/api/realtime/transcript',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const text = String(req.body?.text ?? '').trim()
      const role = req.body?.role === 'assistant' ? 'assistant' : 'user'
      if (text) await saveMessage(user.email, role, text)
      // DETECȚIA LIMBII DIN VOCE (audit 24 iul, P4 — Adrian: „nu depistează
      // limba vorbită"). Chatul scris persista limba prin trackSpeechLang, dar
      // vocea NU o făcea niciodată → sesiunea următoare pornea iar de la zero.
      // Aceeași regulă ca în scris: limba nouă confirmată pe 2 mesaje
      // consecutive → persistată per user; sesiunile viitoare pornesc direct în ea.
      // ADMIN = română MEREU (Adrian, în Italia): NU comităm și NU re-pinăm
      // limba din vorbire — altfel, dacă spune/aude italiană, sesiunea live ar
      // comuta pe italiană („2 voci: ro și italiană"). Rămâne blocat pe română.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      // ADMIN: ancorăm sesiunea live pe română la FIECARE tură (clientul face
      // session.update) — transcrierea nu mai poate aluneca spre altă limbă.
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro' })
      if (text && role === 'user' && !isAdmin) {
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        // ANCORAREA LIMBII ÎN SESIUNEA LIVE (Adrian, 24 iul: „limba fără
        // detecție e aleatoare"): fără ancoră, transcrierea ghicește FIECARE
        // frază independent (româna iese spaniolă/franceză la întâmplare) și
        // otrăvește detecția. Întoarcem limba comisă → clientul o fixează PE
        // LOC în sesiunea Realtime (session.update), fără repornire.
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase() })
      }
      return reply.send({ ok: true })
    },
  )
}
