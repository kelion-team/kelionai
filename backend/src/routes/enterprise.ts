import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { adaugaAgentCustom } from '../db.js'
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
    const b = (req.body ?? {}) as { nume?: string; rol?: string; efort?: string; doarAdmin?: boolean }
    const nume = (b.nume ?? '').trim().slice(0, 80)
    const rol = (b.rol ?? '').trim()
    if (nume.length < 3 || rol.length < 10) {
      reply.code(400)
      return { error: 'numele (min 3 caractere) și meseria (min 10 caractere) sunt obligatorii' }
    }
    const id = nume
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/^agent\s+/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    if (!id) {
      reply.code(400)
      return { error: 'din numele ăsta nu iese un id valid (folosește litere/cifre)' }
    }
    const err = await adaugaAgentCustom({ id, nume, rol, efort: b.efort === 'high' ? 'high' : undefined, doarAdmin: b.doarAdmin === true })
    if (err) {
      reply.code(409)
      return { error: err }
    }
    return { ok: true, id }
  })
}
