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
    // `ask_brain` trebuie să supraviețuiască tăierii — fără ea, ce nu încape în
    // cele 12 n-ar mai putea fi cerut deloc.
    expect(chat).toMatch(/baseTools\.filter\(\(t\) => t\.name === 'ask_brain'\)/)
  })

  it('lista e deduplicată pe NUME înainte de trimitere', () => {
    expect(chat).toMatch(/seenNames\.has\(t\.name\)/)
  })

  it('uneltele dinamice umplu DOAR sloturile rămase sub plafon', () => {
    expect(chat).toMatch(/for \(const t of dynTools\)[\s\S]*?tools\.length >= MAX_PROVIDER_TOOLS[\s\S]*?break/)
  })
})
