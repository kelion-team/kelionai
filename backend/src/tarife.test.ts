import { beforeEach, describe, expect, it, vi } from 'vitest'

const { debits, grants, debit } = vi.hoisted(() => ({
  debits: [] as unknown[][],
  grants: [] as unknown[][],
  debit: vi.fn(async (...args: unknown[]) => {
    debits.push(args)
    return { ok: true as const, debitedMinor: Number(args[1]), duplicate: false }
  }),
}))

vi.mock('./config.js', () => ({
  config: {
    adminEmail: 'owner@example.com',
    videoModel: 'configured-video-model',
    billing: { currency: 'GBP', minorUnit: 2, creditMinor: 10, policyVersion: 'policy-v1' },
  },
}))
vi.mock('./db.js', () => ({
  debitWalletMinorAtomar: debit,
  grantCreditMinor: vi.fn(async (...args: unknown[]) => { grants.push(args); return true }),
}))

import { creditePentru, lirePentru, meniulDeTarife, minorPentru, taxeazaServiciu } from './services/tarife.js'

beforeEach(() => { debits.length = 0; grants.length = 0; debit.mockClear() })

describe('extra-service product tariffs', () => {
  it('uses the same integer amount for display and debit', async () => {
    expect(minorPentru('imagine')).toBe((creditePentru('imagine') ?? 0) * 10)
    expect(lirePentru('imagine')).toBe((minorPentru('imagine') ?? 0) / 100)
    const result = await taxeazaServiciu('customer@example.com', 'imagine', false, 'turn-1')
    expect(result).toMatchObject({ ok: true, debitedMinor: minorPentru('imagine') })
    expect(debits[0][1]).toBe(minorPentru('imagine'))
    expect(String(debits[0][2])).toContain('turn-1')
  })

  it('admin zero is derived from account identity, not a caller boolean', async () => {
    for (const [index, tariff] of meniulDeTarife().entries()) {
      expect(await taxeazaServiciu('owner@example.com', tariff.cheie, false, `admin-${index}`))
        .toMatchObject({ ok: true, debitedMinor: 0 })
    }
    expect(debit).not.toHaveBeenCalled()
    await taxeazaServiciu('customer@example.com', 'imagine', true, 'turn-3')
    expect(debit).toHaveBeenCalledOnce()
  })

  it('requires a stable idempotency key even for an exempt admin operation', async () => {
    expect(await taxeazaServiciu('owner@example.com', 'imagine', false))
      .toMatchObject({ ok: false, cod: 'invalid', motiv: 'idempotency_key_required' })
    expect(debit).not.toHaveBeenCalled()
  })

  it('refund is integer and idempotently linked to the charge', async () => {
    const result = await taxeazaServiciu('customer@example.com', 'cv', false, 'turn-4')
    expect(result.ok).toBe(true)
    if (result.ok) await result.ramburseaza()
    expect(grants[0][1]).toBe(minorPentru('cv'))
    expect(String(grants[0][2])).toContain(':refund')
  })
})
