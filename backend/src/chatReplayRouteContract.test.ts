import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const chat = readFileSync(
  fileURLToPath(new URL('./routes/chat.ts', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n')
const index = readFileSync(
  fileURLToPath(new URL('./index.ts', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n')

describe('chat route durable replay wiring', () => {
  it('claims the durable request before an instant device/gesture effect', () => {
    const claimAt = chat.indexOf('const replayClaim = await claimChatTurn')
    const instantAt = chat.indexOf('const instantCommand = async')
    expect(claimAt).toBeGreaterThan(0)
    expect(instantAt).toBeGreaterThan(claimAt)

    const block = chat.slice(instantAt, chat.indexOf('// Access tokens', instantAt))
    expect(block).toContain('executeChatSideEffect(')
    expect(block).toContain('idempotencyKey: clientKey')
    expect(block).toContain('turnId,')
    expect(block).toContain('await completeChatTurn({')
    expect(block).not.toMatch(/const cmdTurnId = randomUUID/)
  })

  it('persists every normal terminal path before ending the SSE response', () => {
    const afterClaim = chat.slice(chat.indexOf('const replayClaim = await claimChatTurn'))
    expect(afterClaim.match(/await completeChatTurn\(\{/g)?.length).toBeGreaterThanOrEqual(4)
    expect(afterClaim.match(/await failChatTurn\(\{/g)?.length).toBeGreaterThanOrEqual(4)
    expect(afterClaim).toContain('executeChatSideEffect({')
    expect(afterClaim).toContain('saveChatMessageOnce({')
  })

  it('expires retained replay text at startup and in the retention timer', () => {
    expect(index.match(/expireChatReplayResults\(\)/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
