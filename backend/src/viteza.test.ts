import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { alegeModelOrchestrator } from './services/chatModelPolicy.js'

// ── VITEZA — garanțiile misiunii de latență (2 aug) ─────────────────────────
// Garda păstrează o singură execuție secvențială, fără o cursă care așteaptă
// inutil mai mulți concurenți și fără dublarea efectelor de unealtă.

const chat = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')
const orchestrator = readFileSync(new URL('./services/orchestrator.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')

describe('viteza — reparațiile măsurate rămân în sursă', () => {
  it('cursa pe mai mulți concurenți nu mai există (nu are pe cine să alerge)', () => {
    expect(chat).not.toContain('primulCastigator')
    expect(chat).not.toMatch(/Promise\.all\(curse\)/)
  })

  it('politica păstrează modelul deja ales de ladder, fără selector paralel', () => {
    const baza = { modelChat: 'openai/gpt-test-fast', modelProfund: 'openai/gpt-test-heavy' }
    expect(alegeModelOrchestrator({ ...baza, creierDublu: false, turaGrea: true })).toBe(baza.modelChat)
    expect(alegeModelOrchestrator({ ...baza, creierDublu: true, turaGrea: false })).toBe(baza.modelChat)
    expect(alegeModelOrchestrator({ ...baza, creierDublu: true, turaGrea: true })).toBe(baza.modelChat)
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
    // Gardul nou din condiție (registrul backend #2): plasa nu mai reia tura
    // dacă încercarea eșuată a apucat să cheme unelte (efectele s-ar dubla).
    expect(chat).toMatch(/if \(!r && !textFlowed && !faptaInIncercareEsuata && orChatModel && orChatModel !== orchestratorModel\)/)
  })

  it('identificatorii de model vin exclusiv din env validat', () => {
    expect(config).toContain('OPENAI_LUNA_MODEL')
    expect(config).toContain('OPENAI_MEDIUM_MODEL')
    expect(config).toContain('OPENAI_HEAVY_MODEL')
    expect(config).not.toMatch(/luna:\s*['"]gpt-/)
    expect(chat).not.toContain('model_choice:')
    expect(chat).not.toMatch(/startsWith\(['"]openai\//)
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
