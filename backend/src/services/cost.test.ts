import { describe, it, expect, vi } from 'vitest'

// The live-price lookup is the ONLY external dependency of cost.ts — mocked
// here so the source-labeling rules are tested without network. Per-test
// `…Once` implementations (no mockReset): each test states exactly the one
// behavior the unit under test will see.
const getLiveModelPricePerM = vi.fn()
vi.mock('./openrouter.js', () => ({ getLiveModelPricePerM }))

const { brainCostUsd, costFromPrice, TTS_USD_PER_CHAR, ASR_USD_PER_CALL, SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL, VOICE_USD_PER_MINUTE } =
  await import('./cost.js')

describe('cost.ts — prețul modelului vine LIVE, nu dintr-un tabel scris de mână', () => {
  it('cu preț live din catalogul OpenRouter: sursa e live_openrouter și matematica e exactă', async () => {
    getLiveModelPricePerM.mockResolvedValueOnce({ promptPerM: 0.3, completionPerM: 2.5 })
    const r = await brainCostUsd('google/gemini-2.5-flash', 1_000_000, 100_000)
    expect(r.source).toBe('live_openrouter')
    // 1M input × $0.3/1M + 100k output × $2.5/1M = $0.30 + $0.25
    expect(r.usd).toBeCloseTo(0.55, 9)
    expect(getLiveModelPricePerM).toHaveBeenCalledWith('google/gemini-2.5-flash')
  })

  it('fără catalog: cade pe tabelul static ETICHETAT static_estimate, niciodată „real"', async () => {
    getLiveModelPricePerM.mockResolvedValueOnce(null)
    const r = await brainCostUsd('gemini-2.5-flash', 2_000_000, 0)
    expect(r.source).toBe('static_estimate')
    expect(r.usd).toBeCloseTo(0.6, 9) // 2M × $0.30/1M
  })

  it('model complet necunoscut: onest „unknown" cu $0, nu o cifră inventată', async () => {
    getLiveModelPricePerM.mockResolvedValueOnce(null)
    const r = await brainCostUsd('some/model-nobody-knows', 500_000, 500_000)
    expect(r.source).toBe('unknown')
    expect(r.usd).toBe(0)
  })

  it('catalogul pică (throw): tot fallback etichetat, nu crash', async () => {
    getLiveModelPricePerM.mockImplementationOnce(() => {
      throw new Error('network down')
    })
    const r = await brainCostUsd('gemini-2.5-flash', 1_000_000, 0)
    expect(r.source).toBe('static_estimate')
    expect(r.usd).toBeCloseTo(0.3, 9)
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
