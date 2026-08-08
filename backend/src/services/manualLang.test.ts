import { describe, it, expect, vi } from 'vitest'
import { normalizeLang, translationReady, translateStrings } from './manualLang.js'

vi.mock('./geminiDirect.js', () => ({
  geminiDirectAvailable: () => false,
  geminiDirectChat: vi.fn(),
}))

vi.mock('../db.js', () => ({
  loadKv: vi.fn().mockResolvedValue(null),
  saveKv: vi.fn().mockResolvedValue(true),
}))

describe('manualLang', () => {
  describe('normalizeLang', () => {
    it('normalizes valid language codes', () => {
      expect(normalizeLang('en')).toBe('en')
      expect(normalizeLang('RO')).toBe('ro')
      expect(normalizeLang('pt-BR')).toBe('pt')
      expect(normalizeLang('  fr_FR  ')).toBe('fr')
    })

    it('returns empty string for invalid codes', () => {
      expect(normalizeLang('')).toBe('')
      expect(normalizeLang('invalidcode')).toBe('')
      expect(normalizeLang('123')).toBe('')
    })
  })

  describe('translationReady', () => {
    it('returns empty object for en or invalid lang', async () => {
      expect(await translationReady('en', { test: 'hello' })).toEqual({})
      expect(await translationReady('', { test: 'hello' })).toEqual({})
    })
  })

  describe('translateStrings', () => {
    it('returns empty object for en', async () => {
      const result = await translateStrings('en', { key: 'hello' })
      expect(result).toEqual({})
    })

    it('returns empty object when geminiDirect is not available', async () => {
      const result = await translateStrings('fr', { key: 'hello' })
      expect(result).toEqual({})
    })
  })
})
