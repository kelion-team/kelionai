import { beforeEach, describe, expect, it, vi } from 'vitest'

const CHECKOUT_ID = '018f47a0-2cc1-7c13-8b22-c4cd0f87c918'
const ORDER_ID = '018f47a0-2cc1-7c13-8b22-c4cd0f87c919'

const state = vi.hoisted(() => ({
  connectFails: false,
  checkout: {
    id: '018f47a0-2cc1-7c13-8b22-c4cd0f87c918',
    user_email: 'buyer@example.com',
    gross_minor: '2000',
    user_credit_minor: '1500',
    margin_minor: '500',
    currency: 'GBP',
    policy_version: 'customer-credit-v1',
    status: 'pending',
    provider_order_id: '018f47a0-2cc1-7c13-8b22-c4cd0f87c919',
    checkout_url: 'https://checkout.revolut.com/payment-link/order-token',
  },
  walletMinor: 0,
  billing: [] as Array<{ kind: string; amountMinor: number; ref: string }>,
  transactions: 0,
  commits: 0,
  topupRefMinor: 0,
  merchantInserts: 0,
  tail: Promise.resolve() as Promise<void>,
}))

const configMock = vi.hoisted(() => ({
  databaseUrl: 'postgres://test',
  adminEmail: 'owner@example.com',
  billing: {
    currency: 'GBP',
    policyVersion: 'customer-credit-v1',
    minorUnit: 2,
    creditMinor: 10,
    userShareBps: 7_500,
    marginShareBps: 2_500,
    topupStepMinor: 500,
    topupMinMinor: 500,
    firstTopupMinMinor: 2_000,
    topupMaxMinor: 50_000,
  },
}))

