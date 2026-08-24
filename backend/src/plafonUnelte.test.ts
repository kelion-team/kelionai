import { describe, it, expect } from 'vitest'
import { plafonUnelteFurnizor } from './services/chatModelPolicy.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE PROVIDER'S 64-TOOL CEILING ───────────────────────────────────────────
// Aug 1, live incident: the chat route sent 76 tools to the provider →
// every turn died with `400: at most 64 tools are allowed` and the user saw
// only "Am întâmpinat o problemă tehnică". The fix is structural: the list is
// deduped by name and the base itself is trimmed
// under the ceiling with a loud log. This guard makes sure the ceiling can
// never silently disappear again.
const chat = readFileSync(
  fileURLToPath(new URL('./routes/chat.ts', import.meta.url)),
  'utf8',
)

describe('plafonul de unelte al furnizorului e garantat structural', () => {
  it('plafonul este 128 pentru modelele OpenAI și conservator pentru un id necunoscut', () => {
    expect(plafonUnelteFurnizor('openai/gpt-test')).toBe(128)
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
    // (excepția `continuareUsa` e a trierii în doi — lacătele ei stau în
    // triereInDoi.test.ts; aici se pinuiește doar că intenția de acțiune
    // rămâne temeiul turei de lucru)
    expect(chat).toMatch(/cereActiune = \(hasActionIntent\(lastUserText\) \|\| turnHasImage\)/)
    expect(chat).toMatch(/baseTools\.filter\(\(t\) => permisaLaVorbire\(t\.name\)\)/)
  })

  // (Testul detaliat al listei de vorbire s-a mutat în fazeChat.test.ts —
  // lista însăși s-a mutat în services/fazeChat.ts, sursa unică a fazelor.)


  it('lista e deduplicată pe NUME înainte de trimitere', () => {
    expect(chat).toMatch(/seenNames\.has\(t\.name\)/)
  })

  it('nu reintroduce extensii dinamice care pot ocoli politica de autorizare', () => {
    expect(chat).not.toContain('dynTools')
    expect(chat).not.toContain('runDynamicTool')
  })
})
