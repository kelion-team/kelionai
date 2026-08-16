// ── PROBA OLLAMA — dovada vie a creierului LOCAL al constructorului (owner, 16
// aug: „aider pe un model LOCAL pe VPS (Ollama)… verifică dacă nu e deja pus pe
// serverul linux"). Nu ghicim dacă Ollama e pe server — rulăm CHIAR `ollama list`
// și raportăm modelele reale sau eroarea reală. + LEGĂTURA: proba e în health,
// în panoul constructor, iar agentul chiar instalează/rulează pe creierul local.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('probaOllama — rulează CHIAR ollama list, cu cache', () => {
  beforeEach(async () => {
    const { _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    vi.resetModules()
  })

  it('binar absent / serviciu oprit → ok:false cu motiv real (nu „e ok" fabricat)', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: (_c: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) =>
        cb(Object.assign(new Error('spawn ollama ENOENT'), { code: 'ENOENT' })),
    }))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(false)
    expect(r.modele).toEqual([])
    expect(r.motiv).toContain('ENOENT')
    vi.doUnmock('node:child_process')
  })

  it('ollama răspunde → ok:true cu modelele REALE parsate (dovada)', async () => {
    const stdout = 'NAME                 ID    SIZE   MODIFIED\nqwen2.5-coder:7b     abc   4.7 GB 2 days ago\nllama3.2:latest      def   2.0 GB 1 week ago\n'
    vi.doMock('node:child_process', () => ({
      execFile: (_c: string, _a: string[], _o: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) =>
        cb(null, { stdout, stderr: '' }),
    }))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(true)
    expect(r.modele).toContain('qwen2.5-coder:7b')
    expect(r.modele).toContain('llama3.2:latest')
    vi.doUnmock('node:child_process')
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
