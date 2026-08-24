import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { getOrCreateClientStorageId, saveClientError } from '../db.js'
import { redactDiagnostic } from '../shared/diagnosticRedaction.js'

interface ClientErr {
  ts: number
  msg: string
}

const rings = new Map<string, ClientErr[]>()
const MAX_PER_USER = 50
const MAX_RING_USERS = 1_000
const RING_RETENTION_MS = 30 * 60_000

function ringKey(email: string): string {
  return email.trim().toLowerCase()
}

function pruneRings(now: number): void {
  for (const [key, entries] of rings) {
    const recent = entries.filter((entry) => now - entry.ts < RING_RETENTION_MS)
    if (recent.length) rings.set(key, recent)
    else rings.delete(key)
  }
  while (rings.size >= MAX_RING_USERS) {
    const oldest = rings.keys().next().value
    if (oldest === undefined) break
    rings.delete(oldest)
  }
}

/** Recent, already-redacted errors for this account's chat context. */
export function recentClientErrors(email: string, sinceMs = 15 * 60_000): string[] {
  const now = Date.now()
  return (rings.get(ringKey(email)) ?? [])
    .filter((entry) => now - entry.ts < Math.min(sinceMs, RING_RETENTION_MS))
    .map((entry) => `[${new Date(entry.ts).toISOString().slice(11, 19)}] ${entry.msg}`)
}

export async function clientErrorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { errors?: string[] } }>('/api/client-errors', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const list = Array.isArray(req.body?.errors) ? req.body.errors : []
    if (list.length > 10) return reply.code(413).send({ error: 'too_many_errors' })

    let accountId: string
    try { accountId = await getOrCreateClientStorageId(user.email) }
    catch { return reply.code(503).send({ error: 'diagnostic_store_unavailable' }) }

    const now = Date.now()
    pruneRings(now)
    const key = ringKey(user.email)
    const ring = rings.get(key) ?? []
    for (const raw of list) {
      const msg = redactDiagnostic(raw, 400)
      if (!msg || ring.some((entry) => entry.msg === msg && now - entry.ts < 60_000)) continue
      ring.push({ ts: now, msg })
      const type = msg.includes('[PERF]') ? 'perf' : 'f12'
      void saveClientError({ type, message: msg, accountId })
    }
    while (ring.length > MAX_PER_USER) ring.shift()
    rings.set(key, ring)
    return reply.send({ ok: true, accepted: Math.min(list.length, 10) })
  })
}
