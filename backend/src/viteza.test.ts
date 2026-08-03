import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// ── VITEZA — garanțiile misiunii de latență (2 aug) ─────────────────────────
// Măsurat live și prin probă directă (detaliile în config.ts și services/cursa.ts):
//   • cursa modelelor ușoare aștepta TOȚI concurenții (Promise.all) → 18,6s
//     la o tură de chit-chat, deși gemini-direct răspunsese în 2-4s;
//   • tura cu unelte (vremea) pornea pe gemma-4-26b:free → 22s + 37s pe
//     payload-ul real, uneori gol după 70s → cei ~38s ai ownerului;
//   • gemini-direct: 1,2s + 1,0s cu apelul de unealtă CORECT, pe același payload.
// Aici stă garda de sursă: reparațiile măsurate să nu dispară la un refactor.
// (3 aug: cursa și pool-ul OpenRouter au fost extirpate — vezi mai jos.)

const chat = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')
const orchestrator = readFileSync(new URL('./services/orchestrator.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')

describe('viteza — reparațiile măsurate rămân în sursă', () => {
  // (3 aug — extirparea OpenRouter: cursa pe 3 modele a dispărut cu tot cu
  // pool-ul de concurenți; garanția de viteză e acum creierul Gemini unic pe
  // TOATE turele — 1,2s + 1,0s măsurat pe payload-ul real.)
  it('cursa pe mai mulți concurenți nu mai există (nu are pe cine să alerge)', () => {
    expect(chat).not.toContain('primulCastigator')
    expect(chat).not.toMatch(/Promise\.all\(curse\)/)
  })

  it('toate turele merg pe creierul Gemini (google-direct), cu unelte', () => {
    expect(chat).toMatch(/const orchestratorModel = orChatModel/)
    expect(chat).toMatch(/runOrchestrator\(\s*orchestratorModel/)
  })

  it('creierul de LUCRU = Gemini direct (regula lui Adrian, 3 aug; măsurat 1,2s + 1,0s cu apel de unealtă corect)', () => {
    // Adrian, 3 aug: „creierul de LUCRU e Gemini PERMANENT". Turele trec prin
    // orchestrator, care acceptă DOAR prefixul google-direct/ și le duce la
    // geminiDirect CU unelte (orchestrator.ts).
    expect(config).toContain(
      "BRAIN_WORK_MODEL ?? 'google-direct/gemini-2.5-flash'",
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
