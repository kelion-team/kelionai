import { describe, expect, it } from 'vitest'
import { contextPentruCreier } from './lib/contextOffline'

describe('offline sensor context', () => {
  it('is empty when the current turn has no measured signal', () => {
    expect(contextPentruCreier({})).toBe('')
  })

  it('includes only the location explicitly measured for this turn', () => {
    const context = contextPentruCreier({ lat: 51.5, lon: -0.12 })
    expect(context).toContain('51.5000, -0.1200')
    expect(context).toMatch(/never invent/i)
    expect(context).not.toMatch(/face|emotion|movement/)
  })

  it('labels ambient audio as an unconfirmed local heuristic', () => {
    const context = contextPentruCreier({ sunetAmbiental: 'conversatie_posibila' })
    expect(context).toMatch(/possible speech-like audio/i)
    expect(context).toMatch(/not a confirmed event/i)
  })
})
