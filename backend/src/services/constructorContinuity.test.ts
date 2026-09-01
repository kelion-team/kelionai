import { describe, expect, it } from 'vitest'
import {
  constructorContinuity,
  constructorModelOutcome,
  constructorWorkerTechnicalFailureRecord,
  constructorWorkerUnresolvedRecord,
} from './constructorContinuity.js'

describe('constructorContinuity', () => {
  it('keeps legacy terminal failures manual without a generic Retry recommendation', () => {
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'working',
      progress: 'worker_retry_scheduled',
      attempts: 4,
    }, { state: 'open' })
    expect(view.state).toBe('waiting_manual')
    expect(view.retry).toEqual({ mode: 'manual', attempts: 4 })
    expect(view.nextAction).toMatch(/nu recomandă.*model.*Reia/i)
    expect(view.nextAction).not.toMatch(/POWERFUL|folosește.*Reia/i)
    expect(view.modelOutcome).toBeNull()
  })

  it.each(['no_changes', 'test_failure', 'quality_gate_failure'] as const)(
    'recommends a manual POWERFUL switch after measured FAST result %s',
    (reason) => {
      const record = constructorWorkerUnresolvedRecord(reason, 'fast')
      const view = constructorContinuity({
        status: 'failed',
        constructorStage: 'unresolved',
        progress: record.progress,
        log: record.evidence,
      })
      expect(view.state).toBe('waiting_manual')
      expect(view.retry.mode).toBe('manual')
      expect(view.modelOutcome).toEqual({
        profile: 'fast',
        result: 'unresolved',
        reasonCode: reason,
        reason: expect.any(String),
        manualRecommendation: {
          profile: 'powerful',
          reasonCode: 'fast_result_not_publishable',
          reason: expect.stringMatching(/FAST 35B.*POWERFUL 122B/i),
        },
      })
      expect(view.nextAction).toMatch(/Comută manual.*POWERFUL 122B.*Reia/i)
    },
  )

  it.each(['execution_timeout', 'brain_unavailable', 'worker_internal_failure'] as const)(
    'classifies %s as technical and never recommends a model switch',
    (code) => {
      const record = constructorWorkerTechnicalFailureRecord(code, 'fast')
      const view = constructorContinuity({
        status: 'failed',
        constructorStage: 'failed',
        progress: record.progress,
        log: record.evidence,
      })
      expect(view.modelOutcome).toMatchObject({
        profile: 'fast', result: 'technical_failure', reasonCode: code, manualRecommendation: null,
      })
      expect(view.message).toMatch(/cauză tehnică/i)
      expect(view.nextAction).not.toMatch(/POWERFUL|comut|folosește.*Reia/i)
      expect(view.nextAction).toMatch(/nu recomandă.*model.*Reia/i)
    },
  )

  it('reports a migrated unrecorded-profile watchdog failure as technical without model advice', () => {
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'failed',
      progress: 'technical_failure',
      log: 'worker_failure:worker_internal_failure;profile=unrecorded',
    })
    expect(view.state).toBe('waiting_manual')
    expect(view.retry.mode).toBe('manual')
    expect(view.message).toMatch(/cauză tehnică/i)
    expect(view.nextAction).not.toMatch(/POWERFUL|comut|folosește.*Reia/i)
    expect(view.modelOutcome).toBeNull()
  })

  it('keeps a publisher rejection terminal until the owner chooses Reia', () => {
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'failed',
      progress: 'publisher_manual_restart_required',
      log: 'ci_failed',
    }, {
      state: 'diagnosing',
      nextAction: 'Verifică CI; numai ownerul poate folosi Reia.',
    })
    expect(view.state).toBe('waiting_manual')
    expect(view.retry.mode).toBe('manual')
    expect(view.message).toMatch(/nu pornește automat/i)
    expect(view.nextAction).toMatch(/Reia/i)
  })

  it('treats a non-publishable POWERFUL result as final diagnostics without another recommendation', () => {
    const record = constructorWorkerUnresolvedRecord('no_changes', 'powerful')
    const view = constructorContinuity({
      status: 'failed',
      constructorStage: 'unresolved',
      progress: record.progress,
      log: record.evidence,
    })
    expect(view.modelOutcome).toMatchObject({
      profile: 'powerful', result: 'unresolved', reasonCode: 'no_changes', manualRecommendation: null,
    })
    expect(view.message).toMatch(/eșec final/i)
    expect(view.nextAction).toMatch(/terminal.*nu recomandă Reia.*model superior/i)
  })

  it('does not infer a model outcome from raw text or legacy evidence without a measured profile', () => {
    expect(constructorModelOutcome('modelul pare prea slab')).toBeNull()
    expect(constructorModelOutcome('worker_failure:no_changes')).toBeNull()
    expect(constructorModelOutcome('worker_failure:no_changes;profile=fast')).toBeNull()
    expect(constructorModelOutcome('worker_unresolved:no_changes;profile=fast;detail=/private/path')).toBeNull()
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
