import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { raporteazaStareDevice } from '../services/rezilientaCreier.js'

// ── CONFIG OLLAMA PENTRU DEVICE (owner, 22 aug 2026: LEGEA ANTI-HARDCODARE) ──
//
// Frontend-ul (pe device-ul utilizatorului) fetch-uiește configul de aici:
//   - numele modelului (din env CONSTRUCTOR_OLLAMA_MODEL)
//   - digest-ul cerut (din env OLLAMA_MODEL_DIGEST — gol = doar prezență)
//
// Nimic hardcodat — totul din env. Frontend-ul nu știe modelul decât de aici.
// Auth necesar — doar user logat. IP VPS nu se expune (cascade e pe backend).

export async function ollamaConfigRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/ollama/config', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    reply.header('Cache-Control', 'no-store')
    return reply.send({
      model: config.constructorOllamaModel,
      digestCerut: process.env.OLLAMA_MODEL_DIGEST ?? '',
      // gazdaVps SCOASĂ — nu e folosită în frontend și expunea IP-ul intern VPS
    })
  })

  // Frontend-ul raportează starea Ollama de pe device (disponibil sau nu).
  // Backend-ul o folosește pentru cascade: device → VPS → Gemini.
  fastify.post('/api/ollama/local-status', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { disponibil?: boolean }
    raporteazaStareDevice(!!corp.disponibil)
    return reply.send({ ok: true })
  })
}
