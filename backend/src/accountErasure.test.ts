import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  failOn: '',
  released: false,
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'admin@example.com',
    billing: { currency: 'GBP', policyVersion: 'billing-v1', creditMinor: 10 },
    privacy: { backupRetentionDays: 30, financialRetentionYears: 6 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params })
      if (state.failOn && sql.includes(state.failOn)) throw new Error('injected_failure')
      return { rows: [], rowCount: 1 }
    },
    release: () => { state.released = true },
  }),
}))

const { eraseUserAccount } = await import('./db.js')

beforeEach(() => {
  state.calls = []
  state.failOn = ''
  state.released = false
})

describe('transactional account erasure', () => {
  it('targets only the authenticated subject and pseudonymises retained ledgers', async () => {
    const receipt = await eraseUserAccount('User.A@example.com', 'completed')
    expect(receipt.deleted).toContain('messages_and_memories')
    expect(receipt.retained[0]).toMatchObject({ reason: 'legal_obligation_and_legal_claims' })
    expect(receipt.googleRevocation).toBe('completed')

    const allParams = state.calls.flatMap(({ params }) => params).flat(Infinity).map(String)
    expect(allParams).toContain('user.a@example.com')
    expect(allParams).not.toContain('user.b@example.com')
    expect(allParams.some((value) => /^erased:[0-9a-f-]{36}$/.test(value))).toBe(true)
    expect(state.calls.some(({ sql }) => sql === 'COMMIT')).toBe(true)
    expect(state.calls.some(({ sql }) => sql.includes('DELETE FROM auth_sessions'))).toBe(true)
    expect(state.calls.some(({ sql }) => sql.includes('DELETE FROM generated_media'))).toBe(true)
    expect(state.calls.some(({ sql }) => sql.includes('DELETE FROM chat_turn_replays'))).toBe(true)
    const diagnosticDelete = state.calls.findIndex(({ sql }) => sql.includes('DELETE FROM client_errors'))
    const identityDelete = state.calls.findIndex(({ sql }) => sql.includes('DELETE FROM account_client_storage_ids'))
    expect(diagnosticDelete).toBeGreaterThanOrEqual(0)
    expect(identityDelete).toBeGreaterThan(diagnosticDelete)
    expect(state.released).toBe(true)
  })

  it('rolls back and never returns a partial receipt after any table failure', async () => {
    state.failOn = 'DELETE FROM memories'
    await expect(eraseUserAccount('user.a@example.com', 'manual_required')).rejects.toThrow('injected_failure')
    expect(state.calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true)
    expect(state.calls.some(({ sql }) => sql === 'COMMIT')).toBe(false)
    expect(state.released).toBe(true)
  })
})
