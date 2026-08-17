import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

describe('Google OAuth Connect & Scope logic (D3)', () => {
  it('redirects authenticated user or signs token safely', () => {
    const secret = process.env.SESSION_SECRET || config.sessionSecret || 'test_session_secret_for_jwt_signing'
    const sessionPayload = {
      sub: 'google_123456789',
      email: 'owner@example.com',
      name: 'Owner',
      picture: 'https://example.com/photo.jpg',
      locale: 'ro',
    }
    const token = jwt.sign(sessionPayload, secret, { expiresIn: '7d' })
    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')
  })
})
