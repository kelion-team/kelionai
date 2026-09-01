import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  constructorChainAcceptsWork,
  constructorWorkerCanStartNow,
  projectConstructorServiceLeg,
} from './constructorChainStatus.js'

describe('Constructor full-chain service heartbeat', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z')

  it('never paints an unconfigured or unreadable service green', () => {
    expect(projectConstructorServiceLeg({ readable: true, configured: false, stored: null, now }).state).toBe('setup_required')
    expect(projectConstructorServiceLeg({ readable: false, configured: true, stored: null, now }).state).toBe('unknown')
  })

  it('distinguishes a recent busy heartbeat from a stale service', () => {
    expect(projectConstructorServiceLeg({
      readable: true,
      configured: true,
      stored: { state: 'busy', at: new Date(now - 10_000).toISOString() },
      now,
    }).state).toBe('busy')
    expect(projectConstructorServiceLeg({
      readable: true,
      configured: true,
      stored: { state: 'ready', at: new Date(now - 10 * 60_000).toISOString() },
      now,
    }).state).toBe('offline')
  })

  it('keeps a fresh upstream failure degraded instead of ready', () => {
    expect(projectConstructorServiceLeg({
      readable: true,
      configured: true,
      stored: { state: 'degraded', at: new Date(now - 1_000).toISOString(), detail: 'github_auth_required' },
      now,
    })).toMatchObject({ state: 'degraded', detail: 'github_auth_required' })
  })

  it('separates accepting queued work from being able to start it now', () => {
    expect(constructorChainAcceptsWork('ready')).toBe(true)
    expect(constructorWorkerCanStartNow('ready')).toBe(true)

    expect(constructorChainAcceptsWork('busy')).toBe(true)
    expect(constructorWorkerCanStartNow('busy')).toBe(false)

    for (const state of ['offline', 'setup_required', 'degraded', 'unknown'] as const) {
      expect(constructorChainAcceptsWork(state)).toBe(false)
      expect(constructorWorkerCanStartNow(state)).toBe(false)
    }
  })

  it('publishes both availability facts on intake and queue snapshots', () => {
    const route = fs.readFileSync(new URL('../routes/constructor.ts', import.meta.url), 'utf8')
    expect(route.match(/acceptingWork:/g)).toHaveLength(2)
    expect(route.match(/workerCanStartNow:/g)).toHaveLength(2)
    expect(route).toContain('const chain = await readChain()')
  })
})
