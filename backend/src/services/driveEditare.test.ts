// ── L1i: EDITARE AVANSATĂ GOOGLE DRIVE (Docs + Sheets) ──────────────────────
//
// Scrierea în Drive are părți PURE (normalizarea rândurilor pentru Sheets) și
// părți de rețea (apelurile Google). Aici probăm partea pură real, iar restul
// prin CONTRACT de sursă (ca la iscoade): scope-urile de SCRIERE există în
// consimțământ (fără ele API-ul dă 403), iar cele 4 unelte sunt și definite, și
// dispecerizate — altfel ar fi cod mort cu nume frumos.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeazaRanduri, googleTools } from './google.js'

const google = readFileSync(new URL('./google.ts', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8')

describe('normalizeazaRanduri — 2D curat pentru Sheets', () => {
  it('păstrează numerele și textul, iar null/undefined se transformă în celulă goală', () => {
    expect(normalizeazaRanduri([['a', 1], ['b', 2]])).toEqual([['a', 1], ['b', 2]])
    expect(normalizeazaRanduri([[null, undefined, 'x']])).toEqual([['', '', 'x']])
  })
  it('un rând scalar devine un rând cu o singură celulă', () => {
    expect(normalizeazaRanduri(['x', 'y'])).toEqual([['x'], ['y']])
  })
  it('obiectele se serializează, nu se pierd', () => {
    expect(normalizeazaRanduri([[{ a: 1 }]])).toEqual([['{"a":1}']])
  })
  it('numărul infinit/NaN nu trece ca număr (devine text sau gol)', () => {
    // Infinity/NaN nu-s finite → nu-s număr; ajung prin ramura string.
    expect(normalizeazaRanduri([[Number.NaN]])).toEqual([['NaN']])
  })
  it('ce nu e array aruncă NUMIT (nu tăcut)', () => {
    expect(() => normalizeazaRanduri('nu e array' as unknown)).toThrow(/randuri_invalide/)
  })
})

describe('L1i — scope-urile de SCRIERE sunt cerute la consimțământ', () => {
  it('auth.ts cere documents + spreadsheets + drive.file (nu doar drive.readonly)', () => {
    expect(auth).toContain('https://www.googleapis.com/auth/documents')
    expect(auth).toContain('https://www.googleapis.com/auth/spreadsheets')
    expect(auth).toContain('https://www.googleapis.com/auth/drive.file')
  })
})

describe('L1i — cele 4 unelte de editare sunt reale (definite + dispecerizate)', () => {
  const nume = new Set(googleTools.map((t) => t.name))
  it('definite în googleTools', () => {
    for (const n of ['create_doc', 'edit_doc', 'create_sheet', 'edit_sheet']) {
      expect(nume.has(n), `${n} lipsă din googleTools`).toBe(true)
    }
  })
  it('dispecerizate în runGoogleTool (altfel unealtă declarată fără executor)', () => {
    expect(google).toContain("name === 'create_doc'")
    expect(google).toContain("name === 'edit_doc'")
    expect(google).toContain("name === 'create_sheet'")
    expect(google).toContain("name === 'edit_sheet'")
  })
  it('folosesc API-urile reale Docs/Sheets, nu ceva inventat', () => {
    expect(google).toContain('https://docs.googleapis.com/v1/documents')
    expect(google).toContain('https://sheets.googleapis.com/v4/spreadsheets')
  })
  it('un 403 (token vechi doar-citire) devine „reconectează", nu un cod brut', () => {
    // Dispecerul comun transformă orice _http_401/403 în NEEDS_CONNECT.
    expect(google).toMatch(/_http_\(401\|403\)/)
  })
})
