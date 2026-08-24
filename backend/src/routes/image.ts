import type { FastifyInstance, FastifyReply } from 'fastify'
import { getSessionUser } from '../session.js'
import { getImage } from '../services/image.js'
import { getVideo } from '../services/video.js'
import { mediaIdValid } from '../services/mediaPolicy.js'

function mediaHeaders(reply: FastifyReply, mime: string, id: string): FastifyReply {
  const extension = mime === 'video/mp4' ? 'mp4' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
  return reply
    .header('Content-Type', mime)
    .header('Content-Disposition', `inline; filename="${id}.${extension}"`)
    .header('Cache-Control', 'private, max-age=3600')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cross-Origin-Resource-Policy', 'same-origin')
    .header('X-Content-Type-Options', 'nosniff')
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/image/:id', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!mediaIdValid(req.params.id)) return reply.code(404).send({ error: 'not_found' })
    let img: Awaited<ReturnType<typeof getImage>>
    try { img = await getImage(req.params.id, user.email) }
    catch { return reply.code(503).send({ error: 'media_store_unavailable' }) }
    if (!img) return reply.code(404).send({ error: 'not_found' })
    return mediaHeaders(reply, img.mime, req.params.id).send(img.buf)
  })

  app.get<{ Params: { id: string } }>('/api/video/:id', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!mediaIdValid(req.params.id)) return reply.code(404).send({ error: 'not_found' })
    let video: Awaited<ReturnType<typeof getVideo>>
    try { video = await getVideo(req.params.id, user.email) }
    catch { return reply.code(503).send({ error: 'media_store_unavailable' }) }
    if (!video) return reply.code(404).send({ error: 'not_found' })
    return mediaHeaders(reply, video.mime, req.params.id).send(video.buf)
  })
}
