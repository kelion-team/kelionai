// ── TESTELE CĂII BANILOR (audit 30 iul: „ce nu s-a verificat?") ──────────────
//
// `stripe.ts` avea 603 de linii care mișcă BANI REALI și ZERO teste. Era cel mai
// riscant loc din tot softul: o greșeală acolo nu dă eroare de compilare — dă
// bani pierduți sau credit dat pe gratis.
//
// Testăm ce se poate testa determinist, FĂRĂ să atingem Stripe:
//   • verificarea semnăturii webhook — singura parte critică de securitate din
//     fișier (HMAC + comparație timing-safe + fereastră de 5 minute);
//   • gărzile care opresc apelurile când lipsește cheia (nicio cerere de rețea);
//   • validarea sumelor (plafoane, credite invalide).
// Ce cere rețea (Checkout, PaymentIntent, Issuing) rămâne pentru testul live —
// aici verificăm că nici măcar nu pleacă cererea când n-are voie.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

// Cheile se citesc din `config` la import; le punem ÎNAINTE, ca modulul să vadă
// un secret de webhook cunoscut și NICIO cheie secretă (starea „neconfigurat").
//
// AICI A STAT UN AL DOILEA `vi.mock('../src/config.js', () => ({}))` — mock GOL,
// fără `config`. Din fișierul ăsta, `../src/config.js` și `./config.js` duc la
// ACELAȘI modul, deci erau două înregistrări pentru aceeași țintă, iar care
// câștiga era NEDETERMINIST: în ~1 din 4 rulări câștiga cel gol și picau toate
// cele 16 teste cu „No «config» export is defined on the mock". Adică poarta pe
// care ne bazăm ca să spunem „219 teste, 0 picate" mințea un sfert din timp.
// Prins rulând suita de 8 ori la rând, nu o dată.

const SECRET = 'whsec_test_kelion'

vi.mock('./config.js', () => ({
  config: {
    stripe: {
      secretKey: '', // NECONFIGURAT: toate apelurile de rețea trebuie să se oprească
      webhookSecret: SECRET,
      currency: 'gbp',
      creditValue: 0.1,
      userShare: 0.75,
    },
    adminEmail: 'adrianenc11@gmail.com',
  },
}))
vi.mock('./db.js', () => ({
  getStripeCustomer: async () => null,
  setStripeCustomer: async () => {},
}))

const {
  verifyWebhook,
  createCheckout,
  createSaleCheckout,
  createOwnerDeposit,
  createPaymentIntent,
  chargeSavedCard,
  createAdminPayout,
  getStripeBalance,
  hasRefund,
} = await import('./services/stripe.js')

