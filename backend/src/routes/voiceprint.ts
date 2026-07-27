import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { config } from '../config.js'
import {
  saveVoiceprint,
  getVoiceprint,
  getVoiceprintAudio,
  identifyVoiceprint,
  listVoiceprints,
  deleteVoiceprint,
  type VoiceFeatureMeta,
} from '../db.js'

// Sistem de identificare a vorbitorului după timbru vocal.
// Frontul extrage features 100% client-side (zero cost) din fiecare frază
// înregistrată; backendul le compară cu amprentele salvate în Postgres și
// adaugă contextul (nume, gen, voce verificată admin) în promptul creierului.

export interface VoiceFeatures {
  /** Vectorul normalizat folosit la comparare. */
  vector: number[]
  /** Metadate interpretabile (Hz, proporții etc.). */
  meta: VoiceFeatureMeta
  /** Mostră audio scurtă (data-URL webm/opus) a frazei — pentru butonul „play" din admin. */
  clip?: string
}

const IDENTIFY_THRESHOLD = 0.38 // distanță euclidiană normalizată sub care e considerat match

export async function voiceprintRoutes(app: FastifyInstance): Promise<void> {
  // Salvează / actualizează amprenta vocală a userului logat.
  app.post<{ Body: { name?: string; features?: VoiceFeatures } }>(
    '/api/voiceprint/save',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const features = req.body?.features
      if (!features?.vector?.length || !features?.meta) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      const name = (req.body?.name ?? user.name ?? user.email.split('@')[0]).slice(0, 120)
      const gender = inferGender(features.meta.pitchMean)
      const isAdmin = user.email.toLowerCase() === config.adminEmail.toLowerCase()
      await saveVoiceprint({
        email: user.email,
        name,
        gender,
        isAdmin,
        features: features.vector,
        featureMeta: features.meta,
        audioClip: typeof features.clip === 'string' ? features.clip : '',
      })
      return reply.send({ ok: true, gender, isAdmin })
    },
  )

  // Întoarce amprenta userului logat (sau null dacă nu s-a înrolat încă).
  app.get('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const v = await getVoiceprint(user.email)
    return reply.send({ voiceprint: v })
  })

  // Identifică un speaker după features primite.
  app.post<{ Body: { features?: VoiceFeatures } }>('/api/voiceprint/identify', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const features = req.body?.features
    if (!features?.vector?.length || !features?.meta) {
      return reply.code(400).send({ error: 'bad_request' })
    }
    const match = await identifyVoiceprint(features.vector, IDENTIFY_THRESHOLD)
    const gender = inferGender(features.meta.pitchMean)
    return reply.send({
      gender,
      match: match
        ? {
            email: match.email,
            name: match.name,
            gender: match.gender,
            isAdmin: match.isAdmin,
            distance: match.distance,
          }
        : null,
    })
  })

  // Lista tuturor amprentelor — doar admin.
  app.get('/api/voiceprint/list', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const rows = await listVoiceprints(200)
    return reply.send({ rows })
  })

  // Mostra audio a unei amprente — doar admin. Întoarce data-URL-ul salvat ca să
  // poată fi redat cu butonul „play" din panou (Adrian, 14 iul).
  app.get<{ Querystring: { email?: string } }>('/api/voiceprint/audio', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = (req.query?.email ?? '').toLowerCase()
    if (!email) return reply.code(400).send({ error: 'bad_request' })
    const clip = await getVoiceprintAudio(email)
    if (!clip) return reply.code(404).send({ error: 'no_audio' })
    return reply.send({ clip })
  })

  // Șterge amprenta vocală a userului logat (sau a altui user, doar pentru admin).
  app.delete<{ Body: { email?: string } }>('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const targetEmail =
      user.role === 'admin' && req.body?.email ? req.body.email.toLowerCase() : user.email.toLowerCase()
    const ok = await deleteVoiceprint(targetEmail)
    return reply.send({ ok })
  })
}

export function inferGender(pitchMeanHz: number): 'male' | 'female' | 'unknown' {
  if (pitchMeanHz <= 0 || !Number.isFinite(pitchMeanHz)) return 'unknown'
  if (pitchMeanHz < 145) return 'male'
  if (pitchMeanHz > 175) return 'female'
  return 'unknown'
}
