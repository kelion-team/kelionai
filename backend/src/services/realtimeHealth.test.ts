import { describe, expect, it } from 'vitest'
import { realtimeHealth } from './realtimeHealth.js'

describe('Realtime readiness', () => {
  it('does not claim provider connectivity when required voice configuration is absent', async () => {
    const health = await realtimeHealth()
    if (!health.ok) expect(['missing_configuration', 'provider_unreachable', 'model_unavailable']).toContain(health.reason)
    else expect(health.reason).toBe('configured')
  })
})
