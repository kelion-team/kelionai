// ── LACĂT: creierul prin app (Gemini) a IEȘIT din constructor — owner, 16 aug ──
// „la constructor nu e gemeni idiotule… Aider pe un model LOCAL pe VPS (Ollama)…
// pe serverul linux si de acolo sa lucreze aider". Ruta veche prin care Aider cerea
// creierul Gemini al casei (/api/constructor/creier + ușa OpenAI
// /api/constructor/openai/v1/chat/completions) a fost SCOASĂ complet, împreună cu
// handlerul, puntea de formate (creier2Constructor) și alarma ei. Motorul (Aider)
// gândește acum pe creierul LOCAL Ollama de pe VPS, fără chei și fără app.
// Lacăt pe sursă: nimeni nu poate re-lega în tăcere constructorul la Gemini prin app.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')

describe('creierul prin app (Gemini) e SCOS din constructor (Aider = Ollama local)', () => {
  it('handlerul de creier prin app și cele două uși nu mai există', () => {
    expect(ruta).not.toContain('const creierHandler')
    expect(ruta).not.toContain("app.post('/api/constructor/creier'")
    expect(ruta).not.toContain("app.post('/api/constructor/openai/v1/chat/completions'")
  })

  it('puntea de formate OpenAI↔Gemini (creier2Constructor) a fost ștearsă', () => {
    expect(ruta).not.toContain('creier2Constructor')
    expect(ruta).not.toContain('uneltePentruCreier2')
    expect(ruta).not.toContain('raspunsCreier2')
  })

  it('constructorul nu mai cheamă geminiDirect pentru propriul creier', () => {
    // Contextul lui Kelion (memorie/roster/istoric) rămâne pe /api/constructor/context,
    // dar creierul propriu al motorului NU mai e Gemini prin app.
    expect(ruta).not.toContain('geminiDirectChat')
    expect(ruta).not.toContain("recordCost('kelion-constructor', 'gemini'")
  })
})
