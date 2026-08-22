import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── LACĂT: REZERVA LOCALĂ FREE la Devin (owner, 22 aug) ─────────────────────────
// „Devin principal; când pică, treci AUTOMAT pe modelul free de pe VPS (Linux);
// când Devin revine, întoarce-te — RAPID, nu 3 ore." Pinuri pe cod VIU
// (comentariile aruncate întâi, lecția M6), ca legătura să nu se rupă tăcut.
const aici = dirname(fileURLToPath(import.meta.url))
function codViu(rel: string): string {
  return readFileSync(join(aici, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}
const local = codViu('services/constructorLocal.ts')
const dispecer = codViu('services/devinConstructor.ts')

describe('rezerva locală free la Devin — pe cod viu', () => {
  it('modelul + gazda vin din ENV, nu hardcodate (LEGEA anti-hardcodare)', () => {
    expect(local).toMatch(/process\.env\.CONSTRUCTOR_OLLAMA_MODEL/)
    expect(local).toMatch(/process\.env\.OLLAMA_API_BASE/)
  })

  it('probează VIU că Ollama răspunde + are modelul (nu presupune)', () => {
    expect(local).toMatch(/export async function probaOllamaLocal/)
    expect(local).toMatch(/\/api\/tags/)
  })

  it('construiește determinist: patch JSON → repo_write → repo_open_pr (nu tool-calling fragil)', () => {
    expect(local).toMatch(/export async function construiesteLocal/)
    expect(local).toMatch(/format: 'json'/)
    expect(local).toMatch(/'repo_write'/)
    expect(local).toMatch(/'repo_open_pr'/)
  })

  it('dispecerul comută pe rezerva locală la AMBELE eșecuri Devin (pornire + sesiune fără PR)', () => {
    expect(dispecer).toMatch(/import \{ construiesteLocal, numeModelLocal \} from '\.\/constructorLocal\.js'/)
    // funcția de comutare + cele două chemări (pornire eșuată + sesiune fără PR)
    expect(dispecer).toMatch(/async function rezervaLocalaSauEsec/)
    expect((dispecer.match(/rezervaLocalaSauEsec\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('la succes local: jobul e done cu brain „local:<model>" + PR în chat', () => {
    expect(dispecer).toMatch(/brain: `local:\$\{numeLocal\}`/)
    expect(dispecer).toMatch(/local\.ok && local\.prUrl/)
  })

  it('AFIȘEAZĂ care constructor lucrează la comutare (owner: „cind comuta sa afiseze care e")', () => {
    expect(dispecer).toMatch(/COMUTAT pe rezerva LOCALĂ \(\$\{numeLocal\}/)
    expect(local).toMatch(/export function numeModelLocal/)
  })

  it('Devin rămâne PRIMUL (revenire automată): dispecerul cheamă porneisteJobDevin înainte de rezervă', () => {
    expect(dispecer.indexOf('porneisteJobDevin(job.orderText')).toBeGreaterThan(0)
    // rezerva se cheamă în catch/după eșec, nu înaintea încercării Devin
    expect(dispecer.indexOf('porneisteJobDevin(job.orderText')).toBeLessThan(dispecer.lastIndexOf('rezervaLocalaSauEsec('))
  })
})
