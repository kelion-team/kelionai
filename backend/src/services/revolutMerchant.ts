import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import {
  attachMerchantOrder,
  claimMerchantCheckout,
  markMerchantCheckoutCreationFailure,
  recordMerchantOrderObservation,
  recordMerchantReconciliationEvent,
  recordVerifiedMerchantDispute,
  settleMerchantCheckout,
  settleMerchantRefund,
  type MerchantCheckoutSnapshot,
} from '../db.js'
import { readResponseTextLimited } from './httpBody.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROVIDER_RESPONSE_MAX_BYTES = 256_000
const PROVIDER_TIMEOUT_MS = 20_000
export const REVOLUT_WEBHOOK_MAX_BYTES = 65_536
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1_000

type RevolutOrderState = 'pending' | 'processing' | 'authorised' | 'completed' | 'cancelled' | 'failed'

interface RevolutOrder {
  id: string
  type: 'payment' | 'refund'
  state: RevolutOrderState
  amount: number
  outstandingAmount: number | null
  currency: string
  checkoutUrl: string | null
  reference: string | null
  relatedOrderId: string | null
}

interface RevolutDispute {
  id: string
  state: string
  amount: number
  currency: string
  relatedOrderId: string
}

type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; ambiguous: boolean }

export type RevolutCheckoutResult =
  | {
      ok: true
      status: 'pending' | 'paid'
      checkoutId: string
      url: string
      amountMinor: number
      currency: string
      minorUnit: number
    }
  | { ok: false; statusCode: number; error: string }

export type RevolutWebhookResult = { statusCode: number; error?: string }

function checkoutUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2_048) return null
  try {
    const url = new URL(raw)
    if (
      url.origin !== config.revolutMerchant.checkoutOrigin ||
      url.username || url.password || url.hash ||
      !url.pathname.startsWith('/payment-link/')
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

function parseOrder(raw: unknown): RevolutOrder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const state = typeof value.state === 'string' ? value.state.trim().toLowerCase() : ''
  const amount = Number(value.amount)
  const outstandingAmount = value.outstanding_amount == null ? null : Number(value.outstanding_amount)
  const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : ''
  const type = value.type === 'payment' || value.type === 'refund' ? value.type : null
  const relatedOrderId = typeof value.related_order_id === 'string'
    ? value.related_order_id.trim()
    : null
  const merchantData = value.merchant_order_data
  const reference = merchantData && typeof merchantData === 'object' && !Array.isArray(merchantData)
    && typeof (merchantData as Record<string, unknown>).reference === 'string'
    ? String((merchantData as Record<string, unknown>).reference).trim()
    : null
  if (
    !UUID.test(id) || !type ||
    !['pending', 'processing', 'authorised', 'completed', 'cancelled', 'failed'].includes(state) ||
    !Number.isSafeInteger(amount) || amount <= 0 ||
    (outstandingAmount !== null && (!Number.isSafeInteger(outstandingAmount) || outstandingAmount < 0)) ||
    !/^[A-Z]{3}$/.test(currency) ||
    (reference !== null && (!UUID.test(reference) || reference.length > 64)) ||
    (type === 'refund' && (!relatedOrderId || !UUID.test(relatedOrderId))) ||
    (type === 'payment' && relatedOrderId !== null)
  ) return null
  return {
    id,
    type,
    state: state as RevolutOrderState,
    amount,
    outstandingAmount,
    currency,
    checkoutUrl: checkoutUrl(value.checkout_url),
    reference,
    relatedOrderId,
  }
}

function parseDispute(raw: unknown): RevolutDispute | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const payment = value.payment
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const state = typeof value.state === 'string' ? value.state.trim().toLowerCase() : ''
  const amount = Number(value.amount)
  const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : ''
  const relatedOrderId = typeof (payment as Record<string, unknown>).order_id === 'string'
    ? String((payment as Record<string, unknown>).order_id).trim()
    : ''
  if (
    !UUID.test(id) || !/^[a-z_]{2,32}$/.test(state) ||
    !Number.isSafeInteger(amount) || amount <= 0 ||
    !/^[A-Z]{3}$/.test(currency) || !UUID.test(relatedOrderId)
  ) return null
  return { id, state, amount, currency, relatedOrderId }
}

