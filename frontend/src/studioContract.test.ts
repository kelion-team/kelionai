import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aici = dirname(fileURLToPath(import.meta.url))
const source = (path: string): string => readFileSync(join(aici, path), 'utf8')

describe('Studio video OpenAI-only', () => {
  it('acceptă numai frame-ul canonical OpenAI', () => {
    const contract = source('lib/chat.ts')
    const chat = source('components/ChatPanel.tsx')
    const stage = source('pages/Stage.tsx')
    expect(contract).toContain("scenariu?: { videoPrompt: string; nume: string; cale: 'openai' }")
    expect(chat).toContain("c.scenariu?.cale === 'openai' && c.scenariu.videoPrompt")
    expect(stage).toContain("j.cale === 'openai' && j.videoPrompt")
    expect(stage).toContain('scenariuProaspat.videoPrompt')
  })

  it('nu păstrează câmpuri sau rețete video retrase', () => {
    const all = [
      source('lib/chat.ts'),
      source('components/ChatPanel.tsx'),
      source('pages/Stage.tsx'),
    ].join('\n')
    expect(all).not.toMatch(/promptFlow|promptVeo|Google Flow|cale:\s*['"]gratis['"]/i)
  })
})
