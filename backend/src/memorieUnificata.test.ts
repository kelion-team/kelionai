import { describe, it, expect } from 'vitest'
import { memorieUnificata } from './services/memorieUnificata.js'

// ── MEMORIA UNIFICATĂ voce↔scris (Adrian, 9 aug: „trebuie să preia și din audio
// sau invers din scris istoricul, indiferent modalitatea"). Funcție PURĂ —
// probată pe istorice reale, fără DB. ────────────────────────────────────────
describe('memorieUnificata — creierul scris vede și ce s-a vorbit', () => {
  it('turele VORBITE (în DB, nu în array-ul clientului) intră în notă', () => {
    const db = [
      { role: 'user', content: 'caută prețul la bitcoin' },
      { role: 'assistant', content: 'Am căutat, e 64809 dolari.' },
    ]
    const client = [{ role: 'user', content: 'ai căutat? sau cauți?' }]
    const nota = memorieUnificata(db, client)
    expect(nota).toContain('MEMORIA UNIFICATĂ')
    expect(nota).toContain('caută prețul la bitcoin')
    expect(nota).toContain('Am căutat, e 64809 dolari.')
  })

  it('NU dublează turele scrise deja prezente în array-ul clientului', () => {
    const scris = { role: 'user', content: 'salut, ce faci' }
    const db = [scris, { role: 'assistant', content: 'bine, tu?' }]
    // clientul are deja turul scris → doar răspunsul (dacă lipsește) ar intra;
    // aici punem în client ambele → nu mai lipsește nimic.
    const client = [scris, { role: 'assistant', content: 'bine, tu?' }]
    expect(memorieUnificata(db, client)).toBe('')
  })

  it('fără istoric în DB → notă goală (nu inventează memorie)', () => {
    expect(memorieUnificata([], [{ role: 'user', content: 'ceva' }])).toBe('')
  })

  it('păstrează cel mult `cap` rânduri, pe cele mai RECENTE', () => {
    const db = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `vorbit ${i}` }))
    const nota = memorieUnificata(db, [], 5)
    expect(nota).toContain('vorbit 29')
    expect(nota).toContain('vorbit 25')
    expect(nota).not.toContain('vorbit 24')
  })

  it('golurile fără conținut se sar (nu poluează contextul)', () => {
    const db = [
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'un răspuns real' },
    ]
    const nota = memorieUnificata(db, [])
    expect(nota).toContain('un răspuns real')
    expect(nota).not.toContain('Omul:')
  })
})
