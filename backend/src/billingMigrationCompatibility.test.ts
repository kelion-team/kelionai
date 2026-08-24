import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => /^\d{8}_[a-z0-9_]+\.sql$/.test(name))
  .sort()

async function runMigrationChain(db: PGlite, through?: string): Promise<void> {
  for (const name of migrationFiles) {
    await db.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    if (name === through) break
  }
}

async function one<T extends Record<string, unknown>>(db: PGlite, sql: string): Promise<T> {
  const result = await db.query<T>(sql)
  expect(result.rows).toHaveLength(1)
  return result.rows[0]
}

const LEGACY_MONEY_SCHEMA = `
  CREATE TABLE user_prefs (
    user_email TEXT PRIMARY KEY,
    speech_lang TEXT,
    autorecharge_enabled BOOLEAN NOT NULL DEFAULT false,
    autorecharge_threshold INTEGER NOT NULL DEFAULT 20,
    autorecharge_amount INTEGER NOT NULL DEFAULT 10,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE wallets (
    user_email TEXT PRIMARY KEY,
    balance NUMERIC(14,6) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'gbp',
    topup_ref NUMERIC(14,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE billing_events (
    id BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount NUMERIC(14,6) NOT NULL,
    ref TEXT,
    meta TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount NUMERIC(14,6) NOT NULL,
    credits NUMERIC(14,6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE cost_events (
    id BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    kind TEXT NOT NULL,
    cost_usd DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO user_prefs (user_email, autorecharge_enabled, autorecharge_amount)
    VALUES ('buyer@example.test', true, 10);
  INSERT INTO wallets (user_email, balance, currency, topup_ref)
    VALUES ('buyer@example.test', 12.34, 'gbp', 20.00);
  INSERT INTO billing_events (user_email, kind, amount, ref)
    VALUES ('buyer@example.test', 'topup', 7.50, 'legacy-topup');
  INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
    VALUES
      ('buyer@example.test', 20.00, 150, 'paid', 'legacy-paid'),
      ('buyer@example.test', 5.00, 0, 'failed', 'legacy-failed');
  INSERT INTO cost_events (user_email, kind, cost_usd)
    VALUES ('buyer@example.test', 'chat', 0.123456);
`

describe('billing minor-unit migration compatibility', () => {
  it('runs the complete chain on a fresh database', { timeout: 30_000 }, async () => {
    const db = new PGlite()
    try {
      await runMigrationChain(db)
      const columns = await one<{ count: number }>(db, `
        SELECT count(*)::int AS count
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             ('wallets', 'balance_minor'),
             ('billing_events', 'amount_minor'),
             ('transactions', 'gross_minor'),
             ('transactions', 'user_credit_minor'),
             ('cost_events', 'cost_usd_micros')
           )
      `)
      expect(columns.count).toBe(5)

      await expect(db.query(`
        INSERT INTO merchant_checkout_orders
          (id, user_email, idempotency_key, gross_minor, user_credit_minor,
           margin_minor, currency, policy_version)
        VALUES
          ('11111111-1111-4111-8111-111111111111', 'buyer@example.test',
           '22222222-2222-4222-8222-222222222222', 2000, 1400, 600,
           'GBP', 'kelion-gbp-75-25-v1')
      `)).rejects.toThrow(/merchant_checkout_split_exact/)
    } finally {
      await db.close()
    }
  })

  it('preserves and exactly backfills a legacy database', { timeout: 30_000 }, async () => {
    const db = new PGlite()
    try {
      await db.exec(LEGACY_MONEY_SCHEMA)
      await runMigrationChain(db)

      expect(await one(db, `
        SELECT balance_minor::int AS balance_minor,
               topup_ref_minor::int AS topup_ref_minor,
               currency
          FROM wallets WHERE user_email = 'buyer@example.test'
      `)).toEqual({ balance_minor: 1_234, topup_ref_minor: 2_000, currency: 'GBP' })

      expect(await one(db, `
        SELECT amount_minor::int AS amount_minor, currency, policy_version
          FROM billing_events WHERE ref = 'legacy-topup'
      `)).toEqual({ amount_minor: 750, currency: 'GBP', policy_version: 'legacy-gbp-import-v1' })

      const transactions = await db.query<{
        status: string
        gross_minor: number
        user_credit_minor: number
      }>(`
        SELECT status, gross_minor::int, user_credit_minor::int
          FROM transactions
         WHERE payment_ref LIKE 'legacy-%'
         ORDER BY status
      `)
      expect(transactions.rows).toEqual([
        { status: 'failed', gross_minor: 500, user_credit_minor: 0 },
        { status: 'paid', gross_minor: 2_000, user_credit_minor: 1_500 },
      ])

      expect(await one(db, `
        SELECT cost_usd_micros::int AS cost_usd_micros FROM cost_events
         WHERE user_email = 'buyer@example.test'
      `)).toEqual({ cost_usd_micros: 123_456 })

      const preserved = await one<{ count: number }>(db, `
        SELECT count(*)::int AS count
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             ('wallets', 'balance'),
             ('billing_events', 'amount'),
             ('transactions', 'amount'),
             ('cost_events', 'cost_usd')
           )
      `)
      expect(preserved.count).toBe(4)
    } finally {
      await db.close()
    }
  })

  it('contains no destructive accounting operation', () => {
    const sql = readFileSync(join(migrationsDir, '20260824_billing_minor_units.sql'), 'utf8')
      .replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i)
    expect(sql).not.toMatch(/\bALTER\s+(?:COLUMN\s+)?[a-z_]+\s+TYPE\b/i)
  })

  it('rolls back instead of rounding an inexact legacy purchase', { timeout: 30_000 }, async () => {
    const db = new PGlite()
    try {
      await db.exec(LEGACY_MONEY_SCHEMA.replace("20.00, 150, 'paid'", "20.01, 150, 'paid'"))
      await expect(runMigrationChain(db, '20260824_billing_minor_units.sql'))
        .rejects.toThrow(/cannot be split exactly 75\/25/)
      // PGlite keeps the failed explicit transaction open just like PostgreSQL.
      await db.exec('ROLLBACK')
      expect(await one(db, `
        SELECT amount::text AS amount FROM transactions WHERE payment_ref = 'legacy-paid'
      `)).toEqual({ amount: '20.010000' })
      expect(await one<{ count: number }>(db, `
        SELECT count(*)::int AS count
          FROM information_schema.columns
         WHERE table_name = 'transactions' AND column_name = 'gross_minor'
      `)).toEqual({ count: 0 })
    } finally {
      await db.close()
    }
  })
})
