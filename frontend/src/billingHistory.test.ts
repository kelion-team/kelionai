import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHistory, paymentStatusPresentation, type PaymentStatus } from './lib/billing'

afterEach(() => vi.unstubAllGlobals())

describe('payment history contract', () => {
  it('labels every canonical settlement state without treating pending or chargeback as paid', () => {
    const statuses: PaymentStatus[] = ['pending', 'paid', 'refunded', 'chargeback', 'failed', 'admin_grant']
    const tones = Object.fromEntries(statuses.map((status) => [status, paymentStatusPresentation(status, 'en').tone]))
    expect(tones).toEqual({
      pending: 'warning',
      paid: 'success',
      refunded: 'warning',
      chargeback: 'danger',
      failed: 'danger',
      admin_grant: 'success',
    })
  })

  it('accepts only integer minor units and the strict backend status union', async () => {
    const valid = {
      history: [{
        id: 1,
        amountMinor: 1234,
        credits: 92,
        currency: 'GBP',
        status: 'pending',
        createdAt: '2026-08-24T10:00:00.000Z',
      }],
      minorUnit: 2,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(valid), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...valid,
        history: [{ ...valid.history[0], status: 'succeeded' }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchHistory()).toEqual([{ ...valid.history[0], minorUnit: 2 }])
    expect(await fetchHistory()).toBeNull()
  })
})
