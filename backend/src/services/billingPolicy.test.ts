import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    adminEmail: 'owner@example.com',
  },
}))

import {
  minorToMajor,
  splitTopupMinor,
} from './billingPolicy.js'
import { esteAdminKelion } from './adminIdentity.js'

describe('versioned billing arithmetic', () => {
  it('admin identity is derived centrally from the configured verified email', () => {
    expect(esteAdminKelion(' OWNER@EXAMPLE.COM ')).toBe(true)
    expect(esteAdminKelion('customer@example.com')).toBe(false)
  })

  it('converts integer minor units for display', () => {
    expect(minorToMajor(751)).toBe(7.51)
  })

  it('preserves every penny in the exact 75/25 split', () => {
    expect(splitTopupMinor(2_000)).toEqual({ grossMinor: 2_000, userCreditMinor: 1_500, marginMinor: 500 })
    expect(splitTopupMinor(1_001)).toBeNull()
    const split = splitTopupMinor(4_004)!
    expect(split.userCreditMinor + split.marginMinor).toBe(split.grossMinor)
  })
})
