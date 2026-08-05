import { describe, it, expect } from 'vitest'

// (3 aug — extirparea totală OpenRouter: catalogul viu de prețuri a dispărut
// cu tot cu furnizorul. Singura sursă rămasă e tabelul static ETICHETAT
// `static_estimate` — testele pinuiează exact eticheta, ca o estimare să nu
// poată fi prezentată vreodată drept măsurătoare.)
const { brainCostUsd, costFromPrice, TTS_USD_PER_CHAR, ASR_USD_PER_CALL, SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL, VOICE_USD_PER_MINUTE, isDailyBudgetExceeded, DEFAULT_DAILY_BUDGET_CAP_USD } =
  await import('./cost.js')

describe('cost.ts — prețul modelului e o estimare ETICHETATĂ, niciodată „real"', () => {
  it('model din tabelul static: sursa e static_estimate și matematica e exactă', async () => {
    const r = await brainCostUsd('gemini-2.5-flash', 2_000_000, 0)
    expect(r.source).toBe('static_estimate')
    expect(r.usd).toBeCloseTo(0.6, 9) // 2M × $0.30/1M
  })

  it('și cu prefix de furnizor, tot tabelul static răspunde (bare name match)', async () => {
    const r = await brainCostUsd('google-direct/gemini-2.5-flash', 1_000_000, 100_000)
    expect(r.source).toBe('static_estimate')
    // 1M input × $0.3/1M + 100k output × $2.5/1M = $0.30 + $0.25
    expect(r.usd).toBeCloseTo(0.55, 9)
  })

  it('model complet necunoscut: onest „unknown" cu $0, nu o cifră inventată', async () => {
    const r = await brainCostUsd('some/model-nobody-knows', 500_000, 500_000)
    expect(r.source).toBe('unknown')
    expect(r.usd).toBe(0)
  })
})

describe('cost.ts — ratele reziduale sunt estimări etichetate, nu măsurători', () => {
  it('costFromPrice: per-1M → dolari, matematică pură', () => {
    expect(costFromPrice(1, 4, 1_000_000, 250_000)).toBeCloseTo(2, 9)
    expect(costFromPrice(0, 0, 1_000_000, 1_000_000)).toBe(0)
  })

  it('constanele există și sunt pozitive — dar rămân ESTIMĂRI (db.ts le socotește la „estimat")', () => {
    // These are the labeled fallbacks; the test pins them down so a silent
    // "correction" of a money figure in code is a visible, reviewed event.
    expect(TTS_USD_PER_CHAR).toBeCloseTo(30 / 1e6, 15)
    expect(ASR_USD_PER_CALL).toBeCloseTo(0.0015, 12)
    expect(SERPER_USD_PER_CALL).toBeCloseTo(0.001, 12)
    expect(IMAGE_USD_PER_CALL).toBeCloseTo(0.04, 12)
    expect(VOICE_USD_PER_MINUTE).toBeCloseTo(0.35, 12)
  })
})

describe('cost.ts — daily budget cap safeguard (K15)', () => {
  it('isDailyBudgetExceeded correctly evaluates spending vs cap', () => {
    expect(DEFAULT_DAILY_BUDGET_CAP_USD).toBeGreaterThan(0)
    expect(isDailyBudgetExceeded(5.0, 10.0)).toBe(false)
    expect(isDailyBudgetExceeded(10.0, 10.0)).toBe(true)
    expect(isDailyBudgetExceeded(12.5, 10.0)).toBe(true)
  })

  it('disabled or 0 cap allows unlimited spent without exceeding', () => {
    expect(isDailyBudgetExceeded(100.0, 0)).toBe(false)
    expect(isDailyBudgetExceeded(100.0, -1)).toBe(false)
  })
})
