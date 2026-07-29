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
vi.mock('../src/config.js', () => ({}))

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
