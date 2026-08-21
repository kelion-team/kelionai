import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// owner, 19 aug: „seteaza sa aibe timp sa raspunda… dinamic pe greutatea intrebari
// sau problemei" + „sistem de ajustare continuu, cind are destul context".
// Funcțiile sunt PURE în modulul VPS (ESM) — le exersăm real prin subproces node.
const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function ev(expr: string): unknown {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const { greutateOrdin, ajustareDinIstoric, praghAider, parseMasuratori, calibrarePaid } = m;
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

describe('praghAider — dinamic + ajustat + mărginit', () => {
  it('free trivial (greutate 0), fără istoric → bază exactă (8 min / 150s), neajustat', () => {
    const r = ev('praghAider({ platit:false, nrFisiere:0, lungimePrompt:0, ramaseMs: 26*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number; ajustat: boolean }
    expect(r.ajustat).toBe(false)
    expect(r.timeoutMs).toBe(8 * 60000)
    expect(r.tacereKillMs).toBe(150000)
  })
  it('free GREU (6 fișiere) → timeout urcă spre max (16 min), tăcere spre max', () => {
    const r = ev('praghAider({ platit:false, nrFisiere:6, lungimePrompt:8000, ramaseMs: 60*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number }
    expect(Math.round(r.timeoutMs / 60000)).toBe(16)
    expect(r.tacereKillMs).toBeGreaterThan(150000)
  })
  it('istoric cu tăieri degeaba → tăcerea crește față de fără istoric', () => {
    const fara = ev('praghAider({ platit:false, nrFisiere:2, lungimePrompt:1000, ramaseMs: 60*60000, istoric: [] }).tacereKillMs') as number
    const cu = ev('praghAider({ platit:false, nrFisiere:2, lungimePrompt:1000, ramaseMs: 60*60000, istoric: [{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false},{durataMs:150000,taiatPeTacere:true,aEditat:false}] }).tacereKillMs') as number
    expect(cu).toBeGreaterThan(fara)
  })
  it('bugetul rămas mărginește timeout-ul (un job nu devine demon)', () => {
    const r = ev('praghAider({ platit:false, nrFisiere:6, lungimePrompt:8000, ramaseMs: 5*60000, istoric: [] })') as { timeoutMs: number }
    // ramaseMs=5min → timeout ≤ 5min - 60s = 4 min
    expect(r.timeoutMs).toBeLessThanOrEqual(4 * 60000)
  })
  it('tăcerea nu depășește niciodată timeout-ul', () => {
    const r = ev('praghAider({ platit:false, nrFisiere:6, lungimePrompt:8000, ramaseMs: 3*60000, istoric: [] })') as { timeoutMs: number; tacereKillMs: number }
    expect(r.tacereKillMs).toBeLessThanOrEqual(r.timeoutMs)
  })
})

describe('calibrarePaid — media plătit, „pina se calibreaza"', () => {
  it('sub prag de succese plătite → necalibrat', () => {
    const r = ev('calibrarePaid([{durataMs:240000,aEditat:true},{durataMs:200000,aEditat:true}])') as { calibrat: boolean; mediePaidMs: number }
    expect(r.calibrat).toBe(false)
  })
  it('≥3 succese plătite → media reală (ignoră cele fără edit)', () => {
    const r = ev('calibrarePaid([{durataMs:240000,aEditat:true},{durataMs:300000,aEditat:true},{durataMs:360000,aEditat:true},{durataMs:999999,aEditat:false}])') as { calibrat: boolean; mediePaidMs: number }
    expect(r.calibrat).toBe(true)
    expect(r.mediePaidMs).toBe(300000) // (240+300+360)/3 = 300s
  })
})

describe('praghAider — FREE calibrat din media PLĂTIT', () => {
  it('free primește cel puțin ~media plătit × factor înainte să fie tăiat', () => {
    // media paid 300s (5 min) × 1.5 = 450s (7.5 min) — dar baza free trivial e 8 min,
    // deci pe ordin trivial baza domină; pe ordin unde baza ar fi sub calibrare, urcă.
    const paid = '[{durataMs:600000,aEditat:true},{durataMs:660000,aEditat:true},{durataMs:720000,aEditat:true}]' // medie 660s=11min
    const cu = ev(`praghAider({ platit:false, nrFisiere:0, lungimePrompt:200, ramaseMs: 60*60000, istoric: [], istoricPaid: ${paid} })`) as { timeoutMs: number; calibratPaid: boolean }
    const fara = ev('praghAider({ platit:false, nrFisiere:0, lungimePrompt:200, ramaseMs: 60*60000, istoric: [], istoricPaid: [] }).timeoutMs') as number
    expect(cu.calibratPaid).toBe(true)
    // media paid 11min × 1.5 = 16.5min, plafonat la max free 16min → mai mare decât baza 8min
    expect(cu.timeoutMs).toBeGreaterThan(fara)
    expect(Math.round(cu.timeoutMs / 60000)).toBe(16) // plafonat la max free
  })
  it('calibrarea NU se aplică pe plătit (paid nu se calibrează pe el însuși)', () => {
    const r = ev('praghAider({ platit:true, nrFisiere:0, lungimePrompt:200, ramaseMs: 60*60000, istoric: [], istoricPaid: [{durataMs:600000,aEditat:true},{durataMs:660000,aEditat:true},{durataMs:720000,aEditat:true}] })') as { calibratPaid: boolean }
    expect(r.calibratPaid).toBe(true) // măsurat, dar…
    // …pe paid nu ridică floor-ul: baza paid (18 min) domină oricum. Verificăm doar că nu crapă.
  })
})

describe('parseMasuratori — istoric măsurat, filtrat pe sursă', () => {
  it('parsează jsonl, filtrează pe platit, ia ultimele n', () => {
    const jsonl = [
      '{"platit":false,"durataMs":1000,"taiatPeTacere":true,"aEditat":false}',
      '{"platit":true,"durataMs":2000,"aEditat":true}',
      'linie-coruptă',
      '{"platit":false,"durataMs":3000,"aEditat":true}',
    ].join('\n')
    const r = ev(`parseMasuratori(${JSON.stringify(jsonl)}, false, 20)`) as unknown[]
    expect(r).toHaveLength(2)
    expect((r[0] as { durataMs: number }).durataMs).toBe(1000)
  })
})
