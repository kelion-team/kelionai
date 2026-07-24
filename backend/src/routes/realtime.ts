import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { getSpeechLang, getMeserieActiva, saveMessage } from '../db.js'
import { getMeserie } from '../services/meserii.js'
import { openaiRealtimeAnswer } from '../services/realtime.js'

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

      const offer = String(req.body?.sdp ?? '').trim()
      if (!offer) return reply.code(400).send({ error: 'bad_request: sdp required' })

      // Limba PERSISTATĂ a userului învinge; dacă nu are una salvată, folosim ce
      // trimite clientul; altfel română. Așa vocea rămâne pe aceeași limbă peste
      // sesiuni și peste orice escaladare de model — invizibil pentru user.
      const lang = (await getSpeechLang(user.email)) || req.body?.language || 'ro'

      let meserieName: string | null = null
      const meserieId = await getMeserieActiva(user.email)
      if (meserieId != null) meserieName = getMeserie(meserieId)?.nume ?? null

      const res = await openaiRealtimeAnswer(offer, lang, meserieName)
      if (!res.ok) {
        // Motivul REAL al refuzului (corpul erorii OpenAI) intră în log — altfel
        // în F12 se vede doar „502" și diagnoza e oarbă (Adrian, 24 iul).
        req.log.warn({ upstreamStatus: res.status, upstreamError: res.error }, 'realtime upstream refuz')
        const code = res.status === 503 ? 503 : 502
        return reply.code(code).send({ error: 'realtime_upstream', status: res.status })
      }
      // Clientul citește răspunsul ca text (answer SDP) → setRemoteDescription.
      return reply.header('content-type', 'application/sdp').send(res.sdp)
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
      return reply.send({ ok: true })
    },
  )
}
