// ── PROBA AIDER — dovada vie a motorului (owner, 16 aug: „doar denumit nu e
// suficient trebuie verificat real ca e aider… cu dovada"). ─────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('probaAider — rulează CHIAR aider --version, cu cache', () => {
  beforeEach(async () => {
    const { _resetProbaAider } = await import('./services/aiderProba.js')
    _resetProbaAider()
    vi.resetModules()
  })

  it('binar absent → ok:false cu motiv real (nu „merge" fabricat)', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: (_c: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) =>
        cb(Object.assign(new Error('spawn aider ENOENT'), { code: 'ENOENT' })),
    }))
    const { probaAider, _resetProbaAider } = await import('./services/aiderProba.js')
    _resetProbaAider()
    const r = await probaAider()
    expect(r.ok).toBe(false)
    expect(r.motiv).toContain('ENOENT')
    vi.doUnmock('node:child_process')
  })

  it('aider răspunde → ok:true cu versiunea REALĂ (dovada)', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: (_c: string, _a: string[], _o: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) =>
        cb(null, { stdout: 'aider 0.86.1\n', stderr: '' }),
    }))
    const { probaAider, _resetProbaAider } = await import('./services/aiderProba.js')
    _resetProbaAider()
    const r = await probaAider()
    expect(r.ok).toBe(true)
    expect(r.versiune).toContain('aider 0.86.1')
    vi.doUnmock('node:child_process')
  })
})

describe('proba Aider e LEGATĂ (health + panoul constructor + agentul o folosește)', () => {
  it('systemHealth probează motorul Aider (VIU/LIPSĂ măsurat)', () => {
    const h = sursa('./services/health.ts')
    expect(h).toContain('probaAider()')
    expect(h).toContain('aider-constructor-lipsa')
  })
  it('GET /api/admin/constructor trimite starea probată a motorului', () => {
    const c = sursa('./routes/constructor.ts')
    expect(c).toMatch(/probaAider\(\)/)
    expect(c).toMatch(/aider, \/\/ \{ ok, versiune, motiv \}/)
  })
  it('agentul chiar rulează Aider ca motor (aiderInstalat + ruleazaAider)', () => {
    const a = sursa('../../deploy/constructor-agent.mjs')
    expect(a).toContain('function aiderInstalat')
    // Existența lui aider se probează cu `command -v` (instant), NU cu `aider
    // --version` (pornea tot Python-ul greu → depășea 20s pe VPS-ul „sugrumat" →
    // fals „lipsă" → ordinul amânat înainte ca aider să pornească; măsurat 16 aug).
    expect(a).toContain('command -v aider')
    // Motorul real e chiar aider, lansat prin spawn (streaming, transparent pe monitor).
    expect(a).toContain("spawn('aider'")
  })
})
