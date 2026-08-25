import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./config.ts', import.meta.url)), 'utf8')

describe('Romanian Realtime production configuration', () => {
  it('requires explicit realtime, transcription, and owner-approved model configuration', () => {
    expect(source).toContain("configuredApprovedRealtimeModel('OPENAI_REALTIME_MODEL'")
    expect(source).toContain("configuredApprovedRealtimeModel(\n      'OPENAI_REALTIME_TRANSCRIPTION_MODEL'")
    expect(source).toContain('OPENAI_APPROVED_REALTIME_MODELS este obligatoriu în producție')
  })

  it('fails production boot clearly when the injected shared project credential is absent', () => {
    expect(source).toContain('OPENAI_API_KEY_FILE este obligatoriu în producție')
    expect(source).toContain('sk-proj-')
  })
})
