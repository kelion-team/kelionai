import { describe, expect, it } from 'vitest'
import { retryChatEsteNesigur } from './lib/chatReplayPolicy'

describe('chat replay retry policy', () => {
  it('blocks automatic replay after an ambiguous external effect', () => {
    expect(retryChatEsteNesigur('turn_result_indeterminate')).toBe(true)
    expect(retryChatEsteNesigur('idempotency_key_conflict')).toBe(true)
    expect(retryChatEsteNesigur('turn_charge_already_exists')).toBe(true)
  })

  it('keeps pre-execution transport failures retryable with the same UUID', () => {
    expect(retryChatEsteNesigur('offline')).toBe(false)
    expect(retryChatEsteNesigur('server_down')).toBe(false)
    expect(retryChatEsteNesigur('turn_replay_unavailable')).toBe(false)
  })
})
