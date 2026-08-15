// ORDINUL (owner, 15 aug): „constructorul dacă are o eșuare, următoarea tură o
// escaladează automat pe nivel superior Fable 5. Nu pornește duplicat pe
// același model, se revine pentru un nou job la primul model."
// Contractele: încercarea ≥2 → Fable 5 conduce TURA (Gemini nechemat când
// Fable servește); încercarea 1 → Gemini întâi (revenirea la primul model e
// chiar attempt=1 al jobului următor); Fable picat pe escaladare → Gemini e
// plasă, nu moarte; mesajul final de eșec spune drumul REAL parcurs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
const agent = readFileSync(fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url)), 'utf8')

describe('escaladarea pe eșuare (lacăt pe sursă, ca scutulDatelor)', () => {
  it('agentul trimite cinstit a câta încercare e (claim → attempt)', () => {
    expect(agent).toContain('incercareCurenta = Math.max(1, Number(claim.job.attempts) || 1)')
    expect(agent).toContain('attempt: incercareCurenta')
  })

  it('încercarea ≥2 → Fable 5 conduce ÎNAINTEA lanțului Gemini', () => {
    const sus = ruta.indexOf('incercareOrdin > 1 && fable5Disponibil()')
    const gemini = ruta.indexOf('PRINCIPAL: GEMINI')
    expect(sus).toBeGreaterThan(-1)
    expect(gemini).toBeGreaterThan(-1)
    expect(sus).toBeLessThan(gemini) // escaladarea stă DEASUPRA principalului
  })

  it('rezerva de jos nu repetă Fable pe escaladare (fără duplicat pe același model)', () => {
    expect(ruta).toContain("incercareOrdin === 1 && fable5Disponibil()")
  })

  it('Fable picat pe escaladare → Gemini e plasă (jobul nu moare pe rezervă moartă)', () => {
    expect(ruta).toContain('cad pe Gemini ca plasă')
  })

  it('mesajul final de eșec spune drumul real parcurs pe escaladare', () => {
    expect(ruta).toContain('creier_esec (escaladare încercarea ${incercareOrdin})')
  })

  it('ordinul verbatim stă scris la ușă', () => {
    expect(ruta).toContain('următoarea tură o escaladează automat pe nivel superior')
  })
})
