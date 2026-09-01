import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { noteazaAuditStrict } from '../db.js'
import { cerAdmin } from '../session.js'
import {
  ConstructorModelControlError,
  readConstructorModelSnapshot,
  requestConstructorModelSwitch,
  type ConstructorModelProfile,
  type ConstructorModelSnapshot,
} from '../services/constructorModelControl.js'

function requestedProfile(body: unknown): ConstructorModelProfile | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, 'profile')) return null
  return value.profile === 'fast' || value.profile === 'powerful' ? value.profile : null
}

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

  app.post<{ Body: unknown }>('/api/admin/constructor/model', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const user = cerAdmin(req, reply)
    if (!user) return
    const profile = requestedProfile(req.body)
    if (!profile) return reply.code(400).send({ error: 'invalid_constructor_model_profile' })

    let before: ConstructorModelSnapshot
    try {
      before = await readConstructorModelSnapshot()
    } catch {
      req.log.warn('constructor model state unavailable before switch')
      return reply.code(503).send({ error: 'constructor_model_control_unavailable' })
    }

    // Numai un snapshot măsurat `ready` poate autoriza o intenție nouă. O
    // operație failed/switching/unavailable se diagnostichează, nu se suprascrie
    // cu încă un requestId.
    if (before.state !== 'ready' || before.activeProfile === null) {
      return reply.code(409).send({ error: 'constructor_model_not_ready' })
    }

    if (!before.profiles.find((candidate) => candidate.id === profile)?.installed) {
      return reply.code(409).send({ error: 'constructor_model_profile_not_installed' })
    }
    if (before.activeProfile === profile) {
      return reply.send(before)
    }

    const requestId = randomUUID()
    try {
      // Urma descrie exact intenția autorizată; finalizarea rămâne o măsurătoare
      // separată a controllerului, corelată prin requestId.
      await noteazaAuditStrict(
        user.email,
        'constructor-model-switch-requested',
        'constructor_runtime',
        requestId,
        before.activeProfile ?? 'none',
        profile,
      )
    } catch {
      req.log.error('constructor model switch audit unavailable')
      return reply.code(503).send({ error: 'constructor_model_audit_unavailable' })
    }

    try {
      const result = await requestConstructorModelSwitch(profile, requestId, before)
      return reply.code(result.statusCode).send(result.snapshot)
    } catch (error) {
      if (error instanceof ConstructorModelControlError && error.statusCode === 409) {
        return reply.code(409).send({ error: error.publicCode })
      }
      req.log.warn('constructor model switch control unavailable')
      return reply.code(503).send({ error: 'constructor_model_control_unavailable' })
    }
  })
}
