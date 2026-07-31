// ── TESTELE BANILOR: creditare, taxare, idempotență ─────────────────────────
//
// Astea sunt căile prin care intră și ies BANI REALI. Până acum n-aveau NICIUN
// test — și tot ce e scris în comentariile din db.ts („audit 24 iul P0-3",
// „audit 27 iul") sunt găuri prin care s-au pierdut deja bani o dată. Un test
// le ține închise; un comentariu, nu.
//
// Stripe a ieșit total (31 iul): testele de webhook/PaymentIntent/refund au
// dispărut odată cu el. Ce rămâne aici e calea VIE a banilor: alimentarea
// (cod unic + transfer Revolut, creditare prin topUpUser), taxarea consumului
// și citirea soldului.
//
// Rulează pe motorul de Postgres din `testing/fake-pg.ts` (BEGIN/ROLLBACK reale,
// index unic pe `ref`, NUMERIC întors ca șir) — deci CI nu are nevoie de bază
// de date, iar o interogare pe care motorul n-o cunoaște ARUNCĂ, în loc să
// treacă „verde" pe cod neexecutat.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { creeazaFakePg } from './testing/fake-pg.js'

const pgFals = vi.hoisted(() => {
  // Import static aici ar rula înaintea mock-ului; motorul se creează leneș.
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

// Configurarea se MOCHEAZĂ, nu se pune în process.env: variabilele de mediu sunt
// comune pe tot procesul de test, iar un DATABASE_URL scăpat aici schimba
// comportamentul ALTOR fișiere de test (le-a și picat o dată). Aici, doar
// valorile de care are nevoie calea banilor.
vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test@localhost:5432/test?sslmode=disable',
    geminiKey: '',
    billing: { userShare: 0.75, creditValue: 0.1, usdToCurrency: 1, currency: 'gbp' },
  },
}))

const motor = creeazaFakePg()
pgFals.motor = motor

const { topUpUser, debitWallet, getBalance, getWalletStatus, userKey } = await import('./db.js')

const sold = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.balance ?? 0
const refPortofel = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.topup_ref ?? 0
const randuri = (kind: string): { amount: number; ref: string | null }[] =>
  motor.baza.billing.filter((r) => r.kind === kind).map((r) => ({ amount: r.amount, ref: r.ref }))

beforeEach(() => motor.reset())

// ── ALIMENTARE 75/25 ───────────────────────────────────────────────────────
describe('bani — alimentare (topUpUser): userul primește 75%, noi păstrăm 25%', () => {
  it('împarte suma exact și lasă contabilitatea completă', async () => {
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')).toBe(true)

    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect(randuri('topup')).toEqual([{ amount: 7.5, ref: 'tr_1' }])
    expect(randuri('profit')).toEqual([{ amount: 2.5, ref: 'tr_1:profit' }])

    // Rândul contabil din „Tranzacții" (fără el, tabul admin rămânea gol deși
    // banii intrau): suma BRUTĂ plătită + creditele primite.
    expect(motor.baza.tx).toEqual([
      { user_id: 'ion@test.ro', amount: 10, credits: 75, status: 'paid', payment_ref: 'tr_1' },
    ])
  })

  it('A DOUA oară pe aceeași plată NU creditează (idempotență pe ref)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')).toBe(false)
    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6) // nu 15
    expect(randuri('topup')).toHaveLength(1)
    expect(motor.baza.tx).toHaveLength(1)
  })

  it('două alimentări DIFERITE se adună, iar topup_ref e NOUL SOLD (audit P1-3)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'tr_1')
    await topUpUser('ion@test.ro', 20, 'gbp', 'tr_2')
    expect(sold('ion@test.ro')).toBeCloseTo(22.5, 6)
    // Referința alertelor „ți-au mai rămas X%" trebuie să fie soldul COMPLET
    // (22,5), nu ultima alimentare (15) — altfel procentul afișat e fals.
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
    // Scenariul concurent real: garda „am mai văzut ref-ul?" trece (nu există
    // rând `topup` pe tr_9), dar rândul de PROFIT există deja → indexul unic
    // aruncă la mijlocul tranzacției. Fără ROLLBACK corect, userul ar rămâne cu
    // creditul în portofel și cu registrul rupt.
    motor.baza.billing.push({
      user_email: 'ion@test.ro',
      kind: 'profit',
      amount: 2.5,
      ref: 'tr_9:profit',
      meta: 'rând anterior',
    })
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'tr_9')).toBe(false)
    expect(sold('ion@test.ro')).toBe(0) // portofel neatins
    expect(randuri('topup')).toHaveLength(0) // registru neatins
    expect(motor.baza.tx).toHaveLength(0)
  })
})

// ── TAXAREA CONSUMULUI ─────────────────────────────────────────────────────
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
    // Regresia reală: Postgres nu poate tipiza „-$2" simplu („operator is not
    // unique") și TOATĂ debitarea pica în catch, adică userii consumau gratis.
    await debitWallet('ion@test.ro', 1, 'chat')
    const sqlDebit = motor.sqluri.filter((s) => s.startsWith('INSERT INTO wallets (user_email, balance) VALUES'))
    expect(sqlDebit.length).toBeGreaterThan(0)
    for (const s of sqlDebit) expect(s).toContain('::numeric')
  })
})

// ── CITIREA SOLDULUI ───────────────────────────────────────────────────────
describe('bani — citirea soldului nu depinde de cum e scris emailul', () => {
  it('soldul creditat pe „Ion@Test.RO" se vede și interogând cu majuscule', async () => {
    // Alimentarea normalizează emailul (P2-3). Dacă citirea NU normalizează,
    // userul plătește și vede „0 credite" — exact clasa de bug reparată deja de
    // două ori în fișierul ăsta, rămasă deschisă pe calea de CITIRE.
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'tr_c')
    expect(await getBalance('Ion@Test.RO')).toBeCloseTo(7.5, 6)
    expect(await getBalance('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect((await getWalletStatus('Ion@Test.RO')).balance).toBeCloseTo(7.5, 6)
  })

  it('taxarea lovește ACELAȘI portofel, nu creează unul paralel', async () => {
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'tr_c2')
    await debitWallet('Ion@Test.RO', 2.5, 'voce')
    expect(motor.baza.wallets.size).toBe(1) // NU două rânduri pentru același om
    expect(await getBalance('Ion@Test.RO')).toBeCloseTo(5, 6)
  })

  it('preferințele folosesc ACEEAȘI cheie ca portofelul', async () => {
    // Aceeași fisură era deschisă și la limbă, meserie, model și avatar: cu un
    // email cu majuscule, setările „se uitau". O singură formă a cheii,
    // verificată aici pe toate variantele.
    for (const scris of ['ion@test.ro', 'Ion@Test.RO', '  ION@TEST.RO  ']) {
      expect(userKey(scris)).toBe('ion@test.ro')
    }
    expect(userKey('')).toBe('')
    expect(userKey(undefined as unknown as string)).toBe('')
  })

  it('fără portofel, soldul e 0 (nu crapă)', async () => {
    expect(await getBalance('nimeni@test.ro')).toBe(0)
    expect(await getWalletStatus('nimeni@test.ro')).toEqual({ balance: 0, topupRef: 0 })
  })
})
