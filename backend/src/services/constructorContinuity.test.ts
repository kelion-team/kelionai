import { describe, expect, it } from 'vitest'
import { constructorContinuity } from './constructorContinuity.js'
import type { BuildJob } from '../db.js'

const job = (overrides: Partial<BuildJob> = {}): BuildJob => ({
  id: 1, orderedBy: 'owner@example.com', orderText: 'repair', status: 'running', attempts: 1,
  branch: null, prUrl: null, tokens: 0, log: null, progress: 'working', ci: null, brain: null,
  costUsd: null, codexTaskId: 'codex-task', constructorStage: 'working', commit: null,
  liveVersion: null, createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:10:00.000Z', ...overrides,
})

describe('constructor continuity projection', () => {
  it('reports a stale heartbeat without inventing a failure', () => {
    const result = constructorContinuity(job(), null, Date.parse('2026-08-25T10:26:00.000Z'))
    expect(result.state).toBe('running')
    expect(result.heartbeat.stale).toBe(true)
    expect(result.proof).toBeNull()
    expect(result.steps.find((step) => step.id === 'working')?.state).toBe('active')
  })

  it('requires all terminal evidence before calling a job complete', () => {
    const incomplete = constructorContinuity(job({ status: 'done', constructorStage: 'deployed', commit: 'a'.repeat(40), liveVersion: 'abcdef1', ci: null }))
    expect(incomplete.state).not.toBe('completed')
    const complete = constructorContinuity(job({ status: 'done', constructorStage: 'deployed', commit: 'a'.repeat(40), liveVersion: 'abcdef1', ci: 'green' }))
    expect(complete.state).toBe('completed')
    expect(complete.proof?.liveVersion).toBe('abcdef1')
  })

  it('makes the incident cause, evidence and next action visible when blocked', () => {
    const result = constructorContinuity(job({ status: 'failed', attempts: 3, log: 'test failed' }), {
      id: 7, jobId: 1, fingerprint: 'repair', state: 'diagnosing', stage: 'tests', causeCode: 'test_failure',
      causeSummary: 'Un test a eșuat.', evidence: 'assertion failed', responsible: 'kelion', nextAction: 'Repară testul.',
      verification: null, lesson: null, recurrenceCount: 1, strategy: null, strategyActionFingerprint: null,
      strategyEvidenceFingerprint: null, strategyDecisionCount: 0, strategyPending: false,
      openedAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:10:00.000Z', closedAt: null,
    })
    expect(result.state).toBe('blocked')
    expect(result.escalation).toMatchObject({ cause: 'Un test a eșuat.', nextAction: 'Repară testul.' })
    expect(result.retry.allowed).toBe(false)
  })
})
