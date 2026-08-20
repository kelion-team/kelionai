import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { saveMessage } from '../db.js'

// ── SYNC OFFLINE (mod companion, faza 3) ─────────────────────────────────────
// Owner: „la găsirea de semnal să se reconecteze automat, să-și trimită tot pe
// server să se reactualizeze." La revenirea semnalului, clientul trimite AICI tot
// ce s-a întâmplat cât era offline (turele de chat + ora/locația), ca memoria
// serverului (istoricul) să prindă din urmă. Salvăm exact ce s-a întâmplat —
// nimic inventat (regula #1). Cererile care CEREAU net se rezolvă separat, pe
// client, prin /api/chat (coada de amânate), nu aici.

interface TuraOffline {
  rol?: string
  text?: string
  t?: number
  lat?: number
  lon?: number
}

export async function offlineRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/offline/sync', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { ture?: TuraOffline[] }
    const ture = Array.isArray(corp.ture) ? corp.ture : []
    let salvate = 0
    // Plafon prudent per sync (o coadă offline rezonabilă nu depășește asta).
    for (const t of ture.slice(0, 500)) {
      const text = typeof t?.text === 'string' ? t.text.trim() : ''
      if (!text) continue
      const rol = t.rol === 'assistant' ? 'assistant' : 'user'
      await saveMessage(user.email, rol, text)
      salvate++
    }
    return reply.send({ ok: true, salvate })
  })
}
