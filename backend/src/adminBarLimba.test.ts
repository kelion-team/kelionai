import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Cerinta #29: Optiunile de schimbare a limbii in bara de admin
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')

describe('optiunile de schimbare a limbii in bara de admin', () => {
  it('bara de admin contine selectorul de limba', () => {
    expect(bara).toContain('SELECTORUL DE LIMBĂ ÎN BARA DE ADMIN')
    expect(bara).toContain('handleAdminLangChange')
  })

  it('toate cele 7 limbi suportate sunt prezente in selector', () => {
    // B6 (marea verificare, 22 aug): 'ru' era o limbă pe care UI-ul N-O ARE
    // (nu e în Lang/dict — la click cădea pe engleză cu insigna „RU" activă,
    // stare care minte), iar 'pt' (tradusă, în Lang) lipsea din selector.
    // Lacătul pina lista falsă — acum pinuiește adevărul.
    const limbi = ['ro', 'en', 'es', 'fr', 'de', 'it', 'pt']
    for (const l of limbi) {
      expect(bara).toContain(`code: '${l}'`)
    }
  })
})
