// ORDINUL (owner, 16 aug): „constructor unic aider… scoti tot din constructor si
// instalezi doar aider… ramine doar gemini rapid si cu escaladarea spusa pe
// modelul performant gemini… fable iese total de peste tot… nu se comuta nimic."
//
// Contractele NOI, încuiate pe sursă:
//  • Motorul constructorului e AIDER, UNIC — agentul îl rulează, prin app.
//  • Creierul lui Aider vine PRIN APP (constructorul NU ține chei), pe ruta
//    openai gardată cu bridge-secret; acolo e DOAR Gemini: rapid întâi,
//    escaladare ANUNȚATĂ pe modelul performant. FĂRĂ Fable, FĂRĂ comutator.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
const agent = readFileSync(fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url)), 'utf8')

describe('constructor = Aider (motor unic), creier DOAR Gemini prin app', () => {
  it('agentul rulează Aider ca motor unic, prin app (fără chei de furnizor)', () => {
    expect(agent).toContain('construiesteCuAider')
    expect(agent).toContain("'--model', 'openai/kelion-constructor'")
    expect(agent).toContain('/api/constructor/openai/v1')
    expect(agent).toContain('OPENAI_API_KEY: BRIDGE')
  })

  it('creierul din app e DOAR Gemini: rapid întâi, escaladare pe performant', () => {
    expect(ruta).toContain('const modelRapid = modelCerut || config.geminiModel')
    expect(ruta).toContain('const modelPerformant = config.geminiModelGreu')
    expect(ruta).toContain('escaladare pe modelul performant Gemini')
    expect(ruta).toContain('incercareOrdin > 1') // încercarea ≥2 pornește pe performant
  })

  it('ușa OpenAI a creierului (motorul Aider) e înregistrată și bridge-gated', () => {
    expect(ruta).toContain("app.post('/api/constructor/openai/v1/chat/completions', creierHandler(true))")
    expect(ruta).toContain('esteOpenai && bearer === config.bridgeSecret')
  })

  it('FABLE 5 a ieșit TOTAL din constructor (owner, 16 aug)', () => {
    // Cod: nicio funcție Fable, niciun apel direct Anthropic, niciun comutator.
    expect(/fable5Disponibil|fable5Chat|fable5Constructor|fable5Valida/.test(ruta)).toBe(false)
    expect(/claude-fable-5|api\.anthropic\.com/.test(ruta)).toBe(false)
    expect(/forta.?fable/i.test(ruta)).toBe(false)
    // Agentul: niciun identificator Fable în cod (motorul e Aider + Gemini prin app).
    expect(/fable5|fable5Chat|claude-fable-5/i.test(agent)).toBe(false)
  })
})
