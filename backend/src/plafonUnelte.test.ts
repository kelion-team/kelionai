import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE PROVIDER'S 64-TOOL CEILING ───────────────────────────────────────────
// Aug 1, live incident: the chat route sent 76 tools to the provider →
// every turn died with `400: at most 64 tools are allowed` and the user saw
// only "Am întâmpinat o problemă tehnică". The fix is structural: the list is
// deduped by name (open_app_view was registered TWICE), the self-proposed
// dynamic tools fill only the slots left, and the base itself is trimmed
// under the ceiling with a loud log. This guard makes sure the ceiling can
// never silently disappear again.
const chat = readFileSync(
  fileURLToPath(new URL('./routes/chat.ts', import.meta.url)),
  'utf8',
)

describe('plafonul de unelte al furnizorului e garantat structural', () => {
  it('plafonul e AL FURNIZORULUI: 128 pe Gemini (unelte complete), 64 pe restul', () => {
    // Adrian, 3 aug: „nu are unelte complete". 64 era limita API-ului vechi
    // (OpenRouter); Gemini acceptă 128 de declarații → pe google-direct intră
    // TOT inventarul adminului. Testul pinuiește AMBELE cifre și condiția.
    // 8 aug: plafonul furnizorului a rămas EXACT ăsta, dar s-a mutat într-o
    // constantă proprie, fiindcă tura conversațională are acum plafonul ei (12).
    // Ambele cifre rămân pinuite — cea de furnizor NU are voie să scadă tăcut.
    expect(chat).toMatch(/PLAFON_FURNIZOR = orChatModel\?\.startsWith\(GEMINI_DIRECT_PREFIX\) \? 128 : 64/)
    expect(chat).toMatch(/baseTools\.slice\(0, MAX_PROVIDER_TOOLS\)/)
  })

  it('tura de LUCRU primește tot inventarul; doar cea conversațională e subțiată', () => {
    // Adrian, 8 aug: „chatul este doar chat, decizia ce unealtă se face cu
    // creierul". Tăierea la 12 e DOAR pe tura ușoară; când se cere o acțiune
    // (sau modelul escaladează), plafonul redevine cel al furnizorului.
    expect(chat).toMatch(/MAX_PROVIDER_TOOLS = turaUsoara \? PLAFON_UNELTE_USOR : PLAFON_FURNIZOR/)
    expect(chat).toMatch(/cereActiune = hasActionIntent\(lastUserText\)/)
    expect(chat).toMatch(/baseTools\.filter\(\(t\) => UNELTE_CONVERSATIE\.has\(t\.name\)\)/)
  })

  it('VERIFICAREA SISTEMULUI NU E PE TURA DE CONVERSAȚIE (8 aug: „îmi bagă 8 secunde")', () => {
    // `system_health` face 2 apeluri la GitHub (timeout 10 s) ȘI sondează
    // endpointul fiecărui buton din Admin (timeout 8 s, în paralel) — ~8 s în
    // cel mai rău caz, exact cifra reclamată de owner. N-are ce căuta pe drumul
    // unei fraze rostite. Ordinul lui, verbatim: „se scoate din chat".
    const set = /const UNELTE_CONVERSATIE = new Set\(\[([\s\S]*?)\]\)/.exec(chat)?.[1] ?? ''
    expect(set.length, 'lista de unelte pentru conversație a dispărut').toBeGreaterThan(50)
    for (const scump of [
      'system_health',
      'stare_masurata',
      'db_query',
      'db_tables',
      'constructor_status',
      'build_software',
      'repo_write',
      'repo_merge_pr',
      'run_runbook',
      'runbook_status',
      'jules_task',
      'ruleaza_portile',
      'server_logs',
    ]) {
      expect(set.includes(`'${scump}'`), `„${scump}" s-a întors pe tura de conversație — acolo costă secunde`).toBe(
        false,
      )
    }
    // …dar scara spre ele TREBUIE să existe, altfel tura ușoară e o cușcă.
    expect(set.includes("'ask_brain'"), 'fără ask_brain, ce nu e în listă nu mai poate fi cerut deloc').toBe(true)
  })

  it('lista e deduplicată pe NUME înainte de trimitere', () => {
    expect(chat).toMatch(/seenNames\.has\(t\.name\)/)
  })

  it('uneltele dinamice umplu DOAR sloturile rămase sub plafon', () => {
    expect(chat).toMatch(/for \(const t of dynTools\)[\s\S]*?tools\.length >= MAX_PROVIDER_TOOLS[\s\S]*?break/)
  })
})
