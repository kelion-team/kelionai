// ── AUTOVERIFICAREA INTELIGENTĂ — dovada verdictului + „DE CE nu merge" ───────
// Owner, 19 aug: „ceva inteligent bazat pe AI care verifică că face toate
// funcțiile" + „verifică și DE CE nu merge". Nucleul (tipFunctie / interpreteazaProba)
// e pur — probat aici pe fiecare tip de rezultat; runner-ul pe dependențe injectate.
import { describe, it, expect, vi } from 'vitest'
import {
  tipFunctie,
  interpreteazaProba,
  ruleazaAutoverificare,
} from './services/autoverificare.js'
import { CAPABILITIES, grupaExecutieUnealta } from './services/brainCapabilities.js'

describe('tipFunctie — citire (probă reală) vs efect (dry-run)', () => {
  it('o citire cunoscută (system_health) e „citire"', () => {
    expect(tipFunctie('system_health')).toBe('citire')
    expect(tipFunctie('stare_masurata')).toBe('citire')
  })
  it('o funcție cu efect (build/ștergere) e „efect"', () => {
    expect(tipFunctie('build_software')).toBe('efect')
    // necunoscuta pornește conservator = efect (nu se execută orb)
    expect(tipFunctie('o_functie_inexistenta')).toBe('efect')
  })
  it('e consistent cu registrul de execuție (grupaExecutieUnealta)', () => {
    for (const c of CAPABILITIES.slice(0, 20)) {
      const asteptat = grupaExecutieUnealta(c.name) === undefined ? 'citire' : 'efect'
      expect(tipFunctie(c.name)).toBe(asteptat)
    }
  })
})

describe('interpreteazaProba — funcții cu EFECT (dry-run, fără cost)', () => {
  it('cablată → MERGE, cu notă că nu s-a executat (fără efect)', () => {
    const d = interpreteazaProba('build_software', 'efect', { ok: true })
    expect(d.verdict).toBe('merge')
    expect(d.deCe).toMatch(/EFECT|dry-run|nu se execută/)
  })
  it('ne-cablată → STRICAT + recomandare fermă', () => {
    const d = interpreteazaProba('build_software', 'efect', { ok: false, eroare: 'nu e în dispecer' })
    expect(d.verdict).toBe('stricat')
    expect(d.recomandare).toMatch(/^REPARĂ/)
  })
})

describe('interpreteazaProba — funcții de CITIRE: verdict + DE CE, pe fiecare cauză', () => {
  it('401/403/sesiune → NU POT VERIFICA (nu e stricăciune, e auth)', () => {
    for (const er of ['HTTP 401 unauthorized', 'forbidden 403', 'nu ești admin']) {
      const d = interpreteazaProba('get_calendar_events', 'citire', { ok: false, eroare: er })
      expect(d.verdict).toBe('nu_pot_verifica')
      expect(d.deCe).toMatch(/autentificare|drepturi/)
    }
  })
  it('cheie/token lipsă (Google/Serper) → NU POT VERIFICA + recomandare fermă', () => {
    const d = interpreteazaProba('web_search', 'citire', { ok: false, eroare: 'SERPER api key lipsă' })
    expect(d.verdict).toBe('nu_pot_verifica')
    expect(d.deCe).toMatch(/cheie|token/)
    expect(d.recomandare).toMatch(/FERM/)
  })
  it('rețea/timeout/5xx → STRICAT (chiar nu merge acum)', () => {
    for (const er of ['ECONNREFUSED 127.0.0.1', 'timeout after 12s', 'HTTP 503 service unavailable']) {
      const d = interpreteazaProba('system_health', 'citire', { ok: false, eroare: er })
      expect(d.verdict).toBe('stricat')
      expect(d.deCe).toMatch(/nu răspunde|rețea|timeout/)
    }
  })
  it('binar/fișier lipsă (ENOENT) → STRICAT + repune dependența', () => {
    const d = interpreteazaProba('server_logs', 'citire', { ok: false, eroare: 'spawn ENOENT no such file' })
    expect(d.verdict).toBe('stricat')
    expect(d.recomandare).toMatch(/instalează|repune/)
  })
  it('altă eroare → STRICAT, de reparat în cod', () => {
    const d = interpreteazaProba('db_query', 'citire', { ok: false, eroare: 'syntax error at or near FROM' })
    expect(d.verdict).toBe('stricat')
    expect(d.deCe).toMatch(/a picat/)
  })
  it('rezultat gol / eșec auto-declarat → NU POT VERIFICA (regula #1)', () => {
    expect(interpreteazaProba('get_weather', 'citire', { ok: true, rezultat: '' }).verdict).toBe('nu_pot_verifica')
    expect(interpreteazaProba('get_weather', 'citire', { ok: true, rezultat: 'ERROR: nu pot' }).verdict).toBe('nu_pot_verifica')
  })
  it('rezultat plauzibil → MERGE (probat real)', () => {
    const d = interpreteazaProba('get_time', 'citire', { ok: true, rezultat: '2026-08-19T08:00:00Z' })
    expect(d.verdict).toBe('merge')
    expect(d.deCe).toMatch(/probat real/)
  })
})

describe('ruleazaAutoverificare — probează TOATE capabilitățile + îmbogățește AI pe picate', () => {
  it('enumeră toate funcțiile din registru și dă un verdict fiecăreia', async () => {
    const raport = await ruleazaAutoverificare({
      // citirile „merg" (rezultat valid); efectele „cablate" (ok)
      probaCitire: async () => ({ ok: true, rezultat: 'ok-real' }),
      esteCablat: () => true,
    })
    expect(raport.total).toBe(CAPABILITIES.length)
    expect(raport.functii).toHaveLength(CAPABILITIES.length)
    expect(raport.merg).toBe(CAPABILITIES.length)
    expect(raport.stricate).toBe(0)
  })

  it('o citire picată → STRICAT + „de ce", iar AI îmbogățește diagnosticul', async () => {
    const creierDiag = vi.fn(async (picate: { functie: string }[]) => {
      const m: Record<string, { deCe?: string; recomandare?: string }> = {}
      for (const p of picate) m[p.functie] = { deCe: 'cauză AI mai deșteaptă', recomandare: 'FĂ X' }
      return m
    })
    const raport = await ruleazaAutoverificare({
      probaCitire: async (c) =>
        c.name === 'system_health' ? { ok: false, eroare: 'ECONNREFUSED' } : { ok: true, rezultat: 'ok' },
      esteCablat: () => true,
      creierDiag,
    })
    const sh = raport.functii.find((f) => f.functie === 'system_health')!
    expect(sh.verdict).toBe('stricat')
    expect(sh.deCe).toMatch(/AI: cauză AI mai deșteaptă/) // diagnosticul AI e adăugat
    expect(creierDiag).toHaveBeenCalledOnce()
    expect(raport.stricate).toBeGreaterThanOrEqual(1)
  })

  it('creierul AI jos → rămâne diagnosticul determinist (regula #1, nu inventează)', async () => {
    const raport = await ruleazaAutoverificare({
      probaCitire: async () => ({ ok: false, eroare: 'timeout' }),
      esteCablat: () => true,
      creierDiag: async () => {
        throw new Error('creier jos')
      },
    })
    // toate citirile → stricat cu „de ce" determinist, fără să crape
    expect(raport.functii.some((f) => f.verdict === 'stricat' && /nu răspunde|timeout/.test(f.deCe))).toBe(true)
  })
})
