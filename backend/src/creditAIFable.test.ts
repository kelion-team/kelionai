import { describe, it, expect, afterEach, vi } from 'vitest'

// ── DOVADA: Fable 5 = rezerva constructorului, bec verde/roșu (owner, 14 aug) ──
// Owner: „schimbă-mi constructorul cu gemeni ultra… când nu merge repara vreau să
// cadă pe fable 5". Fable 5 (Claude) e REZERVA, PRIN APP (cheia ANTHROPIC_API_KEY
// stă în app, nu în constructor). Anthropic NU expune sold prin API → nu inventăm o
// cifră (regula #1).
//
// ÎNTĂRIT 14 aug (după-amiaza): becul verde a MINȚIT — cheia era PUSĂ în env dar
// INVALIDĂ („API key is invalid", măsurat la Anthropic), rezerva moartă, raportul
// „gata", constructorul blocat. De-acum „servește" = PROBA REALĂ a cheii la
// Anthropic (GET /v1/models, gratuit): validă = VERDE; pusă-dar-refuzată = ROȘU cu
// motivul exact; lipsă = ROȘU. MĂSURAT, deci niciodată GRI.

import { crediteAI, beculCredit } from './services/creditAI.js'
import { _resetProbaFable } from './services/fable5Constructor.js'

const randFable = async () => {
  const rows = await crediteAI()
  const c = rows.find((r) => r.furnizor.startsWith('Fable 5'))
  expect(c, 'rândul Fable 5 (rezerva constructorului) lipsește din raport').toBeTruthy()
  return c!
}

/** Anthropic simulat: proba cheii răspunde cu statusul dat (fără rețea în teste). */
const anthropicRaspunde = (status: number): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status })),
  )
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
    vi.unstubAllGlobals()
    _resetProbaFable() // proba are cache 10 min — un test nu are voie să-l moștenească pe al altuia
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
    // „servește" e MĂSURAT → becul e ROȘU, niciodată GRI.
    expect(c.serveste?.masurat).toBe(true)
    expect(beculCredit(c)).toBe('rosu')
  })

  it('cheie pusă + Anthropic o ACCEPTĂ (probă 200) → rezervă gata, bec VERDE', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-cheie'
    anthropicRaspunde(200)
    const c = await randFable()
    expect(c.cheieConfigurata).toBe(true)
    expect(beculCredit(c)).toBe('verde')
    const v = c.serveste?.masurat && 'valoare' in c.serveste ? (c.serveste.valoare as { da: boolean }) : null
    expect(v?.da).toBe(true)
  })

  it('cheie PUSĂ dar INVALIDĂ (probă 401) → bec ROȘU cu motivul exact — bugul din 14 aug nu mai poate tăcea', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-cheie-moarta'
    anthropicRaspunde(401)
    const c = await randFable()
    // Cheia E configurată (pusă în env)…
    expect(c.cheieConfigurata).toBe(true)
    // …dar becul NU mai are voie să fie verde doar din prezență: proba a picat.
    expect(beculCredit(c)).toBe('rosu')
    const v = c.serveste?.masurat && 'valoare' in c.serveste ? (c.serveste.valoare as { detaliu?: string }) : null
    expect(String(v?.detaliu ?? '')).toContain('REFUZĂ')
  })

  it('rândul rămâne în raport oricum, cu link de facturare Anthropic', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const c = await randFable()
    expect(c.facturare).toContain('anthropic.com')
    // Cheltuiala Fable NU e în jurnalul nostru — spune ONEST, nu raportează 0.
    expect(c.cheltuitLuna.masurat).toBe(false)
  })
})
