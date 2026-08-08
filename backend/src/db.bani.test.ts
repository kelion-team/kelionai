// ── THE MONEY TESTS: crediting, charging, idempotency ─────────────────────
//
// These are the paths through which REAL MONEY comes in and goes out. Until
// now they had NO test — and everything written in db.ts's comments ("Jul 24
// audit P0-3", "Jul 27 audit") are holes through which money was already lost
// once. A test keeps them closed; a comment does not.
//
// Stripe is fully out (Jul 31): the webhook/PaymentIntent/refund tests
// disappeared with it. What remains here is the LIVE money path: the top-up
// (unique code + Revolut transfer, crediting through topUpUser), charging the
// consumption and reading the balance.
//
// It runs on the Postgres engine in `testing/fake-pg.ts` (real BEGIN/ROLLBACK,
// unique index on `ref`, NUMERIC returned as a string) — so CI doesn't need a
// database, and a query the engine doesn't know THROWS, instead of passing
// "green" on unexecuted code.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { creeazaFakePg } from './testing/fake-pg.js'

const pgFals = vi.hoisted(() => {
  // A static import here would run before the mock; the engine is created lazily.
  const cutie: { motor: ReturnType<typeof import('./testing/fake-pg.js').creeazaFakePg> | null } = { motor: null }
  return cutie
})

vi.mock('pg', () => {
  const query = (sql: string, params?: unknown[]) => pgFals.motor!.query(sql, params)
  class Pool {
    query = query
    async connect() {
      return { query, release: () => {} }
    }
  }
  return { default: { Pool } }
})

// The config is MOCKED, not put in process.env: environment variables are
// shared across the whole test process, and a DATABASE_URL leaked here changed
// the behavior of OTHER test files (it has failed them once). Here, only the
// values the money path needs.
vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test@localhost:5432/test?sslmode=disable',
    geminiKey: '',
    billing: { userShare: 0.75, creditValue: 0.1, usdToCurrency: 1, currency: 'gbp' },
  },
}))

const motor = creeazaFakePg()
pgFals.motor = motor

const { topUpUser, debitWallet, citesteSold, citestePortofel, userKey } = await import('./db.js')

/** Soldul CITIT. Aruncă dacă citirea a picat — un test care ia „n-am putut
 *  citi" drept „zero" e fix minciuna pe care o vânăm (8 aug 2026). */
const soldCitit = async (email: string): Promise<number> => {
  const r = await citesteSold(email)
  if (!r.citit) throw new Error(`soldul nu s-a putut citi: ${r.motiv}`)
  return r.sold
}

const sold = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.balance ?? 0
const refPortofel = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.topup_ref ?? 0
const randuri = (kind: string): { amount: number; ref: string | null }[] =>
  motor.baza.billing.filter((r) => r.kind === kind).map((r) => ({ amount: r.amount, ref: r.ref }))

beforeEach(() => motor.reset())

// ── TOP-UP 75/25 ───────────────────────────────────────────────────────────
describe('bani — alimentare (topUpUser): userul primește 75%, noi păstrăm 25%', () => {
  it('împarte suma exact și lasă contabilitatea completă', async () => {
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')).toBe(true)

    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect(randuri('topup')).toEqual([{ amount: 7.5, ref: 'tr_1' }])
    expect(randuri('profit')).toEqual([{ amount: 2.5, ref: 'tr_1:profit' }])

    // The ledger row in "Transactions" (without it, the admin tab stayed empty
    // even though the money came in): the GROSS amount paid + the credits
    // received.
    expect(motor.baza.tx).toEqual([
      { user_id: 'ion@test.ro', amount: 10, credits: 75, status: 'paid', payment_ref: 'tr_1' },
    ])
  })

  it('A DOUA oară pe aceeași plată NU creditează (idempotență pe ref)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')).toBe(false)
    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6) // not 15
    expect(randuri('topup')).toHaveLength(1)
    expect(motor.baza.tx).toHaveLength(1)
  })

  it('două alimentări DIFERITE se adună, iar topup_ref e NOUL SOLD (audit P1-3)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')
    await topUpUser('ion@test.ro', 20, 'gbp', 'tr_2')
    expect(sold('ion@test.ro')).toBeCloseTo(22.5, 6)
    // The reference of the "you have X% left" alerts must be the FULL balance
    // (22.5), not the last top-up (15) — otherwise the shown percentage is
    // false.
    expect(refPortofel('ion@test.ro')).toBeCloseTo(22.5, 6)
  })

  it('emailul se NORMALIZEAZĂ la scriere (audit P2-3)', async () => {
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'tr_maj')
    expect(motor.baza.wallets.has('ion@test.ro')).toBe(true)
    expect(motor.baza.wallets.has('Ion@Test.RO')).toBe(false)
    expect(randuri('topup')[0].amount).toBe(7.5)
  })

  it('refuză sumele imposibile, fără să scrie nimic', async () => {
    expect(await topUpUser('ion@test.ro', 0, 'gbp', 'tr_x')).toBe(false)
    expect(await topUpUser('ion@test.ro', -5, 'gbp', 'tr_x')).toBe(false)
    expect(await topUpUser('ion@test.ro', 10, 'gbp', '')).toBe(false)
    expect(motor.baza.billing).toHaveLength(0)
    expect(motor.baza.wallets.size).toBe(0)
  })

  it('ATOMICITATE: dacă a doua scriere pică, NU rămâne credit pe jumătate', async () => {
    // The real concurrent scenario: the "have I seen this ref?" guard passes
    // (there is no `topup` row on tr_9), but the PROFIT row already exists →
    // the unique index throws in the middle of the transaction. Without a
    // correct ROLLBACK, the user would be left with the credit in the wallet
    // and a broken ledger.
    motor.baza.billing.push({
      user_email: 'ion@test.ro',
      kind: 'profit',
      amount: 2.5,
      ref: 'tr_9:profit',
      meta: 'rând anterior',
    })
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_9')).toBe(false)
    expect(sold('ion@test.ro')).toBe(0) // wallet untouched
    expect(randuri('topup')).toHaveLength(0) // ledger untouched
    expect(motor.baza.tx).toHaveLength(0)
  })
})

