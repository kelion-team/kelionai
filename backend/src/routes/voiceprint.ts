import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  getVoiceprint,
  getVoiceprintAudio,
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

// Rutele /save și /identify au fost SCOASE (auditul din 27 iul: zero apelanți —
// înrolarea și potrivirea se fac inline pe server, în chat.ts și realtime.ts).

export async function voiceprintRoutes(app: FastifyInstance): Promise<void> {
  // Întoarce amprenta userului logat (sau null dacă nu s-a înrolat încă).
  app.get('/api/voiceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const v = await getVoiceprint(user.email)
    return reply.send({ voiceprint: v })
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
