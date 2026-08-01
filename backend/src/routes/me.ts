import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { SESSION_COOKIE } from '../session.js'
import { deleteUserData } from '../db.js'

// SELF-SERVICE ACCOUNT (paying clients). A client has less access than the
// admin — but they MUST be able to delete their own account (GDPR: the right
// to erasure). It deletes everything of theirs (messages, preferences,
// memories, wallet, visits) and logs them out. The admin (the owner) CANNOT
// delete himself here — it would lock the application's owner out forever;
// he is explicitly protected.
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/me/delete', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role === 'admin') {
      // The owner's safety net: the admin account does not self-destruct.
      return reply.code(403).send({ error: 'admin_cannot_self_delete' })
    }
    await deleteUserData(user.email)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })
}
