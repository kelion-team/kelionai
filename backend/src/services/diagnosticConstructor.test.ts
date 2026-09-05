import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  failed: 0,
  jobs: [] as Array<{
    id: number
    status: string
    constructor_stage: string
    log: string | null
    updated_at: Date
    incident_state: string | null
    next_action: string | null
    retry_not_before: Date | null
    publisher_retry_not_before: Date | null
    publisher_lease_until: Date | null
    release_retry_not_before: Date | null
    release_lease_until: Date | null
  }>,
}))

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
      if (sql.includes("WHERE b.arhivat=false AND b.status IN ('queued','running','failed')")) {
        return { rows: state.jobs }
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
  state.jobs = []
})

function failedJob(log: string, id = 1) {
  return {
    id,
    status: 'failed',
    constructor_stage: 'claimed',
    log,
    updated_at: new Date('2026-08-26T11:59:00.000Z'),
    incident_state: null,
    next_action: null,
    retry_not_before: null,
    publisher_retry_not_before: null,
    publisher_lease_until: null,
    release_retry_not_before: null,
    release_lease_until: null,
  }
}

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

  it('păstrează rezultatul nerezolvat fără recomandarea modelelor retrase', async () => {
    state.failed = 1
    state.jobs = [failedJob('worker_unresolved:test_failure;profile=fast')]
    const result = await diagnosticConstructorViu(Date.parse('2026-08-26T12:00:00.000Z'))
    if ('error' in result) throw new Error(result.error)
    const problem = result.probleme.find(({ cod }) => cod === 'constructor_unresolved')
    expect(problem?.recomandare).toContain('comanda explicită Reia')
    expect(problem?.recomandare).not.toMatch(/35B|122B|POWERFUL/)
  })

  it('păstrează și istoricul profilului retras fără a recomanda comutarea', async () => {
    state.failed = 1
    state.jobs = [failedJob('worker_unresolved:quality_gate_failure;profile=powerful')]
    const result = await diagnosticConstructorViu(Date.parse('2026-08-26T12:00:00.000Z'))
    if ('error' in result) throw new Error(result.error)
    const problem = result.probleme.find(({ cod }) => cod === 'constructor_unresolved')
    expect(problem?.recomandare).toContain('comanda explicită Reia')
    expect(problem?.recomandare).not.toMatch(/POWERFUL|122B|model superior/)
  })

  it('nu recomandă model sau Reia pentru outcome technical_failure', async () => {
    state.failed = 1
    state.jobs = [failedJob('worker_failure:worker_internal_failure;profile=fast')]
    const result = await diagnosticConstructorViu(Date.parse('2026-08-26T12:00:00.000Z'))
    if ('error' in result) throw new Error(result.error)
    const problem = result.probleme.find(({ cod }) => cod === 'constructor_technical_failure')
    expect(problem?.recomandare).toContain('nu recomandă schimbarea modelului sau Reia')
    expect(problem?.recomandare).not.toContain('POWERFUL')
  })
})
