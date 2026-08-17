// Creier 2 pe chat (17 aug): panoul nu mai minte; modelul forțat trece prin ușa unitară.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OLLAMA_CLOUD_PREFIX, esteOllamaCloud, ollamaCloudModelCod } from './services/ollamaCloud.js'

const aici = dirname(fileURLToPath(import.meta.url))
const s = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

describe('ollamaCloud — prefix și cod', () => {
  it('prefix + strip', () => {
    expect(esteOllamaCloud(`${OLLAMA_CLOUD_PREFIX}qwen3.5:397b`)).toBe(true)
    expect(esteOllamaCloud('google-direct/x')).toBe(false)
    expect(ollamaCloudModelCod(`${OLLAMA_CLOUD_PREFIX}kimi-k3`)).toBe('kimi-k3')
  })
})

describe('cablaj Creier 2 pe chat greu', () => {
  it('selectedBrainModel citește config creier2 pe heavy', () => {
    const c = s('./routes/chat.ts')
    expect(c).toContain('owner greu → Creier 2 cloud')
    expect(c).toContain('OLLAMA_CLOUD_PREFIX')
    expect(c).toContain("orChatModel?.startsWith('ollama-cloud/')")
    expect(c).toContain('CREIER 2 CLOUD EPUIZAT')
  })
  it('creierRationament onorează opts.model + ollama-cloud', () => {
    const r = s('./services/creierRationament.ts')
    expect(r).toContain('opts.model || modelPentru')
    expect(r).toContain("startsWith('ollama-cloud/')")
    expect(r).toContain('ollamaCloudChat')
    expect(r).toContain('ollamaCloudChatStream')
  })
  it('orchestratorul trece modelul la ușa unitară', () => {
    const o = s('./services/orchestrator.ts')
    expect(o).toContain('model,')
    expect(o).toContain('OLLAMA_CLOUD_PREFIX')
    expect(o).toContain('rationeazaMesajeStream(convo, onTextFiltrat, optR)')
  })
})
