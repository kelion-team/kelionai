// ── THE AUTO TOP-UP CHECKBOX (Adrian, Aug 1) ────────────────────────────────
//
// "auto-pay selectable with a checkbox when the user pays — can he also set
// the payment value?" The rails (the Revolut pay-link) cannot pull money by
// themselves, so the preference means: below the user's threshold, the app
// PREPARES his refill (unique code + link) and he confirms with one tap.
//
// Tested here is the VALIDATION of what the checkbox saves: the amount obeys
// the same rule as any top-up (multiple of £5, minimum £5), the threshold is
// a sane credits number, and garbage never reaches the database — a preference
// saved wrong would prepare the wrong payment, i.e. money shown wrong.
import { describe, it, expect } from 'vitest'
import { validateAutoRecharge } from './routes/billing.js'

describe('auto top-up validation', () => {
  it('accepts a complete, sane preference', () => {
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 10 })).toEqual({
      enabled: true,
      threshold: 20,
      topupAmount: 10,
    })
  })

  it('accepts the checkbox switched off (amount still validated)', () => {
    expect(validateAutoRecharge({ enabled: false, threshold: 0, topupAmount: 5 })).toEqual({
      enabled: false,
      threshold: 0,
      topupAmount: 5,
    })
  })

  it('rejects a refill that is not a multiple of £5', () => {
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 7 })).toBeNull()
  })

  it('rejects a refill under £5 or absurdly large', () => {
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 2 })).toBeNull()
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 5000 })).toBeNull()
  })

  it('rejects a negative or non-numeric threshold', () => {
    expect(validateAutoRecharge({ enabled: true, threshold: -1, topupAmount: 10 })).toBeNull()
    expect(validateAutoRecharge({ enabled: true, threshold: 'mult', topupAmount: 10 })).toBeNull()
  })

  it('rejects missing or malformed bodies', () => {
    expect(validateAutoRecharge(null)).toBeNull()
    expect(validateAutoRecharge(undefined)).toBeNull()
    expect(validateAutoRecharge('on')).toBeNull()
  })
})
