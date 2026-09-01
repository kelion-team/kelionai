import { describe, expect, it } from 'vitest'
import { parseStoredCodexWorkerStatus, projectCodexWorkerState } from './codexWorker.js'

const now = Date.parse('2026-08-26T12:00:00.000Z')

describe('Codex worker public state', () => {
  it('preserves busy and degraded heartbeats instead of painting them ready', () => {
    for (const storedStatus of ['busy', 'degraded'] as const) {
      expect(projectCodexWorkerState({
        readable: true,
        configured: true,
        storedStatus,
        heartbeatAt: new Date(now - 1_000).toISOString(),
        now,
      })).toBe(storedStatus)
    }
  })

  it('keeps unreadable, unconfigured and stale states distinct', () => {
    expect(projectCodexWorkerState({ readable: false, configured: true, storedStatus: 'ready', heartbeatAt: new Date(now).toISOString(), now })).toBe('unknown')
    expect(projectCodexWorkerState({ readable: true, configured: false, storedStatus: 'ready', heartbeatAt: new Date(now).toISOString(), now })).toBe('setup_required')
    expect(projectCodexWorkerState({ readable: true, configured: true, storedStatus: 'ready', heartbeatAt: new Date(now - 10 * 60_000).toISOString(), now })).toBe('offline')
  })

  it('rejects corrupt fresh KV payloads instead of projecting an arbitrary ready state', () => {
    expect(parseStoredCodexWorkerStatus(JSON.stringify({ status: 'garbage', at: new Date(now).toISOString() }))).toBeNull()
    expect(parseStoredCodexWorkerStatus(JSON.stringify({ status: 'ready', at: 'today' }))).toBeNull()
    expect(parseStoredCodexWorkerStatus(JSON.stringify({ status: 'ready', at: new Date(now).toISOString(), internalCostUsdMicros: -1 }))).toBeNull()
    expect(parseStoredCodexWorkerStatus(JSON.stringify({ status: 'busy', at: new Date(now).toISOString(), detail: 'lucrează' })))
      .toMatchObject({ status: 'busy', detail: 'lucrează' })
  })
})
