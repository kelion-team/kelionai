// ── THE VOICE PATH'S TESTS (§1 "what writing can do, voice can too" + §6) ──
//
// Voice is the most fragile path: the OpenAI Realtime session's 31-tool
// ceiling doesn't error on overflow — the session simply does NOT start (504
// on EVERY attempt, the AI-HANDOFF chronology, the Jul 28 wave). A single row
// added to the registry can break voice in production without any build
// failing.
//
// We guard exactly the guarantees that proved expensive:
//   • the 31 ceiling — proven by measurement, not assumed;
//   • the voice list DERIVES from the single registry (not a second,
//     hand-written list);
//   • §1: no writing capability stays unreachable by speaking;
//   • the voice instructions carry the anchors (language + the deed rule).
import { describe, it, expect } from 'vitest'
import { realtimeTools, VOICE_TOOL_NAMES, realtimeInstructions } from './services/realtime.js'
import { CAPABILITIES, chatCapabilityNames, dormantOnVoice } from './services/brainCapabilities.js'

describe('voce — plafonul de 31 de unelte (dacă se depășește, vocea NU pornește)', () => {
  it('sesiunea rămâne SUB plafonul măsurat', () => {
    const n = realtimeTools().length
    expect(n).toBeGreaterThan(0)
    expect(n, `sesiunea Realtime are ${n} unelte — peste 31 nu mai pornește`).toBeLessThanOrEqual(31)
  })

  it('uneltele dinamice NU pot ocoli plafonul', () => {
    // Even if the owner approves 50 new skills, the sent list stays ≤31.
    const multe = Array.from({ length: 50 }, (_, i) => ({
      name: `skill_${i}`,
      description: `unealtă dinamică ${i}`,
      input_schema: { type: 'object' },
    }))
    expect(realtimeTools(multe).length).toBeLessThanOrEqual(31)
  })

  it('fiecare unealtă trimisă are formă completă (nume + schemă)', () => {
    for (const t of realtimeTools()) {
      expect(t.type).toBe('function')
      expect(t.name, 'unealtă fără nume').toBeTruthy()
      expect(t.parameters, `${t.name} fără schemă`).toBeTruthy()
    }
  })

  it('fără nume duplicate în lista trimisă (OpenAI le respinge)', () => {
    const nume = realtimeTools().map((t) => t.name)
    expect(new Set(nume).size).toBe(nume.length)
  })
})

describe('voce — lista DERIVĂ din registrul unic (nu e o a doua listă)', () => {
  it('numele de voce vin exact din registru', () => {
    for (const n of VOICE_TOOL_NAMES) {
      expect(CAPABILITIES.some((c) => c.name === n), `${n} lipsește din registru`).toBe(true)
    }
  })
  it('tot ce e marcat voice+google în registru chiar ajunge în sesiune', () => {
    const dinRegistru = CAPABILITIES.filter((c) => c.category === 'google' && c.voice).map((c) => c.name).sort()
    expect([...VOICE_TOOL_NAMES].sort()).toEqual(dinRegistru)
  })
})

describe('voce — §1: ce poate scrisul, poate și vocea', () => {
  it('ZERO capabilități adormite pe voce', () => {
    const adormite = dormantOnVoice().map((c) => c.name)
    expect(adormite, `adormite pe voce: ${adormite.join(', ')}`).toEqual([])
  })
  it('fiecare capabilitate de chat e accesibilă vorbind (direct sau prin creier)', () => {
    const neajunse = chatCapabilityNames().filter((n) => {
      const c = CAPABILITIES.find((x) => x.name === n)
      return c && !c.voice && !c.voiceViaBrain
    })
    expect(neajunse, `nu ajung pe voce: ${neajunse.join(', ')}`).toEqual([])
  })
})

describe('voce — ancorele din instrucțiuni (§3)', () => {
  const instr = realtimeInstructions('ro', null, '')

  it('poartă limba cerută', () => {
    expect(instr).toBeTruthy()
    expect(instr.length).toBeGreaterThan(100)
  })
  it('conține regula FAPTEI (nu declara că ai făcut fără unealtă)', () => {
    // The rule that stops "I sent"/"I saved" without a real tool call.
    expect(instr.toLowerCase()).toMatch(/unealt|tool|nu (spune|declara|pretinde)|never (say|claim)/i)
  })
  it('nu crapă pe intrări lipsă', () => {
    expect(() => realtimeInstructions('', null, '')).not.toThrow()
    expect(() => realtimeInstructions('en', 'Programator', 'context oarecare')).not.toThrow()
  })
})
