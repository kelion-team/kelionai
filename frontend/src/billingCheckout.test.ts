import { afterEach, describe, expect, it, vi } from 'vitest'
import { newCheckoutIdempotencyKey, startCheckout } from './lib/billing'

const ATTEMPT_ID = '018f47a0-2cc1-7c13-8b22-c4cd0f87c917'
const CHECKOUT_ID = '018f47a0-2cc1-7c13-8b22-c4cd0f87c918'

afterEach(() => vi.unstubAllGlobals())

describe('Revolut hosted checkout client contract', () => {
  it('sends integer minor units with the explicit attempt key and accepts the strict response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 'pending',
        checkoutId: CHECKOUT_ID,
        url: 'https://checkout.revolut.com/payment-link/order-token',
        amountMinor: 2_000,
        currency: 'GBP',
        minorUnit: 2,
      }), { status: 201, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(startCheckout(2_000, ATTEMPT_ID)).resolves.toEqual({
      ok: true,
      pay: {
        status: 'pending',
        checkoutId: CHECKOUT_ID,
        url: 'https://checkout.revolut.com/payment-link/order-token',
        amountMinor: 2_000,
        currency: 'GBP',
        minorUnit: 2,
      },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/checkout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ amountMinor: 2_000, idempotencyKey: ATTEMPT_ID }),
    }))
  })

  it('fails closed before the network for non-integer money or a malformed key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(startCheckout(20.5, ATTEMPT_ID)).resolves.toEqual({ ok: false, error: 'bad_amount' })
    await expect(startCheckout(2_000, 'not-a-uuid')).resolves.toEqual({ ok: false, error: 'idempotency_key_invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects untrusted redirect origins and mismatched monetary responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'pending',
        checkoutId: CHECKOUT_ID,
        url: 'https://payments.example/payment-link/order-token',
        amountMinor: 2_000,
        currency: 'GBP',
        minorUnit: 2,
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'pending',
        checkoutId: CHECKOUT_ID,
        url: 'https://sandbox-checkout.revolut.com/payment-link/order-token',
        amountMinor: 1_999,
        currency: 'GBP',
        minorUnit: 2,
      }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(startCheckout(2_000, ATTEMPT_ID)).resolves.toEqual({ ok: false, error: 'checkout_response_invalid' })
    await expect(startCheckout(2_000, ATTEMPT_ID)).resolves.toEqual({ ok: false, error: 'checkout_response_invalid' })
  })

  it('uses a cryptographically generated UUID for each explicit attempt', () => {
    const randomUUID = vi.fn().mockReturnValue(ATTEMPT_ID)
    vi.stubGlobal('crypto', { randomUUID })
    expect(newCheckoutIdempotencyKey()).toBe(ATTEMPT_ID)
    expect(randomUUID).toHaveBeenCalledOnce()
  })
})
