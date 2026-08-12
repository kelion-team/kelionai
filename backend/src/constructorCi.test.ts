import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── VERDICTUL CI: 'skipped' NU e eșec (12 aug 2026) ──────────────────────────
// Bug REAL prins pe viu: constructorul deschidea un PR BUN (toate cele 7 porți
// verzi în atelier), apoi aștepta checkul „verify". Pe repo-ul ăsta GitHub Actions
// e OPRIT (`vars.ACTIONS_PORNIT` fals), deci „verify" iese 'skipped' (sau nu apare
// deloc). `verdictDinCheckRuns` întorcea 'failure' pe orice conclusion != 'success'
// → ordinul era raportat „picat pe CI" deși PR-ul era corect. Fix: 'skipped'/
// 'neutral' → 'absent' (CI n-a rulat; verificarea reală = porțile din atelier +
// poarta VPS care îmbină pe verde).
//
// Ca și celelalte teste ale constructorului: modulul VPS e ESM în afara rădăcinii
// backend — nu se încarcă în-proces (vitest îl rupe la load). Îl exersăm REAL
// printr-un subproces node care-l importă nativ.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function verdict(checkRuns: unknown): string {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const json = { check_runs: ${JSON.stringify(checkRuns)} };
    console.log(m.verdictDinCheckRuns(json, 'verify'));
  `
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim()
}

describe('verdictDinCheckRuns — „skipped" nu e eșec', () => {
  it('„verify" skipped → absent (NU failure — asta bloca ordinele bune)', () => {
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'skipped' }])).toBe('absent')
  })

  it('„verify" neutral → absent', () => {
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'neutral' }])).toBe('absent')
  })

  it('„verify" success → success', () => {
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'success' }])).toBe('success')
  })

  it('„verify" failure → failure (un eșec REAL de CI tot pică)', () => {
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'failure' }])).toBe('failure')
  })

  it('„verify" cancelled/timed_out → failure', () => {
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'cancelled' }])).toBe('failure')
    expect(verdict([{ name: 'verify', status: 'completed', conclusion: 'timed_out' }])).toBe('failure')
  })

  it('„verify" încă rulează → pending', () => {
    expect(verdict([{ name: 'verify', status: 'in_progress', conclusion: null }])).toBe('pending')
  })

  it('fără checkul „verify" → absent (nu inventează un verdict)', () => {
    expect(verdict([{ name: 'altceva', status: 'completed', conclusion: 'success' }])).toBe('absent')
    expect(verdict([])).toBe('absent')
  })
})
