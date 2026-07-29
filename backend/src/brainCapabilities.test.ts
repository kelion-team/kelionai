import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CAPABILITIES,
  allCapabilityNames,
  chatCapabilityNames,
  voiceCapabilityNames,
  dormantOnVoice,
  dormantOnChat,
} from './services/brainCapabilities.js'
import { VOICE_TOOL_NAMES } from './services/realtime.js'
import { googleTools } from './services/google.js'
import { RUNBOOKS } from './services/runbooks.js'

// PAZNICUL DE COMPLETITUDINE (CREIER UNIC §5). Adrian: „dacă nu înmagazinează
// REAL tot ce are softul, nu are rost". Testul apără sursa unică: să rămână
// adevărată față de realitate și să nu se adoarmă nimic pe ascuns.
describe('brainCapabilities — registrul unic e adevărat', () => {
  it('nu are nume duplicate', () => {
    const names = allCapabilityNames()
    expect(new Set(names).size).toBe(names.length)
  })

  it('fiecare capabilitate e completă (nume + does + măcar o cale)', () => {
    for (const c of CAPABILITIES) {
      expect(c.name, 'nume gol').toBeTruthy()
      expect(c.does, `does gol la ${c.name}`).toBeTruthy()
      expect(c.chat || c.voice, `${c.name} nu e pe nicio cale`).toBe(true)
    }
  })

  // SURSĂ UNICĂ (§1): vocea DERIVĂ acum din registru (realtime.ts). Verificăm
  // registrul față de lista CANONICĂ a celor 18 skill-uri Google de voce — și că
  // derivarea produce exact setul canonic. Dacă cineva schimbă registrul pe
  // ascuns, testul cade; nimic nu se adoarme tăcut.
  it('skill-urile Google pe voce = cele 18 canonice, dintr-o singură sursă', () => {
    const canonic = [
      'add_contact', 'add_task', 'convert_currency', 'create_calendar_event', 'get_calendar_events',
      'get_drive_files', 'get_recent_emails', 'get_tasks', 'get_time', 'get_weather',
      'maps_directions', 'maps_search', 'search_contacts', 'send_email', 'translate_text',
      'web_search', 'wikipedia_lookup', 'youtube_search',
    ].sort()
    const dinRegistru = CAPABILITIES.filter((c) => c.category === 'google' && c.voice).map((c) => c.name).sort()
    expect(dinRegistru).toEqual(canonic)
    // VOICE_TOOL_NAMES (realtime.ts) derivă din registru → trebuie să fie identic.
    expect([...VOICE_TOOL_NAMES].sort()).toEqual(canonic)
  })

  // COMPLETITUDINE FAȚĂ DE REALITATE (§5): registrul nu se verifică doar pe el
  // însuși, ci față de SURSELE REALE. Dacă în google.ts apare/dispare un skill
  // fără să atingă registrul, testul cade — creierul nu poate avea o rută
  // ne-înregistrată, nici registrul o rută inexistentă.
  it('categoria google din registru == skill-urile Google REALE (google.ts)', () => {
    const realGoogle = googleTools.map((t) => t.name).sort()
    const registruGoogle = CAPABILITIES.filter((c) => c.category === 'google').map((c) => c.name).sort()
    expect(registruGoogle).toEqual(realGoogle)
  })

  // HANDLER REAL PENTRU FIECARE CAPABILITATE DE CHAT (întărirea paznicului, audit
  // 29 iul, risc #5): înainte, paznicul verifica realitatea DOAR pe suprafața
  // google; un rând nou în registru, în afara google, fără handler în chat.ts ar
  // fi trecut verde („adormit ascuns"). Acum: fiecare capabilitate de chat TREBUIE
  // să aibă un `case '<nume>'` în runTool (chat.ts), SAU să fie skill Google (rutat
  // prin runGoogleTool), SAU una din cele interceptate ÎNAINTE de runTool (execTool).
  it('fiecare capabilitate de CHAT are un handler real în chat.ts (nu doar în registru)', () => {
    const chatSrc = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
    const cases = new Set([...chatSrc.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]))
    const google = new Set(googleTools.map((t) => t.name))
    // Interceptate în execTool ÎNAINTE de runTool (nu sunt `case`): raționamentul
    // greu și auto-propunerea de unealtă.
    const special = new Set(['ask_brain', 'propose_tool'])
    const areHandler = (n: string): boolean => cases.has(n) || google.has(n) || special.has(n)
    const orfane = chatCapabilityNames().filter((n) => !areHandler(n))
    expect(orfane, `capabilități de chat FĂRĂ handler în chat.ts (adormite): ${orfane.join(', ')}`).toEqual([])
  })

  it('runbook-urile reale (runbooks.ts) sunt acoperite prin run_runbook în registru', () => {
    // Cele 8 runbook-uri se cheamă prin unealta run_runbook — care TREBUIE să
    // existe în registru cât timp există runbook-uri reale.
    expect(Object.keys(RUNBOOKS).length).toBeGreaterThan(0)
    expect(allCapabilityNames()).toContain('run_runbook')
  })

  // STAREA MĂSURATĂ AZI — orice schimbare a suprafeței creierului trebuie să treacă
  // pe AICI (altfel testul cade), deci registrul nu poate rămâne în urmă.
  it('numărul de capabilități pe fiecare cale e cel documentat', () => {
    expect(chatCapabilityNames().length).toBe(66) // chatul = creierul complet (+read_inbox +read_email +delete_calendar_event +complete_task +read_drive_file)
    expect(voiceCapabilityNames().length).toBe(31) // vocea = plafon OpenAI Realtime (măsurat)
  })

  // Doar cele 3 unelte de vedere (cameră/monitor/GPS) sunt native pe voce și nu pe
  // chat (chatul vede inline). Restul „adormirii" e pe voce — ținta §1/§6 = 0.
  it('adormirea e enumerată explicit, niciodată ascunsă', () => {
    expect(dormantOnChat().map((c) => c.name).sort()).toEqual(['get_location', 'get_monitor', 'look'])
    // Azi vocea nu ajunge la ~33 de rute ale chatului (cod/browser/memorie/bani).
    // Le expunem ca listă de dus mai departe, nu ca secret.
    expect(dormantOnVoice().length).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log(`[completitudine] adormite pe voce (de dus în §1/§6): ${dormantOnVoice().map((c) => c.name).join(', ')}`)
  })
})
