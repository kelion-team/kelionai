import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { normalizeaza, similaritate, esteDuplicat } from './cerinteDedup.js'

describe('cerinteDedup — dubluri de cerințe reformulate (K16)', () => {
  it('normalizează diacritice + punctuație + majuscule (păstrează cuvintele)', () => {
    expect(normalizeaza('Mută avatarul în STÂNGA!')).toBe('muta avatarul in stanga')
  })

  it('aceleași cuvinte, altă ordine/punctuație/diacritice = duplicat', () => {
    expect(esteDuplicat('mută avatarul în stânga', 'Muta avatarul la stanga.')).toBe(true)
    expect(esteDuplicat('repară vocea live pe telefon', 'Pe telefon, repara vocea LIVE!')).toBe(true)
  })

  it('text identic (dar cu altă punctuație/majuscule) = similaritate 1', () => {
    expect(similaritate('Repară vocea live.', 'repara vocea live')).toBe(1)
  })

  it('cerințe DIFERITE care împart câteva cuvinte NU sunt unite', () => {
    expect(esteDuplicat('mută avatarul în stânga', 'mută harta în dreapta')).toBe(false)
    expect(esteDuplicat('repară vocea pe telefon', 'repară plata prin Revolut')).toBe(false)
  })

  it('similaritatea e 0–1 și crește cu suprapunerea', () => {
    const s = similaritate('adaugă buton de export pe pagina de trading', 'pune un buton de export în trading')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThanOrEqual(1)
  })

  it('text gol nu crapă', () => {
    expect(normalizeaza('')).toBe('')
    expect(similaritate('', '')).toBe(1)
    expect(esteDuplicat('', 'ceva')).toBe(false)
  })

  it('adaugaCerinta compara inclusiv randurile respinse, ca autonomia sa nu le reinventeze', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8')
    const start = db.indexOf('export async function adaugaCerinta')
    const end = db.indexOf('export async function listeazaCerinte', start)
    const functie = db.slice(start, end)
    expect(functie).toContain('SELECT id, text FROM cerinte ORDER BY created_at DESC LIMIT 200')
    expect(functie).not.toContain("WHERE stare <> 'respinsa'")
  })

})
