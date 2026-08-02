import type { FastifyInstance } from 'fastify'
import { getImage } from '../services/image.js'
import { getVideo } from '../services/video.js'

// Serves the bytes of an image Kelion generated, so the monitor iframe (and a
// chat bubble) can render it by URL.
export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/image/:id', async (req, reply) => {
    const img = await getImage(req.params.id)
    if (!img) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('Content-Type', img.mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(img.buf)
  })

  // Un clip generat (Veo) se servește la fel — id neghicibil, bytes din
  // depozitul de media generată; browserul îl redă direct din <iframe>/URL.
  app.get<{ Params: { id: string } }>('/api/video/:id', async (req, reply) => {
    const v = await getVideo(req.params.id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('Content-Type', v.mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(v.buf)
  })
}
