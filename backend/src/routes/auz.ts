import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { adaugaEvenimentSonor, valideazaEvenimentSonor } from '../services/auzAmbiental.js'

// ── RUTA AUZULUI AMBIENTAL (owner, 22 aug 2026: „simte mediul") ──────────────
// Frontend trimite evenimente sonore detectate aici. Le stocăm in-memory.
// Creierul le accesează prin tool-ul `evenimente_sonore` (definit în chat.ts).

export async function auzRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/auz/eveniment', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const validare = valideazaEvenimentSonor(req.body)
    if (!validare.ok) return reply.code(400).send({ error: validare.error })
    adaugaEvenimentSonor(user.email, validare.valoare)
    return reply.send({ ok: true })
  })
}
