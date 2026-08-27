import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const state = vi.hoisted(() => ({
  failingSource: '' as '' | 'contact' | 'inbound' | 'history' | 'notifications',
  databaseEnabled: true,
}))

vi.mock('./config.js', () => ({
  config: {
    get databaseUrl() { return state.databaseEnabled ? 'postgres://test' : '' },
    adminEmail: 'admin@example.com',
    billing: { currency: 'GBP', policyVersion: 'billing-v1', creditMinor: 10 },
    privacy: { backupRetentionDays: 30, financialRetentionYears: 6 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(() => ({
    query: async (sql: string) => {
      if (state.failingSource === 'contact' && sql.includes('FROM contact_messages')) throw new Error('contact_unreadable')
      if (state.failingSource === 'inbound' && sql.includes('FROM inbound_emails')) throw new Error('inbound_unreadable')
      if (state.failingSource === 'history' && sql.includes('FROM messages')) throw new Error('history_unreadable')
      if (state.failingSource === 'notifications' && sql.includes('FROM admin_notifications')) throw new Error('notifications_unreadable')
      return { rows: [], rowCount: 0 }
    },
  })),
  conexiuneDb: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
}))

const { citesteIstoric, listContactMessages, listInboundEmails } = await import('./db.js')
const { getAdminNotifications } = await import('./services/adminNotification.js')

beforeEach(() => {
  state.failingSource = ''
  state.databaseEnabled = true
})

function routeHandler(source: string, method: string, path: string): string {
  const registration = new RegExp(`app\\.${method}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${path}'`)
  const match = registration.exec(source)
  expect(match, `missing route ${method.toUpperCase()} ${path}`).toBeTruthy()
  const rest = source.slice((match as RegExpExecArray).index + (match as RegExpExecArray)[0].length)
  const next = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('Admin inbox readers distinguish measured empty from unavailable', () => {
  it('returns measured empty lists only after successful queries', async () => {
    await expect(listContactMessages()).resolves.toEqual([])
    await expect(listInboundEmails()).resolves.toEqual([])
    await expect(getAdminNotifications()).resolves.toEqual([])
    await expect(citesteIstoric('user@example.com')).resolves.toEqual({ citit: true, valoare: [] })
  })

  it('returns an explicit unavailable result for each failed query', async () => {
    state.failingSource = 'contact'
    await expect(listContactMessages()).resolves.toBeNull()
    state.failingSource = 'inbound'
    await expect(listInboundEmails()).resolves.toBeNull()
    state.failingSource = 'notifications'
    await expect(getAdminNotifications()).resolves.toBeNull()
    state.failingSource = 'history'
    await expect(citesteIstoric('user@example.com')).resolves.toMatchObject({ citit: false })
  })

  it('returns unavailable when the database is disabled instead of inventing empty inboxes', async () => {
    state.databaseEnabled = false
    await expect(listContactMessages()).resolves.toBeNull()
    await expect(listInboundEmails()).resolves.toBeNull()
    await expect(getAdminNotifications()).resolves.toBeNull()
    await expect(citesteIstoric('user@example.com')).resolves.toMatchObject({ citit: false })
  })

  it('maps every unavailable inbox/history read to HTTP 503', () => {
    const source = fs.readFileSync(new URL('./routes/admin.ts', import.meta.url), 'utf8')
    expect(routeHandler(source, 'get', '/api/admin/inbound')).toContain("if (emails === null) return reply.code(503)")
    expect(routeHandler(source, 'get', '/api/admin/contact-messages')).toContain("if (messages === null) return reply.code(503)")
    expect(routeHandler(source, 'get', '/api/admin/notificari')).toContain("if (notificari === null) return reply.code(503)")
    expect(routeHandler(source, 'get', '/api/admin/history')).toContain("if (!h.citit) return reply.code(503)")
  })
})
