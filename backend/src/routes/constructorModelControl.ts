import type { FastifyInstance } from 'fastify'
import { cerAdmin } from '../session.js'
import { readConstructorModelSnapshot } from '../services/constructorModelControl.js'

export async function constructorModelControlRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/constructor/model', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!cerAdmin(req, reply)) return
    try {
      return reply.send(await readConstructorModelSnapshot())
    } catch {
      req.log.warn('constructor model state unavailable')
      return reply.code(503).send({ error: 'constructor_model_control_unavailable' })
    }
  })

  // Old clients cannot restart a retired local-model switch operation.
  app.post('/api/admin/constructor/model', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!cerAdmin(req, reply)) return
    return reply.code(410).send({ error: 'constructor_model_switch_retired' })
  })
}
