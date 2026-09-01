import { describe, expect, it } from 'vitest'
import { constructorContinuity } from './constructorContinuity.js'

describe('constructorContinuity', () => {
  it('keeps legacy terminal failures on an explicit owner continuation path', () => {
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'working',
      progress: 'worker_retry_scheduled',
      attempts: 4,
    }, { state: 'open' })
    expect(view.state).toBe('waiting_manual')
    expect(view.retry).toEqual({ mode: 'manual', attempts: 4 })
    expect(view.nextAction).toMatch(/Reia/)
  })

  it('surfaces only an external authority action and resumes automatically afterward', () => {
    const view = constructorContinuity({
      status: 'queued',
      constructorStage: 'queued',
      progress: 'external_action_required',
    })
    expect(view.state).toBe('waiting_external')
    expect(view.nextAction).toMatch(/autorizarea extern/i)
    expect(view.retry.mode).toBe('automatic')
  })

  it('uses the canonical incident state and action for an external blocker', () => {
    const view = constructorContinuity({
      status: 'queued',
      constructorStage: 'queued',
    }, {
      state: 'blocked',
      nextAction: 'Reînnoiește autentificarea workerului privat.',
    })
    expect(view.state).toBe('waiting_external')
    expect(view.nextAction).toBe('Reînnoiește autentificarea workerului privat.')
  })

  it('names the exact persisted GitHub authority action', () => {
    const view = constructorContinuity({
      status: 'running',
      constructorStage: 'gates_passed',
      progress: 'external_action_required',
      log: 'branch_protection_invalid',
    })
    expect(view.state).toBe('waiting_external')
    expect(view.nextAction).toMatch(/protecția ramurii master/i)
  })

  it('requires deployed commit and live version for completion', () => {
    expect(constructorContinuity({
      status: 'done',
      constructorStage: 'deployed',
      commit: 'a'.repeat(40),
      liveVersion: 'a'.repeat(40),
    }).finalProof.complete).toBe(true)
    expect(constructorContinuity({
      status: 'done',
      constructorStage: 'deployed',
      commit: 'a'.repeat(40),
      liveVersion: 'a'.repeat(7),
    }).finalProof.complete).toBe(false)
    expect(constructorContinuity({
      status: 'done',
      constructorStage: 'deployed',
      commit: 'a'.repeat(40),
    }).finalProof.complete).toBe(false)
  })

  it('projects the persisted cancelled status as a resolved cancellation, not a failure', () => {
    const view = constructorContinuity({
      status: 'cancelled',
      constructorStage: 'cancelled',
      progress: 'cancelled_by_admin',
    })
    expect(view.state).toBe('cancelled')
    expect(view.message).toMatch(/anulata explicit/i)
    expect(view.finalProof.complete).toBe(false)
  })
})
