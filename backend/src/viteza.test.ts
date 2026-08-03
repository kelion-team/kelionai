import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// ── VITEZA — garanțiile misiunii de latență (2 aug) ─────────────────────────
// Măsurat live și prin probă directă (detaliile în config.ts și services/cursa.ts):
//   • cursa modelelor ușoare aștepta TOȚI concurenții (Promise.all) → 18,6s
//     la o tură de chit-chat, deși gemini-direct răspunsese în 2-4s;
//   • tura cu unelte (vremea) pornea pe gemma-4-26b:free → 22s + 37s pe
//     payload-ul real, uneori gol după 70s → cei ~38s ai ownerului;
//   • gemini-direct: 1,2s + 1,0s cu apelul de unealtă CORECT, pe același payload.
// Testele de comportament real sunt în services/cursa.test.ts (primul
// câștigător) și services/openrouter.test.ts (default-ul de work măsurat).
// Aici stă garda de sursă: cele trei reparații să nu dispară la un refactor.

const chat = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')
const orchestrator = readFileSync(new URL('./services/orchestrator.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')

describe('viteza — reparațiile măsurate rămân în sursă', () => {
  it('cursa se închide la PRIMUL câștigător, nu după cel mai lent concurent', () => {
    expect(chat).toContain('primulCastigator(curse)')
    // Interzis înapoi: așteptarea tuturor concurenților era chiar defectul.
    expect(chat).not.toMatch(/Promise\.all\(curse\)/)
  })

  it('calea ușoară CU unelte pornește pe gemini-direct (măsurat 1,2s + 1,0s)', () => {
    expect(chat).toContain('GEMINI_DIRECT_PREFIX}${config.geminiModel}')
    expect(chat).toMatch(/!heavyTurn && geminiDirectAvailable\(\)/)
  })

  it('creierul de LUCRU = Gemini direct free (regula lui Adrian, 3 aug; măsurat 1,2s + 1,0s cu apel de unealtă corect)', () => {
    // Adrian, 3 aug: „creierul de LUCRU e Gemini free PERMANENT". Turele grele
    // trec prin orchestrator, care detectează prefixul google-direct/ și le duce
    // la geminiDirect CU unelte (orchestrator.ts) — măsurat mai rapid și cu apel
    // de unealtă corect față de nemotron (6s + 3,2s). nemotron rămâne pe treapta
    // „top" (topDefault), ca rezervă de escaladare.
    expect(config).toContain(
      "OPENROUTER_WORK_MODEL ?? 'google-direct/gemini-2.5-flash'",
    )
  })

  it('uneltele dintr-o rundă pleacă ÎN PARALEL, cu rezultatele în ordinea apelurilor', () => {
    expect(orchestrator).toMatch(/Promise\.all\(\s*\(res\.toolCalls/)
    // Ordinea rezultatelor = ordinea apelurilor (conversația e identică cu calea serială).
    expect(orchestrator).toContain('iesiri[i]')
  })

  it('profilingul e cablat: durata fiecărei runde de creier ajunge în jurnal', () => {
    expect(orchestrator).toContain('[TIMP]')
    expect(chat).toContain('[TIMP] tura')
  })
})
