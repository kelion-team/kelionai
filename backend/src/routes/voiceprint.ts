import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  getVoiceprint,
  getVoiceprintAudio,
  listVoiceprints,
  saveVoiceprint,
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
  // Save or update the logged-in user's voiceprint, linking it permanently to their account.
  app.post<{
    Body: {
      vector?: number[]
      meta?: VoiceFeatureMeta
      clip?: string
      name?: string
    }
  }>('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { vector, meta, clip, name } = req.body || {}
    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      return reply.code(400).send({ error: 'invalid_vector' })
    }
    const metaObj: VoiceFeatureMeta = {
      pitchMean: meta?.pitchMean ?? 0,
      pitchMedian: meta?.pitchMedian,
      pitchStd: meta?.pitchStd ?? 0,
      pitchMin: meta?.pitchMin ?? 0,
      pitchMax: meta?.pitchMax ?? 0,
      centroid: meta?.centroid ?? 0,
      rolloff: meta?.rolloff ?? 0,
      zcr: meta?.zcr ?? 0,
      energy: meta?.energy ?? 0,
      jitter: meta?.jitter ?? 0,
      shimmer: meta?.shimmer ?? 0,
    }
    const gender = inferGender(metaObj.pitchMean || 0)
    const displayName = name || user.name || user.email.split('@')[0]
    const isAdmin = user.role === 'admin'

    await saveVoiceprint({
      email: user.email,
      name: displayName,
      gender,
      isAdmin,
      features: vector,
      featureMeta: metaObj,
      audioClip: clip || '',
    })

    const updated = await getVoiceprint(user.email)
    return reply.send({ ok: true, voiceprint: updated })
  })

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
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const rows = await listVoiceprints(200)
    return reply.send({ rows })
  })

  // The audio sample of a voiceprint — admin only. Returns the saved
  // data-URL so it can be played with the panel's "play" button (Adrian,
  // 14 Jul).
  app.get<{ Querystring: { email?: string } }>('/api/voiceprint/audio', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' }) // sesiune moartă ≠ „nu ești admin" (9 aug)
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = (req.query?.email ?? '').toLowerCase()
    if (!email) return reply.code(400).send({ error: 'bad_request' })
    const clip = await getVoiceprintAudio(email)
    if (!clip) return reply.code(404).send({ error: 'no_audio' })
    return reply.send({ clip })
  })

  // ȘTERGEREA E ÎNCHISĂ (ordinul ownerului, 14 aug: „amprentele vocale trebuie
  // să se păstreze"). Ruta rămâne ca orice apelant vechi să primească MOTIVUL,
  // nu un 404 mut; funcția de ștergere din db.ts a fost SCOASĂ de tot, iar
  // triggerul scutului din Postgres refuză DELETE chiar și pentru cod viitor.
  app.delete<{ Body: { email?: string } }>('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.code(403).send({
      ok: false,
      error: 'amprentele_se_pastreaza',
      motiv: 'Ordinul ownerului (14 aug): amprentele vocale se păstrează — nu se șterg prin nicio comandă.',
    })
  })
}

export function inferGender(pitchMeanHz: number): 'male' | 'female' | 'unknown' {
  if (pitchMeanHz <= 0 || !Number.isFinite(pitchMeanHz)) return 'unknown'
  if (pitchMeanHz < 145) return 'male'
  if (pitchMeanHz > 175) return 'female'
  return 'unknown'
}
