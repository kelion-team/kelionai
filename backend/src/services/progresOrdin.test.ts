import { describe, it, expect } from 'vitest'
import { procentDinProgres } from './progresOrdin.js'

// Bara 0–100% a ordinului (Adrian, 3 aug): procentul e o hartă a etapelor
// REALE raportate de lucrător — testul pinuiește ancorele, ca o schimbare de
// text în agent să pice aici, nu să lase bara înghețată în tăcere.
describe('procentul ordinului vine din etapele raportate, nu din aer', () => {
  it('capetele: queued=0, done=100, failed=null (eticheta spune adevărul)', () => {
    expect(procentDinProgres('queued', null)).toBe(0)
    expect(procentDinProgres('done', 'orice')).toBe(100)
    expect(procentDinProgres('failed', 'pas 3/24')).toBeNull()
  })

  it('etapele reale din jurnalul lucrătorului urcă monoton', () => {
    const etape = [
      procentDinProgres('running', ''),
      procentDinProgres('running', 'ordin #32 (încercarea 1)'),
      procentDinProgres('running', 'atelier clonat pe c8aa7c5'),
      procentDinProgres('running', 'pas 1/24: verificare'),
      procentDinProgres('running', 'pas 12/24: edit backend/src/services/tts.ts'),
      procentDinProgres('running', 'pas 24/24: finish'),
      procentDinProgres('running', 'modificări: 4 files changed'),
      procentDinProgres('running', 'verific: npm --prefix backend test'),
      procentDinProgres('running', 'ramura kelion/job-32 împinsă'),
      procentDinProgres('running', 'PR deschis: https://github.com/x/y/pull/699'),
      procentDinProgres('running', 'aștept verificarea independentă (CI) pe PR…'),
    ] as number[]
    for (const v of etape) expect(v).not.toBeNull()
    for (let i = 1; i < etape.length; i++) {
      expect(etape[i]).toBeGreaterThanOrEqual(etape[i - 1])
    }
    expect(etape[etape.length - 1]).toBeLessThan(100) // 100 e DOAR done real
  })

  it('pasul i/N e proporțional și plafonat sub etapa de build', () => {
    const p1 = procentDinProgres('running', 'pas 1/10: read x') as number
    const p9 = procentDinProgres('running', 'pas 9/10: write y') as number
    expect(p9).toBeGreaterThan(p1)
    expect(p9).toBeLessThanOrEqual(74)
  })
})
