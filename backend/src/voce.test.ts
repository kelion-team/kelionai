// ── THE VOICE PATH'S TESTS (Aug 1 — THE ONE-BRAIN ARCHITECTURE) ─────────────
//
// Adrian, Aug 1: "rewrite the whole chat procedure, written and audio
// full-duplex, with escalation — let the BRAIN use the model's voice and
// functions; there must not be two separate entities".
//
// The voice session is PURE EARS AND MOUTH:
//   • ZERO tools in the Realtime session — the 31-tool ceiling that broke
//     voice all through July is gone structurally, not managed;
//   • the model NEVER answers from its own head — it transcribes (ears) and
//     speaks ONLY the "ROSTEȘTE:" items (the brain's words, verbatim);
//   • a spoken turn goes through POST /api/chat — the SAME pipeline, tools,
//     escalation ladder and billing as writing. Parity is the architecture,
//     not a maintained list.
//
// These tests guard exactly that: no second brain can silently grow back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { realtimeInstructions } from './services/realtime.js'
import { CAPABILITIES, chatCapabilityNames, dormantOnVoice, voiceCapabilityNames } from './services/brainCapabilities.js'

describe('voce — sesiunea e urechi + gură, NICIODATĂ un al doilea creier', () => {
  const src = readFileSync(fileURLToPath(new URL('./services/realtime.ts', import.meta.url)), 'utf8')

  it('NU există nicio listă de unelte de voce (plafonul de 31 a murit odată cu ea)', () => {
    expect(src).not.toMatch(/realtimeTools/)
    expect(src).not.toMatch(/VOICE_TOOL_NAMES/)
    expect(src).not.toMatch(/tool_choice/)
    // The session is built without a `tools` field — grep for the session shape.
    expect(src).not.toMatch(/tools:\s*\[/)
  })

  it('registrul confirmă: lista directă de voce e goală, totul trece prin creier', () => {
    expect(voiceCapabilityNames()).toEqual([])
    expect(dormantOnVoice()).toEqual([])
    const neajunse = chatCapabilityNames().filter((n) => {
      const c = CAPABILITIES.find((x) => x.name === n)
      return c && !c.voiceViaBrain
    })
    expect(neajunse, `nu ajung pe voce prin creier: ${neajunse.join(', ')}`).toEqual([])
  })

  it('ruta de voce NU mai are endpoint de unelte, nici ask_brain', () => {
    const route = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')
    expect(route).not.toMatch(/realtime\/tool/)
    expect(route).not.toMatch(/ask_brain/)
    expect(route).not.toMatch(/voiceBrainTurn/)
  })

  it('creierul vorbește prin /api/chat: flag-ul `spoken` există și instruiește stilul rostit', () => {
    const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
    expect(chat).toMatch(/spoken\?: boolean/)
    expect(chat).toMatch(/SPOKEN REPLY/)
  })
})

describe('voce — instrucțiunile gurii (ROSTEȘTE verbatim, tăcere implicită)', () => {
  const instr = realtimeInstructions('ro', true)

  it('poartă regula GURII: vorbește EXACT textul primit, nimic din capul lui', () => {
    expect(instr).toContain('ROSTEȘTE')
    expect(instr.toLowerCase()).toMatch(/never answer|never improvise/)
    expect(instr.toLowerCase()).toMatch(/word for word|exactly/)
  })

  it('poartă regula URECHILOR: auzitul nu e răspuns (tace la tot ce nu e ROSTEȘTE)', () => {
    expect(instr.toLowerCase()).toMatch(/silence is your default|stay silent/)
  })

  it('păstrează gardul de limbă (dovada live: răspuns în rusă la vorbire română)', () => {
    expect(instr).toContain('English, Romanian, French, Spanish, Portuguese, Italian, German')
  })

  it('nu crapă pe intrări lipsă și respectă lacătul de limbă al adminului', () => {
    expect(() => realtimeInstructions('', false)).not.toThrow()
    expect(() => realtimeInstructions('en', false)).not.toThrow()
    expect(realtimeInstructions('ro', true)).toContain('Romanian')
    expect(realtimeInstructions('xx', false).length).toBeGreaterThan(100)
  })
})
