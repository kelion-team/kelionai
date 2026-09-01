// ── L1h: FEEDBACK IMPLICIT — „nu asta am cerut" ajunge în lecții ─────────────
//
// Ce păzește testul: detectorul prinde CORECȚIILE clare, dar NU se aprinde pe
// orice negație (regula #1 — nu-i punem în cârcă greșeli inexistente), iar un
// reproș notat devine lecție pentru creier.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// db.js e mockat ca să nu tragem config-ul real (chei obligatorii) în test —
// ne interesează logica pură, nu persistența.
const kv = new Map<string, string>()
vi.mock('../db.js', () => ({
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => { kv.set(k, v) },
}))

import { esteNemultumire, noteazaRepros, lectiiReprosuri, incarcaReprosuri } from './feedbackImplicit.js'

beforeEach(async () => {
  kv.clear()
  await incarcaReprosuri()
})

describe('esteNemultumire — prinde corecția, nu orice negație', () => {
  it('corecții clare → da', () => {
    for (const t of [
      'nu asta am cerut',
      'nu asta voiam',
      'nu ți-am cerut asta',
      'ai înțeles greșit',
      'nu e corect ce ai făcut',
      'de fapt voiam altceva',
      'not what I asked',
      "that's wrong",
      'you got it wrong',
    ]) {
      expect(esteNemultumire(t).da, t).toBe(true)
    }
  })

  it('negații care NU sunt reproșuri → nu (fără fals pozitive)', () => {
    for (const t of [
      'nu știu ce să aleg',
      'nu am timp acum',
      'ce e greșit la codul ăsta?',
      'nu e nicio problemă',
      'da, perfect, mulțumesc',
      'nu prea înțeleg subiectul',
      'wrong number, poți suna din nou?',
    ]) {
      expect(esteNemultumire(t).da, t).toBe(false)
    }
  })

  it('un text foarte lung nu e un reproș scurt', () => {
    expect(esteNemultumire('nu asta am cerut '.repeat(40)).da).toBe(false)
  })

  it('întoarce și felul corecției', () => {
    expect(esteNemultumire('nu asta am cerut').fel).toBe('nu-asta')
    expect(esteNemultumire('ai înțeles greșit').fel).toBe('gresit')
  })
})

describe('noteazaRepros → lectiiReprosuri', () => {
  it('un reproș notat devine lecție cu cererea și corecția', async () => {
    await noteazaRepros('deschide harta spre Cluj', 'am deschis vremea', 'nu asta am cerut', 'nu-asta', '2026-08-12T10:00:00Z')
    const l = lectiiReprosuri()
    expect(l).toHaveLength(1)
    expect(l[0]).toContain('deschide harta spre Cluj')
    expect(l[0]).toContain('nu asta am cerut')
  })

  it('se păstrează doar ultimele câteva (nu inundă contextul)', async () => {
    for (let i = 0; i < 8; i++) {
      await noteazaRepros(`cerere ${i}`, `raspuns ${i}`, `corectie ${i}`, 'nu-asta', '2026-08-12T10:00:00Z')
    }
    expect(lectiiReprosuri().length).toBeLessThanOrEqual(5)
    // ultima corecție e prezentă
    expect(lectiiReprosuri().some((x) => x.includes('corectie 7'))).toBe(true)
  })

  it('persistă și se reîncarcă (supraviețuiește unei reporniri)', async () => {
    await noteazaRepros('fă X', 'am făcut Y', 'nu asta', 'nu-asta', '2026-08-12T10:00:00Z')
    await incarcaReprosuri() // reîncarcă din KV
    expect(lectiiReprosuri()).toHaveLength(1)
  })
})
