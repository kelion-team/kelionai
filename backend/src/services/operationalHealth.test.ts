import { describe, expect, it } from 'vitest'
import { isOperationalHealthRequest } from './operationalHealth.js'

describe('operational health boundary', () => {
  it('keeps readiness probes outside browser-session and CSRF handling', () => {
    for (const path of ['/health', '/livez', '/readyz', '/api/health?probe=1']) {
      expect(isOperationalHealthRequest('GET', path)).toBe(true)
    }
  })

  it('does not exempt application mutations or unrelated routes', () => {
    expect(isOperationalHealthRequest('POST', '/readyz')).toBe(false)
    expect(isOperationalHealthRequest('GET', '/api/constructor/jobs')).toBe(false)
    expect(isOperationalHealthRequest('GET', '/api/version')).toBe(false)
  })
})
