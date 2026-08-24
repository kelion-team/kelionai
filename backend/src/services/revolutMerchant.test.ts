import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkout = {
  id: '11111111-1111-4111-8111-111111111111',
  grossMinor: 2_000,
  userCreditMinor: 1_500,
  marginMinor: 500,
  currency: 'GBP',
  status: 'creating' as const,
  providerOrderId: null,
  checkoutUrl: null,
}
const orderId = '22222222-2222-4222-8222-222222222222'
const refundOrderId = '55555555-5555-4555-8555-555555555555'
const checkoutUrl = 'https://sandbox-checkout.revolut.com/payment-link/token'
const webhookSecret = 'w'.repeat(48)

const db = vi.hoisted(() => ({
  claimMerchantCheckout: vi.fn(),
  attachMerchantOrder: vi.fn(),
  markMerchantCheckoutCreationFailure: vi.fn(),
  recordMerchantOrderObservation: vi.fn(),
  recordMerchantReconciliationEvent: vi.fn(),
  recordVerifiedMerchantDispute: vi.fn(),
  settleMerchantCheckout: vi.fn(),
  settleMerchantRefund: vi.fn(),
}))

vi.mock('../config.js', () => ({
  config: {
    revolutMerchant: {
      enabled: true,
      secretKey: 's'.repeat(48),
      webhookSigningSecret: webhookSecret,
      apiVersion: '2026-04-20',
      orderExpiry: 'PT2H',
      apiBaseUrl: 'https://sandbox-merchant.revolut.com',
      checkoutOrigin: 'https://sandbox-checkout.revolut.com',
    },
    httpUserAgent: 'Kelionai/test',
    product: { appName: 'Kelionai' },
    publicOrigin: 'https://app.example.test',
    billing: { minorUnit: 2 },
  },
}))

vi.mock('../db.js', () => db)

const {
  handleRevolutWebhook,
  startRevolutCheckout,
  verifyRevolutWebhook,
} = await import('./revolutMerchant.js')

function order(state = 'pending', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: orderId,
    type: 'payment',
    state,
    amount: checkout.grossMinor,
    outstanding_amount: state === 'completed' ? 0 : checkout.grossMinor,
    currency: checkout.currency,
    checkout_url: checkoutUrl,
    merchant_order_data: { reference: checkout.id },
    ...overrides,
  }
}

function refundOrder(amount = 500, state = 'completed'): Record<string, unknown> {
  return {
    id: refundOrderId,
    type: 'refund',
    state,
    amount,
    outstanding_amount: state === 'completed' ? 0 : amount,
    currency: checkout.currency,
    related_order_id: orderId,
    merchant_order_data: { reference: '66666666-6666-4666-8666-666666666666' },
  }
}

