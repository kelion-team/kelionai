import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageA = '123e4567-e89b-42d3-a456-426614174000'
const storageB = '223e4567-e89b-42d3-a456-426614174000'
const state = vi.hoisted(() => ({
  rows: new Map<string, { role: string; content: string; client_created_at_ms: string }>(),
  scopes: new Map<string, string>(),
  commits: 0,
  rollbacks: 0,
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: { currency: 'GBP', policyVersion: 'policy-v1', creditMinor: 10 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN') return { rows: [], rowCount: 0 }
      if (sql === 'COMMIT') { state.commits += 1; return { rows: [], rowCount: 0 } }
      if (sql === 'ROLLBACK') { state.rollbacks += 1; return { rows: [], rowCount: 0 } }
      if (sql.includes('FROM account_client_storage_ids')) {
        const storage_id = state.scopes.get(String(params[0]))
        return { rows: storage_id ? [{ storage_id }] : [], rowCount: storage_id ? 1 : 0 }
      }
      const key = `${String(params[0]).toLowerCase()}:${String(params[4] ?? params[1]).toLowerCase()}`
      if (sql.includes('INSERT INTO messages')) {
        if (state.rows.has(key)) return { rows: [], rowCount: 0 }
        state.rows.set(key, {
          role: String(params[1]),
          content: String(params[2]),
          client_created_at_ms: String(params[3]),
        })
        return { rows: [{ id: state.rows.size }], rowCount: 1 }
      }
      if (sql.includes('FROM messages') && sql.includes('client_event_id')) {
        const row = state.rows.get(key)
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
      }
      throw new Error(`unexpected sql: ${sql.slice(0, 80)}`)
    },
    release: vi.fn(),
  }),
}))

const { syncOfflineMessages } = await import('./db.js')
const turn = {
  id: '4c974ca2-9d0a-4d8f-99ce-e9381b941123',
  role: 'user' as const,
  content: 'offline',
  createdAtMs: 1_777_000_000_000,
}
const second = {
  id: '5c974ca2-9d0a-4d8f-99ce-e9381b941124',
  role: 'assistant' as const,
  content: 'răspuns',
  createdAtMs: turn.createdAtMs,
}

beforeEach(() => {
  state.rows.clear()
  state.scopes.clear()
  state.scopes.set('a@example.test', storageA)
  state.scopes.set('b@example.test', storageB)
  state.commits = 0
  state.rollbacks = 0
})

describe('offline database idempotency and account scope', () => {
  it('stores one row and acknowledges identical retries', async () => {
    const expected = { citit: true, valoare: { ackedIds: [turn.id], rejected: [] } }
    expect(await syncOfflineMessages('A@Example.test', storageA, [turn])).toEqual(expected)
    expect(await syncOfflineMessages('a@example.test', storageA, [turn])).toEqual(expected)
    expect(state.rows.size).toBe(1)
    expect(state.commits).toBe(2)
  })

  it('rejects changed payload per item and commits unrelated valid turns', async () => {
    await syncOfflineMessages('a@example.test', storageA, [turn])
    const result = await syncOfflineMessages('a@example.test', storageA, [
      { ...turn, content: 'changed' },
      second,
    ])
    expect(result).toEqual({
      citit: true,
      valoare: {
        ackedIds: [second.id],
        rejected: [{ id: turn.id, code: 'payload_conflict' }],
      },
    })
    expect(state.rollbacks).toBe(0)
    expect(state.commits).toBe(2)
    expect(state.rows.size).toBe(2)
  })

  it('rejects a mismatched account scope before inserting messages', async () => {
    const result = await syncOfflineMessages('a@example.test', storageB, [turn])
    expect(result).toEqual({ citit: false, motiv: 'scope_mismatch' })
    expect(state.rollbacks).toBe(1)
    expect(state.commits).toBe(0)
    expect(state.rows.size).toBe(0)
  })

  it('scopes the same durable event UUID independently to each authenticated account', async () => {
    await expect(syncOfflineMessages('a@example.test', storageA, [turn]))
      .resolves.toEqual({ citit: true, valoare: { ackedIds: [turn.id], rejected: [] } })
    await expect(syncOfflineMessages('b@example.test', storageB, [{ ...turn, content: 'account B' }]))
      .resolves.toEqual({ citit: true, valoare: { ackedIds: [turn.id], rejected: [] } })
    expect(state.rows.size).toBe(2)
  })
})
