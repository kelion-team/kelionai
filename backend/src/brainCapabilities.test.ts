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
  inventarulMeu,
} from './services/brainCapabilities.js'
import { VOICE_TOOL_NAMES } from './services/realtime.js'
import { googleTools } from './services/google.js'
import { RUNBOOKS } from './services/runbooks.js'
import { SHARED_ADMIN_TOOLS, USER_SCOPED_TOOLS } from './services/adminTools.js'

// THE COMPLETENESS GUARD (SINGLE BRAIN §5). Adrian: "if it doesn't store
// REALLY everything the software has, there's no point". The test guards the
// single source: keep it true to reality and let nothing fall asleep in secret.
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

  // SINGLE SOURCE (§1): voice now DERIVES from the registry (realtime.ts). We
  // check the registry against the CANONICAL list of the 18 Google voice skills
  // — and that the derivation produces exactly the canonical set. If someone
  // changes the registry in secret, the test falls; nothing falls asleep silently.
  it('skill-urile Google pe voce = cele 18 canonice, dintr-o singură sursă', () => {
    const canonic = [
      'add_contact', 'add_task', 'convert_currency', 'create_calendar_event', 'get_calendar_events',
      'get_drive_files', 'get_recent_emails', 'get_tasks', 'get_time', 'get_weather',
      'maps_directions', 'maps_search', 'search_contacts', 'send_email', 'translate_text',
      'web_search', 'wikipedia_lookup', 'youtube_search',
    ].sort()
    const dinRegistru = CAPABILITIES.filter((c) => c.category === 'google' && c.voice).map((c) => c.name).sort()
    expect(dinRegistru).toEqual(canonic)
    // VOICE_TOOL_NAMES (realtime.ts) derives from the registry → must be identical.
    expect([...VOICE_TOOL_NAMES].sort()).toEqual(canonic)
  })

  // COMPLETENESS AGAINST REALITY (§5): the registry isn't checked only against
  // itself, but against the REAL SOURCES. If a skill appears/disappears in
  // google.ts without touching the registry, the test falls — the brain can't
  // have an unregistered route, nor the registry a nonexistent one.
  it('categoria google din registru == skill-urile Google REALE (google.ts)', () => {
    const realGoogle = googleTools.map((t) => t.name).sort()
    const registruGoogle = CAPABILITIES.filter((c) => c.category === 'google').map((c) => c.name).sort()
    expect(registruGoogle).toEqual(realGoogle)
  })

  // A REAL HANDLER FOR EVERY CHAT CAPABILITY (guard hardening, Jul 29 audit,
  // risk #5): before, the guard checked reality ONLY on the google surface; a
  // new registry row outside google with no handler in chat.ts would have passed
  // green ("hidden asleep"). Now: every chat capability MUST have a
  // `case '<name>'` in runTool (chat.ts), OR be a Google skill (routed through
  // runGoogleTool), OR one of those intercepted BEFORE runTool (execTool).
  it('fiecare capabilitate de CHAT are un handler real în chat.ts (nu doar în registru)', () => {
    const chatSrc = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
    const cases = new Set([...chatSrc.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]))
    const google = new Set(googleTools.map((t) => t.name))
    // Intercepted in execTool BEFORE runTool (they're not a `case`): heavy
    // reasoning and tool self-proposal.
    const special = new Set(['ask_brain', 'propose_tool'])
    // The SHARED admin tools (chat ∩ voice) go through the common guard before
    // the switch (execSharedAdminTool) → they no longer have a `case`, but they
    // ARE handled.
    const areHandler = (n: string): boolean =>
      // A REAL handler can be: a `case` in chat.ts, a Google tool, a special
      // one, or an executor from the COMMON source (shared with voice — single
      // dispatch, no duplication). All four are valid paths; what is in none of
      // them is truly asleep.
      cases.has(n) || google.has(n) || special.has(n) || SHARED_ADMIN_TOOLS.has(n) || USER_SCOPED_TOOLS.has(n)
    const orfane = chatCapabilityNames().filter((n) => !areHandler(n))
    expect(orfane, `capabilități de chat FĂRĂ handler în chat.ts (adormite): ${orfane.join(', ')}`).toEqual([])
  })

  // AWARE OF WHAT IT HAS (Adrian, Jul 30: "it must be aware of what it has,
  // what capabilities it has, all of them activated in its brain and directly
  // callable"). The inventory DERIVES from the registry — if someone adds a
  // capability and forgets to tell it about it, this test catches it.
  it('își cunoaște inventarul: fiecare capabilitate de chat apare în el', () => {
    const inv = inventarulMeu(true)
    const lipsa = chatCapabilityNames().filter((n) => !inv.includes(n))
    expect(lipsa, `capabilități pe care le ARE dar nu ȘTIE că le are: ${lipsa.join(', ')}`).toEqual([])
    // And it tells it plainly not to refuse what it holds in its hand.
    expect(inv).toContain('Nu ceri voie')
  })

  it('userul obișnuit nu vede în inventar uneltele de admin', () => {
    const inv = inventarulMeu(false)
    expect(inv).not.toContain('repo_merge_pr')
    expect(inv).not.toContain('secret_pune')
    expect(inv).toContain('send_email') // but the rest, yes
  })

  it('runbook-urile reale (runbooks.ts) sunt acoperite prin run_runbook în registru', () => {
    // The 8 runbooks are called through the run_runbook tool — which MUST
    // exist in the registry as long as real runbooks exist.
    expect(Object.keys(RUNBOOKS).length).toBeGreaterThan(0)
    expect(allCapabilityNames()).toContain('run_runbook')
  })

  // THE STATE MEASURED TODAY — any change to the brain's surface must pass
  // through HERE (otherwise the test falls), so the registry can't fall behind.
  it('numărul de capabilități pe fiecare cale e cel documentat', () => {
    expect(chatCapabilityNames().length).toBe(75) // + card_stare/card_completeaza/card_gata (31 iul: cardul la furnizori, gardat de voce)
    expect(voiceCapabilityNames().length).toBe(31) // vocea = plafon OpenAI Realtime (măsurat)
  })

  // Only the 3 vision tools (camera/monitor/GPS) are native on voice and not on
  // chat (chat sees inline). The rest of the "sleeping" is on voice — the §1/§6
  // target = 0.
  it('adormirea e enumerată explicit, niciodată ascunsă', () => {
    expect(dormantOnChat().map((c) => c.name).sort()).toEqual(['get_location', 'get_monitor', 'look'])
    // §1 TARGET REACHED (Jul 30): voice reaches ALL chat capabilities —
    // dormant = 0. The test was "> 0" while the list still had rows; now it is
    // a REGRESSION GUARD: if someone adds a chat-only tool, or cuts a path from
    // voice, the list becomes non-empty again and CI goes RED. "Asleep" can no
    // longer sneak in quietly — exactly the guarantee required in §5.
    expect(dormantOnVoice().map((c) => c.name)).toEqual([])
    // eslint-disable-next-line no-console
    console.log(`[completitudine] adormite pe voce (de dus în §1/§6): ${dormantOnVoice().map((c) => c.name).join(', ')}`)
  })
})
