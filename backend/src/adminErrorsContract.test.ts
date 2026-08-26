import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const state = vi.hoisted(() => ({
  failClientErrors: false,
  failBuildJobs: false,
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
  getPool: vi.fn(() => ({
    query: async (sql: string) => {
      if (state.failClientErrors && sql.includes('FROM client_errors')) throw new Error('client_errors_unreadable')
      if (state.failBuildJobs && sql.includes('FROM build_jobs')) throw new Error('build_jobs_unreadable')
      return { rows: [], rowCount: 0 }
    },
  })),
  conexiuneDb: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
}))

const { listClientErrorGroupsStrict } = await import('./db.js')
const { problemeGlobaleAcum } = await import('./services/autodiagnostic.js')

beforeEach(() => {
  state.failClientErrors = false
  state.failBuildJobs = false
})

function routeHandler(source: string, method: string, path: string): string {
  const registration = new RegExp(`app\\.${method}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${path}'`)
  const match = registration.exec(source)
  expect(match, `missing route ${method.toUpperCase()} ${path}`).toBeTruthy()
  const rest = source.slice((match as RegExpExecArray).index + (match as RegExpExecArray)[0].length)
  const next = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('Admin Errors/Audit never turns unreadable sources into empty success', () => {
  it('strict client-error storage reader distinguishes measured empty from failure', async () => {
    await expect(listClientErrorGroupsStrict(48, 40)).resolves.toEqual([])
    state.failClientErrors = true
    await expect(listClientErrorGroupsStrict(48, 40)).rejects.toThrow('client_errors_unreadable')
  })

  it('fresh system problems reject when the Constructor queue cannot be read', async () => {
    await expect(problemeGlobaleAcum()).resolves.toEqual([])
    state.failBuildJobs = true
    await expect(problemeGlobaleAcum()).rejects.toThrow('constructor_queue_unreadable')
  })

  it('keeps Errors atomic with 503 and Audit partial with null/source status', () => {
    const source = fs.readFileSync(new URL('./routes/admin.ts', import.meta.url), 'utf8')
    const errors = routeHandler(source, 'get', '/api/admin/erori')
    expect(errors).toContain('listClientErrorGroupsStrict(48, 40)')
    expect(errors).toContain('reply.code(503)')
    expect(errors).not.toMatch(/catch\(\(\) => \[\]\)/)

    const audit = routeHandler(source, 'get', '/api/admin/audit')
    expect(audit).toContain('listClientErrorGroupsStrict(48, 30).catch(() => null)')
    expect(audit).toContain("clientErrors: clientErrors === null ? 'unavailable' : 'ok'")
    expect(audit).toContain("constructorQueue: jobs === null ? 'unavailable' : 'ok'")
    expect(audit).not.toMatch(/catch\(\(\) => \[\]\)/)
  })
})
