import { describe, it, expect } from 'vitest'
import { toGeminiPayload, GEMINI_DIRECT_PREFIX, isGeminiQuotaError } from './geminiDirect.js'

describe('geminiDirect', () => {
  it('has valid direct prefix', () => {
    expect(GEMINI_DIRECT_PREFIX).toBe('google-direct/')
  })

  it('detects quota / rate limit errors', () => {
    expect(isGeminiQuotaError({ status: 429 })).toBe(true)
    expect(isGeminiQuotaError(new Error('gemini 429: Rate limit exceeded'))).toBe(true)
    expect(isGeminiQuotaError({ message: 'RESOURCE_EXHAUSTED: quota exceeded' })).toBe(true)
    expect(isGeminiQuotaError({ message: 'Prepayment credits are depleted' })).toBe(true)
    expect(isGeminiQuotaError({ message: 'Random error' })).toBe(false)
  })

  it('converts messages and tools to Gemini payload structure', () => {
    const payload = toGeminiPayload(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      [
        {
          name: 'search',
          description: 'Search web',
          input_schema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
      { maxTokens: 500, temperature: 0.5 }
    )

    expect(payload.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] })
    expect(payload.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }])
    expect(payload.generationConfig).toEqual({ maxOutputTokens: 500, temperature: 0.5 })
    expect(payload.tools).toBeDefined()
  })

  it('sets thinkingBudget for gemini-2.5 models based on reasoning level', () => {
    const payloadHigh = toGeminiPayload(
      [{ role: 'user', content: 'test' }],
      [],
      { reasoning: 'high' },
      'google-direct/gemini-2.5-pro'
    )
    expect((payloadHigh.generationConfig as any)?.thinkingConfig).toEqual({ thinkingBudget: 4096 })

    const payloadMed = toGeminiPayload(
      [{ role: 'user', content: 'test' }],
      [],
      { reasoning: 'medium' },
      'google-direct/gemini-2.5-flash'
    )
    expect((payloadMed.generationConfig as any)?.thinkingConfig).toEqual({ thinkingBudget: 1024 })

    const payloadLow = toGeminiPayload(
      [{ role: 'user', content: 'test' }],
      [],
      { reasoning: 'low' },
      'google-direct/gemini-2.5-flash'
    )
    expect((payloadLow.generationConfig as any)?.thinkingConfig).toEqual({ thinkingBudget: 512 })
  })

  it('omits thinkingConfig for gemini-3.x models to prevent API 400 errors', () => {
    const payload = toGeminiPayload(
      [{ role: 'user', content: 'test' }],
      [],
      { reasoning: 'high' },
      'google-direct/gemini-3.6-flash'
    )
    expect((payload.generationConfig as any)?.thinkingConfig).toBeUndefined()
  })
})