// ── CHARGING THE CONSUMPTION ───────────────────────────────────────────────
describe('bani — taxarea consumului (debitWallet)', () => {
  it('scade din portofel și lasă urmă în registru', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_d')
    await debitWallet('ion@test.ro', 2, 'chat')
    expect(sold('ion@test.ro')).toBeCloseTo(5.5, 6)
    expect(randuri('usage')).toEqual([{ amount: -2, ref: null }])
  })

  it('sumele nule sau negative nu taxează', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_d2')
    await debitWallet('ion@test.ro', 0, '')
    await debitWallet('ion@test.ro', -3, '')
    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect(randuri('usage')).toHaveLength(0)
  })

  it('PĂSTREAZĂ conversia „::numeric" — fără ea, taxarea eșua în TĂCERE', async () => {
    // The real regression: Postgres can't type a plain "-$2" ("operator is not
    // unique") and the WHOLE debit failed into the catch, i.e. users consumed
    // for free.
    await debitWallet('ion@test.ro', 1, 'chat')
    const sqlDebit = motor.sqluri.filter((s) => s.startsWith('INSERT INTO wallets (user_email, balance) VALUES'))
    expect(sqlDebit.length).toBeGreaterThan(0)
    for (const s of sqlDebit) expect(s).toContain('::numeric')
  })
})

// ── READING THE BALANCE ────────────────────────────────────────────────────
describe('bani — citirea soldului nu depinde de cum e scris emailul', () => {
  it('soldul creditat pe „Ion@Test.RO" se vede și interogând cu majuscule', async () => {
    // The top-up normalizes the email (P2-3). If the READ does NOT normalize,
    // the user pays and sees "0 credits" — exactly the bug class already fixed
    // twice in this file, left open on the READ path.
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'tr_c')
    expect(await soldCitit('Ion@Test.RO')).toBeCloseTo(7.5, 6)
    expect(await soldCitit('ion@test.ro')).toBeCloseTo(7.5, 6)
    const p1 = await citestePortofel('Ion@Test.RO')
    expect(p1.citit && p1.balance).toBeCloseTo(7.5, 6)
  })

  it('taxarea lovește ACELAȘI portofel, nu creează unul paralel', async () => {
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'tr_c2')
    await debitWallet('Ion@Test.RO', 2.5, 'voce')
    expect(motor.baza.wallets.size).toBe(1) // NOT two rows for the same person
    expect(await soldCitit('Ion@Test.RO')).toBeCloseTo(5, 6)
  })

  it('preferințele folosesc ACEEAȘI cheie ca portofelul', async () => {
    // The same crack was open for language, trade, model and avatar too: with
    // an uppercase email, the settings "were forgotten". A single form of the
    // key, checked here on all variants.
    for (const scris of ['ion@test.ro', 'Ion@Test.RO', '  ION@TEST.RO  ']) {
      expect(userKey(scris)).toBe('ion@test.ro')
    }
    expect(userKey('')).toBe('')
    expect(userKey(undefined as unknown as string)).toBe('')
  })

  it('fără portofel, soldul e 0 (nu crapă)', async () => {
    // Fără rând = zero REAL, citit — nu „n-am putut citi".
    expect(await soldCitit('nimeni@test.ro')).toBe(0)
    expect(await citestePortofel('nimeni@test.ro')).toEqual({ citit: true, balance: 0, topupRef: 0 })
  })
})
