import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { alegeModelOrchestrator } from './services/chatModelPolicy.js'

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

  it('politica de model urcă pe Gemini profund doar pe tura grea cu creier dublu', () => {
    const baza = { modelChat: 'google-direct/gemini-2.5-flash', modelProfund: 'gemini-2.5-pro' }
    expect(alegeModelOrchestrator({ ...baza, creierDublu: false, turaGrea: true })).toBe(baza.modelChat)
    expect(alegeModelOrchestrator({ ...baza, creierDublu: true, turaGrea: false })).toBe(baza.modelChat)
    expect(alegeModelOrchestrator({ ...baza, creierDublu: true, turaGrea: true })).toBe('google-direct/gemini-2.5-pro')
    expect(chat).toContain('let orchestratorModel = alegeModelOrchestrator({')
    expect(chat).toMatch(/runOrchestrator\(\s*orchestratorModel/)
  })

  it('creierul profund are PLASĂ: dacă se epuizează, tura cade pe fața rapidă (nu moare)', () => {
    // owner, 13 aug: „e urgent ca kelion să lucreze real" — profundul (Pro) e mai
    // deștept dar mai expus la rate-limit; dacă se epuizează ȘI nimic n-a curs la
    // om, cădem O DATĂ pe flash (orChatModel), ca turele de execuție să nu moară pe
    // mesajul neutru. Rulează doar pe calea deja pierdută (`!r && !textFlowed`).
    expect(chat).toMatch(/CREIER PROFUND EPUIZAT/)
    expect(chat).toMatch(/orchestratorModel = orChatModel/)
    expect(chat).toMatch(/if \(!r && !textFlowed && orChatModel && orChatModel !== orchestratorModel\)/)
  })

  it('creierul de LUCRU = Gemini direct (regula lui Adrian, 3 aug; măsurat 1,2s + 1,0s cu apel de unealtă corect)', () => {
    // Adrian, 3 aug: „creierul de LUCRU e Gemini PERMANENT"; 5 aug: „peste tot
    // modelul avansat"; 6 aug (ultra-decis): un SINGUR model unic, sigilat, FĂRĂ
    // env — toate treptele = getteri pe sursa unică (modelUnicDirect).
    expect(config).toMatch(/get workDefault\(\)/)
    expect(config).toMatch(/modelUnicDirect\(\)/)
    expect(config).not.toContain('BRAIN_WORK_MODEL')
  })

  it('uneltele dintr-o rundă pleacă ÎN PARALEL, cu rezultatele în ordinea apelurilor', () => {
    // Refactorat: paralelizarea coordonată e în helperul `executaApeluriCoordonate`
    // (Promise.all pe apeluri, serializare doar pe grup), chemat pe uneltele rundei.
    // Feature-ul e ACELAȘI (paralel + rezultate în ordinea apelurilor); forma, mai curată.
    expect(orchestrator).toMatch(/Promise\.all\(apeluri\.map\(/) // rulare în paralel
    expect(orchestrator).toMatch(/executaApeluriCoordonate\([\s\S]{0,60}res\.toolCalls/) // pe uneltele rundei
    // Ordinea rezultatelor = ordinea apelurilor (conversația e identică cu calea serială).
    expect(orchestrator).toMatch(/res\.toolCalls\[i\]\.id, iesiri\[i\]/)
  })

  it('profilingul e cablat: durata fiecărei runde de creier ajunge în jurnal', () => {
    expect(orchestrator).toContain('[TIMP]')
    expect(chat).toContain('[TIMP] tura')
  })
})
