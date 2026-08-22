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
// The active `repo_write` path requires the COMPLETE content and therefore
// keeps the truncation guard. The constructor now delegates file editing to
// Aider and validates its committed diff; its old local `toolWrite` path no
// longer exists and must not be kept merely to duplicate this guard.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const backend = sursa('./services/github.ts')

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

// (Blocul „agentul constructor rămâne complet" a fost ȘTERS pe 22 aug, odată
// cu fișierul păzit: deploy/constructor-agent.mjs nu mai există — ownerul a
// ordonat ștergerea integrală a mașinăriei locale; constructorul e DEVIN.
// Garda anti-ciuntire de pe repo_write — calea vie — rămâne sub test mai sus.)
