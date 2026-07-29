import type { FastifyInstance } from 'fastify'
import { getShot } from '../services/browser.js'

// Serves the live browser's latest screenshot, so the monitor iframe can show
// it (mirrors routes/image.ts's pattern for generated images).
export async function browserRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/browser/shot/:id', async (req, reply) => {
    const shot = getShot(req.params.id)
    if (!shot) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('Content-Type', shot.mime)
      .header('Cache-Control', 'no-store')
      .send(shot.buf)
  })

}
