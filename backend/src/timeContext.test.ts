// ── TIME ANCHOR TESTS (§3 of KELION-CREIER-UNIC) ────────────────────────────
//
// The bug Adrian reported: "good evening" said in the morning, and "I told him
// twice it's morning and he parroted me". This anchor is the SINGLE source of
// truth about the time for chat AND voice — if it returns something wrong or
// stays silent, the brain loses its reference and invents. It had zero tests.
import { describe, it, expect } from 'vitest'
import { formatDeviceTime } from './services/timeContext.js'

describe('timeContext — ancora de timp a dispozitivului', () => {
  it('formatează ora reală în fusul cerut', () => {
    const r = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/London')
    expect(r).not.toBeNull()
    expect(r?.tzName).toBe('Europe/London')
    // 06:30 UTC = 07:30 in London in summer — the time MUST appear in the text.
    expect(r?.human).toMatch(/07:30/)
    expect(r?.human).toMatch(/July|Wednesday/)
  })

  it('respectă fusul: același moment, ore diferite', () => {
    const londra = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/London')
    const bucuresti = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/Bucharest')
    expect(londra?.human).not.toBe(bucuresti?.human)
    expect(bucuresti?.human).toMatch(/09:30/)
  })

  it('fără fus valid cade pe UTC, nu crapă', () => {
    expect(formatDeviceTime('2026-07-29T06:30:00Z', undefined)?.tzName).toBe('UTC')
    expect(formatDeviceTime('2026-07-29T06:30:00Z', '')?.tzName).toBe('UTC')
    // Nonexistent timezone: does not throw — falls back to the UTC representation.
    expect(formatDeviceTime('2026-07-29T06:30:00Z', 'Nu/Exista')).not.toBeNull()
  })

  it('TACE (null) când nu are oră reală — nu inventează una', () => {
    // The rule: better no time block than a wrong time.
    expect(formatDeviceTime(undefined, 'Europe/London')).toBeNull()
    expect(formatDeviceTime('', 'Europe/London')).toBeNull()
    expect(formatDeviceTime('nu-i o dată', 'Europe/London')).toBeNull()
    expect(formatDeviceTime(12345, 'Europe/London')).toBeNull()
    expect(formatDeviceTime(null, 'Europe/London')).toBeNull()
  })

  it('dimineața rămâne dimineață (bugul „bună seara" la 7 AM)', () => {
    const r = formatDeviceTime('2026-07-29T05:00:00Z', 'Europe/London')
    expect(r?.human).toMatch(/06:00/) // 6 in the morning, not the evening
  })
})
