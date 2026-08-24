import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── KELION EXECUTĂ, NU FABULEAZĂ (owner, 13 aug 2026) ──────────────────────────
//
// Plângerea, verbatim: „kelion nu execută nimic … doar e un papagal … numai
// fabulă". Cauza măsurată: modelul era pe mod AUTO peste tot și putea răspunde cu
// un card afișat (`show_document`) în loc să cheme o unealtă de execuție; gărzile
// se dezarmau la ORICE apel de unealtă, deci nu deosebeau „am afișat" de „am făcut".
//
// Ordinul: „îl scoți de pe auto, îl pui pe obligatoriu să cheme unealta CORECTĂ,
// auto-armare când apare o acțiune/cerință; gărzile să deosebească afișare de faptă."
// Frontend-ul n-are runner; citim sursa de aici, ca poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const orch = sursa('./services/orchestrator.ts')
const chat = sursa('./routes/chat.ts')
const responses = sursa('./services/openaiResponses.ts')

describe('AFIȘARE ≠ FAPTĂ: gărzile se uită la execuție, nu la „a chemat ceva"', () => {
  it('orchestratorul urmărește separat uneltele de FAPTĂ (nu doar afișare)', () => {
    expect(orch).toMatch(/let anyFaptaToolCalled = false/)
    // marcheazaChemata pune anyFaptaToolCalled DOAR dacă unealta nu e de afișaj.
    expect(orch).toMatch(/if \(!afisaj\.has\(name\)\) anyFaptaToolCalled = true/)
  })

  it('poarta faptei și poarta analizei se declanșează pe !anyFaptaToolCalled', () => {
    expect(orch).toMatch(/!deedGateUsed &&\s*\n\s*!anyFaptaToolCalled/)
    expect(orch).toMatch(/!analizaGateUsed &&\s*\n\s*!anyFaptaToolCalled/)
    // Mesajul spune clar că afișarea nu e execuție.
    expect(orch).toMatch(/show_document\) NU e execuție/)
  })
})

describe('POARTA ACȚIUNII: tura de acțiune nu se închide fără o unealtă de faptă', () => {
  it('există și e independentă de text (prinde și cardul fabricat, tăcut)', () => {
    expect(orch).toMatch(/POARTA ACȚIUNII/)
    expect(orch).toMatch(/opts\.actiuneCeruta && !actiuneGateUsed && !anyFaptaToolCalled/)
    expect(orch).toMatch(/let actiuneGateUsed = false/)
  })
  it('cere execuția reală, nu un card „în lucru"', () => {
    const bloc = /POARTA ACȚIUNII[\s\S]*?continue\r?\n/.exec(orch)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
    expect(bloc).toMatch(/build_software/)
    expect(bloc).toMatch(/nu inventa un card/)
  })
})

describe('FORȚARE îngustă: obligat la o unealtă de EXECUȚIE pe turele de acțiune', () => {
  it('chat armează forțarea DOAR pe acțiunile ownerului (nu hardcodat false)', () => {
    expect(chat).toMatch(/const forteazaFapta = isAdmin && cereActiune/)
    expect(chat).toMatch(/forceToolsFirstRound: forteazaFapta/)
    expect(chat).not.toMatch(/forceToolsFirstRound: false/)
  })
  it('forțarea e restrânsă la uneltele de FAPTĂ, niciodată la afișare', () => {
    expect(chat).toMatch(/forceToolNames: UNELTE_FAPTA/)
    expect(chat).toMatch(/const UNELTE_AFISAJ = new Set\(/)
    expect(chat).toMatch(/'show_document'/)
    expect(chat).toMatch(/const UNELTE_FAPTA = \[/)
    expect(chat).toMatch(/'build_software'/)
    expect(chat).toMatch(/uneltAfisaj: UNELTE_AFISAJ/)
    expect(chat).toMatch(/actiuneCeruta: forteazaFapta/)
  })
  it('adaptorul Responses aplică allowedFunctionNames pe modul required', () => {
    expect(responses).toMatch(/const allowed = hasExplicitAllowlist \? new Set\(opts\.allowedFunctionNames\) : null/)
    expect(responses).toContain('openai_required_tool_allowlist_empty')
    expect(orch).toMatch(/const allowedFunctionNames =\s*\n\s*toolChoice === 'required'/)
  })
})

describe('anti-deflectare judecă pe uneltele CHEMATE, nu pe cele oferite', () => {
  it('folosește cand.toolsCalled, nu toolNamesThisTurn', () => {
    expect(orch).toMatch(/toolsCalled: string\[\]/)
    expect(chat).toMatch(/aAlocatConstructie\(new Set\(cand\.toolsCalled\)\)/)
  })
})
