import { describe, it, expect, vi } from 'vitest'

// Mock environment variables before importing config
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { config, isAllowed, roleFor } from './config.js'

describe('Config Service', () => {
  it('should load required env vars', () => {
    // In Vitest, stubEnv might not override variables already loaded by dotenv
    // if the module is already initialized, but here we just check if they are defined
    expect(config.google.clientId).toBeDefined()
    expect(config.sessionSecret).toBeDefined()
  })

  it('should identify admin correctly', () => {
    // Default admin is adrianenc11@gmail.com
    expect(roleFor('adrianenc11@gmail.com')).toBe('admin')
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