function dispute(state = 'lost'): Record<string, unknown> {
  return {
    id: refundOrderId,
    state,
    amount: 500,
    currency: checkout.currency,
    payment: { order_id: orderId },
  }
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function signed(raw: Buffer, timestamp = String(Date.now())): { timestamp: string; signature: string } {
  const digest = createHmac('sha256', webhookSecret)
    .update(`v1.${timestamp}.`)
    .update(raw)
    .digest('hex')
  return { timestamp, signature: `v1=${digest}` }
}

beforeEach(() => {
  vi.restoreAllMocks()
  db.claimMerchantCheckout.mockReset()
  db.attachMerchantOrder.mockReset().mockResolvedValue({ ...checkout, status: 'pending', providerOrderId: orderId, checkoutUrl })
  db.markMerchantCheckoutCreationFailure.mockReset().mockResolvedValue(true)
  db.recordMerchantOrderObservation.mockReset().mockResolvedValue('recorded')
  db.recordMerchantReconciliationEvent.mockReset().mockResolvedValue('recorded')
  db.recordVerifiedMerchantDispute.mockReset().mockResolvedValue('recorded')
  db.settleMerchantCheckout.mockReset().mockResolvedValue({ kind: 'paid', userCreditMinor: 1_500, marginMinor: 500 })
  db.settleMerchantRefund.mockReset().mockResolvedValue({
    kind: 'applied', userCreditMinor: 375, marginMinor: 125, debtCreatedMinor: 0,
  })
})

describe('Revolut Hosted Checkout', () => {
  it('creates one server-side order and persists the provider URL before returning it', async () => {
    db.claimMerchantCheckout.mockResolvedValue({ kind: 'claimed', checkout })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(order(), 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await startRevolutCheckout('user@example.test', checkout.grossMinor, '33333333-3333-4333-8333-333333333333')

    expect(result).toMatchObject({ ok: true, status: 'pending', checkoutId: checkout.id, url: checkoutUrl })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://sandbox-merchant.revolut.com/api/orders')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /)
    expect((init.headers as Record<string, string>)['revolut-api-version']).toBe('2026-04-20')
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 2_000,
      currency: 'GBP',
      capture_mode: 'automatic',
      expire_pending_after: 'PT2H',
      merchant_order_data: { reference: checkout.id },
    })
    expect(db.attachMerchantOrder).toHaveBeenCalledTimes(1)
  })

  it('replays a stored order without a second provider write', async () => {
    db.claimMerchantCheckout.mockResolvedValue({
      kind: 'replay',
      checkout: { ...checkout, status: 'pending', providerOrderId: orderId, checkoutUrl },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await startRevolutCheckout('user@example.test', checkout.grossMinor, '33333333-3333-4333-8333-333333333333')

    expect(result).toMatchObject({ ok: true, checkoutId: checkout.id, url: checkoutUrl })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks deterministic rejections failed and ambiguous provider errors indeterminate', async () => {
    db.claimMerchantCheckout.mockResolvedValue({ kind: 'claimed', checkout })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 422)))
    expect(await startRevolutCheckout('user@example.test', 2_000, '33333333-3333-4333-8333-333333333333'))
      .toMatchObject({ ok: false, statusCode: 422 })
    expect(db.markMerchantCheckoutCreationFailure).toHaveBeenLastCalledWith(checkout.id, 'failed', 'revolut_http_422')

    db.claimMerchantCheckout.mockResolvedValue({ kind: 'claimed', checkout })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'later' }, 500)))
    expect(await startRevolutCheckout('user@example.test', 2_000, '44444444-4444-4444-8444-444444444444'))
      .toMatchObject({ ok: false, statusCode: 502 })
    expect(db.markMerchantCheckoutCreationFailure).toHaveBeenLastCalledWith(checkout.id, 'indeterminate', 'revolut_http_500')
  })

  it('recovers an ambiguous local row with provider reads only', async () => {
    db.claimMerchantCheckout.mockResolvedValue({ kind: 'recover', checkout: { ...checkout, status: 'indeterminate' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ orders: [{ id: orderId }] }, 200))
      .mockResolvedValueOnce(jsonResponse(order(), 200))
    vi.stubGlobal('fetch', fetchMock)

    const result = await startRevolutCheckout('user@example.test', 2_000, '33333333-3333-4333-8333-333333333333')

    expect(result).toMatchObject({ ok: true, checkoutId: checkout.id })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === 'GET')).toBe(true)
  })
})

