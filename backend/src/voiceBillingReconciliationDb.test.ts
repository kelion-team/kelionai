import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let database: PGlite
let transactionLimits: string[] = []

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test',
    adminEmail: 'owner@example.test',
    billing: {
      currency: 'GBP',
      policyVersion: 'voice-policy-v1',
      creditMinor: 10,
    },
  },
}))

async function queryDatabase(sql: string, params?: unknown[]) {
  // PGlite does not implement PostgreSQL's per-transaction timeout GUCs.
  // They are operational guards, not part of the state-machine semantics
  // exercised by this database test.
  if (/^SET LOCAL (?:statement_timeout|lock_timeout)/.test(sql)) {
    transactionLimits.push(sql)
    return { rows: [], rowCount: 0 }
  }
  return database.query(sql, params)
}

vi.mock('./dbPool.js', () => ({
  getPool: () => ({ query: queryDatabase }),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => ({
    query: queryDatabase,
    release: vi.fn(),
  }),
}))

const {
  citesteCrediteFolosite,
  confirmaDebitVocalLive,
  consumaDebitVocalLive,
  debiteazaVocalLiveAtomar,
  ramburseazaDebitVocalLive,
  reconciliazaDebitariVocale,
} = await import('./db.js')

const USER = 'buyer@example.test'
const SESSION = '11111111-1111-4111-8111-111111111111'
const HANDOFF = '22222222-2222-4222-8222-222222222222'
const OTHER_HANDOFF = '33333333-3333-4333-8333-333333333333'

function debitRef(tick: number): string {
  return `voice-debit:v1:${SESSION}:${tick}`
}

async function wallet(): Promise<{ balance_minor: string; topup_ref_minor: string }> {
  const result = await database.query<{ balance_minor: string; topup_ref_minor: string }>(
    `SELECT balance_minor::text AS balance_minor,
            topup_ref_minor::text AS topup_ref_minor
       FROM wallets WHERE user_email=$1`,
    [USER],
  )
  expect(result.rows).toHaveLength(1)
  return result.rows[0]!
}

async function operation(ref: string): Promise<{
  state: string
  handoff_token: string | null
  refund_event_id: string | null
}> {
  const result = await database.query<{
    state: string
    handoff_token: string | null
    refund_event_id: string | null
  }>(
    `SELECT state, handoff_token::text AS handoff_token,
            refund_event_id::text AS refund_event_id
       FROM voice_billing_operations WHERE debit_ref=$1`,
    [ref],
  )
  expect(result.rows).toHaveLength(1)
  return result.rows[0]!
}

