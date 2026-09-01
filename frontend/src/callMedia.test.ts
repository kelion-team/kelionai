import { describe, expect, it } from 'vitest'
import {
  CALL_UTTERANCE_MAX_MS,
  callMediaEnvelope,
  shouldSplitCallUtterance,
} from './lib/callMedia'

describe('bounded call media messages', () => {
  it('adds one retry-stable UUID field to every phrase envelope', () => {
    expect(callMediaEnvelope('vorbire', 'apel_1', 'BASE64', 'audio/webm', () => 'fixed-id')).toEqual({
      type: 'vorbire',
      callId: 'apel_1',
      utteranceId: 'fixed-id',
      audio: 'BASE64',
      mime: 'audio/webm',
    })
  })

  it('splits continuous speech at the bounded duration, never earlier', () => {
    expect(shouldSplitCallUtterance(1_000, 1_000 + CALL_UTTERANCE_MAX_MS - 1)).toBe(false)
    expect(shouldSplitCallUtterance(1_000, 1_000 + CALL_UTTERANCE_MAX_MS)).toBe(true)
    expect(shouldSplitCallUtterance(Number.NaN, 20_000)).toBe(false)
  })
})
