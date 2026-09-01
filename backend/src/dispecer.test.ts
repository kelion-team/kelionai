import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  iaSlotDacaLiber,
  elibereazaSlot,
  asteaptaLaCoada,
  noteazaEsuare,
  stareDispecer,
} from './services/dispecer.js'

// ── THE DISPATCHER (Adrian, Aug 1: „ce se întâmplă când vor fi zeci sau
// sute de useri? … să scaleze pe o pungă comună") ────────────────────────────
// Real unit tests over the pure service (no DB, no network): the per-model
// slot limit, the per-minute pacing, the fair queue with timeout, the purse
// threshold, the telemetry — plus the source guard that chat.ts actually
// WIRES the dispatcher (a service nobody calls is a decoration).

let modelSeq = 0
const modelNou = (): string => `test-model-${++modelSeq}`

describe('per-model concurrency + pacing', () => {
  it('refuses the 7th simultaneous call on the same model', () => {
    const m1 = modelNou()
    const m2 = modelNou()
    for (let i = 0; i < 6; i++) expect(iaSlotDacaLiber(m1)).toBe(true)
    expect(iaSlotDacaLiber(m1)).toBe(false)
    // …but another model is untouched.
    expect(iaSlotDacaLiber(m2)).toBe(true)
  })

  it('a release frees the slot immediately', () => {
    const model = modelNou()
    for (let i = 0; i < 6; i++) iaSlotDacaLiber(model)
    expect(iaSlotDacaLiber(model)).toBe(false)
    elibereazaSlot(model)
    expect(iaSlotDacaLiber(model)).toBe(true)
  })

  it('refuses more than 18 starts in the same minute (pacing)', () => {
    const model = modelNou()
    for (let i = 0; i < 18; i++) {
      expect(iaSlotDacaLiber(model)).toBe(true)
      elibereazaSlot(model) // instant calls — the MINUTE window still counts them
    }
    expect(iaSlotDacaLiber(model)).toBe(false)
  })

  it('releasing an unknown model never throws and never goes negative', () => {
    expect(() => elibereazaSlot(modelNou())).not.toThrow()
  })
})

describe('the fair queue', () => {
  it('a waiting turn gets the slot the moment it frees up', async () => {
    const model = modelNou()
    for (let i = 0; i < 6; i++) iaSlotDacaLiber(model)
    const waiting = asteaptaLaCoada(async () => [model], new Set(), 3000)
    setTimeout(() => elibereazaSlot(model), 50)
    const got = await waiting
    expect(got).toBe(model)
    // …and the slot arrives HELD (the queue took it for us).
    expect(stareDispecer().peModele[model]).toBe(6)
  })

  it('returns null after the timeout when nothing frees up', async () => {
    const model = modelNou()
    for (let i = 0; i < 6; i++) iaSlotDacaLiber(model)
    const got = await asteaptaLaCoada(async () => [model], new Set(), 300)
    expect(got).toBeNull()
  })

  it('skips models already tried and takes the first free untried candidate', async () => {
    const m1 = modelNou()
    const m2 = modelNou()
    for (let i = 0; i < 6; i++) iaSlotDacaLiber(m1)
    const got = await asteaptaLaCoada(async () => [m1, m2], new Set([m1]), 500)
    // m1 is BOTH tried and busy — m2 must serve.
    expect(got).toBe(m2)
  })
})

// Nu există o pungă secundară sau un furnizor alternativ; coada deservește
// numai treptele OpenAI configurate.

describe('failure memory (Adrian: timpii sunt exceptionali de mari)', () => {
  it('sick models show up in the telemetry', () => {
    const before = stareDispecer().bolnavi
    noteazaEsuare(modelNou())
    noteazaEsuare(modelNou())
    expect(stareDispecer().bolnavi).toBe(before + 2)
  })
})

describe('telemetry', () => {
  it('stareDispecer reports in-flight per model + the queue', () => {
    const m1 = modelNou()
    const m2 = modelNou()
    iaSlotDacaLiber(m1)
    iaSlotDacaLiber(m1)
    iaSlotDacaLiber(m2)
    const s = stareDispecer()
    expect(s.peModele[m1]).toBe(2)
    expect(s.peModele[m2]).toBe(1)
    expect(typeof s.coada).toBe('number')
  })
})