function merchantHeaders(withBody = false): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${config.revolutMerchant.secretKey}`,
    'revolut-api-version': config.revolutMerchant.apiVersion,
    'user-agent': config.httpUserAgent,
    ...(withBody ? { 'content-type': 'application/json' } : {}),
  }
}

async function providerJson<T>(
  url: URL,
  init: RequestInit,
  expectedStatus: number,
  parse: (raw: unknown) => T | null,
): Promise<ProviderResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...merchantHeaders(Boolean(init.body)), ...init.headers },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const body = await readResponseTextLimited(response, PROVIDER_RESPONSE_MAX_BYTES)
    if (response.status !== expectedStatus) {
      const deterministic = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
      return {
        ok: false,
        status: deterministic ? response.status : 502,
        code: `revolut_http_${response.status}`,
        ambiguous: !deterministic,
      }
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      return { ok: false, status: 502, code: 'revolut_content_type_invalid', ambiguous: true }
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(body)
    } catch {
      return { ok: false, status: 502, code: 'revolut_json_invalid', ambiguous: true }
    }
    const value = parse(decoded)
    return value === null
      ? { ok: false, status: 502, code: 'revolut_response_invalid', ambiguous: true }
      : { ok: true, value }
  } catch (error) {
    const code = error instanceof Error && error.message === 'response_too_large'
      ? 'revolut_response_too_large'
      : 'revolut_unavailable'
    return { ok: false, status: 502, code, ambiguous: true }
  }
}

function merchantUrl(path: string): URL {
  const url = new URL(config.revolutMerchant.apiBaseUrl)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url
}

async function createOrder(checkout: MerchantCheckoutSnapshot): Promise<ProviderResult<RevolutOrder>> {
  const url = merchantUrl('/api/orders')
  return providerJson(
    url,
    {
      method: 'POST',
      body: JSON.stringify({
        amount: checkout.grossMinor,
        currency: checkout.currency,
        description: `${config.product.appName} credits`,
        capture_mode: 'automatic',
        expire_pending_after: config.revolutMerchant.orderExpiry,
        merchant_order_data: { reference: checkout.id },
        redirect_url: `${config.publicOrigin}/credits?payment=return`,
      }),
    },
    201,
    (raw) => {
      const order = parseOrder(raw)
      return order?.type === 'payment' ? order : null
    },
  )
}

async function retrieveOrder(orderId: string): Promise<ProviderResult<RevolutOrder>> {
  if (!UUID.test(orderId)) return { ok: false, status: 400, code: 'order_id_invalid', ambiguous: false }
  return providerJson(merchantUrl(`/api/orders/${orderId}`), { method: 'GET' }, 200, parseOrder)
}

async function retrieveDispute(disputeId: string): Promise<ProviderResult<RevolutDispute>> {
  if (!UUID.test(disputeId)) return { ok: false, status: 400, code: 'dispute_id_invalid', ambiguous: false }
  return providerJson(merchantUrl(`/api/disputes/${disputeId}`), { method: 'GET' }, 200, parseDispute)
}

async function findOrderByReference(checkoutId: string): Promise<ProviderResult<RevolutOrder | null>> {
  const url = merchantUrl('/api/orders')
  url.searchParams.set('merchant_order_data_reference', checkoutId)
  url.searchParams.set('limit', '10')
  const found = await providerJson<string[]>(
    url,
    { method: 'GET' },
    200,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const orders = (raw as Record<string, unknown>).orders
      if (!Array.isArray(orders) || orders.length > 10) return null
      const ids = orders.map((order) => {
        if (!order || typeof order !== 'object' || Array.isArray(order)) return ''
        return typeof (order as Record<string, unknown>).id === 'string'
          ? String((order as Record<string, unknown>).id).trim()
          : ''
      })
      return ids.every((id) => UUID.test(id)) ? ids : null
    },
  )
  if (!found.ok) return found
  const unique = [...new Set(found.value)]
  if (unique.length === 0) return { ok: true, value: null }
  if (unique.length !== 1) return { ok: false, status: 409, code: 'revolut_reference_ambiguous', ambiguous: true }
  return retrieveOrder(unique[0])
}

async function attachAndResolve(
  checkout: MerchantCheckoutSnapshot,
  order: RevolutOrder,
  event: string,
  requireReference: boolean,
): Promise<RevolutCheckoutResult> {
  if (
    order.type !== 'payment' ||
    order.amount !== checkout.grossMinor || order.currency !== checkout.currency ||
    (requireReference && order.reference !== checkout.id) ||
    (order.reference !== null && order.reference !== checkout.id) ||
    !order.checkoutUrl
  ) {
    await markMerchantCheckoutCreationFailure(checkout.id, 'indeterminate', 'provider_order_mismatch')
    return { ok: false, statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  const attached = await attachMerchantOrder(
    checkout.id,
    order.id,
    order.checkoutUrl,
    order.state,
    order.amount,
    order.currency,
    event,
  )
  if (!attached) return { ok: false, statusCode: 503, error: 'checkout_persistence_unavailable' }

  if (order.state === 'completed') {
    if (order.outstandingAmount !== null && order.outstandingAmount !== 0) {
      return { ok: false, statusCode: 409, error: 'payment_reconciliation_mismatch' }
    }
    const settlement = await settleMerchantCheckout(order.id, checkout.id, order.amount, order.currency, event)
    if (settlement.kind === 'mismatch' || settlement.kind === 'not_found') {
      return { ok: false, statusCode: 409, error: 'payment_reconciliation_mismatch' }
    }
    if (settlement.kind === 'unavailable') {
      return { ok: false, statusCode: 503, error: 'ledger_unavailable' }
    }
    return {
      ok: true,
      status: 'paid',
      checkoutId: checkout.id,
      url: order.checkoutUrl,
      amountMinor: checkout.grossMinor,
      currency: checkout.currency,
      minorUnit: config.billing.minorUnit,
    }
  }

  const observed = await recordMerchantOrderObservation(order.id, checkout.id, order.state, event)
  if (observed === 'mismatch' || observed === 'not_found') {
    return { ok: false, statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  if (observed === 'unavailable') return { ok: false, statusCode: 503, error: 'ledger_unavailable' }
  if (order.state === 'cancelled' || order.state === 'failed') {
    return { ok: false, statusCode: 409, error: `payment_${order.state}` }
  }
  return {
    ok: true,
    status: 'pending',
    checkoutId: checkout.id,
    url: order.checkoutUrl,
    amountMinor: checkout.grossMinor,
    currency: checkout.currency,
    minorUnit: config.billing.minorUnit,
  }
}

/** Creates at most one provider order for the newly claimed key. Ambiguous
 * provider failures are never retried as a write; subsequent calls reconcile
 * read-only by merchant_order_data.reference. */
export async function startRevolutCheckout(
  userEmail: string,
  amountMinor: number,
  idempotencyKey: string,
): Promise<RevolutCheckoutResult> {
  if (!config.revolutMerchant.enabled) {
    return { ok: false, statusCode: 503, error: 'payment_setup_required' }
  }
  const claim = await claimMerchantCheckout(userEmail, idempotencyKey, amountMinor)
  if (claim.kind === 'unavailable') return { ok: false, statusCode: 503, error: 'ledger_unavailable' }
  if (claim.kind === 'rejected') {
    return {
      ok: false,
      statusCode: claim.code === 'first_topup_minimum' ? 400 : 409,
      error: claim.code,
    }
  }
  if (claim.kind === 'conflict') return { ok: false, statusCode: 409, error: 'idempotency_conflict' }
  if (claim.kind === 'terminal') return { ok: false, statusCode: 409, error: 'payment_order_closed' }
  if (claim.kind === 'replay') {
    if (!claim.checkout.checkoutUrl) return { ok: false, statusCode: 503, error: 'payment_indeterminate' }
    return {
      ok: true,
      status: claim.checkout.status === 'paid' ? 'paid' : 'pending',
      checkoutId: claim.checkout.id,
      url: claim.checkout.checkoutUrl,
      amountMinor: claim.checkout.grossMinor,
      currency: claim.checkout.currency,
      minorUnit: config.billing.minorUnit,
    }
  }
  if (claim.kind === 'recover') {
    const recovered = await findOrderByReference(claim.checkout.id)
    if (!recovered.ok) {
      return { ok: false, statusCode: recovered.status, error: recovered.code }
    }
    if (!recovered.value) return { ok: false, statusCode: 503, error: 'payment_indeterminate' }
    return attachAndResolve(claim.checkout, recovered.value, 'ORDER_RECONCILED', true)
  }

  const created = await createOrder(claim.checkout)
  if (!created.ok) {
    await markMerchantCheckoutCreationFailure(
      claim.checkout.id,
      created.ambiguous ? 'indeterminate' : 'failed',
      created.code,
    )
    return { ok: false, statusCode: created.status, error: created.code }
  }
  return attachAndResolve(claim.checkout, created.value, 'ORDER_CREATED', false)
}

/** Constant-time Revolut v1 signature verification over the exact raw body. */
export function verifyRevolutWebhook(
  rawBody: Buffer,
  timestampHeader: unknown,
  signatureHeader: unknown,
  nowMs = Date.now(),
): boolean {
  if (
    !config.revolutMerchant.webhookSigningSecret ||
    !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > REVOLUT_WEBHOOK_MAX_BYTES ||
    typeof timestampHeader !== 'string' || !/^\d{13}$/.test(timestampHeader) ||
    typeof signatureHeader !== 'string' || signatureHeader.length > 2_048
  ) return false
  const timestamp = Number(timestampHeader)
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs - timestamp) > WEBHOOK_TOLERANCE_MS) return false
  const expected = createHmac('sha256', config.revolutMerchant.webhookSigningSecret)
    .update(`v1.${timestampHeader}.`)
    .update(rawBody)
    .digest()
  const candidates = signatureHeader.split(',').map((value) => value.trim())
  for (const candidate of candidates) {
    const match = /^v1=([a-f0-9]{64})$/i.exec(candidate)
    if (!match) continue
    const actual = Buffer.from(match[1], 'hex')
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true
  }
  return false
}

const ORDER_EVENTS = new Set([
  'ORDER_COMPLETED',
  'ORDER_AUTHORISED',
  'ORDER_CANCELLED',
  'ORDER_FAILED',
  'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_DECLINED',
])

const DISPUTE_EVENTS = new Set([
  'DISPUTE_ACTION_REQUIRED',
  'DISPUTE_UNDER_REVIEW',
  'DISPUTE_WON',
  'DISPUTE_LOST',
])

async function persistReconciliation(input: Parameters<typeof recordMerchantReconciliationEvent>[0]): Promise<RevolutWebhookResult> {
  const recorded = await recordMerchantReconciliationEvent(input)
  if (recorded === 'recorded') return { statusCode: 204 }
  if (recorded === 'unavailable') return { statusCode: 503, error: 'ledger_unavailable' }
  return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
}

async function handleRefundOrder(order: RevolutOrder, event: string): Promise<RevolutWebhookResult> {
  if (order.type !== 'refund' || !order.relatedOrderId) {
    return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  if (order.state !== 'completed') {
    return persistReconciliation({
      providerObjectId: order.id,
      event,
      objectKind: 'refund',
      relatedProviderOrderId: order.relatedOrderId,
      amountMinor: order.amount,
      currency: order.currency,
      providerState: order.state,
      resolution: order.state === 'failed' || order.state === 'cancelled' ? 'manual_review' : 'pending',
    })
  }
  if (
    (order.outstandingAmount !== null && order.outstandingAmount !== 0) ||
    order.amount % 4 !== 0
  ) {
    return persistReconciliation({
      providerObjectId: order.id,
      event,
      objectKind: 'refund',
      relatedProviderOrderId: order.relatedOrderId,
      amountMinor: order.amount,
      currency: order.currency,
      providerState: order.state,
      resolution: 'manual_review',
    })
  }

  // A refund webhook may overtake the original payment webhook. Reconcile the
  // authoritative original order first, then reverse the customer ledger.
  const originalResult = await retrieveOrder(order.relatedOrderId)
  if (!originalResult.ok) {
    return {
      statusCode: originalResult.status >= 500 ? 503 : originalResult.status,
      error: originalResult.code,
    }
  }
  const original = originalResult.value
  if (
    original.type !== 'payment' || original.state !== 'completed' ||
    !original.reference || original.currency !== order.currency ||
    (original.outstandingAmount !== null && original.outstandingAmount !== 0)
  ) return { statusCode: 409, error: 'payment_reconciliation_mismatch' }

  if (original.checkoutUrl) {
    const attached = await attachMerchantOrder(
      original.reference,
      original.id,
      original.checkoutUrl,
      original.state,
      original.amount,
      original.currency,
      'ORDER_RECONCILED_BEFORE_REFUND',
    )
    if (!attached) return { statusCode: 503, error: 'checkout_persistence_unavailable' }
  }
  const originalSettlement = await settleMerchantCheckout(
    original.id,
    original.reference,
    original.amount,
    original.currency,
    'ORDER_RECONCILED_BEFORE_REFUND',
  )
  if (originalSettlement.kind === 'unavailable') return { statusCode: 503, error: 'ledger_unavailable' }
  if (originalSettlement.kind === 'not_found' || originalSettlement.kind === 'mismatch') {
    return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }

  const refundSettlement = await settleMerchantRefund(
    order.id,
    original.id,
    order.amount,
    order.currency,
    event,
  )
  if (refundSettlement.kind === 'applied' || refundSettlement.kind === 'duplicate') {
    return { statusCode: 204 }
  }
  if (refundSettlement.kind === 'unavailable' || refundSettlement.kind === 'not_ready') {
    return { statusCode: 503, error: 'ledger_unavailable' }
  }
  return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
}

export async function handleRevolutWebhook(
  rawBody: Buffer,
  timestampHeader: unknown,
  signatureHeader: unknown,
): Promise<RevolutWebhookResult> {
  if (!config.revolutMerchant.enabled) return { statusCode: 503, error: 'payment_setup_required' }
  if (!verifyRevolutWebhook(rawBody, timestampHeader, signatureHeader)) {
    return { statusCode: 401, error: 'webhook_signature_invalid' }
  }
  let payload: unknown
  try {
    const text = rawBody.toString('utf8')
    if (text.includes('\uFFFD')) throw new Error('utf8_invalid')
    payload = JSON.parse(text)
  } catch {
    return { statusCode: 400, error: 'webhook_json_invalid' }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { statusCode: 400, error: 'webhook_payload_invalid' }
  }
  const value = payload as Record<string, unknown>
  const event = typeof value.event === 'string' ? value.event.trim().toUpperCase() : ''
  const orderId = typeof value.order_id === 'string' ? value.order_id.trim() : ''
  if (!/^[A-Z_]{3,64}$/.test(event) || !UUID.test(orderId)) {
    return { statusCode: 400, error: 'webhook_payload_invalid' }
  }
  if (DISPUTE_EVENTS.has(event)) {
    // The webhook only identifies the dispute. Retrieve its authoritative
    // amount/currency/payment order, then durably freeze the mapped wallet.
    // Final chargeback movement remains a reviewed reconciliation decision.
    const dispute = await retrieveDispute(orderId)
    if (!dispute.ok) {
      return { statusCode: dispute.status >= 500 ? 503 : dispute.status, error: dispute.code }
    }
    if (dispute.value.id !== orderId) {
      return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
    }
    const recorded = await recordVerifiedMerchantDispute({
      providerObjectId: dispute.value.id,
      event,
      relatedProviderOrderId: dispute.value.relatedOrderId,
      amountMinor: dispute.value.amount,
      currency: dispute.value.currency,
      providerState: dispute.value.state,
    })
    if (recorded === 'recorded') return { statusCode: 204 }
    if (recorded === 'unavailable') return { statusCode: 503, error: 'ledger_unavailable' }
    return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  if (!ORDER_EVENTS.has(event)) return { statusCode: 204 }

  const retrieved = await retrieveOrder(orderId)
  if (!retrieved.ok) return { statusCode: retrieved.status >= 500 ? 503 : retrieved.status, error: retrieved.code }
  const order = retrieved.value
  if (order.id !== orderId) {
    return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  if (order.type === 'refund') return handleRefundOrder(order, event)
  if (!order.reference) return { statusCode: 409, error: 'payment_reconciliation_mismatch' }

  // Attach first when a webhook wins the race with the checkout response.
  if (order.checkoutUrl) {
    await attachMerchantOrder(
      order.reference,
      order.id,
      order.checkoutUrl,
      order.state,
      order.amount,
      order.currency,
      event,
    )
  }
  if (order.state === 'completed') {
    if (order.outstandingAmount !== null && order.outstandingAmount !== 0) {
      return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
    }
    const settlement = await settleMerchantCheckout(order.id, order.reference, order.amount, order.currency, event)
    if (settlement.kind === 'paid' || settlement.kind === 'duplicate') return { statusCode: 204 }
    if (settlement.kind === 'unavailable') return { statusCode: 503, error: 'ledger_unavailable' }
    return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
  }
  const observed = await recordMerchantOrderObservation(order.id, order.reference, order.state, event)
  if (observed === 'recorded') return { statusCode: 204 }
  if (observed === 'unavailable') return { statusCode: 503, error: 'ledger_unavailable' }
  return { statusCode: 409, error: 'payment_reconciliation_mismatch' }
}
