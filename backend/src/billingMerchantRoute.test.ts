import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { email: 'user@example.test' } as { email: string } | null,
  wallet: { citit: true as const, balanceMinor: 0, topupRefMinor: 0 },
  start: vi.fn(),
  webhook: vi.fn(),
  walletReads: 0,
}))

vi.mock('./config.js', () => ({
  config: {
    billing: {
      currency: 'GBP', minorUnit: 2, policyVersion: 'policy-v1',
      userShareBps: 7_500, marginShareBps: 2_500, creditMinor: 10,
      chatTurnMinor: 1, firstTopupMinMinor: 2_000, topupMinMinor: 500,
      topupStepMinor: 500, topupMaxMinor: 50_000,
      lowCreditThresholdMinor: 200, suggestedTopupMinor: 1_000,
    },
    adminEmail: 'owner@example.test',
  },
}))
vi.mock('./session.js', () => ({ getSessionUser: () => state.user }))
vi.mock('./services/adminIdentity.js', () => ({
  esteAdminKelion: (email: string) => email === 'owner@example.test',
}))
vi.mock('./db.js', () => ({
  citestePortofel: vi.fn(async () => {
    state.walletReads++
    return state.wallet
  }),
  citesteCrediteFolosite: vi.fn(async () => ({ citit: true, valoare: 0 })),
  listTransactionsForUser: vi.fn(async () => ({ citit: true, valoare: [] })),
  getLowCreditReminder: vi.fn(async () => ({ enabled: false, thresholdMinor: 200, suggestedTopupMinor: 1_000 })),
  setLowCreditReminder: vi.fn(async () => true),
}))
vi.mock('./services/revolutMerchant.js', () => ({
  REVOLUT_WEBHOOK_MAX_BYTES: 65_536,
  startRevolutCheckout: state.start,
  handleRevolutWebhook: state.webhook,
}))

const { billingRoutes } = await import('./routes/billing.js')

async function buildApp() {
  const app = Fastify()
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (error) {
      done(error as Error, undefined)
    }
  })
  await app.register(billingRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  state.user = { email: 'user@example.test' }
  state.wallet = { citit: true, balanceMinor: 0, topupRefMinor: 0 }
  state.walletReads = 0
  state.start.mockReset().mockResolvedValue({
    ok: true,
    status: 'pending',
    checkoutId: '11111111-1111-4111-8111-111111111111',
    url: 'https://sandbox-checkout.revolut.com/payment-link/token',
    amountMinor: 2_000,
    currency: 'GBP',
    minorUnit: 2,
  })
  state.webhook.mockReset().mockResolvedValue({ statusCode: 204 })
})

describe('billing Merchant routes', () => {
  it('keeps balance and history private when no session exists', async () => {
    state.user = null
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/billing/balance' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/billing/history' })).statusCode).toBe(401)
    expect(state.walletReads).toBe(0)
    await app.close()
  })

  it('returns the authoritative admin exemption without requiring a wallet row', async () => {
    state.user = { email: 'owner@example.test' }
    state.wallet = { citit: true, balanceMinor: -102_800, topupRefMinor: 0 }
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/billing/balance' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      credits: 0,
      creditsUsed: 0,
      debitMinor: 0,
      lowCreditPaymentPrompt: null,
      scutit: true,
    })
    expect(state.walletReads).toBe(0)
    await app.close()
  })

  it('fails closed instead of returning a negative customer balance', async () => {
    state.wallet = { citit: true, balanceMinor: -102_800, topupRefMinor: 2_000 }
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/billing/balance' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'ledger_invalid', currency: 'GBP' })
    await app.close()
  })

  it('accepts integer minor units plus a UUID and returns the hosted checkout', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      payload: { amountMinor: 2_000, idempotencyKey: '33333333-3333-4333-8333-333333333333' },
    })
    expect(response.statusCode).toBe(201)
    expect(state.start).toHaveBeenCalledWith('user@example.test', 2_000, '33333333-3333-4333-8333-333333333333')
    await app.close()
  })

  it('rejects malformed idempotency before any provider call', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      payload: { amountMinor: 2_000, idempotencyKey: 'bad' },
    })
    expect(response.statusCode).toBe(400)
    expect(state.start).not.toHaveBeenCalled()
    await app.close()
  })

  it('passes the exact raw webhook bytes to signature verification', async () => {
    const app = await buildApp()
    const raw = '{ "event" : "ORDER_COMPLETED", "order_id" : "22222222-2222-4222-8222-222222222222" }'
    const response = await app.inject({
      method: 'POST',
      url: '/api/billing/revolut/webhook',
      headers: {
        'content-type': 'application/json',
        'revolut-request-timestamp': '1787550000000',
        'revolut-signature': `v1=${'a'.repeat(64)}`,
      },
      payload: raw,
    })
    expect(response.statusCode).toBe(204)
    expect(state.webhook).toHaveBeenCalledTimes(1)
    expect(Buffer.isBuffer(state.webhook.mock.calls[0][0])).toBe(true)
    expect((state.webhook.mock.calls[0][0] as Buffer).toString('utf8')).toBe(raw)
    await app.close()
  })
})
