import { describe, it, expect, afterEach } from 'vitest'

// ── DOVADA: Fable 5 = rezerva constructorului, bec verde/roșu (owner, 14 aug) ──
// Owner: „schimbă-mi constructorul cu gemeni ultra… când nu merge repara vreau să
// cadă pe fable 5". Fable 5 (Claude) e REZERVA, PRIN APP (cheia ANTHROPIC_API_KEY
// stă în app, nu în constructor). Anthropic NU expune sold prin API → nu inventăm o
// cifră (regula #1); becul vine din „e cheia pusă?": pusă = VERDE (rezervă gata),
// lipsă = ROȘU (inactivă) — MĂSURAT, deci NICIODATĂ GRI (owner: „culorile la fel
// pt toți AI, nu gri"). Locul RunPod-ului din raport e luat acum de Fable 5.

import { crediteAI, beculCredit } from './services/creditAI.js'

const randFable = async () => {
  const rows = await crediteAI()
  const c = rows.find((r) => r.furnizor.startsWith('Fable 5'))
  expect(c, 'rândul Fable 5 (rezerva constructorului) lipsește din raport').toBeTruthy()
  return c!
}

describe('creditAI — Fable 5 (rezerva constructorului): verde/roșu, fără gri', () => {
  const cheieVeche = process.env.ANTHROPIC_API_KEY
  const fableVeche = process.env.CONSTRUCTOR_FABLE_KEY
  const fable2Veche = process.env.FABLE_KEY
  afterEach(() => {
    for (const [k, v] of [
      ['ANTHROPIC_API_KEY', cheieVeche],
      ['CONSTRUCTOR_FABLE_KEY', fableVeche],
      ['FABLE_KEY', fable2Veche],
    ] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('fără cheie Anthropic → rezervă INACTIVĂ, bec ROȘU (nu gri, nu 0 fabricat)', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CONSTRUCTOR_FABLE_KEY
    delete process.env.FABLE_KEY
    const c = await randFable()
    expect(c.cheieConfigurata).toBe(false)
    // Nu inventează un sold: `ramas` NU e o cifră măsurată (regula #1).
    expect(c.ramas.masurat).toBe(false)
    expect('valoare' in c.ramas).toBe(false)
    // „servește" e MĂSURAT (config) → becul e ROȘU, niciodată GRI.
    expect(c.serveste?.masurat).toBe(true)
    expect(beculCredit(c)).toBe('rosu')
  })

  it('cu ANTHROPIC_API_KEY pusă → rezervă gata, bec VERDE', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-cheie'
    const c = await randFable()
    expect(c.cheieConfigurata).toBe(true)
    expect(beculCredit(c)).toBe('verde')
  })

  it('rândul rămâne în raport oricum, cu link de facturare Anthropic', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const c = await randFable()
    expect(c.facturare).toContain('anthropic.com')
    // Cheltuiala Fable NU e în jurnalul nostru — spune ONEST, nu raportează 0.
    expect(c.cheltuitLuna.masurat).toBe(false)
  })
})
