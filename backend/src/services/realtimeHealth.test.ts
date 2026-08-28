import { describe, expect, it } from 'vitest'
import { realtimeHealth, realtimeReadinessSatisfied } from './realtimeHealth.js'

describe('Realtime readiness', () => {
  it('does not make an inert candidate depend on an external provider', () => {
    expect(realtimeReadinessSatisfied(false, { ok: false, reason: 'provider_unreachable' })).toBe(true)
  })

  it('fails closed for an active generation when the provider proof fails', () => {
    expect(realtimeReadinessSatisfied(true, { ok: false, reason: 'provider_unreachable' })).toBe(false)
    expect(realtimeReadinessSatisfied(true, { ok: true, reason: 'configured' })).toBe(true)
  })

  it('does not claim provider connectivity when required voice configuration is absent', async () => {
    const health = await realtimeHealth()
    if (!health.ok) expect(['missing_configuration', 'provider_unreachable', 'model_unavailable']).toContain(health.reason)
    else expect(health.reason).toBe('configured')
  })
})
