import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { cerAdmin, sessionTokenHash, trustedMutationOrigin } from '../session.js'
import { noteazaAudit } from '../db.js'
import { doctorCode, validDoctorGrant } from '../services/doctorPolicy.js'
import { doctorSnapshot, grantDoctor, revokeDoctor } from '../services/doctorStore.js'
import { tickDoctor } from '../services/doctor.js'

export async function doctorRoutes(app: FastifyInstance): Promise<void> {
  const authorize = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const user = cerAdmin(req,reply)
    if (!user) return null
    if (user.authProvider !== 'google' || !trustedMutationOrigin(req)) {
      void reply.code(403).send({ error:'forbidden' })
      return null
    }
    return user.email
  }
  const respond = async (reply: FastifyReply, run?: () => Promise<unknown>): Promise<unknown> => {
    try {
      await run?.()
      reply.header('Cache-Control','private, no-store')
      return await doctorSnapshot()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'doctor_grant_already_active') return reply.code(409).send({ error:code })
      if (code === 'doctor_identity_inactive' || code === 'doctor_admin_changed') return reply.code(403).send({ error:'forbidden' })
      return reply.code(503).send({ error:'doctor_unavailable' })
    }
  }
  app.get('/api/admin/doctor', async (req,reply) => {
    if (!authorize(req,reply)) return
    return respond(reply)
  })
  app.post('/api/admin/doctor/grant', { bodyLimit:1024 }, async (req,reply) => {
    const email = authorize(req,reply)
    if (!email) return
    const session = sessionTokenHash(req)
    if (!validDoctorGrant(req.body) || !session) return reply.code(400).send({ error:'doctor_grant_invalid' })
    const request = req.body
    return respond(reply,async () => {
      await grantDoctor(email,session,request)
      noteazaAudit(email,'doctor-grant','doctor_grants','measured-code-repair','disabled',JSON.stringify(request))
    })
  })
  app.delete('/api/admin/doctor/grant', async (req,reply) => {
    const email = authorize(req,reply)
    if (!email) return
    return respond(reply,async () => {
      await revokeDoctor(email)
      noteazaAudit(email,'doctor-revoke','doctor_grants','measured-code-repair','active','revoked')
    })
  })
  app.post('/api/admin/doctor/tick', { bodyLimit:1024 }, async (req,reply) => {
    if (!authorize(req,reply)) return
    if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return reply.code(400).send({ error:'doctor_request_invalid' })
    return respond(reply,() => tickDoctor())
  })
  app.post('/api/admin/doctor/incidents', { bodyLimit:1024 }, async (req,reply) => {
    if (!authorize(req,reply)) return
    const body = req.body as Record<string,unknown> | null
    const code = doctorCode(body?.code)
    if (!body || Object.keys(body).length !== 1 || !code) return reply.code(400).send({ error:'doctor_request_invalid' })
    return respond(reply,() => tickDoctor(code))
  })
}
