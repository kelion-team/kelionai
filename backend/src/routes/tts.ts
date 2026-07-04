import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { recordCost } from '../db.js'
import { ttsCost } from '../services/cost.js'
import { synthesize } from '../services/tts.js'

// Google Cloud Text-to-Speech — Chirp 3 HD (male, academic). Returns MP3 audio.
// The synth itself lives in services/tts.ts (shared with the public /api/greet
// landing greeting); this route adds the session gate + cost accounting.

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string; lang?: string } }>('/api/tts', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    const text = req.body?.text?.trim()
    if (!text) return reply.code(400).send({ error: 'bad_request' })

    try {
      const r = await synthesize(text, req.body?.lang)
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