beforeEach(async () => {
  transactionLimits = []
  database = new PGlite()
  await database.exec(`
    CREATE TABLE wallets (
      user_email TEXT PRIMARY KEY,
      balance_minor BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GBP',
      topup_ref_minor BIGINT NOT NULL DEFAULT 0,
      debt_minor BIGINT NOT NULL DEFAULT 0,
      frozen_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_minor BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      policy_version TEXT NOT NULL,
      ref TEXT,
      meta TEXT,
      legal_basis TEXT,
      retention_until TIMESTAMPTZ,
      erasure_request_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX uniq_billing_ref
      ON billing_events (ref) WHERE ref IS NOT NULL;
    INSERT INTO wallets
      (user_email, balance_minor, currency, topup_ref_minor, debt_minor)
    VALUES
      ('${USER}', 100, 'GBP', 500, 0);
  `)
  await database.exec(readFileSync(
    new URL('../migrations/20260909_voice_billing_operations.sql', import.meta.url),
    'utf8',
  ))
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

describe('voice billing durable reconciliation', () => {
  it('bounds the atomic debit transaction at the PostgreSQL boundary', async () => {
    const ref = debitRef(1)

    await expect(
      debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() + 30_000),
    ).resolves.toEqual({ ok: true, debitedMinor: 10, duplicate: false })
    expect(transactionLimits).toEqual([
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
    ])
  }, 30_000)

  it('bounds both refund phases and the reconciliation selector at the PostgreSQL boundary', async () => {
    const directRef = debitRef(1)
    await debiteazaVocalLiveAtomar(USER, 10, directRef, Date.now() + 30_000)
    transactionLimits = []

    await expect(ramburseazaDebitVocalLive(directRef)).resolves.toBe('refunded')
    expect(transactionLimits).toEqual([
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
    ])

    const reconciledRef = debitRef(2)
    await debiteazaVocalLiveAtomar(USER, 10, reconciledRef, Date.now() - 1_000)
    transactionLimits = []

    await expect(reconciliazaDebitariVocale()).resolves.toEqual({
      claimed: 1,
      refunded: 1,
      pending: 0,
    })
    expect(transactionLimits).toEqual([
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
      "SET LOCAL statement_timeout = '4500ms'",
      "SET LOCAL lock_timeout = '4000ms'",
    ])
  }, 30_000)

  it('refunds a debit committed after the first close-time lookup and remains idempotent after restart', async () => {
    const ref = debitRef(1)

    // The close handler ran before the delayed debit transaction became
    // visible. A later process must discover the durable pending row.
    await expect(reconciliazaDebitariVocale({ ref })).resolves.toEqual({
      claimed: 0,
      refunded: 0,
      pending: 0,
    })
    await expect(
      debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() - 1_000),
    ).resolves.toEqual({ ok: true, debitedMinor: 10, duplicate: false })
    expect(await wallet()).toEqual({ balance_minor: '90', topup_ref_minor: '500' })
    await expect(citesteCrediteFolosite(USER)).resolves.toEqual({ citit: true, valoare: 1 })

    // This call represents the startup sweep of a fresh backend process.
    await expect(reconciliazaDebitariVocale()).resolves.toEqual({
      claimed: 1,
      refunded: 1,
      pending: 0,
    })
    expect(await wallet()).toEqual({ balance_minor: '100', topup_ref_minor: '500' })
    await expect(citesteCrediteFolosite(USER)).resolves.toEqual({ citit: true, valoare: 0 })
    expect(await operation(ref)).toMatchObject({ state: 'refunded', handoff_token: null })

    const ledger = await database.query<{ kind: string; amount_minor: string; ref: string }>(
      `SELECT kind, amount_minor::text AS amount_minor, ref
         FROM billing_events ORDER BY id`,
    )
    expect(ledger.rows).toEqual([
      { kind: 'usage', amount_minor: '-10', ref },
      { kind: 'grant', amount_minor: '10', ref: ref.replace('voice-debit:', 'voice-refund:') },
    ])

    await expect(reconciliazaDebitariVocale()).resolves.toEqual({
      claimed: 0,
      refunded: 0,
      pending: 0,
    })
    await expect(ramburseazaDebitVocalLive(ref)).resolves.toBe('duplicate')
    await expect(
      debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() + 10_000),
    ).resolves.toEqual({ ok: true, debitedMinor: 0, duplicate: true })
    await expect(
      debiteazaVocalLiveAtomar(USER, 11, ref, Date.now() + 10_000),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' })
    await expect(
      debiteazaVocalLiveAtomar('other@example.test', 10, ref, Date.now() + 10_000),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' })
    expect(await wallet()).toEqual({ balance_minor: '100', topup_ref_minor: '500' })
  }, 30_000)

  it('resumes a refund_pending intent left by a crashed worker without double crediting', async () => {
    const ref = debitRef(2)
    await debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() + 30_000)
    await database.query("UPDATE wallets SET currency='EUR' WHERE user_email=$1", [USER])

    // The intent commits before the wallet credit. A real second-phase error
    // must therefore survive process loss as refund_pending.
    await expect(ramburseazaDebitVocalLive(ref)).resolves.toBe('unavailable')
    expect(await operation(ref)).toMatchObject({ state: 'refund_pending' })
    await database.query(
      "UPDATE wallets SET currency='GBP' WHERE user_email=$1",
      [USER],
    )

    await expect(reconciliazaDebitariVocale()).resolves.toEqual({
      claimed: 1,
      refunded: 1,
      pending: 0,
    })
    await expect(ramburseazaDebitVocalLive(ref)).resolves.toBe('duplicate')
    expect(await wallet()).toEqual({ balance_minor: '100', topup_ref_minor: '500' })

    const refunds = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM billing_events WHERE ref=$1`,
      [ref.replace('voice-debit:', 'voice-refund:')],
    )
    expect(refunds.rows[0]?.count).toBe(1)
  }, 30_000)

  it('binds consume and acknowledgement replays to one handoff token', async () => {
    const ref = debitRef(3)
    await debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() + 30_000)

    await expect(
      consumaDebitVocalLive(ref, HANDOFF, Date.now() + 30_000),
    ).resolves.toBe('ok')
    await expect(
      consumaDebitVocalLive(ref, OTHER_HANDOFF, Date.now() + 30_000),
    ).resolves.toBe('conflict')
    await expect(
      consumaDebitVocalLive(ref, HANDOFF, Date.now() + 30_000),
    ).resolves.toBe('duplicate')

    await expect(confirmaDebitVocalLive(ref, OTHER_HANDOFF)).resolves.toBe('conflict')
    await expect(confirmaDebitVocalLive(ref, HANDOFF)).resolves.toBe('ok')
    await expect(confirmaDebitVocalLive(ref, HANDOFF)).resolves.toBe('duplicate')
    await expect(confirmaDebitVocalLive(ref, OTHER_HANDOFF)).resolves.toBe('conflict')
    await expect(ramburseazaDebitVocalLive(ref)).resolves.toBe('acknowledged')

    expect(await operation(ref)).toMatchObject({
      state: 'acknowledged',
      handoff_token: HANDOFF,
      refund_event_id: null,
    })
    expect(await wallet()).toEqual({ balance_minor: '90', topup_ref_minor: '500' })
  }, 30_000)

  it('enforces one operation for each session tick at the database boundary', async () => {
    const ref = debitRef(4)
    await debiteazaVocalLiveAtomar(USER, 10, ref, Date.now() + 30_000)
    const otherRef = 'voice-debit:v1:44444444-4444-4444-8444-444444444444:4'
    const event = await database.query<{ id: string }>(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'usage', -10, 'GBP', 'voice-policy-v1', $2, 'duplicate tick probe')
       RETURNING id::text AS id`,
      [USER, otherRef],
    )

    await expect(database.query(
      `INSERT INTO voice_billing_operations
         (debit_ref, debit_event_id, session_id, tick, state, consume_deadline)
       VALUES ($1, $2::bigint, $3::uuid, 4, 'pending', now() + interval '30 seconds')`,
      [otherRef, event.rows[0]!.id, SESSION],
    )).rejects.toThrow()
  }, 30_000)

  it('ignores legacy voice references and never adopts them into the v1 outbox', async () => {
    const legacyRef = `voice:${SESSION}:1`
    await database.query(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'usage', -10, 'GBP', 'legacy-policy', $2, 'legacy voice minute')`,
      [USER, legacyRef],
    )

    await expect(reconciliazaDebitariVocale({ ref: legacyRef })).resolves.toEqual({
      claimed: 0,
      refunded: 0,
      pending: 0,
    })
    await expect(
      debiteazaVocalLiveAtomar(USER, 10, legacyRef, Date.now() + 30_000),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' })

    const operations = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM voice_billing_operations',
    )
    expect(operations.rows[0]?.count).toBe(0)
    expect(await wallet()).toEqual({ balance_minor: '100', topup_ref_minor: '500' })
  }, 30_000)
})
