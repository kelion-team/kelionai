import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ORDER_ID = '22222222-2222-4222-8222-222222222222'
interface RefundState {
  original: {
    id: string
    user_email: string
    gross_minor: string
    user_credit_minor: string
    margin_minor: string
    refunded_gross_minor: string
    refunded_user_credit_minor: string
    refunded_margin_minor: string
    currency: string
    policy_version: string
    status: string
    provider_order_id: string
    checkout_url: string
  }
  balanceMinor: number
  debtMinor: number
  topupRefMinor: number
  refunds: Map<string, {
    original_provider_order_id: string
    checkout_id: string
    gross_minor: string
    user_credit_minor: string
    margin_minor: string
    currency: string
    policy_version: string
    debt_created_minor: string
  }>
  billing: Array<{ kind: string; amountMinor: number; ref: string }>
  transactions: Array<{ grossMinor: number; status: string; ref: string }>
  commits: number
  tail: Promise<void>
}

const state = vi.hoisted((): RefundState => ({
  original: {
    id: '11111111-1111-4111-8111-111111111111',
    user_email: 'buyer@example.test',
    gross_minor: '2000',
    user_credit_minor: '1500',
    margin_minor: '500',
    refunded_gross_minor: '0',
    refunded_user_credit_minor: '0',
    refunded_margin_minor: '0',
    currency: 'GBP',
    policy_version: 'kelion-gbp-75-25-v1',
    status: 'paid',
    provider_order_id: '22222222-2222-4222-8222-222222222222',
    checkout_url: 'https://sandbox-checkout.revolut.com/payment-link/token',
  },
  balanceMinor: 1_500,
  debtMinor: 0,
  topupRefMinor: 1_500,
  refunds: new Map(),
  billing: [],
  transactions: [],
  commits: 0,
  tail: Promise.resolve(),
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: {
      currency: 'GBP', policyVersion: 'kelion-gbp-75-25-v1', minorUnit: 2,
      creditMinor: 10, userShareBps: 7_500, marginShareBps: 2_500,
      topupStepMinor: 500, topupMinMinor: 500, firstTopupMinMinor: 2_000,
      topupMaxMinor: 50_000,
    },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => {
    let unlock: (() => void) | null = null
    let snapshot: Omit<RefundState, 'tail'> | null = null
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql === 'BEGIN') {
          const before = state.tail
          state.tail = new Promise<void>((resolve) => { unlock = resolve })
          await before
          snapshot = {
            original: { ...state.original },
            balanceMinor: state.balanceMinor,
            debtMinor: state.debtMinor,
            topupRefMinor: state.topupRefMinor,
            refunds: new Map([...state.refunds].map(([key, value]) => [key, { ...value }])),
            billing: state.billing.map((row) => ({ ...row })),
            transactions: state.transactions.map((row) => ({ ...row })),
            commits: state.commits,
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
            state.original = { ...snapshot.original }
            state.balanceMinor = snapshot.balanceMinor
            state.debtMinor = snapshot.debtMinor
            state.topupRefMinor = snapshot.topupRefMinor
            state.refunds = new Map([...snapshot.refunds].map(([key, value]) => [key, { ...value }]))
            state.billing = snapshot.billing.map((row) => ({ ...row }))
            state.transactions = snapshot.transactions.map((row) => ({ ...row }))
            state.commits = snapshot.commits
          }
          unlock?.()
          unlock = null
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('FROM merchant_checkout_orders') && sql.includes('WHERE provider_order_id = $1')) {
          return params[0] === state.original.provider_order_id
            ? { rows: [{ ...state.original }], rowCount: 1 }
            : { rows: [], rowCount: 0 }
        }
        if (sql.includes('FROM merchant_refund_events')) {
          const refund = state.refunds.get(String(params[0]))
          return { rows: refund ? [{ ...refund }] : [], rowCount: refund ? 1 : 0 }
        }
        if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              balance_minor: String(state.balanceMinor),
              debt_minor: String(state.debtMinor),
              currency: 'GBP',
            }],
            rowCount: 1,
          }
        }
        if (sql.includes('UPDATE wallets')) {
          state.balanceMinor = Number(params[1])
          state.topupRefMinor = Math.min(state.topupRefMinor, state.balanceMinor)
          state.debtMinor = Number(params[2])
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO billing_events')) {
          state.billing.push({
            kind: sql.includes("'margin_refund'") ? 'margin_refund' : 'refund',
            amountMinor: Number(params[1]),
            ref: String(params[4]),
          })
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO transactions')) {
          state.transactions.push({
            grossMinor: Number(params[1]),
            status: 'refunded',
            ref: String(params[6]),
          })
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO merchant_refund_events')) {
          state.refunds.set(String(params[0]), {
            original_provider_order_id: String(params[1]),
            checkout_id: String(params[2]),
            gross_minor: String(params[3]),
            user_credit_minor: String(params[4]),
            margin_minor: String(params[5]),
            currency: String(params[6]),
            policy_version: String(params[7]),
            debt_created_minor: String(params[9]),
          })
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('UPDATE merchant_checkout_orders')) {
          state.original.refunded_gross_minor = String(Number(state.original.refunded_gross_minor) + Number(params[1]))
          state.original.refunded_user_credit_minor = String(Number(state.original.refunded_user_credit_minor) + Number(params[2]))
          state.original.refunded_margin_minor = String(Number(state.original.refunded_margin_minor) + Number(params[3]))
          return { rows: [], rowCount: 1 }
        }
        throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`)
      },
      release: vi.fn(),
    }
  },
}))

const { settleMerchantRefund } = await import('./db.js')

beforeEach(() => {
  state.original.status = 'paid'
  state.original.refunded_gross_minor = '0'
  state.original.refunded_user_credit_minor = '0'
  state.original.refunded_margin_minor = '0'
  state.balanceMinor = 1_500
  state.debtMinor = 0
  state.topupRefMinor = 1_500
  state.refunds.clear()
  state.billing.length = 0
  state.transactions.length = 0
  state.commits = 0
  state.tail = Promise.resolve()
})

describe('merchant refund accounting', () => {
  it('reverses an exact partial 75/25 split and records one refund history row', async () => {
    const result = await settleMerchantRefund(
      '55555555-5555-4555-8555-555555555555', ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED',
    )
    expect(result).toEqual({ kind: 'applied', userCreditMinor: 375, marginMinor: 125, debtCreatedMinor: 0 })
    expect(state.balanceMinor).toBe(1_125)
    expect(state.debtMinor).toBe(0)
    expect(state.billing).toEqual([
      { kind: 'refund', amountMinor: -375, ref: 'revolut-refund:55555555-5555-4555-8555-555555555555' },
      { kind: 'margin_refund', amountMinor: -125, ref: 'revolut-refund:55555555-5555-4555-8555-555555555555:margin' },
    ])
    expect(state.transactions).toHaveLength(1)
    expect(state.original.refunded_gross_minor).toBe('500')
  })

  it('makes a duplicate delivery a no-op', async () => {
    const id = '55555555-5555-4555-8555-555555555555'
    await expect(settleMerchantRefund(id, ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED'))
      .resolves.toMatchObject({ kind: 'applied' })
    await expect(settleMerchantRefund(id, ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED'))
      .resolves.toMatchObject({ kind: 'duplicate' })
    expect(state.balanceMinor).toBe(1_125)
    expect(state.billing).toHaveLength(2)
    expect(state.transactions).toHaveLength(1)
  })

  it('recognises replay of the final full refund after cumulative totals reached the order amount', async () => {
    const id = '55555555-5555-4555-8555-555555555555'
    await expect(settleMerchantRefund(id, ORIGINAL_ORDER_ID, 2_000, 'GBP', 'ORDER_COMPLETED'))
      .resolves.toMatchObject({ kind: 'applied', userCreditMinor: 1_500, marginMinor: 500 })
    await expect(settleMerchantRefund(id, ORIGINAL_ORDER_ID, 2_000, 'GBP', 'ORDER_COMPLETED'))
      .resolves.toMatchObject({ kind: 'duplicate', userCreditMinor: 1_500, marginMinor: 500 })
    expect(state.original.refunded_gross_minor).toBe('2000')
    expect(state.billing).toHaveLength(2)
    expect(state.transactions).toHaveLength(1)
  })

  it('serializes distinct partial refunds and rejects an over-refund', async () => {
    const outcomes = await Promise.all([
      settleMerchantRefund('55555555-5555-4555-8555-555555555555', ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED'),
      settleMerchantRefund('66666666-6666-4666-8666-666666666666', ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED'),
    ])
    expect(outcomes.every((result) => result.kind === 'applied')).toBe(true)
    expect(state.original.refunded_gross_minor).toBe('1000')
    await expect(
      settleMerchantRefund('77777777-7777-4777-8777-777777777777', ORIGINAL_ORDER_ID, 1_500, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'mismatch' })
    expect(state.original.refunded_gross_minor).toBe('1000')
  })

  it('never exposes a negative wallet when refunded credit was already spent', async () => {
    state.balanceMinor = 100
    const result = await settleMerchantRefund(
      '55555555-5555-4555-8555-555555555555', ORIGINAL_ORDER_ID, 500, 'GBP', 'ORDER_COMPLETED',
    )
    expect(result).toEqual({ kind: 'applied', userCreditMinor: 375, marginMinor: 125, debtCreatedMinor: 275 })
    expect(state.balanceMinor).toBe(0)
    expect(state.debtMinor).toBe(275)
  })

  it('rejects non-divisible or foreign-currency refunds without ledger writes', async () => {
    await expect(
      settleMerchantRefund('55555555-5555-4555-8555-555555555555', ORIGINAL_ORDER_ID, 101, 'GBP', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'mismatch' })
    await expect(
      settleMerchantRefund('66666666-6666-4666-8666-666666666666', ORIGINAL_ORDER_ID, 500, 'USD', 'ORDER_COMPLETED'),
    ).resolves.toEqual({ kind: 'mismatch' })
    expect(state.balanceMinor).toBe(1_500)
    expect(state.billing).toHaveLength(0)
  })
})
