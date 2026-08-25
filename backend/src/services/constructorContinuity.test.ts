import { describe, expect, it } from 'vitest'
import { constructorContinuity } from './constructorContinuity.js'

describe('constructorContinuity', () => {
  it('keeps recoverable failures on an automatic continuation path', () => {
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'working',
      progress: 'worker_retry_scheduled',
      attempts: 4,
    }, { status: 'open' })
    expect(view.state).toBe('recovering')
    expect(view.retry).toEqual({ mode: 'automatic', attempts: 4 })
    expect(view.nextAction).toBeNull()
  })

  it('surfaces only an external authority action and resumes automatically afterward', () => {
    const view = constructorContinuity({
      status: 'queued',
      constructorStage: 'queued',
      progress: 'external_action_required',
    })
    expect(view.state).toBe('waiting_external')
    expect(view.nextAction).toMatch(/autorizarea externa/i)
    expect(view.retry.mode).toBe('automatic')
  })

  it('requires deployed commit and live version for completion', () => {
    expect(constructorContinuity({
      status: 'done',
      constructorStage: 'deployed',
      commit: 'a'.repeat(40),
      liveVersion: 'v1',
    }).finalProof.complete).toBe(true)
    expect(constructorContinuity({
      status: 'done',
      constructorStage: 'deployed',
      commit: 'a'.repeat(40),
    }).finalProof.complete).toBe(false)
  })
})
