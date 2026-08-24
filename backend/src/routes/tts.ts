import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { getVoicePref } from '../db.js'
import { esteAdminKelion } from '../services/adminIdentity.js'
import { synthesize, openaiTtsAvailable, ttsConfigured, TTS_MAX_CHARS } from '../services/tts.js'

// Upload-style text-to-speech. Live voice stays on OpenAI Realtime; this route
// uses the configured OpenAI speech model. Offline speech remains on-device.

// The request cap, in ONE place (frontend audit, Aug 2): the promo narrator
// used to hardcode its own 3500 next to this 5000 — two constants, no
// contract, and lowering the server cap would have silently truncated clips.
// Now the status probe PUBLISHES the cap and the client chunks against it.
export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  // ENGINE STATUS (Adrian, Aug 2 — the frontend polls this to decide which
  // mouth to open). BOOLEANS ONLY — a key never leaves the server.
  app.get('/api/tts/status', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return {
      available: ttsConfigured(),
      engine: openaiTtsAvailable() ? 'openai' : null,
      maxChars: TTS_MAX_CHARS,
    }
  })

  app.post<{ Body: { text?: string; lang?: string } }>('/api/tts', {
    bodyLimit: 20_000,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    // This upload-style endpoint exists only for the owner's promo recorder.
    // Customer chat/call voice is billed on its parent turn/session.
    if (!esteAdminKelion(user.email)) return reply.code(403).send({ error: 'forbidden' })

    // Character cap: online synthesis is paid and must have a bounded body —
    // one client could send ~24MB of text at 120 req/min = a huge bill.
    const text = req.body?.text?.trim()
    if (!text) return reply.code(400).send({ error: 'bad_request' })
    if (text.length > TTS_MAX_CHARS) return reply.code(413).send({ error: 'tts_text_too_large' })

    try {
      const r = await synthesize(text, req.body?.lang, {
        voice: await getVoicePref(user.email).catch(() => null),
        usageContext: { userEmail: user.email, surface: 'promo_tts' },
      })
      if (!r.ok) {
        if (r.status >= 500) app.log.warn({ status: r.status, error: r.error }, 'tts failed')
        return reply.code(r.status).send({ error: r.error })
      }
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-store')
      return reply.send(r.audio)
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'tts_failed' })
    }
  })
}
