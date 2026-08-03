// ── THE OPENAI COSTS PILL: "CAN'T READ" IS NOT "ZERO" ───────────────────────
//
// Adrian's order, with live evidence: the Money tab showed "voice_minutes
// $204.52" (mic-on minutes × a hand-written rate) while the OpenAI Usage page
// showed ~$65. The real figure is readable from the provider's costs API —
// and when it CAN'T be read, the pill must say so, never show a credible zero
// (the same rule that fixed the OpenRouter pill, see soldOpenrouter.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { getOpenAiMonthCost, monthStartUtc } = await import('./services/openaiCosts.js')

/** A well-formed provider page: one monthly bucket, two cost lines. */
function pageOk(values: number[]): Response {
  return new Response(
    JSON.stringify({
      object: 'page',
      data: [
        {
          object: 'bucket',
          start_time: monthStartUtc(),
          end_time: monthStartUtc() + 2_678_400,
          results: values.map((v) => ({
            object: 'organization.costs.result',
            amount: { value: v, currency: 'usd' },
            line_item: null,
            project_id: null,
          })),
        },
      ],
      has_more: false,
      next_page: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('openai-costs — citirea reală din API-ul furnizorului', () => {
  beforeEach(() => {
    delete process.env.OPENAI_USAGE_KEY
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_USAGE_KEY
  })

  it('fără OPENAI_USAGE_KEY răspunde ONEST indisponibil, NU zero', async () => {
    const r = await getOpenAiMonthCost(true)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_configured')
    // The zero must never be readable as a measurement: ok=false is the only
    // signal the UI trusts (it shows „⚠ OpenAI").
  })

  it('cheltuiala lunii = SUMA liniilor din bucket, citită cu cheia corectă', async () => {
    process.env.OPENAI_USAGE_KEY = 'sk-admin-test'
    let seenUrl = ''
    let seenAuth = ''
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seenUrl = String(url)
      seenAuth = String((init.headers as Record<string, string>).Authorization ?? '')
      return pageOk([40.25, 24.75])
    })
    const r = await getOpenAiMonthCost(true)
    expect(r.ok).toBe(true)
    expect(r.monthUsd).toBeCloseTo(65.0, 6) // the real ~$65, not the $204 estimate
    expect(seenUrl).toContain(`start_time=${monthStartUtc()}`)
    // 1d, NU 1mo: OpenAI întoarce HTTP 400 pe „1mo" („Supported values are:
    // '1d'"), de-aia pastila arăta ⚠ deși cheia funcționa (Adrian, 3 aug).
    expect(seenUrl).toContain('bucket_width=1d')
    expect(seenUrl).not.toContain('1mo')
    expect(seenUrl).toContain('limit=31')
    expect(seenAuth).toBe('Bearer sk-admin-test')
  })

  it('un zero REAL de la furnizor e o măsurătoare validă (ok: true)', async () => {
    process.env.OPENAI_USAGE_KEY = 'sk-admin-test'
    vi.stubGlobal('fetch', async () => pageOk([]))
    const r = await getOpenAiMonthCost(true)
    expect(r.ok).toBe(true)
    expect(r.monthUsd).toBe(0) // measured zero — allowed; a FAILED read is not
  })

  it('HTTP picat → „nu pot citi", nu zero', async () => {
    process.env.OPENAI_USAGE_KEY = 'sk-admin-test'
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    const r = await getOpenAiMonthCost(true)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('http_401')
  })

  it('răspuns în altă formă → „unexpected_shape", nu zero', async () => {
    process.env.OPENAI_USAGE_KEY = 'sk-admin-test'
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ surpriza: true }), { status: 200 }),
    )
    const r = await getOpenAiMonthCost(true)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toMatch(/^unexpected_shape:/)
  })

  it('cache 5 minute: a doua citire NU mai lovește rețeaua', async () => {
    process.env.OPENAI_USAGE_KEY = 'sk-admin-test'
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return pageOk([10])
    })
    const a = await getOpenAiMonthCost(true) // fills the cache
    const b = await getOpenAiMonthCost() // must be served from it
    expect(a.ok && b.ok).toBe(true)
    expect(b.monthUsd).toBe(10)
    expect(calls).toBe(1)
  })
})

describe('openai-costs — începutul lunii UTC', () => {
  it('cade pe ziua 1 a lunii curente, la miezul nopții UTC', () => {
    const aug15 = Date.UTC(2026, 7, 15, 13, 45)
    expect(monthStartUtc(aug15)).toBe(Math.floor(Date.UTC(2026, 7, 1) / 1000))
    // New Year's Eve belongs to December, not January.
    const jan1 = Date.UTC(2027, 0, 1, 0, 0, 1)
    expect(monthStartUtc(jan1)).toBe(Math.floor(Date.UTC(2027, 0, 1) / 1000))
  })
})
