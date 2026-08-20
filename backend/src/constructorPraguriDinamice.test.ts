import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// owner, 19 aug: „seteaza sa aibe timp sa raspunda… dinamic pe greutatea intrebari
// sau problemei" + „sistem de ajustare continuu, cind are destul context".
// Funcțiile sunt PURE în modulul VPS (ESM) — le exersăm real prin subproces node.
// Constructorul e FREE-LOCAL unic (paidul a fost scos, 20 aug): pragurile nu mai au
// dimensiune plătită de calibrat.
const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function ev(expr: string): unknown {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const { greutateOrdin, ajustareDinIstoric, praghAider, parseMasuratori } = m;
    console.log(JSON.stringify(${expr}));
  `
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 }).trim())
}

describe('greutateOrdin — 0..1 din semnale măsurate', () => {
  it('ordin trivial (0 fișiere, prompt scurt) → aproape 0', () => {
    expect(ev('greutateOrdin({ nrFisiere: 0, lungimePrompt: 200 })')).toBeLessThan(0.1)
  })
  it('ordin greu (6 fișiere) → 1', () => {
    expect(ev('greutateOrdin({ nrFisiere: 6, lungimePrompt: 500 })')).toBe(1)
  })
  it('prompt lung ridică greutatea', () => {
    expect(ev('greutateOrdin({ nrFisiere: 0, lungimePrompt: 8000 })')).toBeGreaterThan(0.7)
  })
})

describe('ajustareDinIstoric — CONTINUĂ, doar cu destul context', () => {
  it('sub prag (2 mostre) → neutru, destulContext=false', () => {
    const r = ev('ajustareDinIstoric([{durataMs:1000,aEditat:true},{durataMs:2000,aEditat:true}], 3)') as { factorTimeout: number; factorTacere: number; destulContext: boolean }
    expect(r.destulContext).toBe(false)
    expect(r.factorTimeout).toBe(1)
    expect(r.factorTacere).toBe(1)
  })
  it('multe tăieri pe tăcere fără edit → factorTacere > 1', () => {
    const r = ev('ajustareDinIstoric([{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false}])') as { factorTacere: number; destulContext: boolean }
    expect(r.destulContext).toBe(true)
    expect(r.factorTacere).toBeGreaterThan(1)
  })
  it('durate mari la cei ce au editat → factorTimeout > 1', () => {
    const r = ev('ajustareDinIstoric([{durataMs:600000,aEditat:true},{durataMs:660000,aEditat:true},{durataMs:720000,aEditat:true}])') as { factorTimeout: number }
    expect(r.factorTimeout).toBeGreaterThan(1)
  })
})

describe('praghAider — dinamic + ajustat + mărginit (free-local)', () => {
  it('trivial (greutate 0), fără istoric → bază exactă (8 min / 150s), neajustat', () => {
    const r = ev('praghAider({ nrFisiere:0, lungimePrompt:0, ramaseMs: 26*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number; ajustat: boolean }
    expect(r.ajustat).toBe(false)
    expect(r.timeoutMs).toBe(8 * 60000)
    expect(r.tacereKillMs).toBe(150000)
  })
  it('GREU (6 fișiere) → timeout urcă spre max (16 min), tăcere spre max', () => {
    const r = ev('praghAider({ nrFisiere:6, lungimePrompt:8000, ramaseMs: 60*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number }
    expect(Math.round(r.timeoutMs / 60000)).toBe(16)
    expect(r.tacereKillMs).toBeGreaterThan(150000)
  })
  it('istoric cu tăieri degeaba → tăcerea crește față de fără istoric', () => {
    const fara = ev('praghAider({ nrFisiere:2, lungimePrompt:1000, ramaseMs: 60*60000, istoric: [] }).tacereKillMs') as number
    const cu = ev('praghAider({ nrFisiere:2, lungimePrompt:1000, ramaseMs: 60*60000, istoric: [{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false}] }).tacereKillMs') as number
    expect(cu).toBeGreaterThan(fara)
  })
  it('bugetul rămas mărginește timeout-ul (un job nu devine demon)', () => {
    const r = ev('praghAider({ nrFisiere:6, lungimePrompt:8000, ramaseMs: 5*60000, istoric: [] })') as { timeoutMs: number }
    // ramaseMs=5min → timeout ≤ 5min - 60s = 4 min
    expect(r.timeoutMs).toBeLessThanOrEqual(4 * 60000)
  })
  it('tăcerea nu depășește niciodată timeout-ul', () => {
    const r = ev('praghAider({ nrFisiere:6, lungimePrompt:8000, ramaseMs: 3*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number }
    expect(r.tacereKillMs).toBeLessThanOrEqual(r.timeoutMs)
  })
})

describe('parseMasuratori — istoric măsurat (toate free acum)', () => {
  it('parsează jsonl, sare peste liniile corupte, ia ultimele n', () => {
    const jsonl = [
      '{"durataMs":1000,"taiatPeTacere":true,"aEditat":false}',
      'linie-coruptă',
      '{"durataMs":3000,"aEditat":true}',
    ].join('\n')
    const r = ev(`parseMasuratori(${JSON.stringify(jsonl)}, 20)`) as unknown[]
    expect(r).toHaveLength(2)
    expect((r[0] as { durataMs: number }).durataMs).toBe(1000)
  })
})
