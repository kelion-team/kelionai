import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ failed: 0 }))

vi.mock('../db.js', () => ({
  dbEnabled: () => true,
  getPool: () => ({
    query: vi.fn(async (sql: string) => {
      if (sql.includes("count(*) FILTER (WHERE status='queued'")) {
        return {
          rows: [{
            queued: 0,
            running: 0,
            failed: state.failed,
            oldest_queued_at: null,
            oldest_running_at: null,
          }],
        }
      }
      if (sql.includes("WHERE b.arhivat=false AND b.status IN ('queued','running')")) {
        return { rows: [] }
      }
      throw new Error(`unexpected query: ${sql}`)
    }),
  }),
}))

vi.mock('./constructorChainStatus.js', () => ({
  getConstructorChainStatus: vi.fn(async () => ({
    state: 'ready',
    reason: 'ready',
    lastHeartbeat: '2026-08-26T12:00:00.000Z',
    legs: {
      worker: { state: 'ready', lastHeartbeat: '2026-08-26T12:00:00.000Z', detail: 'ready' },
      publisher: { state: 'ready', lastHeartbeat: '2026-08-26T12:00:00.000Z', detail: 'ready' },
      release: { state: 'ready', lastHeartbeat: '2026-08-26T12:00:00.000Z', detail: 'ready' },
    },
  })),
}))

const { diagnosticConstructorViu } = await import('./diagnosticConstructor.js')

beforeEach(() => {
  state.failed = 0
})

describe('diagnosticul Constructor Admin', () => {
  it('nu declară sănătos un lanț cu ordine failed nearhivate', async () => {
    state.failed = 2
    const result = await diagnosticConstructorViu(Date.parse('2026-08-26T12:00:00.000Z'))
    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.sanatos).toBe(false)
    expect(result.probleme).toContainEqual(expect.objectContaining({
      cod: 'constructor_failed_jobs',
      severitate: 'critic',
    }))
    expect(result.verdict).not.toContain('nu există blocaje critice')
  })
})
