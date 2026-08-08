import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { saveClientError } from '../db.js'

// ── THE ERRORS FROM THE USER'S BROWSER (F12) — Kelion's eyes on the client ──
// Adrian (24 Jul): "he must have access to the F12 logs". The frontend
// catches the console errors (window.onerror, unhandledrejection,
// console.error) and sends them here; chat.ts injects the RECENT errors into
// Kelion's context, so that at "why doesn't X work?" he diagnoses from the
// browser's REAL symptoms, not from guessing. In-memory ring per user —
// diagnostics, not an archive.

interface ClientErr {
  ts: number
  msg: string
}

const rings = new Map<string, ClientErr[]>()
const MAX_PER_USER = 50

/** The errors from the last `sinceMs` ms for the user — for the chat context. */
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
      // Dedup: the same error repeated in a burst doesn't fill the ring.
      if (ring.some((e) => e.msg === msg && now - e.ts < 60_000)) continue
      ring.push({ ts: now, msg })
      // PERSISTENCE (audit 24 Jul, P1-3): the ring is memory only — on
      // restart the errors disappeared and the autonomous repair had no
      // durable source. We also save to the DB (best-effort, doesn't block
      // the reply).
      void saveClientError({ type: 'f12', message: `${user.email}: ${msg}`, ip: req.ip })
    }
    while (ring.length > MAX_PER_USER) ring.shift()
    rings.set(user.email, ring)
    return reply.send({ ok: true })
  })

}
