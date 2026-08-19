import { describe, it, expect } from 'vitest'
import { memorieRezolvareConstructor } from './services/invatareConstructor.js'

// owner, 19 aug: „kelion invata cum si cine, ce a aplicat ca sa rezolve".
describe('memorieRezolvareConstructor — ce învață Kelion din rezolvare', () => {
  it('free local: cine + motor + ce a aplicat', () => {
    const m = memorieRezolvareConstructor({
      id: 501, motor: 'aider', creier: 'qwen2.5-coder:32b', sursa: 'free',
      fisiere: ['backend/src/routes/chat.ts', 'frontend/src/App.tsx'], ordin: 'repară butonul de copy',
    })
    expect(m).toContain('#501')
    expect(m).toContain('„repară butonul de copy"')
    expect(m).toContain('aider')
    expect(m).toContain('qwen2.5-coder:32b')
    expect(m).toContain('free (local pe VPS)')
    expect(m).toContain('backend/src/routes/chat.ts')
  })

  it('plătit cloud: eticheta corectă', () => {
    const m = memorieRezolvareConstructor({ id: 7, motor: 'aider', creier: 'qwen3.5:397b', sursa: 'platit', fisiere: [] })
    expect(m).toContain('qwen3.5:397b')
    expect(m).toContain('plătit (cloud)')
    expect(m).not.toContain('a aplicat pe') // fără fișiere → fără clauza aia
  })

  it('trunchiază lista lungă de fișiere cu un rest numărat', () => {
    const fisiere = Array.from({ length: 15 }, (_, i) => `f${i}.ts`)
    const m = memorieRezolvareConstructor({ id: 9, creier: 'x', sursa: 'free', fisiere })
    expect(m).toContain('(+3)')
  })

  it('fără id valid → gol (nu inventează o memorie)', () => {
    expect(memorieRezolvareConstructor({ id: 0 })).toBe('')
    expect(memorieRezolvareConstructor({ id: -1 })).toBe('')
    // fisiere ne-array e ignorat, nu crapă
    expect(memorieRezolvareConstructor({ id: 3, creier: 'x', sursa: 'free', fisiere: 'nu-e-listă' as unknown })).toContain('#3')
  })
})
