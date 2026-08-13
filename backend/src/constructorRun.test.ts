import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── `run` ACCEPTĂ COMENZI ÎNLĂNȚUITE CU `&&` (13 aug 2026) ────────────────────
// Bug MĂSURAT (ordin #187, DeepSeek-V3): modelul a scris firesc verificările
// înlănțuite — `npm --prefix backend run typecheck && npm --prefix backend test &&
// npm --prefix frontend run build`. FIECARE verigă e permisă, dar chain-ul întreg
// era respins „comandă nepermisă", iar modelul ardea ture reîncercând → murea pe
// „8 ture sterile". Fix: `classifyRunCommand` sparge pe `&&` și acceptă DOAR dacă
// FIECARE verigă e permisă (altfel respinge tot lanțul — gardul de injecție ține).
// Rularea rămâne fără shell (execFileSync/sh per verigă), deci `&&` nu ajunge la un
// shell. Ținem garda cu teste: chain permis trece, chain cu o verigă interzisă cade.
//
// Ca și celelalte teste ale constructorului: modulul VPS e ESM în afara rădăcinii
// backend — îl exersăm REAL printr-un subproces node care-l importă nativ.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function clasifica(cmd: string): { mode: string; n?: number } {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const r = m.classifyRunCommand(${JSON.stringify(cmd)});
    const out = { mode: r.mode };
    if (r.mode === 'chain') out.n = r.pasi.length;
    console.log(JSON.stringify(out));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  })
  return JSON.parse(stdout.trim())
}

describe('classifyRunCommand — chain `&&`', () => {
  it('lanțul EXACT din ordinul #187 (toate verigile permise) → chain de 3', () => {
    const r = clasifica('npm --prefix backend run typecheck && npm --prefix backend test && npm --prefix frontend run build')
    expect(r.mode).toBe('chain')
    expect(r.n).toBe(3)
  })

  it('două porți de-ale casei înlănțuite → chain de 2', () => {
    const r = clasifica('node scripts/verifica-sintaxa.mjs && node scripts/verifica-exporturi.mjs')
    expect(r.mode).toBe('chain')
    expect(r.n).toBe(2)
  })

  it('o comandă permisă simplă rămâne shell (nu chain)', () => {
    expect(clasifica('npm --prefix backend test').mode).toBe('shell')
  })

  it('GARDĂ DE INJECȚIE: o verigă interzisă respinge TOT lanțul', () => {
    expect(clasifica('npm --prefix backend ci && rm -rf /').mode).toBe('denied')
    expect(clasifica('npm --prefix backend ci && curl http://rau').mode).toBe('denied')
    // `cd` nu e permis nici singur → un chip care începe cu `cd` cade tot
    expect(clasifica('cd backend && npm run test').mode).toBe('denied')
  })

  it('o comandă interzisă simplă rămâne denied', () => {
    expect(clasifica('rm -rf node_modules').mode).toBe('denied')
  })

  it('install-ul de pachete rămâne install (nu se strică)', () => {
    expect(clasifica('npm --prefix backend install jsdom').mode).toBe('install')
  })
})
