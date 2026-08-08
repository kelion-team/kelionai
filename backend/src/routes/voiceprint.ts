import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  getVoiceprint,
  getVoiceprintAudio,
  listVoiceprints,
  deleteVoiceprint,
  type VoiceFeatureMeta,
} from '../db.js'

// Speaker identification system by voice timbre.
// The frontend extracts features 100% client-side (zero cost) from each
// recorded phrase; the backend compares them with the voiceprints saved in
// Postgres and adds the context (name, gender, admin-verified voice) to the
// brain's prompt.

export interface VoiceFeatures {
  /** The normalized vector used for comparison. */
  vector: number[]
  /** Interpretable metadata (Hz, ratios etc.). */
  meta: VoiceFeatureMeta
  /** A short audio sample (webm/opus data-URL) of the phrase — for the "play" button in admin. */
  clip?: string
}

// The /save and /identify routes were REMOVED (the 27 Jul audit: zero
// callers — enrolment and matching happen inline on the server, in chat.ts
// and realtime.ts).

export async function voiceprintRoutes(app: FastifyInstance): Promise<void> {
  // Returns the logged-in user's voiceprint (or null if not enrolled yet).
  app.get('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const v = await getVoiceprint(user.email)
    return reply.send({ voiceprint: v })
  })

  // The list of all voiceprints — admin only.
  app.get('/api/voiceprint/list', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const rows = await listVoiceprints(200)
    return reply.send({ rows })
  })

  // The audio sample of a voiceprint — admin only. Returns the saved
  // data-URL so it can be played with the panel's "play" button (Adrian,
  // 14 Jul).
  app.get<{ Querystring: { email?: string } }>('/api/voiceprint/audio', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = (req.query?.email ?? '').toLowerCase()
    if (!email) return reply.code(400).send({ error: 'bad_request' })
    const clip = await getVoiceprintAudio(email)
    if (!clip) return reply.code(404).send({ error: 'no_audio' })
    return reply.send({ clip })
  })

  // Deletes the logged-in user's voiceprint (or another user's, admin only).
  app.delete<{ Body: { email?: string } }>('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const targetEmail =
      user.role === 'admin' && req.body?.email ? req.body.email.toLowerCase() : user.email.toLowerCase()
    const ok = await deleteVoiceprint(targetEmail)
    // 200 cu `{ok:false}` însemna „ștergere reușită" pentru orice apelant care
    // se uită la status (panoul se uită și la corp, dar uneltele lui Kelion și
    // scripturile nu). `deleteVoiceprint` întoarce `true` și când n-a găsit
    // rândul, deci `false` = ștergerea chiar a picat. Măsurat 8 aug.
    if (!ok) return reply.code(502).send({ ok: false, error: 'stergere_esuata' })
    return reply.send({ ok })
  })
}

export function inferGender(pitchMeanHz: number): 'male' | 'female' | 'unknown' {
  if (pitchMeanHz <= 0 || !Number.isFinite(pitchMeanHz)) return 'unknown'
  if (pitchMeanHz < 145) return 'male'
  if (pitchMeanHz > 175) return 'female'
  return 'unknown'
}