// ── THE WIRING GUARD ─────────────────────────────────────────────────────────
// The dispatcher must be called from the brain loop in chat.ts — slots taken
// before every brain attempt, released on EVERY path, the queue consulted
// when the model is busy.
// Gardurile de mai jos pinuiează reîncercările pe treptele OpenAI configurate,
// apoi mesajul neutru.
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('chat.ts chiar folosește dispecerul OpenAI', () => {
  it('ia slot înainte de încercarea creierului — pe modelul EFECTIV (escaladarea ask_brain mută rundele pe alt model; slotul trebuie să-l urmeze, registrul backend #1)', () => {
    expect(chat).toMatch(/const modelEfectiv = \(\): string => escaladare\.model \|\| orchestratorModel/)
    expect(chat).toMatch(/const modelIncercare = modelEfectiv\(\)/)
    expect(chat).toMatch(/iaSlotDacaLiber\(modelIncercare\)/)
  })
  it('eliberează slotul pe orice drum (finally)', () => {
    expect(chat).toMatch(/finally \{\s*elibereazaSlot\(slotTinut\)/)
  })
  it('coada e consultată când modelul este ocupat — pe același model efectiv', () => {
    expect(chat).toMatch(/asteaptaLaCoada\(async \(\) => \[modelIncercare\]/)
    // …și plasa (profund↔rapid) tot pe modelul efectiv își ia slotul.
    expect(chat).toMatch(/asteaptaLaCoada\(async \(\) => \[modelPlasa\]/)
  })
  it('nu există pool sau rezervă de provider paralel', () => {
    expect(chat).not.toMatch(/listaCandidati|rezervaDeschisa|adaugaLaRezerva|getCatalog/)
  })
  it('un răspuns gol sau o eroare se notează (telemetrie) pe modelul VINOVAT — cel efectiv la momentul eșecului, nu cel de pornire', () => {
    expect(chat).toMatch(/const modelVinovat = modelEfectiv\(\)/)
    expect(chat).toMatch(/noteazaEsuare\(modelVinovat\)/)
    // Telemetria nu mai are voie să dea vina pe modelul de PORNIRE.
    expect(chat).not.toMatch(/noteazaEsuare\(orchestratorModel\)/)
    expect(chat).not.toMatch(/noteazaEsuare\(modelIncercare\)/)
  })
  it('profundul epuizat NU se re-încearcă tot pe profund — cade pe o față rapidă REALĂ (a treia treaptă modelRapidDirect pe turele grele, unde plasa veche era moartă)', () => {
    expect(chat).toMatch(/modelEfectiv\(\) === profund/)
    expect(chat).toMatch(/PROFUNDUL EPUIZAT/)
    expect(chat).toMatch(/orchestratorModel !== profund \? orchestratorModel : modelRapidDirect\(\)/)
  })
  it('fapta CU EFECT EXTERN deja executată oprește orice reluare completă a turei (registrul backend #2) — și bucla, și plasele', () => {
    expect(chat).toMatch(/let faptaInIncercareEsuata = false/)
    // Contorul este doar pe uneltele cu efect extern; citirile măsurate rămân
    // reluabile, iar ask_brain nu este tratat ca efect extern.
    expect(chat).toMatch(/const unelteLaStart = unelteEfectIncercate\.length/)
    expect(chat).toMatch(/const eUnealtaCuEfectExtern = \(nume: string\): boolean =>\s*grupaExecutieUnealta\(nume\) === 'efect' && nume !== 'ask_brain' && !UNELTE_AFISAJ\.has\(nume\)/)
    expect(chat).toMatch(/const efectExtern = eUnealtaCuEfectExtern\(name\)[\s\S]{0,120}if \(efectExtern\) \{\s*unelteEfectIncercate\.push\(name\)/)
    // ARMAREA + break-ul (contra-exemplul CE-1 al verificatorului: fără astea,
    // flag-ul e veșnic false și toate celelalte lacăte rămân verzi degeaba).
    expect(chat).toMatch(/if \(!r && unelteEfectIncercate\.length > unelteLaStart\) \{\s*faptaInIncercareEsuata = true\s*break\s*\}/)
    // ambele plase citesc flag-ul
    const plaseGardate = chat.match(/!faptaInIncercareEsuata/g) ?? []
    expect(plaseGardate.length).toBeGreaterThanOrEqual(2)
  })
  it('UNELTE_AFISAJ are EXACT cei 5 membri de afișare (mutantul M2; click_monitor SCOS 22 aug — apasă elemente reale; goleste_monitorul MUTAT 22 aug la FAPTE — vânătorul a măsurat că poarta acțiunii îi prescria modelului refuzul „oprește-l manual")', () => {
    expect(chat).toMatch(/const UNELTE_AFISAJ = new Set\(\[\s*'show_document', 'show_on_screen', 'open_app_view',\s*'zoom_monitor', 'arata_pe_grafic',\s*\]\)/)
    expect(chat).not.toMatch(/UNELTE_AFISAJ = new Set\(\[[^\]]*'click_monitor'/)
    expect(chat).not.toMatch(/UNELTE_AFISAJ = new Set\(\[[^\]]*'goleste_monitorul'/)
    // ...și golirea e pe lista rundei forțate (unealta chemabilă pe acțiune):
    expect(chat).toMatch(/'goleste_monitorul',\s*\]\.filter\(\(n\) => toolNamesThisTurn\.has\(n\)\)/)
  })
  it('plasele nu ricoșează una în alta (F4): profund→rapid armează plasaRulata, iar plasa oglindită o respectă', () => {
    expect(chat).toMatch(/let plasaRulata = false/)
    expect(chat).toMatch(/plasaRulata = true/)
    expect(chat).toMatch(/!faptaInIncercareEsuata && !plasaRulata && config\.modelCreierProfund/)
  })
  it('modelIncercare se calculează ÎN buclă, la fiecare încercare (CE-3: mutat înaintea buclei, escaladarea din mijloc ar lăsa slotul pe modelul de la start)', () => {
    expect(chat).toMatch(/for \(let attempt = 0; attempt < MAX_INCERCARI_MODEL && !r; attempt\+\+\) \{[\s\S]{0,400}const modelIncercare = modelEfectiv\(\)/)
  })
  it('treapta a treia chiar ÎNCEARCĂ plasa, nu doar loghează (CE-4)', () => {
    expect(chat).toMatch(/PROFUNDUL EPUIZAT[\s\S]{0,200}await incearcaPlasa\(\)/)
  })
  it('la epuizarea încercărilor tura se încheie ONEST (mesajul neutru din catch), nu pe alt creier', () => {
    expect(chat).toMatch(/brain_openai_exhausted/)
    expect(chat).toMatch(/Încearcă din nou în câteva secunde\./)
  })
})
