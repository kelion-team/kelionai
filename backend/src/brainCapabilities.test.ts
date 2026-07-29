import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES,
  allCapabilityNames,
  chatCapabilityNames,
  voiceCapabilityNames,
  dormantOnVoice,
  dormantOnChat,
} from './services/brainCapabilities.js'
import { VOICE_TOOL_NAMES } from './services/realtime.js'

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

  // OGLINDA REALITĂȚII: skill-urile Google din registru (cele marcate voce) TREBUIE
  // să fie EXACT setul real de nume-voce din serviciul de voce. Dacă cineva scoate
  // un skill din voce fără să atingă registrul, testul cade — nu se adoarme tăcut.
  it('skill-urile Google din registru == setul real de nume-voce (realtime.ts)', () => {
    const googleVoiceFromRegistry = CAPABILITIES.filter((c) => c.category === 'google' && c.voice)
      .map((c) => c.name)
      .sort()
    const runtime = [...VOICE_TOOL_NAMES].sort()
    expect(googleVoiceFromRegistry).toEqual(runtime)
  })

  // STAREA MĂSURATĂ AZI — orice schimbare a suprafeței creierului trebuie să treacă
  // pe AICI (altfel testul cade), deci registrul nu poate rămâne în urmă.
  it('numărul de capabilități pe fiecare cale e cel documentat', () => {
    expect(chatCapabilityNames().length).toBe(61) // chatul = creierul complet
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
