// ── COMUTATORUL CREIER 2 (cloud) + SURSA CONSTRUCTORULUI (free/plătit) ───────
// Owner, 16 aug: „ramine chatul live gemeni… creier 2 → Kimi K3 cu comutator
// Qwen3.5 Max… constructor = FREE (local pe VPS) ↔ PLĂTIT (același model ca creier
// 2)… un abonament $20/lună… se aprinde când lipesc cheia". Lacăt pe alegerea
// ownerului + cablajul: panoul scrie, host-ul citește, Aider trece pe cloud.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tagModelCloud, bazaOllamaCloud, MODELE_CLOUD } from './services/creierCloud.js'

const aici = dirname(fileURLToPath(import.meta.url))
const s = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

describe('creierCloud — alegerea modelului cloud (Kimi K3 ↔ Qwen3.5 Max)', () => {
  it('gemini → fără tag cloud; kimi-k3/qwen3.5 → tag-ul de model real', () => {
    expect(tagModelCloud('gemini')).toBe('')
    expect(tagModelCloud('kimi-k3')).toBe(MODELE_CLOUD['kimi-k3'])
    expect(tagModelCloud('qwen3.5')).toBe(MODELE_CLOUD['qwen3.5'])
  })
  it('baza cloud e Ollama, suprascriabilă din env', () => {
    expect(bazaOllamaCloud()).toMatch(/^https?:\/\//)
  })
})

describe('cablajul comutatorului — panou scrie, host citește, Aider trece pe cloud', () => {
  it('constructor.ts are endpointul de setare (admin) + cel de config (host, bridge)', () => {
    const c = s('./routes/constructor.ts')
    expect(c).toContain("app.post<{ Body: { creier2?: string; constructorSursa?: string; ollamaKey?: string } }>(")
    expect(c).toContain("'/api/admin/constructor/creier-cloud'")
    expect(c).toContain("app.get('/api/constructor/creier-config'")
    // statusul admin trimite alegerea + proba MĂSURATĂ a cheii
    expect(c).toContain('creier: creierCfg')
    expect(c).toContain('cloud, // { ok, motiv, modele }')
  })

  it('agentul: Aider trece pe CLOUD (openai/<model> + cheie) când sursa=platit', () => {
    const a = s('../../deploy/constructor-agent.mjs')
    expect(a).toContain("creierCfg.sursa === 'platit'")
    expect(a).toContain('`openai/${creierCfg.model}`')
    expect(a).toContain('aiderEnv.OPENAI_API_KEY = creierCfg.cheie')
    // pe cloud NU mai instalăm local; pe free rămâne asiguraCreierulLocal
    expect(a).toContain('if (!platit && !asiguraCreierulLocal())')
    expect(a).toContain("await api('/api/constructor/creier-config'")
  })

  it('panoul (AdminPanel) are comutatorul creier 2 + constructor + câmp de cheie', () => {
    const p = s('../../frontend/src/components/AdminPanel.tsx')
    expect(p).toContain("'/api/admin/constructor/creier-cloud'")
    expect(p).toContain('setCreierCfg')
    expect(p).toContain('ollamaKeyInput')
    expect(p).toContain('Kimi K3 (cloud)')
    expect(p).toContain('Qwen3.5 397B (cloud)')
    expect(p).toContain('PLĂTIT (= creier 2 cloud)')
  })
})
