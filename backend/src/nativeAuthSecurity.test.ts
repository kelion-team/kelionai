import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  created: null as null | Record<string, unknown>,
  consumed: false,
  nativeUser: true,
  role: 'customer' as 'customer' | 'admin',
  ticketCount: 0,
}))

vi.mock('./config.js', () => ({
  config: {
    isProd: false,
    google: {
      clientId: 'google-client', clientSecret: 'google-secret',
      redirectUri: 'https://app.example.test/auth/google/callback',
    },
    googleTokenEncryptionKey: 'g'.repeat(32),
    publicOrigin: 'https://app.example.test',
    frontendOrigin: 'https://app.example.test',
    product: {
      nativeOrigins: ['capacitor://localhost', 'http://tauri.localhost', 'tauri://localhost'],
      nativeRedirects: {
        ios: 'https://app.example.test/auth/native/complete',
        desktop: 'kelionai://auth/native/complete',
        constructorDesktop: 'kelion-constructor://auth/native/complete',
      },
    },
    nativeAuth: { requestTtlSeconds: 600, exchangeTtlSeconds: 120, channelTicketTtlSeconds: 30 },
    openSignup: true,
  },
  isAllowed: () => true,
  roleFor: () => memory.role,
}))

vi.mock('google-auth-library', () => ({
  OAuth2Client: class { verifyIdToken = vi.fn() },
}))

vi.mock('./session.js', () => ({
  clearSession: vi.fn(),
  createNativeSession: vi.fn(async () => ({ accessToken: 'a'.repeat(43), tokenType: 'Bearer', expiresIn: 600 })),
  getSessionUser: vi.fn(() => memory.nativeUser
    ? { email: 'native@example.com', role: memory.role, authProvider: 'google' }
    : null),
  isNativeBearerSession: vi.fn(() => memory.nativeUser),
  revokeNativeBearer: vi.fn(async (req: { headers: Record<string, string | undefined> }) =>
    req.headers.authorization === `Bearer ${'a'.repeat(43)}`),
  sessionTokenHash: vi.fn(() => memory.nativeUser ? 'b'.repeat(64) : null),
  setSession: vi.fn(),
}))

vi.mock('./db.js', () => ({
  accountBlockStatus: vi.fn(async () => ({ available: true, blocked: false })),
  completeNativeAuthRequest: vi.fn(async () => true),
  createNativeAuthRequest: vi.fn(async (input: Record<string, unknown>) => { memory.created = input }),
  getNativeAuthByHandle: vi.fn(async () => null),
  getNativeAuthByOauthState: vi.fn(async () => null),
  saveGoogleRefreshToken: vi.fn(),
  getGoogleRefreshToken: vi.fn(async () => ''),
  createNativeChannelTicket: vi.fn(async () => { memory.ticketCount += 1 }),
  consumeNativeAuthCode: vi.fn(async (input: {
    clientState: string
    platform: string
    installId: string
    clientCodeChallenge: string
  }) => {
    if (memory.consumed || !memory.created) return null
    if (input.clientState !== memory.created.clientState
      || input.platform !== memory.created.platform
      || input.installId !== memory.created.installId
      || input.clientCodeChallenge !== memory.created.clientCodeChallenge) return null
    memory.consumed = true
    return { email: 'native@example.com', name: 'Native', picture: '', locale: 'en' }
  }),
}))

const { authRoutes } = await import('./routes/auth.js')

async function app() {
  const instance = Fastify()
  await instance.register(authRoutes)
  return instance
}

const installId = '4c974ca2-9d0a-4d8f-99ce-e9381b941123'
const verifier = 'v'.repeat(43)
const challenge = createHash('sha256').update(verifier).digest('base64url')

beforeEach(() => {
  memory.created = null
  memory.consumed = false
  memory.nativeUser = true
  memory.role = 'customer'
  memory.ticketCount = 0
})

async function startNative(instance: Awaited<ReturnType<typeof app>>) {
  return instance.inject({
    method: 'POST', url: '/auth/native/start',
    headers: { origin: 'capacitor://localhost' },
    payload: { platform: 'ios', installId, codeChallenge: challenge },
  })
}

