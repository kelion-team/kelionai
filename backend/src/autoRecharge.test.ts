import { describe, it, expect } from 'vitest'
import { config } from './config.js'
import { validateLowCreditReminder } from './routes/billing.js'

describe('low-credit payment reminder validation', () => {
  it('accepts a complete, sane preference', () => {
    expect(validateLowCreditReminder({
      enabled: true,
      thresholdMinor: config.billing.lowCreditThresholdMinor,
      suggestedTopupMinor: config.billing.topupMinMinor,
    })).toEqual({
      enabled: true,
      thresholdMinor: config.billing.lowCreditThresholdMinor,
      suggestedTopupMinor: config.billing.topupMinMinor,
    })
  })

  it('accepts the reminder switched off while still validating the suggestion', () => {
    expect(validateLowCreditReminder({
      enabled: false,
      thresholdMinor: 0,
      suggestedTopupMinor: config.billing.topupMinMinor,
    })).toEqual({
      enabled: false,
      thresholdMinor: 0,
      suggestedTopupMinor: config.billing.topupMinMinor,
    })
  })

  it('rejects a suggestion outside the configured top-up step', () => {
    expect(validateLowCreditReminder({
      enabled: true,
      thresholdMinor: 0,
      suggestedTopupMinor: config.billing.topupMinMinor + 1,
    })).toBeNull()
  })

  it('rejects suggestions outside the configured bounds', () => {
    expect(validateLowCreditReminder({ enabled: true, thresholdMinor: 0, suggestedTopupMinor: -1 })).toBeNull()
    expect(validateLowCreditReminder({
      enabled: true,
      thresholdMinor: 0,
      suggestedTopupMinor: config.billing.topupMaxMinor + config.billing.topupStepMinor,
    })).toBeNull()
  })

  it('rejects a negative or non-numeric threshold', () => {
    expect(validateLowCreditReminder({ enabled: true, thresholdMinor: -1, suggestedTopupMinor: config.billing.topupMinMinor })).toBeNull()
    expect(validateLowCreditReminder({ enabled: true, thresholdMinor: 'many', suggestedTopupMinor: config.billing.topupMinMinor })).toBeNull()
  })

  it('rejects missing or malformed bodies', () => {
    expect(validateLowCreditReminder(null)).toBeNull()
    expect(validateLowCreditReminder(undefined)).toBeNull()
    expect(validateLowCreditReminder('on')).toBeNull()
  })
})
