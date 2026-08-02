import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// config is mocked (not env-stubbed): fx.ts must read the billing currency and
// the STATIC FALLBACK rate from config — the same pattern as db.bani.test.ts.
vi.mock('../config.js', () => ({
  config: { billing: { currency: 'gbp', usdToCurrency: 0.8, creditValue: 0.1, userShare: 0.75 } },
}))

const { getUsdRate, resetFxCache } = await import('./fx.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const liveResponse = (gbp: number) =>
  new Response(JSON.stringify({ result: 'success', rates: { GBP: gbp, EUR: 0.92 } }), { status: 200 })

beforeEach(() => {
  fetchMock.mockReset()
  resetFxCache()
})
afterEach(() => resetFxCache())

describe('fx.ts — cursul de schimb e CITIT LIVE, nu tastat', () => {
  it('rata live din API învinge valoarea statică din env', async () => {
    fetchMock.mockResolvedValue(liveResponse(0.7913))
    const r = await getUsdRate()
    expect(r.source).toBe('live')
    expect(r.rate).toBeCloseTo(0.7913, 6)
    expect(fetchMock).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD', expect.anything())
  })

  it('cache 6h: a doua citire NU mai lovește rețeaua', async () => {
    fetchMock.mockResolvedValue(liveResponse(0.79))
    await getUsdRate()
    const again = await getUsdRate()
    expect(again.source).toBe('live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('API pică → fallback LA ENV, dar ETICHETAT env_static (nu „rata de azi")', async () => {
    fetchMock.mockRejectedValue(new Error('no network'))
    const r = await getUsdRate()
    expect(r.source).toBe('env_static')
    expect(r.rate).toBeCloseTo(0.8, 9)
    expect(r.error).toBeTruthy()
  })

  it('formă necunoscută a răspunsului → NU e „curs 1.0", e fallback etichetat cu eroare', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ something: 'else' }), { status: 200 }))
    const r = await getUsdRate()
    expect(r.source).toBe('env_static')
    expect(r.error).toMatch(/unexpected_shape/)
  })

  it('http non-200 → fallback etichetat, cu statusul în eroare', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }))
    const r = await getUsdRate()
    expect(r.source).toBe('env_static')
    expect(r.error).toBe('http_503')
  })
})
