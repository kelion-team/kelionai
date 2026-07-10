import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { SESSION_COOKIE } from '../session.js'
import { deleteUserData } from '../db.js'

// SELF-SERVICE ACCOUNT (clienți plătitori). Un client are mai puțin acces decât
// adminul — dar TREBUIE să-și poată șterge singur contul (GDPR: dreptul la
// ștergere). Șterge tot ce ține de el (mesaje, preferințe, memorii, portofel,
// vizite) și îl deloghează. Adminul (owner-ul) NU se poate șterge de aici — ar
// bloca pe veci proprietarul aplicației; e protejat explicit.
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/me/delete', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (user.role === 'admin') {
      // Plasa de siguranță a owner-ului: contul de admin nu se autodistruge.
      return reply.code(403).send({ error: 'admin_cannot_self_delete' })
    }
    await deleteUserData(user.email)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })
}
