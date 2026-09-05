import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { creeazaAgentCustom } from '../services/agentiKelion.js'
import { cerAdmin } from '../session.js'

// AdminPanel este singura interfață pentru agenții personalizați. Backendul
// expune doar API JSON; nu mai există o a doua consolă HTML cu script inline.

/** Gardul comun al rutelor de admin — o singură sursă (cerAdmin, session.ts):
 *  401 pe sesiune moartă, 403 DOAR pe rol. */
function adminSau403(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  return cerAdmin(req, reply)
}

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  // AGENT NOU pus de owner (4 aug: „când mai vreau un model de agent să pot
  // pune și să fie creat automat"): salvează în DB → intră PE LOC în rosterul
  // viu (/api/a2a). DOAR admin.
  app.post('/api/enterprise/agent-nou', async (req, reply) => {
    const user = adminSau403(req, reply)
    if (!user) return { error: 'forbidden' }
    const result = await creeazaAgentCustom((req.body ?? {}) as { nume?: unknown; rol?: unknown; efort?: unknown; doarAdmin?: unknown })
    if (!result.ok) return reply.code(result.status).send({ error: result.error })
    return { ok: true, id: result.id }
  })
}
