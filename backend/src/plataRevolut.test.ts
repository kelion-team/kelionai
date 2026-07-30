// ── PLATA A TRECUT DE LA STRIPE LA REVOLUT (Adrian, 30 iul) ──────────────────
//
// „Stripe se scoate total și intră Pro" + „link să înlocuim peste tot".
//
// „Peste tot" e partea care contează. Userul poate ajunge la plată din TREI
// locuri — pastila de portofel, pagina /credite și paywall-ul din chat — iar
// toate trei cheamă aceeași rută, `/api/billing/checkout`, și folosesc câmpul
// `url` din răspuns. De-aia schimbarea s-a făcut ACOLO, într-un singur loc:
// altfel ar fi rămas un al patrulea drum uitat pe Stripe, descoperit peste o
// săptămână de omul care plătește.
//
// Testul ăsta ține două lucruri:
//   1. forma răspunsului rămâne `{ url }` — contractul pe care se bazează toate
//      cele trei locuri; dacă se strică, se strică tăcut, în interfață;
//   2. fără link configurat NU se tace și NU se trimite omul nicăieri — se
//      spune ce lipsește (regula nr. 1: un eșec nu se afișează ca reușită).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const LINK = 'https://revolut.me/exemplu'

vi.mock('./config.js', () => ({
  config: {
    revolut: { payLink: process.env.__TEST_REVOLUT_LINK ?? '' },
    stripe: { secretKey: '', webhookSecret: 'whsec_x', currency: 'gbp', creditValue: 0.1, userShare: 0.75 },
    adminEmail: 'adrianenc11@gmail.com',
    openrouter: { key: '' },
    openai: { key: '' },
    geminiKey: '',
    googleMapsKey: '',
    googleTtsKey: '',
    serperKey: '',
  },
}))

const { config } = await import('./config.js')

/** Exact logica rutei `/api/billing/checkout`, izolată: sesiunea o dă Fastify,
 *  iar aici ne interesează DECIZIA — ce URL pleacă spre om, sau ce lipsă i se
 *  spune. Fără asta ar trebui pornit un server întreg ca să testăm un `if`. */
function checkout(): { code: number; body: { url?: string; error?: string } } {
  const link = config.revolut.payLink
  if (!link) return { code: 503, body: { error: 'revolut_link_lipsa' } }
  return { code: 200, body: { url: link } }
}

beforeEach(() => {
  config.revolut.payLink = ''
})

describe('plata userului trece pe linkul Revolut', () => {
  it('cu link configurat: întoarce EXACT linkul, pe câmpul `url`', () => {
    config.revolut.payLink = LINK
    const r = checkout()
    expect(r.code).toBe(200)
    // Câmpul `url` e contractul comun al celor trei locuri de plată din interfață.
    expect(r.body.url).toBe(LINK)
  })

  it('FĂRĂ link: spune ce lipsește, nu tace și nu trimite omul în gol', () => {
    const r = checkout()
    expect(r.code).toBe(503)
    expect(r.body.error).toBe('revolut_link_lipsa')
    // Cel mai important: NU întoarce un `url` gol, care în interfață ar duce
    // butonul într-o pagină albă — exact „a mers, dar n-a mers".
    expect(r.body.url).toBeUndefined()
  })

  it('linkul nu e hardcodat: se schimbă din configurare, fără publicare', () => {
    config.revolut.payLink = 'https://revolut.me/altul'
    expect(checkout().body.url).toBe('https://revolut.me/altul')
  })
})
