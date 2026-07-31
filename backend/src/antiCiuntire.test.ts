import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── UN FIȘIER NU SE GOLEȘTE DINTR-O SCHIMBARE DE DOUĂ RÂNDURI ───────────────
//
// 31 iul 2026, 12:36. Kelion a deschis și și-a dat merge singur la PR #613:
// „exclud un model din scara constructorului". A intrat în master cu 2 inserții
// și 1036 de ȘTERGERI, iar `deploy/constructor-agent.mjs` a rămas cu 14 rânduri
// din 1049. Diagnosticul lui era CORECT (modelul chiar întorcea răspunsuri goale
// la 11 ordine la rând) — execuția a golit fișierul.
//
// Cauza: `repo_write` cere conținutul COMPLET, iar ieșirea modelului e plafonată.
// Pe un fișier mare răspunsul se taie, și se scrie un ciot — cu commit și mesaj
// care sună corect.
//
// LECȚIA CARE CONTEAZĂ, și de ce testul ăsta e scris așa: paznicul EXISTA. De
// mult. Dar doar în constructorul de pe VPS, pus acolo după un incident
// anterior de exact același fel. Calea din aplicație n-a primit niciodată
// aceeași lecție. **Un paznic pus într-un singur loc apără un singur loc.**
// De asta testul verifică AMBELE căi și că pragul e IDENTIC — două praguri
// diferite pentru aceeași primejdie ar însemna că unul e greșit.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const backend = sursa('./services/github.ts')
const constructor = sursa('../../deploy/constructor-agent.mjs')

describe('calea din aplicație (repo_write) refuză o rescriere ciuntită', () => {
  it('compară mărimea nouă cu cea veche înainte să scrie', () => {
    expect(backend).toMatch(/marimeNoua < marimeVeche \* 0\.5/)
    expect(backend).toContain('refuzat_ciuntire')
  })

  it('ia mărimea din cererea pe care o face oricum — fără cerere în plus', () => {
    // `/contents/` întoarce și `size` lângă `sha`; paznicul nu costă nimic.
    expect(backend).toMatch(/sha\?: string; size\?: number/)
  })

  it('refuzul spune ce să facă, nu doar „nu"', () => {
    // Un refuz fără ieșire îl lasă pe model să reîncearce la fel, în buclă.
    expect(backend).toMatch(/citește-l cu read_source[\s\S]{0,80}retrimite-l complet/)
  })

  it('fișierele mici nu sunt afectate — pragul are un plafon de jos', () => {
    expect(backend).toMatch(/PRAG_MINIM_OCTETI = 2_000/)
    expect(backend).toMatch(/marimeVeche > PRAG_MINIM_OCTETI/)
  })
})

describe('AMBELE căi de scriere au paznicul, cu ACELAȘI prag', () => {
  it('constructorul de pe VPS îl are (îl avea de dinainte)', () => {
    expect(constructor).toMatch(/content\.length < vechi\.length \* 0\.5/)
    expect(constructor).toMatch(/vechi\.length > 2_000/)
  })

  it('pragurile sunt identice — 50% și 2000 de octeți, în amândouă', () => {
    const proc = (s: string): string[] => s.match(/\* 0\.5/g) ?? []
    expect(proc(backend).length).toBeGreaterThan(0)
    expect(proc(constructor).length).toBeGreaterThan(0)
    expect(backend).toContain('2_000')
    expect(constructor).toContain('2_000')
  })
})

describe('fișierul distrus e la loc, întreg', () => {
  it('constructor-agent.mjs are peste o mie de rânduri, nu paisprezece', () => {
    const randuri = constructor.split('\n').length
    expect(randuri).toBeGreaterThan(1000)
  })

  it('scara de modele conține schimbarea pe care PR #613 o voia', () => {
    // Diagnosticul lui Kelion era bun: modelul chiar e defect. Schimbarea
    // rămâne — doar aplicată fără să distrugă restul fișierului.
    expect(constructor).toMatch(/MODELE_DOVEDIT_PROASTE = new Set\(\[[\s\S]{0,600}nvidia\/nemotron-3-super-120b-a12b:free/)
    expect(constructor).not.toMatch(/MODEL_LADDER = \[\s*\n\s*'nvidia\/nemotron-3-super-120b-a12b:free'/)
  })

  it('bucățile mari ale constructorului sunt toate acolo', () => {
    // Verificare grosieră dar reală: dacă fișierul ar fi iar ciuntit, măcar una
    // dintre astea ar lipsi.
    for (const bucata of ['function toolWrite', 'function toolEdit', 'MODEL_LADDER', 'RUN_ALLOWED', 'compactHistory'])
      expect(constructor).toContain(bucata)
  })
})
