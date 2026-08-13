import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── "I'LL ANALYSE" IS NO LONGER JUST A WORD ────────────────────────────────
//
// Adrian, Jul 31: "when it says it's going to analyse, it must FACTUALLY open
// the monitor and show what it's doing!"
//
// The deed gate (Jul 27) caught "I DID it" — a deed declared without any tool
// having been called. But the promise to LOOK at something passed unharmed:
// "I'll analyse", "let me look", "I'll check" ended the turn, sounded like
// work, and nothing happened. The person was left in front of an empty
// screen, waiting for an analysis that had never started.
//
// Now there are TWO gates, and the second doesn't just require execution —
// it requires the work to be SEEN on the monitor while it's being done.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const orch = sursa('./services/orchestrator.ts')
const chat = sursa('./routes/chat.ts')

describe('poarta analizei există și e separată de poarta faptei', () => {
  it('are propriul tipar de cuvinte și propriul întrerupător de o-singură-dată', () => {
    expect(orch).toMatch(/const ANALIZA_CLAIM_RE\s*=/)
    expect(orch).toMatch(/let analizaGateUsed = false/)
    // Execuție-conștientă (owner, 13 aug): un apel de AFIȘARE (show_document) nu
    // mai dezarmează poarta — condiția e pe `anyFaptaToolCalled`, nu pe „a chemat ceva".
    expect(orch).toMatch(/!analizaGateUsed &&\s*\n\s*!anyFaptaToolCalled/)
  })

  it('nu o înlocuiește pe cea veche — amândouă rămân active', () => {
    expect(orch).toMatch(/DEED_CLAIM_RE\.test/)
    expect(orch).toMatch(/ANALIZA_CLAIM_RE\.test/)
    expect(orch).toMatch(/POARTA FAPTEI/)
    expect(orch).toMatch(/POARTA ANALIZEI/)
  })

  it('se declanșează DOAR când n-a chemat nicio unealtă', () => {
    // If it called something, it really looked — we stop nagging it.
    const bloc = /POARTA ANALIZEI[\s\S]*?continue\r?\n/.exec(orch)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
  })
})

describe('cuvintele care erau vorbă goală sunt prinse', () => {
  // We rebuild the pattern from the source and test it FOR REAL — we don't
  // just check the regex exists, but that it catches exactly the sentences a
  // turn used to die with.
  const linia = /const ANALIZA_CLAIM_RE\s*=\s*\n?\s*(\/[\s\S]*?\/i)/.exec(orch)?.[1] ?? ''
  const re = new RegExp(linia.slice(1, linia.lastIndexOf('/')), 'i')

  const prinse = [
    'Bun, o să analizez fișierul și revin.',
    'Mă uit acum peste cod.',
    'Verific ce se întâmplă acolo.',
    'Investighez cauza.',
    'Let me look into it.',
    "I'll check the logs.",
    'Arunc o privire în jurnale.',
  ]
  for (const f of prinse) {
    it(`prinde: „${f}"`, () => expect(re.test(f)).toBe(true))
  }

  // It must not jump at everything. An answer that REALLY delivers something,
  // or a past-tense finding, has no business in the gate.
  const libere = [
    'Gata, am reparat și am pus PR-ul #612.',
    'Am analizat deja — cauza e la linia 218.',
    'Nu pot face asta: nu am acces la facturare.',
    'Rezultatul e 804.',
  ]
  for (const f of libere) {
    it(`NU prinde: „${f}"`, () => expect(re.test(f)).toBe(false))
  }
})

describe('cererea e să DESCHIDĂ MONITORUL, nu doar să execute', () => {
  it('mesajul porții cere explicit show_document', () => {
    expect(orch).toMatch(/PUNE PE MONITOR[\s\S]{0,60}show_document/)
    expect(orch).toMatch(/fișier și linie/)
  })

  it('cere și sinceritate dacă n-are cu ce să analizeze', () => {
    expect(orch).toMatch(/Dacă nu ai cu ce să analizezi, spune clar asta/)
  })

  it('regula e și în promptul lui, nu doar în poartă', () => {
    // The gate is the net. The prompt is there so we never reach the net.
    expect(chat).toMatch(/IF YOU SAY YOU WILL ANALYSE, ANALYSE — ON SCREEN/)
    expect(chat).toMatch(/call show_document FIRST/)
    expect(chat).toMatch(/call show_document AGAIN with what you FOUND/)
    expect(chat).toMatch(/Never announce an analysis you do not immediately perform and display/)
  })
})
