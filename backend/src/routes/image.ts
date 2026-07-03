import type { FastifyInstance } from 'fastify'
import { getImage } from '../services/image.js'

// Serves the bytes of an image Kelion generated, so the monitor iframe (and a
// chat bubble) can render it by URL.
export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/image/:id', async (req, reply) => {
    const img = getImage(req.params.id)
    if (!img) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('Content-Type', img.mime)
      .header('Cache-Control', 'public, max-age=3600')
      .send(img.buf)
  })
}
