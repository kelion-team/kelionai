import { describe, expect, it, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: '',
    adminEmail: 'owner@example.com',
    billing: {
      currency: 'GBP', minorUnit: 2, policyVersion: 'policy-v1',
      userShareBps: 7_500, marginShareBps: 2_500, creditMinor: 10,
      firstTopupMinMinor: 2_000, topupMinMinor: 500, topupStepMinor: 500, topupMaxMinor: 50_000,
      lowCreditThresholdMinor: 200, suggestedTopupMinor: 1_000,
    },
  },
}))

const { validateLowCreditReminder, validateTopUpMinor } = await import('./routes/billing.js')
const { getLowCreditReminder } = await import('./db.js')

const wallet = (topupRefMinor: number) => async () => ({ citit: true as const, balanceMinor: 0, topupRefMinor })
const unavailable = async () => ({ citit: false as const, motiv: 'offline' })

describe('billing route rules use integer minor units', () => {
  it('enforces first and later top-up rails and fails closed on unreadable wallet', async () => {
    expect(await validateTopUpMinor(wallet(0), 'a@example.com', 1_500)).toBe('first_topup_minimum')
    expect(await validateTopUpMinor(wallet(0), 'a@example.com', 2_000)).toBeNull()
    expect(await validateTopUpMinor(wallet(2_000), 'a@example.com', 700)).toBe('bad_topup_increment')
    expect(await validateTopUpMinor(wallet(2_000), 'a@example.com', 500)).toBeNull()
    expect(await validateTopUpMinor(unavailable, 'a@example.com', 2_000)).toBe('sold_necitit')
  })

  it('rejects sub-penny and non-exact split amounts', async () => {
    expect(await validateTopUpMinor(wallet(2_000), 'a@example.com', 500.1)).toBe('bad_amount')
    expect(await validateTopUpMinor(wallet(2_000), 'a@example.com', 501)).toBe('bad_amount')
  })

  it('validates the reminder without implying an automatic payment', () => {
    expect(validateLowCreditReminder({ enabled: true, thresholdMinor: 200, suggestedTopupMinor: 1_000 }))
      .toEqual({ enabled: true, thresholdMinor: 200, suggestedTopupMinor: 1_000 })
    expect(validateLowCreditReminder({ enabled: true, thresholdMinor: 200, suggestedTopupMinor: 701 })).toBeNull()
  })

  it('returns configured reminder defaults when persistence is unavailable', async () => {
    expect(await getLowCreditReminder('a@example.com')).toEqual({
      enabled: false, thresholdMinor: 200, suggestedTopupMinor: 1_000,
    })
  })
})
