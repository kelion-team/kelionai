import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  identity: null as null | { email: string; authProvider: 'google' | 'local' },
  databaseEnabled: true,
  rowCount: 1 as number | null,
  failure: '' as '' | 'pool' | 'query',
  query: vi.fn(),
}))

vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.js')>()
  return {
    ...actual,
    config: { ...actual.config, adminEmail: 'owner@example.test', publicOrigin: 'https://app.example.test' },
    roleFor: (email: string) => email === 'owner@example.test' ? 'admin' : 'customer',
  }
})
vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>()
  return {
    ...actual,
    dbEnabled: () => state.databaseEnabled,
    getPool: () => {
      if (state.failure === 'pool') throw new Error('private-pool-connection')
      return { query: state.query }
    },
    readAndTouchAuthSession: async () => state.identity
      ? { ...state.identity, name: 'Owner', picture: '', locale: 'ro', sessionKind: 'browser' }
      : null,
  }
})

const { adminRoutes } = await import('./routes/admin.js')
const { hydrateSession, trustedMutationOrigin, SESSION_COOKIE } = await import('./session.js')
const apps: ReturnType<typeof Fastify>[] = []
const headers = { cookie: `${SESSION_COOKIE}=${'n'.repeat(43)}`, origin: 'https://app.example.test' }

async function notificationApp() {
  const app = Fastify()
  apps.push(app)
  app.addHook('preHandler', async (req, reply) => {
    await hydrateSession(req)
    if (!trustedMutationOrigin(req)) return reply.code(403).send({ error: 'origin_forbidden' })
  })
  await app.register(adminRoutes)
  return app
}

beforeEach(() => {
  state.identity = { email: 'owner@example.test', authProvider: 'google' }
  state.databaseEnabled = true
  state.rowCount = 1
  state.failure = ''
  state.query.mockReset().mockImplementation(async () => {
    if (state.failure === 'query') throw new Error('private-query-detail')
    return { rowCount: state.rowCount }
  })
})
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('Admin notification read receipts are authenticated and fail-closed', () => {
  it('returns 200 only for an update measured in storage', async () => {
    const app = await notificationApp()
    const result = await app.inject({ method: 'POST', url: '/api/admin/notificari/7/citit', headers })
    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ ok: true })
    expect(state.query).toHaveBeenCalledExactlyOnceWith('UPDATE admin_notifications SET read = TRUE WHERE id = $1', [7])
  })

  it('returns 404 for an absent ID and 503 for unavailable storage without details', async () => {
    const app = await notificationApp()
    state.rowCount = 0
    const missing = await app.inject({ method: 'POST', url: '/api/admin/notificari/7/citit', headers })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'notificare_negasita' })
    for (const failure of ['query', 'pool', 'disabled', 'unknown-count'] as const) {
      state.failure = failure === 'query' || failure === 'pool' ? failure : ''
      state.databaseEnabled = failure !== 'disabled'
      state.rowCount = failure === 'unknown-count' ? null : 1
      const result = await app.inject({ method: 'POST', url: '/api/admin/notificari/7/citit', headers })
      expect(result.statusCode, failure).toBe(503)
      expect(result.json()).toEqual({ error: 'notificare_nemarcata' })
      expect(result.body).not.toContain('private-')
    }
  })

  it('rejects anonymous, customer and local-owner sessions before the write', async () => {
    const app = await notificationApp()
    for (const identity of [null, { email: 'customer@example.test', authProvider: 'google' as const }, { email: 'owner@example.test', authProvider: 'local' as const }]) {
      state.identity = identity
      const result = await app.inject({ method: 'POST', url: '/api/admin/notificari/7/citit', headers })
      // A local record using the owner's email is rejected by hydration,
      // before it can become an admin session; a customer is authenticated but forbidden.
      expect(result.statusCode).toBe(identity?.email === 'customer@example.test' ? 403 : 401)
    }
    expect(state.query).not.toHaveBeenCalled()
  })

  it('rejects invalid IDs and cross-origin cookie mutations before storage', async () => {
    const app = await notificationApp()
    for (const id of ['0', '-1', '1.5', 'not-a-number']) {
      expect((await app.inject({ method: 'POST', url: `/api/admin/notificari/${id}/citit`, headers })).statusCode).toBe(400)
    }
    const foreign = await app.inject({ method: 'POST', url: '/api/admin/notificari/7/citit', headers: { ...headers, origin: 'https://foreign.example.test' } })
    expect(foreign.statusCode).toBe(403)
    expect(foreign.json()).toEqual({ error: 'origin_forbidden' })
    expect(state.query).not.toHaveBeenCalled()
  })
})
