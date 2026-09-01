import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')

describe('erorile creierului rămân oneste și nu dublează efecte', () => {
  it('reîncearcă numai înainte ca primul text să ajungă la client', () => {
    expect(source).toContain('MAX_INCERCARI_MODEL')
    expect(source).toContain('brain_openai_exhausted')
    expect(source).toMatch(/if \(textFlowed\) throw ge/)
  })

  it('folosește un mesaj neutru pentru o pană tranzitorie', () => {
    expect(source).toContain('Încearcă din nou în câteva secunde.')
    expect(source).toContain('Try again in a few seconds.')
  })

  it('nu promite că retry-ul repară o eroare permanentă', () => {
    expect(source).toMatch(/const eNetranzitorie =/)
    expect(source).toContain('Cererea asta nu a putut fi dusă la capăt')
    expect(source).toContain('This request could not be completed')
  })

  it('avertizează când o faptă externă a reușit înaintea întreruperii', () => {
    expect(source).toMatch(/const fapteDejaExecutate = doveziUnelte\.some\(/)
    expect(source).toMatch(/eUnealtaCuEfectExtern\(d\.nume\)/)
    expect(source).toContain('Am apucat să execut o parte din ce ai cerut înainte de întrerupere')
    expect(source).toContain('Part of what you asked was already carried out before the interruption')
  })

  it('detaliile de rată/cotă rămân numai în logul serverului', () => {
    expect(source).toMatch(/console\.error\('\[CHAT ERROR\]'[\s\S]{0,120}isRateLimit/)
    expect(source).not.toContain('Modelul gratuit a atins plafonul')
    expect(source).not.toContain('schimbă modelul din Setări')
  })
})
