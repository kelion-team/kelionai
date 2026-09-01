import { describe, expect, it, vi } from 'vitest'

const { loadKv, saveKv, rationeazaMesaje } = vi.hoisted(() => ({
  loadKv: vi.fn().mockResolvedValue(null),
  saveKv: vi.fn().mockResolvedValue(true),
  rationeazaMesaje: vi.fn(),
}))

vi.mock('../config.js', () => ({ config: { openai: { key: '' } } }))
vi.mock('../db.js', () => ({ loadKv, saveKv }))
vi.mock('./creierRationament.js', () => ({ rationeazaMesaje }))

import { normalizeLang, translationReady, translateStrings } from './manualLang.js'

describe('manualLang', () => {
  it('normalizează coduri de limbă și refuză valori arbitrare', () => {
    expect(normalizeLang('RO')).toBe('ro')
    expect(normalizeLang('pt-BR')).toBe('pt')
    expect(normalizeLang('  fr_FR  ')).toBe('fr')
    expect(normalizeLang('invalidcode')).toBe('')
    expect(normalizeLang('123')).toBe('')
  })

  it('engleza și un cod invalid nu pornesc traducere', async () => {
    expect(await translationReady('en', { test: 'hello' })).toEqual({})
    expect(await translateStrings('', { test: 'hello' })).toEqual({})
    expect(rationeazaMesaje).not.toHaveBeenCalled()
  })

  it('fără cheia OpenAI păstrează sursa și nu inventează traduceri', async () => {
    expect(await translateStrings('fr', { key: 'hello' })).toEqual({})
    expect(rationeazaMesaje).not.toHaveBeenCalled()
    expect(saveKv).not.toHaveBeenCalled()
  })
})
