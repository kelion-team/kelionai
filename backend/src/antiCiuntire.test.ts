import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── A FILE IS NOT EMPTIED BY A TWO-LINE CHANGE ─────────────────────────────
//
// Jul 31 2026, 12:36. Kelion opened and merged PR #613 by itself: "exclude a
// model from the constructor's ladder". It entered master with 2 insertions
// and 1036 DELETIONS, and `deploy/constructor-agent.mjs` was left with 14
// lines out of 1049. Its diagnosis was CORRECT (the model really returned
// empty answers on 11 orders in a row) — the execution emptied the file.
//
// The cause: `repo_write` requires the COMPLETE content, and the model's
// output is capped. On a large file the answer gets cut, and a stump is
// written — with a commit and a correct-sounding message.
//
// THE LESSON THAT MATTERS, and why this test is written this way: the guard
// EXISTED. For a long time. But only in the VPS constructor, put there after
// a previous incident of exactly the same kind. The in-app path never got the
// same lesson. **A guard placed in a single place protects a single place.**
// That's why the test checks BOTH paths and that the threshold is IDENTICAL —
// two different thresholds for the same danger would mean one is wrong.
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
    // `/contents/` returns `size` next to `sha`; the guard costs nothing.
    expect(backend).toMatch(/sha\?: string; size\?: number/)
  })

  it('refuzul spune ce să facă, nu doar „nu"', () => {
    // A refusal with no way out lets the model retry the same way, in a loop.
    expect(backend).toMatch(/citește-l cu read_source[\s\S]{0,80}retrimite-l complet/)
  })

  it('fișierele mici nu sunt afectate — pragul are un plafon de jos', () => {
    expect(backend).toMatch(/PRAG_MINIM_OCTETI = 2_000/)
    expect(backend).toMatch(/marimeVeche > PRAG_MINIM_OCTETI/)
  })
})

describe('AMBELE căi de scriere au paznicul, cu ACELAȘI prag', () => {
  it('the VPS constructor has it (it had it from before)', () => {
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
  it('constructor-agent.mjs are sute de rânduri, nu paisprezece', () => {
    // (Pragul coborât de la 1000 la 900 pe 3 aug: extirparea scării OpenRouter
    // a scos ~270 de rânduri LEGITIM — fișierul întreg are acum ~970.)
    const randuri = constructor.split('\n').length
    expect(randuri).toBeGreaterThan(900)
  })

  // (Testul „scara de modele conține schimbarea PR #613" a fost ȘTERS, 3 aug —
  // scara de modele OpenRouter a fost extirpată cu totul din constructor. Creierul
  // constructorului e acum un model LOCAL Ollama de pe VPS, deci nu mai există nici
  // MODELE_DOVEDIT_PROASTE, nici creier prin app.)

  it('bucățile mari ale constructorului sunt toate acolo', () => {
    // A coarse but real check: if the file were maimed again, at least one of
    // these would be missing. (Owner 16 aug: motorul e AIDER, unic —
    // construiesteCuAider/ruleazaAider; creierul lui e un model LOCAL Ollama pe VPS,
    // pus automat de asiguraCreierulLocal. Primitivele de editare + porțile + gardul
    // de comenzi rămân biblioteca casei.)
    for (const bucata of ['function toolWrite', 'function toolEdit', 'construiesteCuAider', 'function ruleazaAider', 'RUN_ALLOWED', 'function verificaAtelierul'])
      expect(constructor).toContain(bucata)
  })
})