describe('native OAuth exchange', () => {
  it('emits only a first-party authorize URL and binds a PKCE challenge', async () => {
    const server = await app()
    const response = await startNative(server)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(new URL(body.authorizeUrl).origin).toBe('https://app.example.test')
    expect(new URL(body.authorizeUrl).pathname).toBe('/auth/native/authorize')
    expect(body.state).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(memory.created).toMatchObject({ platform: 'ios', installId, clientCodeChallenge: challenge })
  })

  it('accepts the dedicated Constructor desktop identity without creating a second API trust path', async () => {
    const server = await app()
    const response = await server.inject({
      method: 'POST', url: '/auth/native/start',
      headers: { origin: 'http://tauri.localhost' },
      payload: { platform: 'constructor-desktop', installId, codeChallenge: challenge },
    })
    expect(response.statusCode).toBe(200)
    expect(memory.created).toMatchObject({ platform: 'constructor-desktop', installId, clientCodeChallenge: challenge })
  })

  it('rejects unlisted or cross-platform shell origins', async () => {
    const server = await app()
    const foreign = await server.inject({
      method: 'POST', url: '/auth/native/start', headers: { origin: 'https://attacker.invalid' },
      payload: { platform: 'ios', installId, codeChallenge: challenge },
    })
    const crossed = await server.inject({
      method: 'POST', url: '/auth/native/start', headers: { origin: 'capacitor://localhost' },
      payload: { platform: 'desktop', installId, codeChallenge: challenge },
    })
    expect(foreign.statusCode).toBe(400)
    expect(crossed.statusCode).toBe(400)
  })

  it('consumes the exchange code once and rejects a wrong PKCE verifier', async () => {
    const server = await app()
    const started = (await startNative(server)).json()
    const code = 'c'.repeat(43)
    const wrong = await server.inject({
      method: 'POST', url: '/auth/native/exchange', headers: { origin: 'capacitor://localhost' },
      payload: { platform: 'ios', installId, code, state: started.state, verifier: 'x'.repeat(43) },
    })
    expect(wrong.statusCode).toBe(400)
    const first = await server.inject({
      method: 'POST', url: '/auth/native/exchange', headers: { origin: 'capacitor://localhost' },
      payload: { platform: 'ios', installId, code, state: started.state, verifier },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ tokenType: 'Bearer', accessToken: 'a'.repeat(43) })
    const replay = await server.inject({
      method: 'POST', url: '/auth/native/exchange', headers: { origin: 'capacitor://localhost' },
      payload: { platform: 'ios', installId, code, state: started.state, verifier },
    })
    expect(replay.statusCode).toBe(400)
  })
})

describe('native channel ticket', () => {
  it('issues a short one-use channel credential only for a native bearer session', async () => {
    const server = await app()
    const ok = await server.inject({ method: 'POST', url: '/api/auth/native/channel-ticket', payload: { audience: 'vocal-live' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ protocol: 'kelion-native', expiresIn: 30 })
    expect(ok.json().ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(memory.ticketCount).toBe(1)

    memory.nativeUser = false
    const denied = await server.inject({ method: 'POST', url: '/api/auth/native/channel-ticket', payload: { audience: 'vocal-live' } })
    expect(denied.statusCode).toBe(401)
  })

  it('keeps deploy status admin-only', async () => {
    const server = await app()
    const denied = await server.inject({ method: 'POST', url: '/api/auth/native/channel-ticket', payload: { audience: 'deploy-status' } })
    expect(denied.statusCode).toBe(403)
    memory.role = 'admin'
    const allowed = await server.inject({ method: 'POST', url: '/api/auth/native/channel-ticket', payload: { audience: 'deploy-status' } })
    expect(allowed.statusCode).toBe(200)
  })
})

describe('native bearer revocation', () => {
  it('is retry-safe and requires an allowed shell origin plus a bearer', async () => {
    const server = await app()
    const request = {
      method: 'POST' as const,
      url: '/auth/native/logout',
      headers: { origin: 'capacitor://localhost', authorization: `Bearer ${'a'.repeat(43)}` },
    }
    expect((await server.inject(request)).statusCode).toBe(204)
    expect((await server.inject(request)).statusCode).toBe(204)
    expect((await server.inject({ ...request, headers: { ...request.headers, origin: 'https://attacker.invalid' } })).statusCode).toBe(403)
    expect((await server.inject({ method: 'POST', url: '/auth/native/logout', headers: { origin: 'capacitor://localhost' } })).statusCode).toBe(401)
  })
})
