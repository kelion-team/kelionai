import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageA = '123e4567-e89b-42d3-a456-426614174000'
const storageB = '223e4567-e89b-42d3-a456-426614174000'
const memory = vi.hoisted(() => ({
  rows: new Map<string, { role: string; content: string; createdAtMs: number }>(),
  scopes: new Map([['user-a@example.test', '123e4567-e89b-42d3-a456-426614174000']]),
  user: { email: 'user-a@example.test' } as { email: string } | null,
  syncCalls: 0,
}))

vi.mock('./config.js', () => ({
  config: {
    offlineSync: { maxTurns: 100, maxTextChars: 8_000, maxAgeDays: 30, futureSkewSeconds: 300 },
  },
}))

vi.mock('./session.js', () => ({
  getSessionUser: () => memory.user,
}))

vi.mock('./db.js', () => ({
  syncOfflineMessages: vi.fn(async (email: string, clientStorageId: string, turns: Array<{
    id: string
    role: string
    content: string
    createdAtMs: number
  }>) => {
    memory.syncCalls += 1
    if (memory.scopes.get(email) !== clientStorageId) return { citit: false, motiv: 'scope_mismatch' }
    const ackedIds: string[] = []
    const rejected: Array<{ id: string; code: 'payload_conflict' }> = []
    for (const turn of turns) {
      const key = `${email}:${turn.id}`
      const old = memory.rows.get(key)
      if (old && (old.role !== turn.role || old.content !== turn.content || old.createdAtMs !== turn.createdAtMs)) {
        rejected.push({ id: turn.id, code: 'payload_conflict' })
        continue
      }
      if (!old) memory.rows.set(key, turn)
      ackedIds.push(turn.id)
    }
    return { citit: true, valoare: { ackedIds, rejected } }
  }),
}))

const { offlineRoutes, validateOfflineBatch } = await import('./routes/offline.js')
const id = '4c974ca2-9d0a-4d8f-99ce-e9381b941123'
const id2 = '5c974ca2-9d0a-4d8f-99ce-e9381b941124'
const id3 = '6c974ca2-9d0a-4d8f-99ce-e9381b941125'

beforeEach(() => {
  memory.rows.clear()
  memory.scopes.clear()
  memory.scopes.set('user-a@example.test', storageA)
  memory.user = { email: 'user-a@example.test' }
  memory.syncCalls = 0
})

async function app() {
  const server = Fastify()
  await server.register(offlineRoutes)
  return server
}

describe('offline sync account-bound exact-once contract', () => {
  it('acks a stable UUID on first delivery and identical retry', async () => {
    const server = await app()
    const payload = {
      clientStorageId: storageA,
      ture: [{ id, rol: 'user', text: 'mesaj offline', t: Date.now() }],
    }
    const expected = { ok: true, clientStorageId: storageA, ackedIds: [id], rejected: [] }
    expect((await server.inject({ method: 'POST', url: '/api/offline/sync', payload })).json()).toEqual(expected)
    expect((await server.inject({ method: 'POST', url: '/api/offline/sync', payload })).json()).toEqual(expected)
    expect(memory.rows.size).toBe(1)
  })

  it('rejects unauthenticated and cross-account scope requests before message writes', async () => {
    const server = await app()
    const payload = { clientStorageId: storageA, ture: [{ id, rol: 'user', text: 'secret A', t: Date.now() }] }
    memory.user = null
    const unauthenticated = await server.inject({ method: 'POST', url: '/api/offline/sync', payload })
    expect(unauthenticated.statusCode).toBe(401)
    expect(memory.syncCalls).toBe(0)

    memory.user = { email: 'user-a@example.test' }
    const mismatch = await server.inject({
      method: 'POST',
      url: '/api/offline/sync',
      payload: { ...payload, clientStorageId: storageB },
    })
    expect(mismatch.statusCode).toBe(409)
    expect(mismatch.json()).toEqual({ error: 'scope_mismatch' })
    expect(memory.rows.size).toBe(0)
  })

  it('quarantines poison items without blocking valid turns behind them', async () => {
    const server = await app()
    const now = Date.now()
    const response = await server.inject({
      method: 'POST',
      url: '/api/offline/sync',
      payload: {
        clientStorageId: storageA,
        ture: [
          { id, rol: 'user', text: 'prea vechi', t: now - 31 * 86_400_000 },
          { id: id2, rol: 'assistant', text: 'valid', t: now },
          { id: id3, rol: 'user', text: 'din viitor', t: now + 301_000 },
          { id: 'nu-e-uuid', rol: 'user', text: 'invalid', t: now },
        ],
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      clientStorageId: storageA,
      ackedIds: [id2],
      rejected: [
        { id, code: 'timestamp_too_old', retryable: false },
        { id: id3, code: 'timestamp_future', retryable: false },
        { id: null, code: 'invalid_uuid', retryable: false },
      ],
    })
    expect(memory.rows.size).toBe(1)
  })

  it('rejects a conflicting UUID per item while committing the rest of the batch', async () => {
    const server = await app()
    const at = Date.now()
    await server.inject({
      method: 'POST',
      url: '/api/offline/sync',
      payload: { clientStorageId: storageA, ture: [{ id, rol: 'user', text: 'unu', t: at }] },
    })
    const response = await server.inject({
      method: 'POST',
      url: '/api/offline/sync',
      payload: {
        clientStorageId: storageA,
        ture: [
          { id, rol: 'user', text: 'schimbat', t: at },
          { id: id2, rol: 'assistant', text: 'nou și valid', t: at },
        ],
      },
    })
    expect(response.json()).toEqual({
      ok: true,
      clientStorageId: storageA,
      ackedIds: [id2],
      rejected: [{ id, code: 'payload_conflict', retryable: false }],
    })
    expect(memory.rows.size).toBe(2)
  })

  it('never returns the same UUID in both ACK and rejected sets', async () => {
    const server = await app()
    const at = Date.now()
    const response = await server.inject({
      method: 'POST',
      url: '/api/offline/sync',
      payload: {
        clientStorageId: storageA,
        ture: [
          { id, rol: 'user', text: 'prima copie', t: at },
          { id, rol: 'user', text: 'a doua copie', t: at },
          { id: id2, rol: 'assistant', text: 'valid', t: at },
        ],
      },
    })
    expect(response.json()).toEqual({
      ok: true,
      clientStorageId: storageA,
      ackedIds: [id2],
      rejected: [{ id, code: 'duplicate_uuid', retryable: false }],
    })
    expect(memory.rows.size).toBe(1)
  })

  it('rejects an invalid container while preserving per-item validation for valid containers', () => {
    expect(validateOfflineBatch({ ture: [{ id, rol: 'user', text: 'x', t: Date.now() }] })).toBeNull()
    expect(validateOfflineBatch({ clientStorageId: storageA, ture: [] })).toBeNull()
    const validated = validateOfflineBatch({
      clientStorageId: storageA,
      ture: [{ id, rol: 'user', text: 'x', t: Date.now(), lat: 51 }],
    })
    expect(validated?.turns).toEqual([])
    expect(validated?.rejected).toMatchObject([{ id, code: 'coordinates_forbidden', retryable: false }])
  })
})
