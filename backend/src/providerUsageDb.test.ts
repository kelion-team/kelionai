import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  queries: [] as string[],
  release: vi.fn(),
  query: vi.fn(),
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: { currency: 'GBP', policyVersion: 'test-policy', creditMinor: 10 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  conexiuneDb: async () => ({ query: database.query, release: database.release }),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
}))

const { recordProviderUsage } = await import('./db.js')

beforeEach(() => {
  database.queries = []
  database.release.mockReset()
  database.query.mockReset().mockImplementation(async (sql: string) => {
    database.queries.push(sql.replace(/\s+/g, ' ').trim())
    return { rows: [], rowCount: sql.includes('INSERT INTO provider_usage_events') ? 1 : 0 }
  })
})

describe('provider usage durable DB boundary', () => {
  it('bounds the durable insert inside a server-limited transaction', async () => {
    await expect(recordProviderUsage({
      responseId: 'resp_test_1',
      userEmail: 'user@example.test',
      surface: 'openai_health',
      model: 'configured-model',
      inputTokens: 4,
      outputTokens: 1,
    })).resolves.toBeUndefined()

    expect(database.queries[0]).toBe('BEGIN')
    expect(database.queries[1]).toBe("SET LOCAL statement_timeout = '4500ms'")
    expect(database.queries[2]).toBe("SET LOCAL lock_timeout = '4000ms'")
    expect(database.queries[3]).toContain('INSERT INTO provider_usage_events')
    expect(database.queries[4]).toBe('COMMIT')
    expect(database.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back and releases the client when the bounded insert fails', async () => {
    database.query.mockImplementation(async (sql: string) => {
      database.queries.push(sql.replace(/\s+/g, ' ').trim())
      if (sql.includes('INSERT INTO provider_usage_events')) throw new Error('statement timeout')
      return { rows: [], rowCount: 0 }
    })

    await expect(recordProviderUsage({
      responseId: 'resp_test_2',
      userEmail: 'user@example.test',
      surface: 'chat',
      model: 'configured-model',
      inputTokens: 8,
      outputTokens: 2,
    })).rejects.toThrow('provider_usage_write_failed')

    expect(database.queries).toContain('ROLLBACK')
    expect(database.release).toHaveBeenCalledTimes(1)
  })
})
