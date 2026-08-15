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

  it('toate opțiunile de schimbare a limbii (ro, en, es, fr, de, it, ru) sunt disponibile', () => {
    const limbi = ['ro', 'en', 'es', 'fr', 'de', 'it', 'ru']
    for (const limba of limbi) {
      expect(stageCode).toContain(`code: '${limba}'`)
    }
  })
})
