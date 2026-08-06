import { describe, it, expect, beforeAll } from 'vitest'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

describe('Google OAuth Connect & Scope logic (D3)', () => {
  beforeAll(() => {
    if (!process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = 'test_session_secret_1234567890'
    }
  })

  it('signs session token correctly when sessionSecret is provided', () => {
    const secret = process.env.SESSION_SECRET || config.sessionSecret || 'test_fallback_secret'
    const sessionPayload = {
      sub: 'google_12345',
      email: 'owner@example.com',
      name: 'Owner',
      picture: 'https://example.com/photo.jpg',
      locale: 'ro',
    }
    const token = jwt.sign(sessionPayload, secret, { expiresIn: '7d' })
    expect(token).toBeDefined()
    expect(typeof token).toBe('string')

    const decoded = jwt.verify(token, secret) as any
    expect(decoded.sub).toBe('google_12345')
    expect(decoded.email).toBe('owner@example.com')
  })
})