describe('Revolut webhook authentication and settlement', () => {
  it('verifies an exact raw payload, current timestamp and any matching v1 signature', () => {
    const raw = Buffer.from('{"event":"ORDER_COMPLETED","order_id":"22222222-2222-4222-8222-222222222222"}')
    const proof = signed(raw)
    expect(verifyRevolutWebhook(raw, proof.timestamp, `v1=${'0'.repeat(64)},${proof.signature}`)).toBe(true)
    expect(verifyRevolutWebhook(Buffer.concat([raw, Buffer.from(' ')]), proof.timestamp, proof.signature)).toBe(false)
    expect(verifyRevolutWebhook(raw, String(Date.now() - 300_001), proof.signature)).toBe(false)
  })

  it('retrieves authoritative completed state and settles exactly once', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'ORDER_COMPLETED', order_id: orderId, merchant_order_ext_ref: checkout.id }))
    const proof = signed(raw)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(order('completed'), 200))))

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(db.settleMerchantCheckout).toHaveBeenCalledWith(orderId, checkout.id, 2_000, 'GBP', 'ORDER_COMPLETED')

    db.settleMerchantCheckout.mockResolvedValue({ kind: 'duplicate', userCreditMinor: 1_500, marginMinor: 500 })
    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
  })

  it('uses current provider truth when webhooks arrive out of order', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'ORDER_PAYMENT_FAILED', order_id: orderId }))
    const proof = signed(raw)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(order('completed'), 200)))

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(db.settleMerchantCheckout).toHaveBeenCalledWith(orderId, checkout.id, 2_000, 'GBP', 'ORDER_PAYMENT_FAILED')
  })

  it('rejects unsigned and amount-mismatched completion without granting credit', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'ORDER_COMPLETED', order_id: orderId }))
    vi.stubGlobal('fetch', vi.fn())
    expect(await handleRevolutWebhook(raw, String(Date.now()), `v1=${'0'.repeat(64)}`))
      .toEqual({ statusCode: 401, error: 'webhook_signature_invalid' })
    expect(fetch).not.toHaveBeenCalled()

    const proof = signed(raw)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(order('completed', { amount: 2_004 }), 200)))
    db.settleMerchantCheckout.mockResolvedValue({ kind: 'mismatch' })
    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature))
      .toEqual({ statusCode: 409, error: 'payment_reconciliation_mismatch' })
  })

  it('reconciles an out-of-order partial refund and reverses it exactly once', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'ORDER_COMPLETED', order_id: refundOrderId }))
    const proof = signed(raw)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(refundOrder(), 200))
      .mockResolvedValueOnce(jsonResponse(order('completed'), 200))
    vi.stubGlobal('fetch', fetchMock)

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(db.settleMerchantCheckout).toHaveBeenCalledWith(
      orderId, checkout.id, checkout.grossMinor, checkout.currency, 'ORDER_RECONCILED_BEFORE_REFUND',
    )
    expect(db.settleMerchantRefund).toHaveBeenCalledWith(
      refundOrderId, orderId, 500, 'GBP', 'ORDER_COMPLETED',
    )

    db.settleMerchantCheckout.mockResolvedValue({ kind: 'duplicate', userCreditMinor: 1_500, marginMinor: 500 })
    db.settleMerchantRefund.mockResolvedValue({
      kind: 'duplicate', userCreditMinor: 375, marginMinor: 125, debtCreatedMinor: 0,
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(refundOrder(), 200))
      .mockResolvedValueOnce(jsonResponse(order('completed'), 200)))
    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(db.settleMerchantRefund).toHaveBeenCalledTimes(2)
  })

  it('queues a non-divisible partial refund for manual reconciliation without rounding', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'ORDER_COMPLETED', order_id: refundOrderId }))
    const proof = signed(raw)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(refundOrder(101), 200)))

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(db.recordMerchantReconciliationEvent).toHaveBeenCalledWith(expect.objectContaining({
      providerObjectId: refundOrderId,
      objectKind: 'refund',
      amountMinor: 101,
      resolution: 'manual_review',
    }))
    expect(db.settleMerchantRefund).not.toHaveBeenCalled()
  })

  it('retrieves dispute facts and durably freezes the mapped wallet for review', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'DISPUTE_LOST', order_id: refundOrderId }))
    const proof = signed(raw)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(dispute(), 200))
    vi.stubGlobal('fetch', fetchMock)

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature)).toEqual({ statusCode: 204 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://sandbox-merchant.revolut.com/api/disputes/${refundOrderId}`,
    )
    expect(db.recordVerifiedMerchantDispute).toHaveBeenCalledWith({
      providerObjectId: refundOrderId,
      event: 'DISPUTE_LOST',
      relatedProviderOrderId: orderId,
      amountMinor: 500,
      currency: 'GBP',
      providerState: 'lost',
    })
  })

  it('retries a dispute webhook when authoritative reconciliation storage is unavailable', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'DISPUTE_UNDER_REVIEW', order_id: refundOrderId }))
    const proof = signed(raw)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(dispute('under_review'), 200)))
    db.recordVerifiedMerchantDispute.mockResolvedValue('unavailable')

    expect(await handleRevolutWebhook(raw, proof.timestamp, proof.signature))
      .toEqual({ statusCode: 503, error: 'ledger_unavailable' })
  })
})
