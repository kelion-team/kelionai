// ── THE SERPER CREDIT PILL: "CAN'T READ" IS NOT "ZERO" ──────────────────────
//
// The same honesty contract as the OpenAI costs pill (openaiCosts.test.ts):
// the balance is read from the provider's own /account endpoint, and when it
// CAN'T be read the pill must say so — never show a credible "Serper 0".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { getSerperBalance } = await import('./services/serperBalance.js')

/** A well-formed provider answer: the real /account shape. */
function accountOk(balance: number, rateLimit = 50): Response {
  return new Response(JSON.stringify({ balance, rateLimit }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('serper-balance — citirea reală din API-ul furnizorului', () => {
  beforeEach(() => {
    delete process.env.SERPER_API_KEY
    delete process.env.SERPER_KEY
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SERPER_API_KEY
    delete process.env.SERPER_KEY
  })

  it('fără SERPER_API_KEY răspunde ONEST indisponibil, NU zero', async () => {
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_configured')
    // ok=false is the only signal the UI trusts (it shows „Serper ⚠").
  })

  it('acceptă și aliasul SERPER_KEY (la fel ca config.ts)', async () => {
    process.env.SERPER_KEY = 'serper-test-key'
    let seenKey = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seenKey = String((init.headers as Record<string, string>)['X-API-KEY'] ?? '')
      return accountOk(12345)
    })
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(true)
    expect(seenKey).toBe('serper-test-key')
  })

  it('balanța = cifra REALĂ din /account, citită cu headerul X-API-KEY', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key'
    let seenUrl = ''
    let seenKey = ''
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seenUrl = String(url)
      seenKey = String((init.headers as Record<string, string>)['X-API-KEY'] ?? '')
      return accountOk(49875, 50)
    })
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(true)
    expect(r.balance).toBe(49875)
    expect(r.rateLimit).toBe(50)
    expect(seenUrl).toBe('https://google.serper.dev/account')
    expect(seenKey).toBe('serper-test-key')
  })

  it('un zero REAL de la furnizor e o măsurătoare validă (ok: true)', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key'
    vi.stubGlobal('fetch', async () => accountOk(0))
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(true)
    expect(r.balance).toBe(0) // measured zero — allowed; a FAILED read is not
  })

  it('HTTP picat → „nu pot citi", nu zero', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key'
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('http_401')
  })

  it('răspuns în altă formă → „unexpected_shape", nu zero', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key'
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ surpriza: true }), { status: 200 }),
    )
    const r = await getSerperBalance(true)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toMatch(/^unexpected_shape:/)
  })

  it('cache 5 minute: a doua citire NU mai lovește rețeaua', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key'
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return accountOk(777)
    })
    const a = await getSerperBalance(true) // fills the cache
    const b = await getSerperBalance() // must be served from it
    expect(a.ok && b.ok).toBe(true)
    expect(b.balance).toBe(777)
    expect(calls).toBe(1)
  })
})
