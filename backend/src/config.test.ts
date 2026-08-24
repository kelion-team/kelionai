import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/auth/google/callback'
  process.env.SESSION_SECRET = 'not-a-real-secret-for-tests'
  process.env.ADMIN_EMAIL = 'admin@example.test'
})

import { config, isAllowed, roleFor } from './config.js'

describe('Config Service', () => {
  it('should load required env vars', () => {
    // In Vitest, stubEnv might not override variables already loaded by dotenv
    // if the module is already initialized, but here we just check if they are defined
    expect(config.google.clientId).toBeDefined()
    expect(config.sessionSecret).toBeDefined()
  })

  it('should identify admin correctly', () => {
    expect(config.adminEmail).not.toBe('')
    expect(roleFor(config.adminEmail.toUpperCase())).toBe('admin')
    expect(roleFor('other@gmail.com')).toBe('customer')
  })

  it('should check allowlist correctly', () => {
    // openSignup is true by default in our test env if not specified otherwise
    expect(isAllowed('random@user.com')).toBe(true)
  })

  it('should configure geo endpoints dynamically', () => {
    expect(config.geo.nominatimBaseUrl).toBeDefined()
    expect(config.geo.osrmRoutingUrl).toBeDefined()
  })
})
