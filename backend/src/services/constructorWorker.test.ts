import { describe, expect, it } from 'vitest'
import { parseStoredConstructorWorkerStatus, projectConstructorWorkerState } from './constructorWorker.js'

const now = Date.parse('2026-08-26T12:00:00.000Z')

describe('Constructor local worker public state', () => {
  it('preserves busy and degraded heartbeats instead of painting them ready', () => {
    for (const storedStatus of ['busy', 'degraded'] as const) {
      expect(projectConstructorWorkerState({
        readable: true,
        configured: true,
        storedStatus,
        heartbeatAt: new Date(now - 1_000).toISOString(),
        now,
      })).toBe(storedStatus)
    }
  })

  it('keeps unreadable, unconfigured and stale states distinct', () => {
    expect(projectConstructorWorkerState({ readable: false, configured: true, storedStatus: 'ready', heartbeatAt: new Date(now).toISOString(), now })).toBe('unknown')
    expect(projectConstructorWorkerState({ readable: true, configured: false, storedStatus: 'ready', heartbeatAt: new Date(now).toISOString(), now })).toBe('setup_required')
    expect(projectConstructorWorkerState({ readable: true, configured: true, storedStatus: 'ready', heartbeatAt: new Date(now - 10 * 60_000).toISOString(), now })).toBe('offline')
  })

  it('rejects corrupt fresh KV payloads instead of projecting an arbitrary ready state', () => {
    expect(parseStoredConstructorWorkerStatus(JSON.stringify({ status: 'garbage', at: new Date(now).toISOString() }))).toBeNull()
    expect(parseStoredConstructorWorkerStatus(JSON.stringify({ status: 'ready', at: 'today' }))).toBeNull()
    expect(parseStoredConstructorWorkerStatus(JSON.stringify({ status: 'ready', at: new Date(now).toISOString(), internalCostUsdMicros: -1 }))).toBeNull()
    expect(parseStoredConstructorWorkerStatus(JSON.stringify({ status: 'ready', at: new Date(now).toISOString(), taskUrl: 'https://example.test/task' }))).toBeNull()
    expect(parseStoredConstructorWorkerStatus(JSON.stringify({ status: 'busy', at: new Date(now).toISOString(), detail: 'lucrează' })))
      .toMatchObject({ status: 'busy', detail: 'lucrează' })
  })
})
