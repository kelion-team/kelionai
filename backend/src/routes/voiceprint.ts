import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  deleteVoiceprint,
  getVoiceprint,
  saveVoiceprint,
  type VoiceFeatureMeta,
  type VoiceprintRow,
} from '../db.js'
import { replaceControlCharacters } from '../shared/textSanitization.js'

/**
 * This is an explicitly enrolled spectral profile used for user-scoped voice
 * personalisation. It is not neural speaker identification and never grants
 * permissions or an admin role.
 */
const MAX_VECTOR = 256
const MAX_CLIP_BYTES = 450 * 1024

type VoiceprintValid = {
  ok: true
  vector: number[]
  meta: VoiceFeatureMeta
  clip: string
  name: string
} | { ok: false; error: string }

export function valideazaVoiceprintPayload(input: unknown, fallbackName: string): VoiceprintValid {
  if (!input || typeof input !== 'object') return { ok: false, error: 'corp_invalid' }
  const body = input as Record<string, unknown>
  if (!Array.isArray(body.vector) || body.vector.length < 3 || body.vector.length > MAX_VECTOR) {
    return { ok: false, error: 'invalid_vector' }
  }
  const vector = body.vector.map(Number)
  if (!vector.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    return { ok: false, error: 'invalid_vector' }
  }
  if (!body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta)) {
    return { ok: false, error: 'invalid_meta' }
  }
  const centroid = Number((body.meta as Record<string, unknown>).centroid)
  if (!Number.isFinite(centroid) || centroid < 0 || centroid > 24_000) {
    return { ok: false, error: 'invalid_meta' }
  }
  const meta: VoiceFeatureMeta = { centroid }

  let clip = ''
  if (body.clip != null && body.clip !== '') {
    if (typeof body.clip !== 'string') return { ok: false, error: 'invalid_clip' }
    const match = /^data:audio\/(webm|ogg|wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.clip)
    if (!match) return { ok: false, error: 'invalid_clip' }
    const bytes = Buffer.from(match[2], 'base64')
    const type = match[1]
    const webm = type === 'webm' && bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    const ogg = type === 'ogg' && bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS'
    const wav = type === 'wav' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
    if (!bytes.length || bytes.length > MAX_CLIP_BYTES || (!webm && !ogg && !wav)) {
      return { ok: false, error: 'invalid_clip' }
    }
    clip = body.clip
  }
  const proposed = typeof body.name === 'string'
    ? replaceControlCharacters(body.name, '').trim()
    : ''
  return { ok: true, vector, meta, clip, name: (proposed || fallbackName).slice(0, 100) }
}

const availability = {
  method: 'spectral_profile' as const,
  neuralSpeakerIdentification: false,
  authority: 'personalisation_only' as const,
}

function metadataVoiceprint(profile: VoiceprintRow | null): null | {
  name: string
  hasAudio: boolean
  updatedAt: string
} {
  if (!profile) return null
  return {
    name: profile.name,
    hasAudio: profile.hasAudio,
    updatedAt: profile.updatedAt,
  }
}

export async function voiceprintRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { vector?: number[]; meta?: VoiceFeatureMeta; clip?: string; name?: string } }>(
    '/api/voiceprint/me',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const valid = valideazaVoiceprintPayload(req.body, user.name || user.email.split('@')[0])
      if (!valid.ok) return reply.code(400).send({ error: valid.error })
      await saveVoiceprint({
        email: user.email,
        name: valid.name,
        features: valid.vector,
        featureMeta: valid.meta,
        audioClip: valid.clip,
      })
      return reply.send({
        ok: true,
        voiceprint: metadataVoiceprint(await getVoiceprint(user.email)),
        availability,
      })
    },
  )

  app.get('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({
      voiceprint: metadataVoiceprint(await getVoiceprint(user.email)),
      availability,
    })
  })

  app.delete('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const deleted = await deleteVoiceprint(user.email)
    return reply.send({ ok: true, deleted })
  })
}
