// ── UȘA OpenAI a CREIERULUI (motorul Aider) — owner, 16 aug ──────────────────
// Aider (LiteLLM) cere creierul pe /api/constructor/openai/v1/chat/completions,
// cu bridge-secretul ca Bearer. Endpointul împachetează creierul Gemini al casei
// în forma OpenAI-completă (id/object/created/choices[].finish_reason). Lacăt pe
// sursă: forma, autentificarea și înregistrarea rutei nu pot regresa în tăcere.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')

describe('endpointul OpenAI al creierului constructorului (Aider ↔ creier prin app)', () => {
  it('un SINGUR handler, două uși (fără duplicare): /creier + /openai/v1/chat/completions', () => {
    expect(ruta).toContain('const creierHandler = (esteOpenai: boolean) =>')
    expect(ruta).toContain("app.post('/api/constructor/creier', creierHandler(false))")
    expect(ruta).toContain("app.post('/api/constructor/openai/v1/chat/completions', creierHandler(true))")
  })

  it('autentificarea acceptă bridge-secretul ca antet SAU ca Bearer (doar pe ușa openai)', () => {
    expect(ruta).toContain("req.headers['x-bridge-secret'] === config.bridgeSecret")
    expect(ruta).toContain('esteOpenai && bearer === config.bridgeSecret')
  })

  it('răspunsul openai e împachetat complet (object/created/finish_reason), altfel neatins', () => {
    expect(ruta).toContain("object: 'chat.completion'")
    expect(ruta).toContain('finish_reason')
    expect(ruta).toContain('created: Math.floor(Date.now() / 1000)')
    // pe /creier răspunsul rămâne forma noastră brută (raspunde() nu ambalează)
    expect(ruta).toContain('if (!esteOpenai) return reply.send(payload)')
  })
})
