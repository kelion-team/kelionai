import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { saveClientError, listClientErrors } from '../db.js'

// ── ERORILE DIN BROWSERUL USERULUI (F12) — ochii lui Kelion pe client ────────
// Adrian (24 iul): „el trebuie să aibă acces la logurile F12". Frontend-ul
// prinde erorile consolei (window.onerror, unhandledrejection, console.error)
// și le trimite aici; chat.ts injectează erorile RECENTE în contextul lui
// Kelion, ca la „de ce nu merge X?" să diagnosticheze din simptomele REALE ale
// browserului, nu din ghicit. Ring în memorie per user — diagnostic, nu arhivă.

interface ClientErr {
  ts: number
  msg: string
}

const rings = new Map<string, ClientErr[]>()
const MAX_PER_USER = 50

/** Erorile din ultimele `sinceMs` ms pentru user — pentru contextul de chat. */
export function recentClientErrors(email: string, sinceMs = 15 * 60_000): string[] {
  const now = Date.now()
  return (rings.get(email) ?? [])
    .filter((e) => now - e.ts < sinceMs)
    .map((e) => `[${new Date(e.ts).toISOString().slice(11, 19)}] ${e.msg}`)
}

export async function clientErrorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { errors?: string[] } }>('/api/client-errors', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const list = Array.isArray(req.body?.errors) ? req.body.errors : []
    const ring = rings.get(user.email) ?? []
    const now = Date.now()
    for (const raw of list.slice(0, 10)) {
      const msg = String(raw ?? '').slice(0, 400).trim()
      if (!msg) continue
      // Dedup: aceeași eroare repetată în rafală nu umple ringul.
      if (ring.some((e) => e.msg === msg && now - e.ts < 60_000)) continue
      ring.push({ ts: now, msg })
      // PERSISTENȚĂ (audit 24 iul, P1-3): ringul e doar memorie — la restart
      // erorile dispăreau și repararea autonomă nu avea nicio sursă durabilă.
      // Salvăm și în DB (best-effort, nu blochează răspunsul).
      void saveClientError({ type: 'f12', message: `${user.email}: ${msg}`, ip: req.ip })
    }
    while (ring.length > MAX_PER_USER) ring.shift()
    rings.set(user.email, ring)
    return reply.send({ ok: true })
  })

  // Erorile F12 persistate, pentru admin + repararea autonomă (audit 24 iul):
  // Kelion (admin) și bridge-ul pot citi simptomele TUTUROR userilor, nu doar
  // pe ale sesiunii curente, și după restart.
  app.get<{ Querystring: { n?: string } }>('/api/admin/client-errors', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ errors: await listClientErrors(Number(req.query?.n ?? 100) || 100) })
  })
}
