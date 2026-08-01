import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { recordCost, getVoicePref } from '../db.js'
import { ttsCost } from '../services/cost.js'
import { synthesize } from '../services/tts.js'

// Google Cloud Text-to-Speech — Chirp 3 HD (male, academic). Returns MP3 audio.
// The synth itself lives in services/tts.ts (shared with the public /api/greet
// landing greeting); this route adds the session gate + cost accounting.

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string; lang?: string } }>('/api/tts', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // 5000-character cap: /api/tts hits Google TTS (paid) and had no limit —
    // one client could send ~24MB of text at 120 req/min = a huge bill.
    const text = req.body?.text?.trim()?.slice(0, 5000)
    if (!text) return reply.code(400).send({ error: 'bad_request' })

    try {
      // THE SAME VOICE AS THE LIVE VOICE (C4). Without this, the user picked a
      // voice in Settings, heard it in full-duplex, and the written chat replied
      // with someone else.
      const r = await synthesize(text, req.body?.lang, { voice: await getVoicePref(user.email).catch(() => null) })
      if (!r.ok) {
        if (r.status >= 500) app.log.warn({ status: r.status, error: r.error }, 'google tts failed')
        return reply.code(r.status).send({ error: r.error })
      }
      void recordCost(user.email, 'tts', ttsCost(text.length))
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-store')
      return reply.send(r.audio)
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'tts_failed' })
    }
  })
}
