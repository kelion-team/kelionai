import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let database: PGlite

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: { currency: 'GBP', policyVersion: 'policy-v1', creditMinor: 10 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: () => ({ query: (sql: string, params?: unknown[]) => database.query(sql, params) }),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => ({
    query: (sql: string, params?: unknown[]) => database.query(sql, params),
    release: vi.fn(),
  }),
}))

const { citesteIstoric, getRecentHistory, syncOfflineMessages } = await import('./db.js')
const email = 'offline@example.test'
const clientStorageId = '123e4567-e89b-42d3-a456-426614174000'
const at = 1_777_000_000_000

function turn(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message-${String(index).padStart(3, '0')}`,
    createdAtMs: at,
  }
}

beforeEach(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE messages (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      client_event_id UUID,
      client_created_at_ms BIGINT
    );
    CREATE UNIQUE INDEX uniq_messages_user_client_event
      ON messages (lower(user_email), client_event_id)
      WHERE client_event_id IS NOT NULL;
    CREATE TABLE account_client_storage_ids (
      user_email TEXT PRIMARY KEY,
      storage_id UUID NOT NULL UNIQUE
    );
    INSERT INTO account_client_storage_ids (user_email, storage_id)
      VALUES ('${email}', '${clientStorageId}');
  `)
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

describe('offline history deterministic ordering', () => {
  it('paginates every older message beyond 1000 using numeric IDs for equal timestamps', { timeout:30_000 }, async () => {
    await database.query(`INSERT INTO messages(user_email,role,content,created_at)
      SELECT $1,'user','record-'||n::text,'2026-09-05T00:00:00Z'::timestamptz FROM generate_series(1,1005) AS n`,[email])
    let before: { createdAt:string;id:string } | null = null
    const ids: string[] = []
    let pages = 0
    do {
      const result = await citesteIstoric(email,{ email,limit:200,before })
      expect(result.citit).toBe(true)
      if (!result.citit) throw new Error('history unreadable')
      const page = result.valoare
      if (pages === 0) expect(page.history.map((row) => row.id)).toEqual(Array.from({ length:200 },(_,index) => String(806+index)))
      ids.unshift(...page.history.map((row) => row.id))
      before = page.nextCursor
      pages++
    } while (before && pages < 10)
    expect(before).toBeNull()
    expect(pages).toBe(6)
    expect(ids).toEqual(Array.from({ length:1005 },(_,index) => String(index+1)))
  })
  it('preserves insertion order across the 100/101 batch boundary and a lost-response retry', { timeout: 30_000 }, async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => turn(index))
    const lastTurn = turn(100)

    const first = await syncOfflineMessages(email, clientStorageId, firstBatch)
    const replay = await syncOfflineMessages(email, clientStorageId, firstBatch)
    const second = await syncOfflineMessages(email, clientStorageId, [lastTurn])
    expect(first.citit && first.valoare.ackedIds).toHaveLength(100)
    expect(replay).toEqual(first)
    expect(second).toEqual({ citit: true, valoare: { ackedIds: [lastTurn.id], rejected: [] } })

    const complete = await citesteIstoric(email, 101)
    expect(complete.citit && complete.valoare.map((row) => row.content))
      .toEqual(Array.from({ length: 101 }, (_, index) => turn(index).content))
    await expect(getRecentHistory(email, 101))
      .resolves.toEqual(complete.citit ? complete.valoare : [])

    const count = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM messages')
    expect(count.rows[0]?.count).toBe(101)
  })
})
