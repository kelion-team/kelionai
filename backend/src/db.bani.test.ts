// ── TESTELE BANILOR: creditare, taxare, idempotență, refund ─────────────────
//
// Astea sunt căile prin care intră și ies BANI REALI. Până acum n-aveau NICIUN
// test — și tot ce e scris în comentariile din db.ts („audit 24 iul P0-3",
// „audit 27 iul", „incident real: plată rambursată dar creditată") sunt găuri
// prin care s-au pierdut deja bani o dată. Un test le ține închise; un
// comentariu, nu.
//
// Rulează pe motorul de Postgres din `testing/fake-pg.ts` (BEGIN/ROLLBACK reale,
// index unic pe stripe_ref, NUMERIC întors ca șir) — deci CI nu are nevoie de
// bază de date, iar o interogare pe care motorul n-o cunoaște ARUNCĂ, în loc să
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
    stripe: { userShare: 0.75, creditValue: 0.1, usdToCurrency: 1 },
  },
}))

const motor = creeazaFakePg()
pgFals.motor = motor

const {
  topUpUser,
  topUpUserFromPaymentIntent,
  creditSaleExact,
  revokeTopUpForRefund,
  debitWallet,
  getBalance,
  getWalletStatus,
  updateTransactionStatus,
  getStripeCustomer,
  setStripeCustomer,
} = await import('./db.js')

const sold = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.balance ?? 0
const refPortofel = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.topup_ref ?? 0
const randuri = (kind: string): { amount: number; stripe_ref: string | null }[] =>
  motor.baza.billing.filter((r) => r.kind === kind).map((r) => ({ amount: r.amount, stripe_ref: r.stripe_ref }))

beforeEach(() => motor.reset())

// ── ALIMENTARE 75/25 ───────────────────────────────────────────────────────
describe('bani — alimentare (topUpUser): userul primește 75%, noi păstrăm 25%', () => {
  it('împarte suma exact și lasă contabilitatea completă', async () => {
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'pi_1')).toBe(true)

    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect(randuri('topup')).toEqual([{ amount: 7.5, stripe_ref: 'pi_1' }])
    expect(randuri('profit')).toEqual([{ amount: 2.5, stripe_ref: 'pi_1:profit' }])

    // Rândul contabil din „Tranzacții" (fără el, tabul admin rămânea gol deși
    // banii intrau): suma BRUTĂ plătită + creditele primite.
    expect(motor.baza.tx).toEqual([
      { user_id: 'ion@test.ro', amount: 10, credits: 75, status: 'paid', stripe_payment_intent_id: 'pi_1' },
    ])
  })

  it('A DOUA oară pe aceeași plată NU creditează (idempotență pe stripe_ref)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'pi_1')
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'pi_1')).toBe(false)
    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6) // nu 15
    expect(randuri('topup')).toHaveLength(1)
    expect(motor.baza.tx).toHaveLength(1)
  })

  it('două alimentări DIFERITE se adună, iar topup_ref e NOUL SOLD (audit P1-3)', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'pi_1')
    await topUpUser('ion@test.ro', 20, 'gbp', 'pi_2')
    expect(sold('ion@test.ro')).toBeCloseTo(22.5, 6)
    // Referința alertelor „ți-au mai rămas X%" trebuie să fie soldul COMPLET
    // (22,5), nu ultima alimentare (15) — altfel procentul afișat e fals.
    expect(refPortofel('ion@test.ro')).toBeCloseTo(22.5, 6)
  })

  it('emailul se NORMALIZEAZĂ la scriere (audit P2-3)', async () => {
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'pi_maj')
    expect(motor.baza.wallets.has('ion@test.ro')).toBe(true)
    expect(motor.baza.wallets.has('Ion@Test.RO')).toBe(false)
    expect(randuri('topup')[0].amount).toBe(7.5)
  })

  it('refuză sumele imposibile, fără să scrie nimic', async () => {
    expect(await topUpUser('ion@test.ro', 0, 'gbp', 'pi_x')).toBe(false)
    expect(await topUpUser('ion@test.ro', -5, 'gbp', 'pi_x')).toBe(false)
    expect(await topUpUser('ion@test.ro', 10, 'gbp', '')).toBe(false)
    expect(motor.baza.billing).toHaveLength(0)
    expect(motor.baza.wallets.size).toBe(0)
  })

  it('ATOMICITATE: dacă a doua scriere pică, NU rămâne credit pe jumătate', async () => {
    // Scenariul concurent real: garda „am mai văzut ref-ul?" trece (nu există
    // rând `topup` pe pi_9), dar rândul de PROFIT există deja → indexul unic
    // aruncă la mijlocul tranzacției. Fără ROLLBACK corect, userul ar rămâne cu
    // creditul în portofel și cu registrul rupt.
    motor.baza.billing.push({
      user_email: 'ion@test.ro',
      kind: 'profit',
      amount: 2.5,
      stripe_ref: 'pi_9:profit',
      meta: 'rând anterior',
    })
    expect(await topUpUser('ion@test.ro', 10, 'gbp', 'pi_9')).toBe(false)
    expect(sold('ion@test.ro')).toBe(0) // portofel neatins
    expect(randuri('topup')).toHaveLength(0) // registru neatins
    expect(motor.baza.tx).toHaveLength(0)
  })
})

