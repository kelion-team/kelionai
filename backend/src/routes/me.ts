import type { FastifyInstance } from 'fastify'
import { OAuth2Client } from 'google-auth-library'
import { clearSession, getSessionUser } from '../session.js'
import { deleteFaceprint, eraseUserAccount, getGoogleRefreshToken, updateErasureGoogleRevocation, type ProcessorRevocationStatus } from '../db.js'
import { config } from '../config.js'

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.delete('/api/faceprint/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const sters = await deleteFaceprint(user.email)
    return reply.send({ ok: true, sters })
  })

  app.post<{ Body: { confirmation?: string } }>('/api/me/delete', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (req.body?.confirmation !== 'DELETE') {
      return reply.code(400).send({ error: 'confirmation_required', confirmation: 'DELETE' })
    }
    const authenticatedAt = Number(user.authenticatedAt)
    if (!Number.isFinite(authenticatedAt) || Date.now() - authenticatedAt > config.session.recentReauthSeconds * 1000) {
      return reply.code(428).send({
        error: 'recent_reauthentication_required',
        reauthenticatePath: '/auth/google/login',
      })
    }

    const token = await getGoogleRefreshToken(user.email).catch(() => '')
    try {
      // Persist the erasure before the external revocation. If the DB
      // transaction fails, Google access is not revoked without a receipt.
      // If Google is unavailable afterwards, the completed receipt keeps the
      // conservative manual_required status.
      const initialRevocation: ProcessorRevocationStatus = token ? 'manual_required' : 'not_applicable'
      const receipt = await eraseUserAccount(user.email, initialRevocation)
      if (token) {
        try {
          const oauth = new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.redirectUri)
          await oauth.revokeToken(token)
          if (await updateErasureGoogleRevocation(receipt.requestId, 'completed')) {
            receipt.googleRevocation = 'completed'
          }
        } catch {
          // The durable receipt already says manual_required.
        }
      }
      await clearSession(req, reply).catch(() => undefined)
      return reply.send({ ok: true, receipt })
    } catch {
      return reply.code(503).send({ error: 'erasure_unavailable' })
    }
  })
}
