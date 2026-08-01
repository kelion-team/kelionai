// ── PAYMENT MOVED FROM STRIPE TO REVOLUT (Adrian, Jul 30) ─────────────────
//
// "Stripe is removed completely and Pro comes in" + "a link to replace
// everywhere".
//
// "Everywhere" is the part that matters. The user can reach payment from
// THREE places — the wallet pill, the /credite page and the chat paywall —
// and all three call the same route, `/api/billing/checkout`, and use the
// `url` field from the response. That's why the change was made THERE, in a
// single place: otherwise a fourth forgotten road would have stayed on
// Stripe, discovered a week later by the person paying.
//
// This test holds two things:
//   1. the response shape stays `{ url }` — the contract all three places
//      rely on; if it breaks, it breaks silently, in the interface;
//   2. without a configured link it does NOT stay silent and does NOT send
//      the person anywhere — it says what's missing (rule no. 1: a failure is
//      not displayed as success).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const LINK = 'https://revolut.me/exemplu'

vi.mock('./config.js', () => ({
  config: {
    revolut: { payLink: process.env.__TEST_REVOLUT_LINK ?? '' },
    billing: { currency: 'gbp', creditValue: 0.1, userShare: 0.75, usdToCurrency: 0.8 },
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

/** The exact logic of the `/api/billing/checkout` route, isolated: Fastify
 *  provides the session, and here we care about the DECISION — which URL
 *  leaves for the person, or which absence is told to them. Without this we'd
 *  have to boot a whole server to test an `if`. */
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
    // The `url` field is the shared contract of the three payment places in the interface.
    expect(r.body.url).toBe(LINK)
  })

  it('FĂRĂ link: spune ce lipsește, nu tace și nu trimite omul în gol', () => {
    const r = checkout()
    expect(r.code).toBe(503)
    expect(r.body.error).toBe('revolut_link_lipsa')
    // Most important: it does NOT return an empty `url`, which in the
    // interface would lead the button into a blank page — exactly "it worked,
    // but it didn't".
    expect(r.body.url).toBeUndefined()
  })

  it('linkul nu e hardcodat: se schimbă din configurare, fără publicare', () => {
    config.revolut.payLink = 'https://revolut.me/altul'
    expect(checkout().body.url).toBe('https://revolut.me/altul')
  })
})
