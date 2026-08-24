import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  cheiePublicaPush,
  aboneazaPush,
  dezaboneazaPush,
  normalizeazaAbonarePush,
  normalizeazaEndpointPush,
} from '../services/pushTelefon.js'
import type { AbonarePush } from '../services/pushTelefon.js'
import { esteAdminKelion } from '../services/adminIdentity.js'

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/push/cheie', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!esteAdminKelion(user.email)) return reply.code(403).send({ error: 'forbidden' })
    const cheie = await cheiePublicaPush()
    if (!cheie) return reply.code(503).send({ error: 'push_unavailable' })
    return { cheie }
  })

  app.post<{ Body: { abonare?: AbonarePush } }>('/api/push/aboneaza', {
    bodyLimit: 8_192,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['abonare'],
        properties: {
          abonare: {
            type: 'object',
            additionalProperties: false,
            required: ['endpoint', 'keys'],
            properties: {
              endpoint: { type: 'string', minLength: 12, maxLength: 2_048 },
              keys: {
                type: 'object',
                additionalProperties: false,
                required: ['p256dh', 'auth'],
                properties: {
                  p256dh: { type: 'string', minLength: 80, maxLength: 100 },
                  auth: { type: 'string', minLength: 20, maxLength: 30 },
                },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!esteAdminKelion(user.email)) return reply.code(403).send({ error: 'forbidden' })
    const abonare = normalizeazaAbonarePush(req.body?.abonare)
    if (!abonare) return reply.code(400).send({ error: 'invalid_subscription' })
    const ok = await aboneazaPush(user.email, abonare)
    if (!ok) return reply.code(503).send({ error: 'subscription_unavailable' })
    return { ok: true }
  })

  app.post<{ Body: { endpoint?: string } }>('/api/push/dezaboneaza', {
    bodyLimit: 4_096,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['endpoint'],
        properties: { endpoint: { type: 'string', minLength: 12, maxLength: 2_048 } },
      },
    },
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!esteAdminKelion(user.email)) return reply.code(403).send({ error: 'forbidden' })
    const endpoint = normalizeazaEndpointPush(req.body?.endpoint)
    if (!endpoint) return reply.code(400).send({ error: 'invalid_endpoint' })
    const ok = await dezaboneazaPush(user.email, endpoint)
    if (!ok) return reply.code(503).send({ error: 'unsubscribe_unavailable' })
    return { ok: true }
  })
}
