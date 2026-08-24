import { describe, expect, it } from 'vitest'
import { appendTurn, finishTurn, readTurnFrom, startTurn } from './services/sseReplay.js'

async function collect(email: string, turnId: string, after: number): Promise<string> {
  let output = ''
  for await (const chunk of readTurnFrom(email, turnId, after)) output += chunk
  return output
}

describe('chat SSE replay account boundary', () => {
  it('never exposes a turn buffer to another authenticated account', async () => {
    const turnId = '22222222-2222-4222-8222-222222222222'
    startTurn('a@example.test', turnId)
    appendTurn('a@example.test', turnId, 'secret-account-A')
    finishTurn('a@example.test', turnId)

    startTurn('b@example.test', turnId)
    appendTurn('b@example.test', turnId, 'secret-account-B')
    finishTurn('b@example.test', turnId)

    const accountA = await collect('a@example.test', turnId, 0)
    const accountB = await collect('b@example.test', turnId, 0)
    expect(accountA).toContain('secret-account-A')
    expect(accountA).not.toContain('secret-account-B')
    expect(accountB).toContain('secret-account-B')
    expect(accountB).not.toContain('secret-account-A')
  })

  it('replays only events after Last-Event-ID and never duplicates the prefix', async () => {
    const email = 'resume@example.test'
    const turnId = '33333333-3333-4333-8333-333333333333'
    startTurn(email, turnId)
    appendTurn(email, turnId, 'first')
    appendTurn(email, turnId, 'second')
    finishTurn(email, turnId)

    const afterFirstPayload = await collect(email, turnId, 2)
    expect(afterFirstPayload).not.toContain('data: first')
    expect(afterFirstPayload).toContain('data: second')
  })
})
