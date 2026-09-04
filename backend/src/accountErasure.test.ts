import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  failOn: '',
  released: false,
  identityActive: true,
  nextBuildId: 41,
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
      if (sql.includes('SELECT EXISTS (') && sql.includes('FROM auth_sessions')) {
        return { rows: [{ active: state.identityActive }], rowCount: 1 }
      }
      if (sql.includes("SELECT id, order_text, status FROM build_jobs")) return { rows: [], rowCount: 0 }
      if (sql.includes('INSERT INTO build_jobs (ordered_by, order_text, brain)')) {
        return { rows: [{ id: state.nextBuildId++ }], rowCount: 1 }
      }
      if (sql.includes('DELETE FROM auth_sessions')) state.identityActive = false
      return { rows: [], rowCount: 1 }
    },
    release: () => { state.released = true },
  }),
}))

const { createBuildJob, eraseUserAccount } = await import('./db.js')

beforeEach(() => {
  state.calls = []
  state.failOn = ''
  state.released = false
  state.identityActive = true
  state.nextBuildId = 41
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
    const cancellation = state.calls.find(({ sql }) => sql.includes("constructor_stage='cancelled'"))?.sql ?? ''
    expect(cancellation).toContain("constructor_stage IN ('claimed','accepted','working')")
    expect(cancellation).toContain('NOT EXISTS (SELECT 1 FROM constructor_pipeline')
    expect(cancellation).toContain('codex_task_id=NULL')
    const pseudonymisation = state.calls.find(({ sql }) => sql.includes("order_text = '[erased]'"))?.sql ?? ''
    expect(pseudonymisation).not.toContain("status = CASE")
    expect(state.calls.some(({ sql }) => sql.includes('JOIN constructor_pipeline') && sql.includes("evidence='[erased]'"))).toBe(true)
    const diagnosticDelete = state.calls.findIndex(({ sql }) => sql.includes('DELETE FROM client_errors'))
    const identityDelete = state.calls.findIndex(({ sql }) => sql.includes('DELETE FROM account_client_storage_ids'))
    expect(diagnosticDelete).toBeGreaterThanOrEqual(0)
    expect(identityDelete).toBeGreaterThan(diagnosticDelete)
    expect(state.released).toBe(true)
  })

  it('locks account build rows before deciding whether handoff exists', async () => {
    await eraseUserAccount('User.A@example.com', 'completed')

    const accountLock = state.calls.findIndex(({ sql, params }) =>
      sql.includes('pg_advisory_xact_lock(hashtext($1))')
      && String(params[0]) === 'constructor-account:user.a@example.com')
    const buildRowsLock = state.calls.findIndex(({ sql }) =>
      sql.includes('SELECT id FROM build_jobs') && sql.includes('ORDER BY id') && sql.includes('FOR UPDATE'))
    const cancellation = state.calls.findIndex(({ sql }) => sql.includes("constructor_stage='cancelled'"))

    expect(accountLock).toBeGreaterThanOrEqual(0)
    expect(buildRowsLock).toBeGreaterThan(accountLock)
    expect(cancellation).toBeGreaterThan(buildRowsLock)
  })

  it('rolls back and never returns a partial receipt after any table failure', async () => {
    state.failOn = 'DELETE FROM memories'
    await expect(eraseUserAccount('user.a@example.com', 'manual_required')).rejects.toThrow('injected_failure')
    expect(state.calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true)
    expect(state.calls.some(({ sql }) => sql === 'COMMIT')).toBe(false)
    expect(state.released).toBe(true)
  })

  it('serializes Constructor intake with erasure in both lock orders', async () => {
    const created = await createBuildJob('User.A@example.com', 'Remediază fluxul Constructor')
    expect(created).toMatchObject({ created: true, status: 'queued' })
    await eraseUserAccount('User.A@example.com', 'completed')
    const firstInsert = state.calls.findIndex(({ sql }) => sql.includes('INSERT INTO build_jobs'))
    const pseudonymise = state.calls.findIndex(({ sql }) => sql.includes("order_text = '[erased]'"))
    expect(firstInsert).toBeGreaterThanOrEqual(0)
    expect(pseudonymise).toBeGreaterThan(firstInsert)

    state.calls = []
    state.identityActive = true
    await eraseUserAccount('User.A@example.com', 'completed')
    const receiptCommit = state.calls.map(({ sql }) => sql === 'COMMIT').lastIndexOf(true)
    await expect(createBuildJob('User.A@example.com', 'Ordin sosit după erasure'))
      .rejects.toThrow('constructor_identity_erased_or_inactive')
    expect(state.calls.findIndex(({ sql }, index) => index > receiptCommit && sql.includes('INSERT INTO build_jobs'))).toBe(-1)

    const accountLocks = state.calls.filter(({ sql, params }) =>
      sql.includes('pg_advisory_xact_lock(hashtext($1))')
      && String(params[0]) === 'constructor-account:user.a@example.com')
    expect(accountLocks.length).toBeGreaterThanOrEqual(2)
  })
})
