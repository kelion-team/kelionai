import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const authSource = readFileSync(fileURLToPath(new URL('./routes/auth.ts', import.meta.url)), 'utf8')
const { authRoutes } = await import('./routes/auth.js')

describe('poarta criptografică Google OAuth', () => {
  it('starts identity login with PKCE S256 and state', async () => {
    const app = Fastify()
    await app.register(cookie)
    await app.register(authRoutes)
    const response = await app.inject({ method: 'GET', url: '/auth/google/login' })
    expect(response.statusCode).toBe(302)
    const redirect = new URL(response.headers.location ?? '')
    expect(redirect.origin).toBe('https://accounts.google.com')
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256')
    expect(redirect.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(redirect.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/)
  })

  it('keeps an approved intended route, and turns a failed callback into a visible retry page', async () => {
    const app = Fastify()
    await app.register(cookie)
    await app.register(authRoutes)
    const start = await app.inject({ method: 'GET', url: '/auth/google/login?next=/credite' })
    expect(start.statusCode).toBe(302)
    expect((start.headers['set-cookie'] as string[]).some((value) => value.includes('kelionai_oauth_return_to=') && value.includes('credite'))).toBe(true)

    const stateCookie = (start.headers['set-cookie'] as string[])
      .find((value) => value.startsWith('kelionai_oauth_state='))
    expect(stateCookie).toBeTruthy()
    const failure = await app.inject({
      method: 'GET',
      url: '/auth/google/callback',
      headers: { cookie: stateCookie ?? '' },
    })
    expect(failure.statusCode).toBe(302)
    expect(failure.headers.location).toBe('http://localhost:5173/login?error=oauth_failed&reason=bad_state')
  })

  it('requires both a known capability and an authenticated session for incremental connect', async () => {
    const app = Fastify()
    await app.register(cookie)
    await app.register(authRoutes)
    const missingCapability = await app.inject({ method: 'GET', url: '/auth/google/connect' })
    expect(missingCapability.statusCode).toBe(400)
    expect(missingCapability.json()).toEqual({ error: 'capability_required' })

    const anonymous = await app.inject({ method: 'GET', url: '/auth/google/connect?capability=calendar' })
    expect(anonymous.statusCode).toBe(302)
    expect(anonymous.headers.location).toContain('?error=closed')
  })
  it('verifică id_token cu clientul oficial și audiența aplicației', () => {
    expect(authSource).toContain('googleIdentityVerifier.verifyIdToken({')
    expect(authSource).toContain('audience: config.google.clientId')
    expect(authSource).toContain("claims?.email_verified !== true")
  })

  it('nu autentifică prin simpla decodare base64 a JWT-ului', () => {
    expect(authSource).not.toContain("Buffer.from(payload, 'base64url')")
    expect(authSource).not.toContain('function decodeIdToken')
  })
})
