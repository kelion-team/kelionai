// ── „STRIPE 0? AM BĂGAT BANI" (Adrian, 30 iul) ───────────────────────────────
//
// Stripe ține soldul SEPARAT pe fiecare monedă. Noi numărăm doar moneda contului
// (`STRIPE_CURRENCY`, implicit gbp) — și pe bună dreptate: adunate, lirele cu
// dolarii dau o cifră fără niciun sens (bug reparat pe 4 iul).
//
// Dar filtrarea avea o consecință pe care n-o vedea nimeni: un sold ținut în USD
// sau EUR era aruncat afară, iar panoul scria „£0.00". Adică EXACT aceeași cifră
// pentru „n-ai bani" și pentru „ai bani, dar în altă monedă". A treia oară într-o
// zi când o citire incompletă e afișată ca fapt (regula nr. 1 din CLAUDE.md).
//
// Testele astea apără despărțirea celor două înțelesuri.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_pentru_teste',
      webhookSecret: 'whsec_x',
      currency: 'gbp',
      creditValue: 0.1,
      userShare: 0.75,
    },
    adminEmail: 'adrianenc11@gmail.com',
    openrouter: { key: '' },
    openai: { key: '' },
    geminiKey: '',
    googleMapsKey: '',
    googleTtsKey: '',
    serperKey: '',
  },
}))
vi.mock('./db.js', () => ({
  getStripeCustomer: async () => null,
  setStripeCustomer: async () => {},
}))

const { getStripeBalance } = await import('./services/stripe.js')

/** Răspunsul lui Stripe la GET /v1/balance, în forma reală (sume în bani mici). */
function balanta(body: unknown): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getStripeBalance — un sold în altă monedă nu mai poate fi ascuns', () => {
  it('CAZUL LUI: bani REALI în USD, zero în lire → 0 la lire, DAR moneda străină e raportată', async () => {
    balanta({
      available: [{ amount: 0, currency: 'gbp' }, { amount: 12_500, currency: 'usd' }],
      pending: [],
    })
    const b = await getStripeBalance()
    expect(b).not.toBeNull()
    // Cifra în lire rămâne cinstită: chiar e 0 în lire.
    expect(b!.available).toBe(0)
    // …dar nu mai e SINGURA informație. Banii din USD apar, deci „£0.00" nu mai
    // poate fi citit ca „n-ai nimic".
    expect(b!.alteMonede).toEqual([{ currency: 'usd', available: 125, pending: 0 }])
  })

  it('adună disponibil + în tranzit pe aceeași monedă străină', async () => {
    balanta({
      available: [{ amount: 1_000, currency: 'eur' }],
      pending: [{ amount: 500, currency: 'eur' }],
    })
    const b = await getStripeBalance()
    expect(b!.alteMonede).toEqual([{ currency: 'eur', available: 10, pending: 5 }])
  })

  it('mai multe monede străine, fiecare la rândul ei (NU se adună între ele)', async () => {
    balanta({
      available: [
        { amount: 100, currency: 'gbp' },
        { amount: 200, currency: 'usd' },
        { amount: 300, currency: 'eur' },
      ],
      pending: [],
    })
    const b = await getStripeBalance()
    expect(b!.available).toBe(1)
    expect(b!.alteMonede).toEqual([
      { currency: 'usd', available: 2, pending: 0 },
      { currency: 'eur', available: 3, pending: 0 },
    ])
  })

  it('totul în moneda contului → nicio monedă străină de raportat', async () => {
    balanta({ available: [{ amount: 4_200, currency: 'gbp' }], pending: [] })
    const b = await getStripeBalance()
    expect(b!.available).toBe(42)
    expect(b!.alteMonede).toEqual([])
  })

  it('o intrare fără monedă se socotește a contului (cum era și înainte)', async () => {
    balanta({ available: [{ amount: 5_000 }], pending: [] })
    const b = await getStripeBalance()
    expect(b!.available).toBe(50)
    expect(b!.alteMonede).toEqual([])
  })

  it('punga cardului (Issuing) rămâne numărată separat, în moneda contului', async () => {
    balanta({
      available: [{ amount: 0, currency: 'gbp' }],
      pending: [],
      issuing: { available: [{ amount: 2_000, currency: 'gbp' }] },
    })
    const b = await getStripeBalance()
    expect(b!.issuing).toBe(20)
  })
})
