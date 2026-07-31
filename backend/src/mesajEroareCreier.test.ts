import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── 402 NU E 429 ────────────────────────────────────────────────────────────
//
// Adrian, 31 iul: „credit creier epuizat […] de ce ai mințit?"
//
// Avea dreptate. Un model gratuit care atinge plafonul de cereri pe minut
// întoarce 429. Codul băga 429 în aceeași condiție cu 402 și-i scria pe ecran
// „reîncarcă creditul" — bani ceruți pentru un model care costă ZERO, fără ca
// aplicația să fi citit vreodată un sold. Exact regula lui #1: o stare afirmată,
// nemăsurată.
//
// Testul citește codul REAL. Dacă cineva pune 429 înapoi lângă 402, pică aici.
const sursa = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('mesajul de eroare al creierului nu mai cere bani pentru un plafon de cereri', () => {
  it('429 e tratat ca plafon de cereri, separat de fonduri', () => {
    expect(sursa).toMatch(/const isRateLimit\s*=[\s\S]{0,200}429/)
  })

  it('condiția de bani NU mai conține 429', () => {
    const bani = /const isQuota\s*=([\s\S]{0,200}?)\n/.exec(sursa)?.[1] ?? ''
    expect(bani).not.toContain('429')
    expect(bani).toContain('402')
  })

  it('banii se cer doar când NU e plafon de cereri', () => {
    expect(sursa).toMatch(/const isQuota\s*=\s*!isRateLimit/)
  })

  it('userul primește un mesaj care spune explicit că nu e vorba de bani', () => {
    expect(sursa).toMatch(/plafonul de cereri[\s\S]{0,80}nu e o problemă de bani/)
  })
})
