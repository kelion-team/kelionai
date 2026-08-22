import type { FastifyInstance } from 'fastify'
import { cerAdmin } from '../session.js'
import { cicluPaznic, raportPaznicLive } from '../services/paznic.js'

/** Rutele paznicului — văd starea live a aplicației. */
export async function paznicRoutes(app: FastifyInstance): Promise<void> {
  // GET — ultimul raport, fără re-rulare.
  app.get('/api/admin/paznic', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(raportPaznicLive())
  })

  // POST — forțează un ciclu acum și întoarce rezultatul.
  app.post('/api/admin/paznic', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await cicluPaznic())
  })
}