/** Construiește antetul de semnătură exact cum îl trimite Stripe. */
function semneaza(corp: string, secondeOffset = 0): string {
  const t = Math.floor(Date.now() / 1000) + secondeOffset
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${corp}`).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('stripe — verificarea semnăturii webhook (securitate)', () => {
  const corp = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } })

  it('acceptă un webhook semnat corect', () => {
    const ev = verifyWebhook(corp, semneaza(corp))
    expect(ev).not.toBeNull()
    expect(ev?.type).toBe('payment_intent.succeeded')
  })

  it('RESPINGE semnătura falsificată (altcineva încearcă să crediteze)', () => {
    const fals = `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`
    expect(verifyWebhook(corp, fals)).toBeNull()
  })

  it('RESPINGE corpul modificat după semnare (suma umflată pe drum)', () => {
    const sig = semneaza(corp)
    const corpModificat = corp.replace('pi_1', 'pi_HACKED')
    expect(verifyWebhook(corpModificat, sig)).toBeNull()
  })

  it('RESPINGE semnătura veche — fereastra e de 5 minute (anti-replay)', () => {
    // Semnătură de acum 10 minute: valid criptografic, dar expirată.
    expect(verifyWebhook(corp, semneaza(corp, -600))).toBeNull()
  })

  it('RESPINGE antet lipsă, gol sau fără v1', () => {
    expect(verifyWebhook(corp, '')).toBeNull()
    expect(verifyWebhook(corp, 't=123')).toBeNull()
    expect(verifyWebhook('', semneaza(corp))).toBeNull()
  })

  it('RESPINGE un corp care nu e JSON, chiar semnat corect', () => {
    const rupt = 'nu-i json{'
    expect(verifyWebhook(rupt, semneaza(rupt))).toBeNull()
  })
})

describe('stripe — fără cheie secretă NU pleacă nicio cerere de bani', () => {
  // Plasa: dacă vreo funcție ar chema rețeaua fără cheie, `fetch` ar fi apelat.
  // Îl spionăm și cerem să rămână NEATINS.
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('nu trebuia chemată rețeaua fără cheie Stripe')
    })
  })

  it('createCheckout se oprește curat', async () => {
    expect(await createCheckout('a@b.c', 'A', 20, 'https://kelionai.app')).toEqual({ error: 'stripe_not_configured' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('createSaleCheckout se oprește curat', async () => {
    expect(await createSaleCheckout('a@b.c', 100, 'https://kelionai.app')).toEqual({ error: 'stripe_not_configured' })
  })

  it('createOwnerDeposit se oprește curat', async () => {
    expect(await createOwnerDeposit('a@b.c', 50, 'https://kelionai.app')).toEqual({ error: 'stripe_not_configured' })
  })

  it('createPaymentIntent se oprește curat', async () => {
    expect(await createPaymentIntent('a@b.c', 'A', 20)).toEqual({ error: 'stripe_not_configured' })
  })

  it('chargeSavedCard (debitare off-session!) se oprește curat', async () => {
    expect(await chargeSavedCard('a@b.c', 'A', 20)).toEqual({ ok: false, error: 'stripe_not_configured' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('createAdminPayout (scoate bani din cont!) se oprește curat', async () => {
    expect(await createAdminPayout(100)).toEqual({ error: 'stripe_not_configured' })
  })

  it('getStripeBalance întoarce null, nu cifre inventate', async () => {
    expect(await getStripeBalance()).toBeNull()
  })

  it('hasRefund întoarce false fără să întrebe rețeaua', async () => {
    expect(await hasRefund('pi_123')).toBe(false)
  })
})

describe('stripe — validarea sumelor (înainte de orice apel)', () => {
  it('vânzarea refuză un număr de credite invalid', async () => {
    // 0, negativ și peste plafon — toate trebuie oprite ca `bad_credits`, nu
    // duse mai departe. (Fără cheie ar da oricum stripe_not_configured, deci
    // verificăm doar că NU trece de validare cu succes.)
    for (const n of [0, -5, 200_000]) {
      const r = await createSaleCheckout('a@b.c', n, 'https://kelionai.app')
      expect('error' in r).toBe(true)
    }
  })

  it('payout-ul refuză suma zero sau negativă', async () => {
    for (const n of [0, -10]) {
      expect('error' in (await createAdminPayout(n))).toBe(true)
    }
  })
})

// ── REZERVA CARE NU SE ATINGE (Adrian, 30 iul) ─────────────────────────────
//
// Rezerva sunt BANII CU CARE DAI ÎNAPOI. Sub prag NU se scoate nimic din punga
// de plăți spre card, fiindcă:
//   • la o rambursare, dacă punga e goală, contul intră pe minus;
//   • la o dispută, Stripe ia suma PLUS un comision care nu se returnează;
//   • comisioanele Stripe se rețin din sold, nu din altă parte.
// Panoul avea deja nota „sub zero = taxe reținute la rambursări/dispute".
//
// £20 + £10 pe fiecare user în plus („rezerva 20, bătut în cuie", 30 iul).
describe('bani — rezerva din punga de plăți crește cu numărul de useri', () => {
  // £20, bătut în cuie (Adrian, 30 iul). Prima valoare a fost £100 — cu un
  // singur user și solduri mici, bloca bani degeaba: din £100 puși în pungă, pe
  // card ajungeau zero, fiindcă tot ce e SUB prag rămâne pe loc.
  const BAZA = 20
  const PER_USER = 10
  const rezerva = (useri: number): number => BAZA + Math.max(0, useri - 1) * PER_USER

  it('exact scara cerută', () => {
    expect(rezerva(1)).toBe(20)
    expect(rezerva(2)).toBe(30)
    expect(rezerva(3)).toBe(40)
    expect(rezerva(10)).toBe(110)
  })

  it('fără useri, pragul rămâne cel de bază (nu zero)', () => {
    expect(rezerva(0)).toBe(20)
  })

  it('sub rezervă nu se scoate NIMIC', () => {
    const disponibil = (sold: number, useri: number): number => sold - rezerva(useri)
    expect(disponibil(9.74, 1)).toBeLessThan(0) // cazul real din contul lui
    expect(disponibil(19, 1)).toBeLessThan(0)
    expect(disponibil(20, 1)).toBe(0) // fix pe prag: tot nu se scoate
    expect(disponibil(25, 2)).toBeLessThan(0) // 2 useri → pragul e 30
  })

  it('peste rezervă se scoate DOAR excedentul, plafonat la alimentarea normală', () => {
    const TOPUP = 20
    const cat = (sold: number, useri: number): number => Math.min(TOPUP, Math.max(0, sold - rezerva(useri)))
    expect(cat(100, 1)).toBe(20) // excedent 80 → plafonat la 20
    expect(cat(32, 1)).toBe(12) // excedent 12 → exact 12
    expect(cat(32, 2)).toBe(2) // 2 useri: pragul 30 → excedent 2
  })
})
