import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { adaugaStareEmotionala, stariEmotionaleRecente, emotieDominanta, type StareEmotionalaStocata } from '../services/memorieEmotionala.js'

// ── RUTA EMOȚIEI (owner, 22 aug 2026: „simte") ───────────────────────────────

export async function emotieRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/emotie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as Partial<StareEmotionalaStocata>
    if (!corp.emotie) return reply.code(400).send({ error: 'lipsa_emotie' })
    adaugaStareEmotionala({
      emotie: corp.emotie,
      intensitate: typeof corp.intensitate === 'number' ? corp.intensitate : 0,
      ts: typeof corp.ts === 'number' ? corp.ts : Date.now(),
    }, user.email)
    return reply.send({ ok: true })
  })

  fastify.get('/api/emotie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({
      stari: stariEmotionaleRecente(),
      dominanta: emotieDominanta(),
    })
  })
}
