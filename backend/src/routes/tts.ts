import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { recordCost, getVoicePref } from '../db.js'
import { config } from '../config.js'
import { ttsCost } from '../services/cost.js'
import { synthesize, googleTtsAvailable } from '../services/tts.js'

// Google Cloud Text-to-Speech — Chirp 3 HD is the PRIMARY voice (male, in any
// language); OpenAI TTS is strictly the reserve (Adrian, Aug 2: "openai
// ramine rezerva doar daca google pica"). The synth itself lives in
// services/tts.ts (shared with the chat voice path); this route adds the
// session gate + cost accounting + the engine-status probe.

// The request cap, in ONE place (frontend audit, Aug 2): the promo narrator
// used to hardcode its own 3500 next to this 5000 — two constants, no
// contract, and lowering the server cap would have silently truncated clips.
// Now the status probe PUBLISHES the cap and the client chunks against it.
export const TTS_MAX_CHARS = 5000

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  // ENGINE STATUS (Adrian, Aug 2 — the frontend polls this to decide which
  // mouth to open). BOOLEANS ONLY — a key never leaves the server.
  app.get('/api/tts/status', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return { google: googleTtsAvailable(), openai: !!config.openai.key, maxChars: TTS_MAX_CHARS }
  })

  app.post<{ Body: { text?: string; lang?: string } }>('/api/tts', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // Character cap: /api/tts hits Google TTS (paid) and had no limit —
    // one client could send ~24MB of text at 120 req/min = a huge bill.
    const text = req.body?.text?.trim()?.slice(0, TTS_MAX_CHARS)
    if (!text) return reply.code(400).send({ error: 'bad_request' })

    try {
      // THE USER'S CHOSEN VOICE still reaches the OpenAI reserve (C4): without
      // it, the user picked a voice in Settings, heard it in full-duplex, and
      // the written chat replied with someone else. Google Chirp (primary) has
      // ONE male voice in every language, per the Aug 2 order.
      const r = await synthesize(text, req.body?.lang, { voice: await getVoicePref(user.email).catch(() => null) })
      if (!r.ok) {
        if (r.status >= 500) app.log.warn({ status: r.status, error: r.error }, 'tts failed')
        return reply.code(r.status).send({ error: r.error })
      }
      // Engine-labeled cost (Adrian, Aug 2 — Google primary, OpenAI reserve):
      // ttsCost is the Chirp 3 HD rate ($30/1M chars); the kind says WHICH
      // engine actually spoke, so the admin ledger can tell them apart.
      void recordCost(user.email, `tts:${r.engine}`, ttsCost(text.length))
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-store')
      return reply.send(r.audio)
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'tts_failed' })
    }
  })
}
