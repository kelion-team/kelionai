import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let database: PGlite

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: { currency: 'GBP', policyVersion: 'policy-v1', creditMinor: 10 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: () => ({ query: (sql: string, params?: unknown[]) => database.query(sql, params) }),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => ({
    query: (sql: string, params?: unknown[]) => database.query(sql, params),
    release: vi.fn(),
  }),
}))

const { recordVerifiedMerchantDispute } = await import('./db.js')
const checkoutId = '11111111-1111-4111-8111-111111111111'
const providerOrderId = '22222222-2222-4222-8222-222222222222'
const disputeId = '33333333-3333-4333-8333-333333333333'

beforeEach(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE merchant_checkout_orders (
      id UUID PRIMARY KEY,
      provider_order_id UUID UNIQUE,
      user_email TEXT NOT NULL,
      gross_minor BIGINT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE wallets (
      user_email TEXT PRIMARY KEY,
      balance_minor BIGINT NOT NULL,
      currency TEXT NOT NULL,
      frozen_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE merchant_reconciliation_events (
      provider_object_id UUID NOT NULL,
      event TEXT NOT NULL,
      object_kind TEXT NOT NULL,
      related_provider_order_id UUID,
      amount_minor BIGINT,
      currency TEXT,
      provider_state TEXT,
      resolution TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider_object_id, event)
    );
    INSERT INTO merchant_checkout_orders
      (id, provider_order_id, user_email, gross_minor, currency, status)
      VALUES ('${checkoutId}', '${providerOrderId}', 'buyer@example.test', 2000, 'GBP', 'paid');
    INSERT INTO wallets (user_email, balance_minor, currency)
      VALUES ('buyer@example.test', 1500, 'GBP');
  `)
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

function lostDispute(amountMinor = 500) {
  return {
    providerObjectId: disputeId,
    event: 'DISPUTE_LOST',
    relatedProviderOrderId: providerOrderId,
    amountMinor,
    currency: 'GBP',
    providerState: 'lost',
  }
}

describe('verified Merchant dispute intake', () => {
  it('records exact facts and freezes the mapped wallet transactionally', { timeout: 30_000 }, async () => {
    await expect(recordVerifiedMerchantDispute(lostDispute())).resolves.toBe('recorded')
    const wallet = await database.query<{ frozen_reason: string | null }>(
      "SELECT frozen_reason FROM wallets WHERE user_email='buyer@example.test'",
    )
    expect(wallet.rows[0]?.frozen_reason).toBe('merchant_dispute')
    const event = await database.query<{ amount_minor: string; related_provider_order_id: string }>(
      'SELECT amount_minor::text, related_provider_order_id::text FROM merchant_reconciliation_events',
    )
    expect(event.rows[0]).toEqual({ amount_minor: '500', related_provider_order_id: providerOrderId })
  })

  it('accepts an identical webhook retry but rejects changed accounting facts', { timeout: 30_000 }, async () => {
    await expect(recordVerifiedMerchantDispute(lostDispute())).resolves.toBe('recorded')
    await expect(recordVerifiedMerchantDispute(lostDispute())).resolves.toBe('recorded')
    await expect(recordVerifiedMerchantDispute(lostDispute(504))).resolves.toBe('invalid')
    const event = await database.query<{ occurrences: number; amount_minor: string }>(
      'SELECT occurrences, amount_minor::text FROM merchant_reconciliation_events',
    )
    expect(event.rows[0]).toEqual({ occurrences: 2, amount_minor: '500' })
  })

  it('keeps an unmatched dispute durable for review without freezing an unrelated wallet', { timeout: 30_000 }, async () => {
    const result = await recordVerifiedMerchantDispute({
      ...lostDispute(),
      relatedProviderOrderId: '44444444-4444-4444-8444-444444444444',
    })
    expect(result).toBe('recorded')
    const wallet = await database.query<{ frozen_reason: string | null }>('SELECT frozen_reason FROM wallets')
    expect(wallet.rows[0]?.frozen_reason).toBeNull()
    const count = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM merchant_reconciliation_events',
    )
    expect(count.rows[0]?.count).toBe(1)
  })

  it('records a won dispute without introducing a new wallet freeze', { timeout: 30_000 }, async () => {
    const result = await recordVerifiedMerchantDispute({
      ...lostDispute(),
      event: 'DISPUTE_WON',
      providerState: 'won',
    })
    expect(result).toBe('recorded')
    const wallet = await database.query<{ frozen_reason: string | null }>('SELECT frozen_reason FROM wallets')
    expect(wallet.rows[0]?.frozen_reason).toBeNull()
  })
})