// ── ALIMENTARE DIN PaymentIntent ───────────────────────────────────────────
describe('bani — alimentare din PaymentIntent (capcana „pending", audit P0-3)', () => {
  it('un rând „pending" NU blochează creditarea (userul plătise, credit zero)', async () => {
    motor.baza.tx.push({
      user_id: 'ana@test.ro',
      amount: 10,
      credits: 0,
      status: 'pending',
      stripe_payment_intent_id: 'pi_p',
    })
    expect(await topUpUserFromPaymentIntent('ana@test.ro', 10, 'gbp', 'pi_p')).toBe(true)
    expect(sold('ana@test.ro')).toBeCloseTo(7.5, 6) // banii AU ajuns în portofel
    expect(motor.baza.tx[0].status).toBe('succeeded')
  })

  it('un rând deja „succeeded" NU se mai creditează a doua oară', async () => {
    await topUpUserFromPaymentIntent('ana@test.ro', 10, 'gbp', 'pi_s')
    expect(sold('ana@test.ro')).toBeCloseTo(7.5, 6)
    expect(await topUpUserFromPaymentIntent('ana@test.ro', 10, 'gbp', 'pi_s')).toBe(true)
    expect(sold('ana@test.ro')).toBeCloseTo(7.5, 6) // NU 15
    expect(randuri('topup')).toHaveLength(1)
  })

  it('plată nouă: creează rândul contabil cu creditele în UNITĂȚI de credit', async () => {
    await topUpUserFromPaymentIntent('ana@test.ro', 20, 'gbp', 'pi_n')
    expect(motor.baza.tx[0]).toMatchObject({ amount: 20, credits: 150, status: 'succeeded' })
  })
})

// ── VÂNZARE ADMIN CU CREDITE EXACTE ────────────────────────────────────────
describe('bani — vânzare admin (creditSaleExact): fix cât s-a vândut', () => {
  it('creditează EXACT creditele vândute, nu formula de 75%', async () => {
    expect(await creditSaleExact('ana@test.ro', 12, 'gbp', 'sale_1', 100)).toBe(true)
    expect(sold('ana@test.ro')).toBeCloseTo(10, 6) // 100 credite × £0,10
    expect(randuri('profit')[0].amount).toBeCloseTo(2, 6) // 12 − 10
    expect(motor.baza.tx[0]).toMatchObject({ credits: 100, status: 'paid' })
  })

  it('marja nu poate fi NEGATIVĂ (vânzare în pierdere → profit 0, nu −X)', async () => {
    await creditSaleExact('ana@test.ro', 5, 'gbp', 'sale_2', 100) // vinde £10 cu £5
    expect(randuri('profit')[0].amount).toBe(0)
  })

  it('rotunjire la bani, nu la a 15-a zecimală', async () => {
    await creditSaleExact('ana@test.ro', 4, 'gbp', 'sale_3', 33)
    expect(sold('ana@test.ro')).toBe(3.3)
    expect(randuri('profit')[0].amount).toBe(0.7)
  })

  it('idempotentă pe stripe_ref, ca alimentarea normală', async () => {
    await creditSaleExact('ana@test.ro', 12, 'gbp', 'sale_4', 100)
    expect(await creditSaleExact('ana@test.ro', 12, 'gbp', 'sale_4', 100)).toBe(false)
    expect(sold('ana@test.ro')).toBeCloseTo(10, 6)
  })

  it('refuză 0 credite sau sumă 0', async () => {
    expect(await creditSaleExact('ana@test.ro', 12, 'gbp', 'sale_5', 0)).toBe(false)
    expect(await creditSaleExact('ana@test.ro', 0, 'gbp', 'sale_6', 10)).toBe(false)
    expect(motor.baza.wallets.size).toBe(0)
  })
})

