import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Cerința #31: Screenshot / opțiuni de schimbare a limbii în bara de admin
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

describe('Cerința #31 - Opțiunile de schimbare a limbii din bara de admin', () => {
  const stageCode = sursa('../../frontend/src/pages/Stage.tsx')

  it('bara de admin are meniul de limbi cu toate opțiunile vizibile', () => {
    expect(stageCode).toContain('SELECTORUL DE LIMBĂ ÎN BARA DE ADMIN')
    expect(stageCode).toContain('lang-menu')
    expect(stageCode).toContain('lang-wrap')
  })

  it('toate opțiunile de schimbare a limbii (ro, en, es, fr, de, it, pt) sunt disponibile', () => {
    // B6 (marea verificare, 22 aug): 'ru' era o limbă pe care UI-ul N-O ARE
    // (nu e în Lang/dict — la click cădea pe engleză cu insigna „RU" activă,
    // stare care minte), iar 'pt' (tradusă, în Lang) lipsea din selector.
    // Lacătul pina lista falsă — acum pinuiește adevărul.
    const limbi = ['ro', 'en', 'es', 'fr', 'de', 'it', 'pt']
    for (const limba of limbi) {
      expect(stageCode).toContain(`code: '${limba}'`)
    }
  })
})