vi.mock('./config.js', () => ({ config: configMock }))
vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => {
    if (state.connectFails) throw new Error('database unavailable')
    let unlock: (() => void) | null = null
    let snapshot: null | {
      checkoutStatus: string
      walletMinor: number
      billingLength: number
      transactions: number
      merchantInserts: number
    } = null
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql === 'BEGIN') {
          const before = state.tail
          state.tail = new Promise<void>((resolve) => { unlock = resolve })
          await before
          snapshot = {
            checkoutStatus: state.checkout.status,
            walletMinor: state.walletMinor,
            billingLength: state.billing.length,
            transactions: state.transactions,
            merchantInserts: state.merchantInserts,
          }
          return { rows: [], rowCount: 0 }
        }
        if (sql === 'COMMIT') {
          state.commits++
          unlock?.()
          unlock = null
          return { rows: [], rowCount: 0 }
        }
        if (sql === 'ROLLBACK') {
          if (snapshot) {
            state.checkout.status = snapshot.checkoutStatus
            state.walletMinor = snapshot.walletMinor
            state.billing.length = snapshot.billingLength
            state.transactions = snapshot.transactions
            state.merchantInserts = snapshot.merchantInserts
          }
          unlock?.()
          unlock = null
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('INSERT INTO wallets') && sql.includes('VALUES ($1, 0, $2, 0)')) {
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('SELECT topup_ref_minor::text, currency')) {
          return {
            rows: [{ topup_ref_minor: String(state.topupRefMinor), currency: 'GBP' }],
            rowCount: 1,
          }
        }
        if (sql.includes('INSERT INTO merchant_checkout_orders')) {
          state.merchantInserts++
          return {
            rows: [{
              id: String(params[0]),
              gross_minor: String(params[3]),
              user_credit_minor: String(params[4]),
              margin_minor: String(params[5]),
              currency: String(params[6]),
              policy_version: String(params[7]),
              status: 'creating',
              provider_order_id: null,
              checkout_url: null,
            }],
            rowCount: 1,
          }
        }
        if (sql.includes('FROM merchant_checkout_orders') && sql.includes('FOR UPDATE')) {
          return params[0] === state.checkout.provider_order_id
            ? { rows: [{ ...state.checkout }], rowCount: 1 }
            : { rows: [], rowCount: 0 }
        }
        if (sql.includes('SELECT 1 FROM billing_events')) {
          const found = state.billing.some((row) => row.ref === params[0])
          return { rows: found ? [{ '?column?': 1 }] : [], rowCount: found ? 1 : 0 }
        }
        if (sql.includes('INSERT INTO billing_events')) {
          state.billing.push({
            kind: sql.includes("'topup'") ? 'topup' : 'margin',
            amountMinor: Number(params[1]),
            ref: String(params[4]),
          })
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO wallets')) {
          state.walletMinor += Number(params[1])
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO transactions')) {
          state.transactions++
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('UPDATE merchant_checkout_orders')) {
          if (state.checkout.status === 'paid') return { rows: [], rowCount: 0 }
          state.checkout.status = 'paid'
          return { rows: [], rowCount: 1 }
        }
        throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 100)}`)
      },
      release: vi.fn(),
    }
  },
}))

const { claimMerchantCheckout, settleMerchantCheckout } = await import('./db.js')

beforeEach(() => {
  state.connectFails = false
  state.checkout.status = 'pending'
  state.walletMinor = 0
  state.billing.length = 0
  state.transactions = 0
  state.commits = 0
  state.topupRefMinor = 0
  state.merchantInserts = 0
  state.tail = Promise.resolve()
})

describe('merchant checkout atomic settlement', () => {
  it('enforces the first top-up minimum inside the locked DB claim', async () => {
    await expect(
      claimMerchantCheckout('buyer@example.com', '33333333-3333-4333-8333-333333333333', 500),
    ).resolves.toEqual({ kind: 'rejected', code: 'first_topup_minimum' })
    expect(state.merchantInserts).toBe(0)

    await expect(
      claimMerchantCheckout('buyer@example.com', '44444444-4444-4444-8444-444444444444', 2_000),
    ).resolves.toMatchObject({
      kind: 'claimed',
      checkout: { grossMinor: 2_000, userCreditMinor: 1_500, marginMinor: 500 },
    })
    expect(state.merchantInserts).toBe(1)
    expect(state.commits).toBe(1)
  })

  it('credits exactly 75%, records 25%, and makes provider replay a no-op', async () => {
    await expect(
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_000, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'paid', userCreditMinor: 1_500, marginMinor: 500 })

    expect(state.walletMinor).toBe(1_500)
    expect(state.billing).toEqual([
      { kind: 'topup', amountMinor: 1_500, ref: `revolut:${ORDER_ID}` },
      { kind: 'margin', amountMinor: 500, ref: `revolut:${ORDER_ID}:margin` },
    ])
    expect(state.transactions).toBe(1)
    expect(state.checkout.status).toBe('paid')
    expect(state.commits).toBe(1)

    await expect(
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_000, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'duplicate', userCreditMinor: 1_500, marginMinor: 500 })
    expect(state.walletMinor).toBe(1_500)
    expect(state.billing).toHaveLength(2)
    expect(state.transactions).toBe(1)
  })

  it('serializes concurrent webhook deliveries into one credit', async () => {
    const outcomes = await Promise.all([
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_000, 'GBP', 'ORDER_COMPLETED'),
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_000, 'GBP', 'ORDER_COMPLETED'),
    ])
    expect(outcomes.map((item) => item.kind).sort()).toEqual(['duplicate', 'paid'])
    expect(state.walletMinor).toBe(1_500)
    expect(state.billing).toHaveLength(2)
    expect(state.transactions).toBe(1)
  })

  it('rolls back without credit when provider money differs from the immutable order', async () => {
    await expect(
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_500, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'mismatch' })
    expect(state.walletMinor).toBe(0)
    expect(state.billing).toHaveLength(0)
    expect(state.transactions).toBe(0)
    expect(state.checkout.status).toBe('pending')
  })

  it('fails closed when a database client cannot be acquired', async () => {
    state.connectFails = true
    await expect(
      settleMerchantCheckout(ORDER_ID, CHECKOUT_ID, 2_000, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'unavailable' })
  })
})
