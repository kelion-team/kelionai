/** Immutable, versioned commercial policy. It is the only production source
 * for the exact currency unit and 75/25 receipt split. */
export const BILLING_POLICY = Object.freeze({
  version: 'kelion-gbp-75-25-v1',
  currency: 'GBP',
  minorUnit: 2,
  userShareBps: 7_500,
  marginShareBps: 2_500,
})

export function minorToMajor(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('amount_minor_invalid')
  return amountMinor / 10 ** BILLING_POLICY.minorUnit
}

export type TopupSplit = { grossMinor: number; userCreditMinor: number; marginMinor: number }

/** Exact 75/25 policy. Eligible top-ups are penny integers and divisible by
 * four, so no rounding penny can disappear into either side. */
export function splitTopupMinor(grossMinor: number): TopupSplit | null {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0 || grossMinor % 4 !== 0) return null
  const userCreditMinor = grossMinor * BILLING_POLICY.userShareBps / 10_000
  const marginMinor = grossMinor * BILLING_POLICY.marginShareBps / 10_000
  if (userCreditMinor + marginMinor !== grossMinor) return null
  return { grossMinor, userCreditMinor, marginMinor }
}
