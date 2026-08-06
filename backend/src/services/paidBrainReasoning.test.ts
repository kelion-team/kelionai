import { describe, it, expect, vi } from 'vitest'
import { isTransientBrainError, expertModelLadder, runBrainLadder, brainComplete } from './brain.js'

describe('Paid Brain Reasoning Test & Fallback', () => {
  it('detects transient errors correctly for brain ladder retries', () => {
    expect(isTransientBrainError(new Error('HTTP 429 rate limit reached'))).toBe(true)
    expect(isTransientBrainError(new Error('ResourceExhausted: quota exceeded'))).toBe(true)
    expect(isTransientBrainError(new Error('Gemini 503 Service Unavailable'))).toBe(true)
    expect(isTransientBrainError(new Error('ETIMEDOUT'))).toBe(true)
    expect(isTransientBrainError(new Error('HTTP 401 Unauthorized'))).toBe(false)
  })

  it('builds expert model ladder using Gemini direct models', () => {
    const ladder = expertModelLadder()
    expect(ladder.length).toBeGreaterThan(0)
    for (const model of ladder) {
      expect(model.startsWith('google-direct/')).toBe(true)
    }
  })

  it('runs model ladder and fails over transient errors to next rung', async () => {
    const modelsTried: string[] = []
    const mockCall = vi.fn(async (model: string) => {
      modelsTried.push(model)
      if (model === 'google-direct/gemini-2.5-flash') {
        throw new Error('429 Rate limit')
      }
      return { text: 'Success reasoning', model, inputTokens: 10, outputTokens: 20, costUsd: 0.001 }
    })

    const result = await runBrainLadder(
      ['google-direct/gemini-2.5-flash', 'google-direct/gemini-2.5-pro'],
      mockCall,
      { budgetMs: 5000, sleep: async () => {} }
    )

    expect(result.text).toBe('Success reasoning')
    expect(modelsTried).toEqual(['google-direct/gemini-2.5-flash', 'google-direct/gemini-2.5-pro'])
  })
})
