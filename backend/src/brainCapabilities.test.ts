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
      expect(c.chat || c.voice || c.voiceViaBrain, `${c.name} nu e pe nicio cale`).toBe(true)
    }
  })

  // ONE BRAIN (Aug 1): the Realtime session holds ZERO tools by design — it is
  // ears+mouth only, so the old 31-tool ceiling is gone. EVERY capability is
  // reachable by voice through the ONE brain (/api/chat): voiceViaBrain mirrors
  // chat. If someone marks a chat capability as unreachable by voice, the test
  // falls — parity can't silently break.
  it('vocea ajunge la TOT prin creierul unic; lista directă e goală by design', () => {
    expect(voiceCapabilityNames()).toEqual([])
    const faraVoce = chatCapabilityNames().filter(
      (n) => !CAPABILITIES.find((c) => c.name === n)?.voiceViaBrain,
    )
    expect(faraVoce, `capabilități de chat NEaccesibile vorbind: ${faraVoce.join(', ')}`).toEqual([])
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
    // reasoning, tool self-proposal, și citirea monitorului (10 aug — conținutul
    // ecranului vine din corpul cererii, se întoarce înainte de runTool).
    const special = new Set(['ask_brain', 'propose_tool', 'get_monitor', 'click_monitor', 'zoom_monitor', 'get_mouse_position', 'arata_pe_grafic'])
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
    expect(chatCapabilityNames().length).toBe(101) // 11 aug: +episoade_promo (jurnalul seriei de clipuri — ce a filmat, unde a rămas). 10 aug: +arata_pe_grafic (pointeri de indicație pe graficul de trading). 10 aug: +cauta_istoric (accesul lui Kelion la istoricul complet de chat). 10 aug: +click_monitor, +zoom_monitor, +get_mouse_position. 10 aug: +agent_nou, +get_monitor, +goleste_monitorul (perechea lui get_monitor), +ruleaza_portile/jurnal_masuratori/vaneaza_buguri (suita de măsurare), +constructor_command (canalul de comandă construit de constructor, PR #966). 5 aug: +12 unelte legate la creier.
    expect(voiceCapabilityNames().length).toBe(0) // 1 aug: sesiunea de voce = urechi+gură, ZERO unelte directe
  })

  // AUG 1: the 3 vision tools (camera/monitor/GPS) are no longer voice-native
  // either — voice reaches them through the SAME body context as writing
  // (camera frames / coords / screen go with the turn). Nothing is dormant
  // anywhere; both lists stay empty and any regression goes RED.
  it('adormirea e enumerată explicit, niciodată ascunsă', () => {
    expect(dormantOnChat().map((c) => c.name)).toEqual([])
    expect(dormantOnVoice().map((c) => c.name)).toEqual([])
  })
})
