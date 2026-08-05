import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeazaTextCerinta, adaugaCerinta } from '../db.js'

vi.mock('../db.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
  }
})

describe('normalizeazaTextCerinta', () => {
  it('normalizes requirement texts by removing diacritics, extra spaces, and common prefixes', () => {
    const raw1 = '  ÎMBUNĂTĂȚIRE la cerința #12: Adaugă deduplicare la captare.  '
    const raw2 = 'adauga deduplicare la captare'
    expect(normalizeazaTextCerinta(raw1)).toBe(normalizeazaTextCerinta(raw2))
  })

  it('treats identical requirement content with different casing or punctuation as duplicate key', () => {
    const textA = 'Sistemul nu monitorizează cerințele până la capăt!'
    const textB = 'sistemul nu monitorizeaza cerintele pana la capat'
    expect(normalizeazaTextCerinta(textA)).toBe(normalizeazaTextCerinta(textB))
  })
})
