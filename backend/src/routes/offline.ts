import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { syncOfflineMessages, type OfflineMessageInput } from '../db.js'

// ── SYNC OFFLINE (mod companion, faza 3) ─────────────────────────────────────
// Owner: „la găsirea de semnal să se reconecteze automat, să-și trimită tot pe
// server să se reactualizeze." La revenirea semnalului, clientul trimite AICI tot
// ce s-a întâmplat cât era offline (turele de chat + ora), ca memoria
// serverului (istoricul) să prindă din urmă. Salvăm exact ce s-a întâmplat —
// fără coordonate persistente. Cererile care cereau net se rezolvă separat, pe
// client, prin /api/chat (coada de amânate), nu aici.

interface TuraOffline {
  id?: unknown
  rol?: string
  text?: string
  t?: number
  lat?: unknown
  lon?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STORAGE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type OfflineRejectionCode =
  | 'invalid_uuid'
  | 'duplicate_uuid'
  | 'coordinates_forbidden'
  | 'invalid_role'
  | 'empty_text'
  | 'text_too_long'
  | 'timestamp_invalid'
  | 'timestamp_too_old'
  | 'timestamp_future'
  | 'payload_conflict'

export interface OfflineRejectedItem {
  id: string | null
  code: OfflineRejectionCode
  retryable: false
}

interface IndexedRejection extends OfflineRejectedItem {
  ordinal: number
}

interface ValidatedOfflineTurn extends OfflineMessageInput {
  inputOrdinal: number
}

export interface ValidatedOfflineBatch {
  clientStorageId: string
  turns: ValidatedOfflineTurn[]
  rejected: IndexedRejection[]
}

export function validateOfflineBatch(input: unknown, now = Date.now()): ValidatedOfflineBatch | null {
  const body = input as { clientStorageId?: unknown; ture?: unknown } | null
  if (!body || typeof body !== 'object' || !Array.isArray(body.ture)) return null
  if (body.ture.length === 0 || body.ture.length > config.offlineSync.maxTurns) return null
  const clientStorageId = typeof body.clientStorageId === 'string'
    ? body.clientStorageId.trim().toLowerCase()
    : ''
  if (!STORAGE_UUID_RE.test(clientStorageId)) return null
  const idCounts = new Map<string, number>()
  for (const raw of body.ture) {
    if (!raw || typeof raw !== 'object') continue
    const rawId = typeof (raw as TuraOffline).id === 'string'
      ? String((raw as TuraOffline).id).toLowerCase()
      : ''
    if (UUID_RE.test(rawId)) idCounts.set(rawId, (idCounts.get(rawId) ?? 0) + 1)
  }
  const reportedDuplicates = new Set<string>()
  const oldest = now - config.offlineSync.maxAgeDays * 86_400_000
  const newest = now + config.offlineSync.futureSkewSeconds * 1_000
  const clean: ValidatedOfflineTurn[] = []
  const rejected: IndexedRejection[] = []
  for (const [ordinal, raw] of body.ture.entries()) {
    const turn = raw as TuraOffline | null
    const id = turn && typeof turn.id === 'string' ? turn.id.toLowerCase() : ''
    const safeId = UUID_RE.test(id) ? id : null
    const reject = (code: OfflineRejectionCode): void => {
      rejected.push({ id: safeId, code, retryable: false, ordinal })
    }
    if (!turn || typeof turn !== 'object' || !safeId) {
      reject('invalid_uuid')
      continue
    }
    if ((idCounts.get(id) ?? 0) > 1) {
      if (!reportedDuplicates.has(id)) reject('duplicate_uuid')
      reportedDuplicates.add(id)
      continue
    }
    if (turn.lat != null || turn.lon != null) {
      reject('coordinates_forbidden')
      continue
    }
    if (turn.rol !== 'user' && turn.rol !== 'assistant') {
      reject('invalid_role')
      continue
    }
    const content = typeof turn.text === 'string' ? turn.text.trim() : ''
    if (!content) {
      reject('empty_text')
      continue
    }
    if (content.length > config.offlineSync.maxTextChars) {
      reject('text_too_long')
      continue
    }
    const createdAtMs = Number(turn.t)
    if (!Number.isSafeInteger(createdAtMs)) {
      reject('timestamp_invalid')
      continue
    }
    if (createdAtMs < oldest) {
      reject('timestamp_too_old')
      continue
    }
    if (createdAtMs > newest) {
      reject('timestamp_future')
      continue
    }
    clean.push({ id, role: turn.rol, content, createdAtMs, inputOrdinal: ordinal })
  }
  return { clientStorageId, turns: clean, rejected }
}

export async function offlineRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/offline/sync', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const batch = validateOfflineBatch(req.body)
    if (!batch) return reply.code(400).send({ error: 'invalid_offline_batch' })
    const synced = await syncOfflineMessages(user.email, batch.clientStorageId, batch.turns)
    if (!synced.citit) {
      const code = synced.motiv === 'scope_mismatch' ? 409 : 503
      return reply.code(code).send({ error: synced.motiv })
    }
    const orderById = new Map(batch.turns.map((turn) => [turn.id, turn.inputOrdinal]))
    const rejected = [
      ...batch.rejected,
      ...synced.valoare.rejected.map((item) => ({
        ...item,
        retryable: false as const,
        ordinal: orderById.get(item.id) ?? Number.MAX_SAFE_INTEGER,
      })),
    ]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(({ id, code, retryable }): OfflineRejectedItem => ({ id, code, retryable }))
    return reply.send({
      ok: true,
      clientStorageId: batch.clientStorageId,
      ackedIds: synced.valoare.ackedIds,
      rejected,
    })
  })
}
