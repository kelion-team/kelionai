import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { adaugaEvenimentSonor, evenimenteSonoreRecente, evenimenteUrgente, type EvenimentSonorStocat } from '../services/auzAmbiental.js'

// ── RUTA AUZULUI AMBIENTAL (owner, 22 aug 2026: „simte mediul") ──────────────
// Frontend trimite evenimente sonore detectate aici. Le stocăm in-memory.
// Creierul le accesează prin tool-ul `evenimente_sonore` (definit în chat.ts).

export async function auzRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/auz/eveniment', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as Partial<EvenimentSonorStocat>
    if (!corp.tip) return reply.code(400).send({ error: 'lipsa_tip' })
    adaugaEvenimentSonor({
      ts: typeof corp.ts === 'number' ? corp.ts : Date.now(),
      tip: corp.tip,
      intensitate: typeof corp.intensitate === 'number' ? corp.intensitate : 0,
      durataMs: typeof corp.durataMs === 'number' ? corp.durataMs : 0,
      frecventaDominanta: typeof corp.frecventaDominanta === 'number' ? corp.frecventaDominanta : 0,
    })
    return reply.send({ ok: true })
  })

  fastify.get('/api/auz/evenimente', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({
      evenimente: evenimenteSonoreRecente(),
      urgente: evenimenteUrgente(),
    })
  })
}
