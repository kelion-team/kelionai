import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { recordCost } from '../db.js'
import { ASR_USD_PER_CALL } from '../services/cost.js'
import { transcribe } from '../services/asr.js'

// Audio language identification + transcription via Google Cloud Speech-to-Text
// v2 (chirp_3, automatic language detection). This is what lets Kelion detect
// the spoken language FROM THE AUDIO itself — e.g. a Chinese speaker on an
// English browser — which text-based detection can't do (the browser recognizer
// would mis-transcribe first). The detected language then drives the browser
// recognizer + Chirp voice. Speech is Google-only per spec.
//
// The Google call lives in services/asr.ts (transcribe) — reused by the
// full-duplex voice agent via /api/bridge/voice-turn. This route only adds the
// session gate + cost accounting.

export async function asrRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { audio?: string; lang?: string } }>('/api/asr', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    const audio = req.body?.audio?.trim()
    if (!audio) return reply.code(400).send({ error: 'bad_request' })

    const r = await transcribe(audio, { langHint: (req.body?.lang ?? '').trim() })
    if (!r.ok) {
      if (r.status === 502) app.log.warn({ error: r.error }, 'google asr failed')
      return reply.code(r.status).send({ error: r.error.split(':')[0] })
    }
    void recordCost(user.email, 'asr', ASR_USD_PER_CALL)
    return reply.send({ lang: r.lang, transcript: r.transcript, confidence: r.confidence })
  })
}
