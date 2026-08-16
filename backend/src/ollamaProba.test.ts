// ── PROBA OLLAMA — dovada vie a creierului LOCAL al constructorului (owner, 16
// aug: „aider pe un model LOCAL pe VPS (Ollama)… verifică dacă nu e deja pus pe
// serverul linux"). Nu ghicim dacă Ollama e pe server — îl întrebăm pe HOST prin
// HTTP (`/api/tags`), NU rulând CLI-ul în container (bugul „spawn ollama ENOENT"
// care striga fals „LIPSĂ pe VPS"). + LEGĂTURA: proba e în health, în panoul
// constructor, iar agentul chiar instalează/rulează pe creierul local.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('probaOllama — întreabă HOST-ul prin HTTP (/api/tags), cu cache', () => {
  beforeEach(async () => {
    const { _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    vi.restoreAllMocks()
  })

  it('Ollama nu răspunde pe host → ok:false cu motiv real (nu „e ok" fabricat)', async () => {
    // Serviciul căzut / neatins = eroare de rețea, NU „spawn ollama ENOENT" din
    // container (bugul reparat: nu mai rulăm binarul local, întrebăm host-ul).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed ECONNREFUSED') }))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(false)
    expect(r.modele).toEqual([])
    expect(r.motiv).toContain('nu răspunde pe host')
    vi.unstubAllGlobals()
  })

  it('Ollama pe host răspunde (200 + /api/tags) → ok:true cu modelele REALE (dovada)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.2:latest' }] }),
    })))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(true)
    expect(r.modele).toContain('qwen2.5-coder:7b')
    expect(r.modele).toContain('llama3.2:latest')
    vi.unstubAllGlobals()
  })
})

describe('proba Ollama e LEGATĂ (health + panoul constructor + auto-instalarea agentului)', () => {
  it('systemHealth probează creierul LOCAL Ollama (VIU/LIPSĂ măsurat)', () => {
    const h = sursa('./services/health.ts')
    expect(h).toContain('probaOllama()')
    expect(h).toContain('ollama-local-lipsa')
  })
  it('GET /api/admin/constructor trimite starea probată a creierului local', () => {
    const c = sursa('./routes/constructor.ts')
    expect(c).toMatch(/probaOllama\(\)/)
    expect(c).toContain('ollama, // { ok, modele, motiv }')
  })
  it('agentul își pune SINGUR creierul local pe VPS (owner: „sa instaleze el")', () => {
    const a = sursa('../../deploy/constructor-agent.mjs')
    expect(a).toContain('function asiguraCreierulLocal')
    expect(a).toContain('setup-ollama.sh')
    expect(a).toContain('OLLAMA_API_BASE')
    expect(a).toContain('ollama_chat/')
  })
})