// ── RAMBURSARE ─────────────────────────────────────────────────────────────
describe('bani — refund (incident real: bani întorși pe card, credite rămase)', () => {
  beforeEach(async () => {
    motor.reset()
    await topUpUser('ion@test.ro', 10, 'gbp', 'pi_r')
  })

  it('retrage creditul, reversează profitul și marchează tranzacția', async () => {
    expect(await revokeTopUpForRefund('pi_r')).toBe(true)
    expect(sold('ion@test.ro')).toBeCloseTo(0, 6)
    expect(randuri('refund')).toEqual([{ amount: 7.5, stripe_ref: 'pi_r:refund' }])
    expect(motor.baza.tx[0].status).toBe('refunded')
  })

  it('PROFITUL raportat se întoarce la zero (audit 27 iul)', async () => {
    await revokeTopUpForRefund('pi_r')
    const totalProfit = randuri('profit').reduce((s, r) => s + r.amount, 0)
    expect(totalProfit).toBeCloseTo(0, 6) // +2,5 la plată, −2,5 la rambursare
  })

  it('a doua rambursare pe aceeași plată nu mai scade nimic', async () => {
    await revokeTopUpForRefund('pi_r')
    expect(await revokeTopUpForRefund('pi_r')).toBe(false)
    expect(sold('ion@test.ro')).toBeCloseTo(0, 6) // nu −7,5
  })

  it('o plată necunoscută nu produce nimic', async () => {
    expect(await revokeTopUpForRefund('pi_inexistent')).toBe(false)
    expect(await revokeTopUpForRefund('')).toBe(false)
    expect(sold('ion@test.ro')).toBeCloseTo(7.5, 6)
  })
})

// ── TAXAREA CONSUMULUI ─────────────────────────────────────────────────────
describe('bani — taxarea consumului (debitWallet)', () => {
  it('scade din portofel și lasă urmă în registru', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'pi_d')
    await debitWallet('ion@test.ro', 2, 'chat')
    expect(sold('ion@test.ro')).toBeCloseTo(5.5, 6)
    expect(randuri('usage')).toEqual([{ amount: -2, stripe_ref: null }])
  })

  it('sumele nule sau negative nu taxează', async () => {
    await topUpUser('ion@test.ro', 10, 'gbp', 'pi_d2')
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
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'pi_c')
    expect(await getBalance('Ion@Test.RO')).toBeCloseTo(7.5, 6)
    expect(await getBalance('ion@test.ro')).toBeCloseTo(7.5, 6)
    expect((await getWalletStatus('Ion@Test.RO')).balance).toBeCloseTo(7.5, 6)
  })

  it('taxarea lovește ACELAȘI portofel, nu creează unul paralel', async () => {
    await topUpUser('Ion@Test.RO', 10, 'gbp', 'pi_c2')
    await debitWallet('Ion@Test.RO', 2.5, 'voce')
    expect(motor.baza.wallets.size).toBe(1) // NU două rânduri pentru același om
    expect(await getBalance('Ion@Test.RO')).toBeCloseTo(5, 6)
  })

  it('clientul Stripe se regăsește indiferent de cum e scris emailul', async () => {
    // Altfel, la a doua plată i s-ar crea un client Stripe NOU: card salvat
    // pierdut, reîncărcare automată moartă, două fișe pentru același om.
    await setStripeCustomer('Ion@Test.RO', 'cus_123')
    expect(await getStripeCustomer('ion@test.ro')).toBe('cus_123')
    expect(await getStripeCustomer('ION@TEST.RO')).toBe('cus_123')
    expect(motor.baza.wallets.size).toBe(1)
  })

  it('fără portofel, soldul e 0 (nu crapă)', async () => {
    expect(await getBalance('nimeni@test.ro')).toBe(0)
    expect(await getWalletStatus('nimeni@test.ro')).toEqual({ balance: 0, topupRef: 0 })
  })
})

// ── ORDINEA WEBHOOK-URILOR ─────────────────────────────────────────────────
describe('bani — o plată reușită nu poate fi retrogradată (audit 27 iul)', () => {
  it('un „failed" venit DUPĂ „succeeded" nu strică istoricul', async () => {
    await topUpUserFromPaymentIntent('ana@test.ro', 10, 'gbp', 'pi_w')
    expect(motor.baza.tx[0].status).toBe('succeeded')
    await updateTransactionStatus('pi_w', 'failed')
    expect(motor.baza.tx[0].status).toBe('succeeded') // rămâne reușită
  })

  it('dar o plată „pending" poate fi marcată eșuată', async () => {
    motor.baza.tx.push({
      user_id: 'ana@test.ro',
      amount: 10,
      credits: 0,
      status: 'pending',
      stripe_payment_intent_id: 'pi_f',
    })
    await updateTransactionStatus('pi_f', 'failed')
    expect(motor.baza.tx[0].status).toBe('failed')
  })
})
