import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  consumed: false,
  created: [] as string[],
  sessions: [] as string[],
  sent: [] as string[],
  blockAvailable: true,
}))

vi.mock('./config.js', () => ({
  config: {
    adminEmail: 'admin@example.com',
    publicOrigin: 'https://app.example.test',
  },
}))
vi.mock('./services/mail.js', () => ({
  sendMail: vi.fn(async ({ to }: { to: string }) => { state.sent.push(to) }),
}))
vi.mock('./session.js', () => ({
  setSession: vi.fn(async (_reply: unknown, user: { email: string }) => { state.sessions.push(user.email) }),
}))
vi.mock('./db.js', () => ({
  accountBlockStatus: vi.fn(async () => state.blockAvailable
    ? { available: true, blocked: false }
    : { available: false }),
  saveLoginToken: vi.fn(async () => undefined),
  consumeLoginToken: vi.fn(async () => {
    if (state.consumed) return null
    state.consumed = true
    return 'verified@example.com'
  }),
  getLocalAccount: vi.fn(async (email: string) => state.created.includes(email)
    ? { email, name: '', pass_hash: '00:00' }
    : null),
  createLocalAccount: vi.fn(async (email: string) => {
    if (state.created.includes(email)) return false
    state.created.push(email)
    return true
  }),
  updateLocalPassword: vi.fn(async () => true),
  revokeAllAuthSessions: vi.fn(async () => undefined),
}))

const { authLocalRoutes } = await import('./routes/authLocal.js')

async function app() {
  const instance = Fastify()
  await instance.register(authLocalRoutes)
  return instance
}

beforeEach(() => {
  state.consumed = false
  state.created = []
  state.sessions = []
  state.sent = []
  state.blockAvailable = true
})

describe('verified local identity only', () => {
  it('has no unverified password registration route', async () => {
    const server = await app()
    const response = await server.inject({ method: 'POST', url: '/auth/local/register', payload: { email: 'victim@example.com', password: 'attacker password' } })
    expect(response.statusCode).toBe(404)
    expect(state.created).toEqual([])
    expect(state.sessions).toEqual([])
  })

  it('creates a local identity only after the one-use mailbox callback', async () => {
    const server = await app()
    const token = 'a'.repeat(64)
    const first = await server.inject({ method: 'GET', url: `/auth/local/magic/cb?token=${token}` })
    expect(first.statusCode).toBe(302)
    expect(state.created).toEqual(['verified@example.com'])
    expect(state.sessions).toEqual(['verified@example.com'])

    const replay = await server.inject({ method: 'GET', url: `/auth/local/magic/cb?token=${token}` })
    expect(replay.statusCode).toBe(302)
    expect(state.sessions).toEqual(['verified@example.com'])
  })

  it('never sends a local sign-in link for the configured Google administrator', async () => {
    const server = await app()
    const response = await server.inject({ method: 'POST', url: '/auth/local/magic', payload: { email: 'ADMIN@example.com' } })
    expect(response.statusCode).toBe(200)
    expect(state.sent).toEqual([])
  })

  it('fails closed when account status cannot be checked', async () => {
    state.blockAvailable = false
    const server = await app()
    const response = await server.inject({ method: 'POST', url: '/auth/local/magic', payload: { email: 'user@example.com' } })
    expect(response.statusCode).toBe(503)
    expect(state.sent).toEqual([])
  })
})
