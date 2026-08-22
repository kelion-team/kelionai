import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { adaugaObservatie, type ObservatieStocata } from '../services/vedereContinua.js'

// ── RUTA VEDERII CONTINUE (owner, 22 aug 2026: „simte mediul") ───────────────
// Frontend trimite cadre cu mișcare aici. Le stocăm in-memory (efemere, 5 min).
// Creierul le accesează prin tool-ul `observatii_vizuale` (definit în chat.ts).

export async function vedereRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/vedere/observatie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as Partial<ObservatieStocata>
    if (!corp.imagine || typeof corp.imagine !== 'string') {
      return reply.code(400).send({ error: 'lipsa_imagine' })
    }
    adaugaObservatie({
      ts: typeof corp.ts === 'number' ? corp.ts : Date.now(),
      lat: typeof corp.lat === 'number' ? corp.lat : undefined,
      lon: typeof corp.lon === 'number' ? corp.lon : undefined,
      miscare: typeof corp.miscare === 'number' ? corp.miscare : 0,
      imagine: corp.imagine,
    })
    return reply.send({ ok: true })
  })

  fastify.get('/api/vedere/observatii', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    // Import dinamic ca să evităm ciclul la boot
    const { observatiiRecente, numarObservatii } = await import('../services/vedereContinua.js')
    return reply.send({
      observatii: observatiiRecente(),
      total: numarObservatii(),
    })
  })
}
