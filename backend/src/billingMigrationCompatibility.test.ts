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
    VALUES
      ('buyer@example.test', 13.404999, 'gbp', 14.985000),
      ('debtor@example.test', -3.476667, 'gbp', 0.00);
  INSERT INTO billing_events (user_email, kind, amount, ref)
    VALUES
      ('buyer@example.test', 'topup', 7.492500, 'legacy-topup-a'),
      ('buyer@example.test', 'profit', 2.497500, 'legacy-profit-a'),
      ('buyer@example.test', 'topup', 7.492500, 'legacy-topup-b'),
      ('buyer@example.test', 'profit', 2.497500, 'legacy-profit-b'),
      ('buyer@example.test', 'refund', 1.230000, 'legacy-refund'),
      ('buyer@example.test', 'usage', -0.116667, NULL),
      ('buyer@example.test', 'usage', -0.116667, NULL),
      ('buyer@example.test', 'usage', -0.116667, NULL),
      ('debtor@example.test', 'usage', -3.476667, NULL);
  INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
    VALUES
      ('buyer@example.test', 9.99, 74, 'paid', 'legacy-paid'),
      ('buyer@example.test', 5.00, 0, 'failed', 'legacy-failed'),
      ('buyer@example.test', 9.99, 74, 'refunded', 'legacy-refunded');
  INSERT INTO cost_events (user_email, kind, cost_usd)
    VALUES
      ('buyer@example.test', 'voice_minutes', 0.116666666667),
      ('buyer@example.test', 'voice_minutes', 0.116666666667),
      ('buyer@example.test', 'voice_minutes', 0.116666666667),
      ('buyer@example.test', 'chat', 0.123456);
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
             ('wallets', 'debt_minor'),
             ('billing_events', 'amount_minor'),
             ('transactions', 'gross_minor'),
             ('transactions', 'user_credit_minor'),
             ('cost_events', 'cost_usd_micros')
           )
      `)
      expect(columns.count).toBe(6)

      expect(await one(db, `
        SELECT count(*)::int AS count
          FROM pg_trigger
         WHERE tgname LIKE 'kelion_legacy_%' AND NOT tgisinternal
      `)).toEqual({ count: 0 })

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
               debt_minor::int AS debt_minor,
               frozen_reason,
               currency
          FROM wallets WHERE user_email = 'buyer@example.test'
      `)).toEqual({
        balance_minor: 1_340,
        topup_ref_minor: 1_499,
        debt_minor: 0,
        frozen_reason: null,
        currency: 'GBP',
      })

      expect(await one(db, `
        SELECT balance_minor::int AS balance_minor,
               topup_ref_minor::int AS topup_ref_minor,
               debt_minor::int AS debt_minor,
               frozen_reason,
               currency
          FROM wallets WHERE user_email = 'debtor@example.test'
      `)).toEqual({
        balance_minor: 0,
        topup_ref_minor: 0,
        debt_minor: 348,
        frozen_reason: 'legacy_debt_reconciliation',
        currency: 'GBP',
      })

      const commercialEvents = await db.query<{
        ref: string
        amount_minor: number
        currency: string
        policy_version: string
      }>(`
        SELECT ref, amount_minor::int, currency, policy_version
          FROM billing_events
         WHERE ref LIKE 'legacy-%'
         ORDER BY ref
      `)
      expect(commercialEvents.rows).toEqual([
        {
          ref: 'legacy-profit-a',
          amount_minor: 250,
          currency: 'GBP',
          policy_version: 'legacy-gbp-reconciled-v1',
        },
        {
          ref: 'legacy-profit-b',
          amount_minor: 250,
          currency: 'GBP',
          policy_version: 'legacy-gbp-reconciled-v1',
        },
        {
          ref: 'legacy-refund',
          amount_minor: -123,
          currency: 'GBP',
          policy_version: 'legacy-gbp-reconciled-v1',
        },
        {
          ref: 'legacy-topup-a',
          amount_minor: 749,
          currency: 'GBP',
          policy_version: 'legacy-gbp-reconciled-v1',
        },
        {
          ref: 'legacy-topup-b',
          amount_minor: 749,
          currency: 'GBP',
          policy_version: 'legacy-gbp-reconciled-v1',
        },
      ])

      const usage = await db.query<{ amount_minor: number }>(`
        SELECT amount_minor::int
          FROM billing_events
         WHERE user_email = 'buyer@example.test' AND kind = 'usage'
         ORDER BY id
      `)
      expect(usage.rows).toEqual([
        { amount_minor: -12 },
        { amount_minor: -11 },
        { amount_minor: -12 },
      ])
      expect(await one(db, `
        SELECT round(sum(amount) * 100)::int AS legacy_total_minor,
               sum(amount_minor)::int AS projected_total_minor
          FROM billing_events
         WHERE user_email = 'buyer@example.test' AND kind = 'usage'
      `)).toEqual({ legacy_total_minor: -35, projected_total_minor: -35 })
      expect(await one(db, `
        SELECT round(sum(amount) * 100)::int AS legacy_topup_total_minor,
               sum(amount_minor)::int AS projected_topup_total_minor
          FROM billing_events
         WHERE user_email = 'buyer@example.test' AND kind = 'topup'
      `)).toEqual({ legacy_topup_total_minor: 1_499, projected_topup_total_minor: 1_498 })
      expect(await one(db, `
        SELECT balance::text AS legacy_balance,
               balance_minor::int AS projected_balance_minor,
               sum(amount_minor) FILTER (
                 WHERE kind IN ('topup', 'usage', 'refund', 'grant')
               )::int AS projected_ledger_minor
          FROM wallets
          JOIN billing_events USING (user_email)
         WHERE user_email = 'buyer@example.test'
         GROUP BY balance, balance_minor
      `)).toEqual({
        legacy_balance: '13.404999',
        projected_balance_minor: 1_340,
        projected_ledger_minor: 1_340,
      })

      const transactions = await db.query<{
        status: string
        gross_minor: number
        user_credit_minor: number
        kelion_margin_minor: number
      }>(`
        SELECT status,
               gross_minor::int,
               user_credit_minor::int,
               CASE
                 WHEN status IN ('paid', 'refunded')
                   THEN (gross_minor - user_credit_minor)::int
                 ELSE 0
               END AS kelion_margin_minor
          FROM transactions
         WHERE payment_ref LIKE 'legacy-%'
         ORDER BY status
      `)
      expect(transactions.rows).toEqual([
        { status: 'failed', gross_minor: 500, user_credit_minor: 0, kelion_margin_minor: 0 },
        { status: 'paid', gross_minor: 999, user_credit_minor: 749, kelion_margin_minor: 250 },
        { status: 'refunded', gross_minor: 999, user_credit_minor: 749, kelion_margin_minor: 250 },
      ])

      const voiceCosts = await db.query<{ cost_usd_micros: number }>(`
        SELECT cost_usd_micros::int
          FROM cost_events
         WHERE user_email = 'buyer@example.test' AND kind = 'voice_minutes'
         ORDER BY id
      `)
      expect(voiceCosts.rows).toEqual([
        { cost_usd_micros: 116_667 },
        { cost_usd_micros: 116_666 },
        { cost_usd_micros: 116_667 },
      ])
      expect(await one(db, `
        SELECT round(sum(cost_usd::numeric) * 1000000)::int AS legacy_total_micros,
               sum(cost_usd_micros)::int AS projected_total_micros
          FROM cost_events
         WHERE user_email = 'buyer@example.test' AND kind = 'voice_minutes'
      `)).toEqual({ legacy_total_micros: 350_000, projected_total_micros: 350_000 })

      const preserved = await one<{ count: number }>(db, `
        SELECT count(*)::int AS count
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             ('wallets', 'balance'),
             ('wallets', 'topup_ref'),
             ('billing_events', 'amount'),
             ('transactions', 'amount'),
             ('transactions', 'credits'),
             ('cost_events', 'cost_usd')
           )
      `)
      expect(preserved.count).toBe(6)

      // Legacy columns remain queryable as immutable cutover evidence, while
      // runtime-shaped inserts use only the new integer accounting contract.
      await db.exec(`
        INSERT INTO billing_events
          (user_email, kind, amount_minor, currency, policy_version, ref)
        VALUES
          ('buyer@example.test', 'usage', -1, 'GBP', 'current-v1', 'current-usage');
        INSERT INTO transactions
          (user_id, gross_minor, user_credit_minor, credits, currency,
           policy_version, status, payment_ref)
        VALUES
          ('buyer@example.test', 100, 75, 7, 'GBP', 'current-v1', 'paid', 'current-paid');
        INSERT INTO cost_events (user_email, kind, cost_usd_micros)
        VALUES ('buyer@example.test', 'chat', 1);
      `)
      expect(await one(db, `
        SELECT amount::text AS legacy_billing_amount
          FROM billing_events WHERE ref = 'current-usage'
      `)).toEqual({ legacy_billing_amount: '-0.010000' })
      expect(await one(db, `
        SELECT amount::text AS legacy_transaction_amount
          FROM transactions WHERE payment_ref = 'current-paid'
      `)).toEqual({ legacy_transaction_amount: '1.000000' })
      expect(await one(db, `
        SELECT cost_usd::numeric::text AS legacy_cost
          FROM cost_events WHERE cost_usd_micros = 1
      `)).toEqual({ legacy_cost: '0.000001' })
    } finally {
      await db.close()
    }
  })

  it('bridges live legacy writes, new writes, and an immediate image rollback', { timeout: 30_000 }, async () => {
    const db = new PGlite()
    try {
      await db.exec(LEGACY_MONEY_SCHEMA)
      await runMigrationChain(db)

      expect(await one(db, `
        SELECT count(*)::int AS count
          FROM pg_trigger
         WHERE tgname LIKE 'kelion_legacy_%' AND NOT tgisinternal
      `)).toEqual({ count: 5 })
      expect(await one(db, `
        SELECT count(*)::int AS count
          FROM pg_constraint
         WHERE conrelid = 'transactions'::regclass
           AND conname = 'uniq_transactions_ref'
           AND contype = 'u'
      `)).toEqual({ count: 1 })

      // Exact order used by the legacy live top-up path: ledger credit,
      // wallet major-unit update, profit row, then purchase row.
      await db.exec(`
        BEGIN;
        INSERT INTO billing_events (user_email, kind, amount, ref, meta)
        VALUES ('buyer@example.test', 'topup', 7.492500, 'compat-topup', 'user 75%');
        INSERT INTO wallets (user_email, balance, currency, topup_ref)
        VALUES ('buyer@example.test', 7.492500, 'gbp', 7.492500)
        ON CONFLICT (user_email) DO UPDATE
          SET balance = wallets.balance + 7.492500,
              topup_ref = wallets.balance + 7.492500,
              updated_at = now();
        INSERT INTO billing_events (user_email, kind, amount, ref, meta)
        VALUES ('buyer@example.test', 'profit', 2.497500, 'compat-topup:profit', 'margin 25%');
        INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
        VALUES ('buyer@example.test', 9.99, 74, 'paid', 'compat-topup');
        COMMIT;
      `)

      expect(await one(db, `
        SELECT balance::text AS legacy_balance,
               balance_minor::int AS balance_minor,
               debt_minor::int AS debt_minor
          FROM wallets WHERE user_email = 'buyer@example.test'
      `)).toEqual({ legacy_balance: '20.897499', balance_minor: 2_089, debt_minor: 0 })
      expect(await one(db, `
        SELECT gross_minor::int AS gross_minor,
               user_credit_minor::int AS user_credit_minor,
               (gross_minor - user_credit_minor)::int AS kelion_margin_minor,
               policy_version
          FROM transactions WHERE payment_ref = 'compat-topup'
      `)).toEqual({
        gross_minor: 999,
        user_credit_minor: 749,
        kelion_margin_minor: 250,
        policy_version: 'legacy-write-compat-v1',
      })

      // The new image writes integer units. Bridges mirror a safe legacy view
      // so an immediate rollback can still read and then write the account.
      await db.exec(`
        BEGIN;
        UPDATE wallets
           SET balance_minor = balance_minor - 1, updated_at = now()
         WHERE user_email = 'buyer@example.test';
        INSERT INTO billing_events
          (user_email, kind, amount_minor, currency, policy_version, ref, meta)
        VALUES
          ('buyer@example.test', 'usage', -1, 'GBP', 'current-v1',
           'compat-current-usage', 'new writer');
        INSERT INTO cost_events (user_email, kind, cost_usd_micros)
        VALUES ('buyer@example.test', 'voice_minutes', 1);
        INSERT INTO transactions
          (user_id, gross_minor, user_credit_minor, credits, currency,
           policy_version, status, payment_ref)
        VALUES
          ('buyer@example.test', 999, 0, 0, 'GBP', 'current-v1',
           'pending', 'compat-current-pending');
        COMMIT;
      `)
      expect(await one(db, `
        SELECT balance::text AS legacy_balance, balance_minor::int AS balance_minor
          FROM wallets WHERE user_email = 'buyer@example.test'
      `)).toEqual({ legacy_balance: '20.880000', balance_minor: 2_088 })

      await db.exec(`
        BEGIN;
        UPDATE wallets
           SET balance = balance - 0.116667, updated_at = now()
         WHERE user_email = 'buyer@example.test';
        INSERT INTO billing_events (user_email, kind, amount, ref, meta)
        VALUES
          ('buyer@example.test', 'usage', -0.116667,
           'compat-rollback-usage', 'legacy rollback writer');
        INSERT INTO cost_events (user_email, kind, cost_usd)
        VALUES ('buyer@example.test', 'voice_minutes', 0.116666666667);
        INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
        VALUES ('buyer@example.test', 9.99, 74, 'paid', 'compat-current-pending')
        ON CONFLICT (payment_ref) DO UPDATE SET status = 'paid';
        COMMIT;
      `)

      expect(await one(db, `
        SELECT wallet.balance::text AS legacy_balance,
               wallet.balance_minor::int AS balance_minor,
               ledger.ledger_minor::int AS ledger_minor
          FROM wallets AS wallet
          CROSS JOIN LATERAL (
            SELECT sum(amount_minor) FILTER (
              WHERE kind IN ('topup', 'usage', 'refund', 'grant')
            ) AS ledger_minor
              FROM billing_events
             WHERE user_email = wallet.user_email
          ) AS ledger
         WHERE wallet.user_email = 'buyer@example.test'
      `)).toEqual({ legacy_balance: '20.763333', balance_minor: 2_076, ledger_minor: 2_076 })
      expect(await one(db, `
        SELECT amount_minor::int AS amount_minor, policy_version
          FROM billing_events WHERE ref = 'compat-rollback-usage'
      `)).toEqual({ amount_minor: -12, policy_version: 'legacy-write-compat-v1' })
      expect(await one(db, `
        SELECT status, gross_minor::int AS gross_minor,
               user_credit_minor::int AS user_credit_minor,
               policy_version
          FROM transactions WHERE payment_ref = 'compat-current-pending'
      `)).toEqual({
        status: 'paid',
        gross_minor: 999,
        user_credit_minor: 749,
        policy_version: 'current-v1',
      })
      expect(await one(db, `
        SELECT cost_usd_micros::int AS cost_usd_micros
          FROM cost_events
         WHERE kind = 'voice_minutes' AND cost_usd = 0.116666666667
         ORDER BY id DESC LIMIT 1
      `)).toEqual({ cost_usd_micros: 116_667 })
      expect(await one(db, `
        SELECT round(sum(cost_usd::numeric) * 1000000)::int AS legacy_total_micros,
               sum(cost_usd_micros)::int AS projected_total_micros
          FROM cost_events
         WHERE user_email = 'buyer@example.test' AND kind = 'voice_minutes'
      `)).toEqual({ legacy_total_micros: 466_668, projected_total_micros: 466_668 })
    } finally {
      await db.close()
    }
  })

  it('contains no destructive accounting operation', () => {
    const sql = readFileSync(join(migrationsDir, '20260824_billing_minor_units.sql'), 'utf8')
      .replace(/--.*$/gm, '')
    const withoutLegacyNullabilityRelaxations = sql.replace(
      /\bALTER\s+TABLE\s+[a-z_]+\s+ALTER\s+COLUMN\s+[a-z_]+\s+DROP\s+NOT\s+NULL\b/gi,
      '',
    ).replace(/\bDROP\s+INDEX\s+public\.uniq_transactions_ref\b/gi, '')
    expect(withoutLegacyNullabilityRelaxations).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i)
    expect(sql).not.toMatch(/\bALTER\s+(?:COLUMN\s+)?[a-z_]+\s+TYPE\b/i)

    const walletSync = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kelion_legacy_billing_wallet_sync()'),
      sql.indexOf("EXECUTE 'CREATE TRIGGER kelion_legacy_billing_wallet_sync"),
    )
    expect(walletSync.indexOf('FOR UPDATE')).toBeGreaterThan(-1)
    expect(walletSync.indexOf('FOR UPDATE')).toBeLessThan(
      walletSync.indexOf('ledger_minor := public.kelion_legacy_wallet_ledger_minor'),
    )
  })

  it('rolls back instead of rounding a sub-penny legacy purchase', { timeout: 30_000 }, async () => {
    const db = new PGlite()
    try {
      await db.exec(LEGACY_MONEY_SCHEMA.replace("9.99, 74, 'paid'", "9.991, 74, 'paid'"))
      await expect(runMigrationChain(db, '20260824_billing_minor_units.sql'))
        .rejects.toThrow(/transactions\.amount contains sub-penny legacy values/)
      // PGlite keeps the failed explicit transaction open just like PostgreSQL.
      await db.exec('ROLLBACK')
      expect(await one(db, `
        SELECT amount::text AS amount FROM transactions WHERE payment_ref = 'legacy-paid'
      `)).toEqual({ amount: '9.991000' })
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
