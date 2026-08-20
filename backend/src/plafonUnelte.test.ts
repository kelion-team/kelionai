import { describe, it, expect } from 'vitest'
import { plafonUnelteFurnizor } from './services/chatModelPolicy.js'
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
  it('plafonul e AL FURNIZORULUI: 128 pe Gemini, 64 pe orice altceva (necunoscut)', () => {
    expect(plafonUnelteFurnizor('google-direct/gemini-2.5-flash')).toBe(128)
    expect(plafonUnelteFurnizor('alt-furnizor/model-necunoscut')).toBe(64)
    expect(plafonUnelteFurnizor(null)).toBe(64)
    expect(chat).toContain('const PLAFON_FURNIZOR = plafonUnelteFurnizor(orChatModel)')
    expect(chat).toMatch(/baseTools\.slice\(0, MAX_PROVIDER_TOOLS\)/)
  })

  it('tura de LUCRU primește tot inventarul; doar cea conversațională e subțiată', () => {
    // Adrian, 8 aug: „chatul este doar chat, decizia ce unealtă se face cu
    // creierul". Tăierea la 12 e DOAR pe tura ușoară; când se cere o acțiune
    // (sau modelul escaladează), plafonul redevine cel al furnizorului.
    expect(chat).toMatch(/MAX_PROVIDER_TOOLS = turaUsoara \? PLAFON_UNELTE_USOR : PLAFON_FURNIZOR/)
    expect(chat).toMatch(/cereActiune = hasActionIntent\(lastUserText\)/)
    expect(chat).toMatch(/baseTools\.filter\(\(t\) => permisaLaVorbire\(t\.name\)\)/)
  })

  // (Testul detaliat al listei de vorbire s-a mutat în fazeChat.test.ts —
  // lista însăși s-a mutat în services/fazeChat.ts, sursa unică a fazelor.)


  it('lista e deduplicată pe NUME înainte de trimitere', () => {
    expect(chat).toMatch(/seenNames\.has\(t\.name\)/)
  })

  it('uneltele dinamice umplu DOAR sloturile rămase sub plafon — și NICIODATĂ pe tura ușoară', () => {
    // Audit 9 aug: dinamicele se lipeau DUPĂ filtrul permisaLaVorbire și
    // ocoleau lista albă a fazei de vorbire; acum pe tura ușoară nu intră deloc
    // (rămân prin ask_brain → inventarul plin), iar plafonul rămâne pinuit.
    expect(chat).toMatch(/for \(const t of turaUsoara \? \[\] : dynTools\)[\s\S]*?tools\.length >= MAX_PROVIDER_TOOLS[\s\S]*?break/)
  })
})
