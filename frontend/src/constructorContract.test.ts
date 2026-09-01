import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  constructorAvailabilityFromSnapshot,
  constructorHasVerifiedLiveResult,
  constructorJobsFromSnapshot,
  constructorJobCanBeCancelled,
  constructorPersistentEventsText,
  isConstructorContinuity,
  isConstructorWorkCard,
  type ConstructorContinuity,
  type ConstructorWorkCard,
} from './lib/constructorContract'

function continuity(complete: boolean): ConstructorContinuity {
  return {
    state: complete ? 'completed' : 'waiting_manual',
    checkpoint: complete ? 'deployed' : 'done',
    message: 'test',
    nextAction: null,
    retry: { mode: 'manual', attempts: 0 },
    finalProof: {
      complete,
      commit: complete ? 'a'.repeat(40) : null,
      liveVersion: complete ? 'a'.repeat(40) : null,
    },
    progress: {
      percent: complete ? 100 : null,
      completed: 0,
      total: 0,
      currentStage: null,
      resolved: complete,
      source: 'constructor_activity_events',
    },
    activity: [],
    eventCount: 0,
  }
}

function workCard(): ConstructorWorkCard {
  const progress = continuity(false).progress
  return {
    id: 'constructor:7',
    canonicalLink: '#constructor-work-card-7',
    objective: 'Fix the flow',
    acceptanceCriteria: ['tests pass'],
    contextLinks: [],
    owner: 'owner@example.com',
    actor: 'codex-worker',
    plan: [{ key: 'working', label: 'Lucrează', state: 'current' }],
    currentStep: 'working',
    status: 'running',
    progress,
    heartbeatAt: '2026-08-26T12:00:00.000Z',
    activity: [],
    decisions: [],
    approvals: [],
    risks: [],
    dependencies: [],
    escalationCondition: 'on failure',
    finalResult: null,
    evidence: { eventCount: 0, prUrl: null, ci: null, commit: null, liveVersion: null },
    closure: { resolved: false, closedAt: null },
  }
}

describe('contractul acțiunilor și rezultatului Constructor în Admin', () => {
  it('nu prezintă un done legacy/incomplet drept live verificat', () => {
    expect(constructorHasVerifiedLiveResult('done')).toBe(false)
    expect(constructorHasVerifiedLiveResult('done', continuity(false))).toBe(false)
    expect(constructorHasVerifiedLiveResult('done', continuity(true))).toBe(true)
    expect(constructorHasVerifiedLiveResult('failed', continuity(true))).toBe(false)
    expect(constructorHasVerifiedLiveResult('done', {} as ConstructorContinuity)).toBe(false)
  })

  it('respinge profund continuity și workCard incomplete înainte de randare', () => {
    expect(isConstructorContinuity(continuity(false))).toBe(true)
    expect(isConstructorContinuity({})).toBe(false)
    expect(isConstructorContinuity({ ...continuity(false), finalProof: {} })).toBe(false)
    expect(isConstructorContinuity({ ...continuity(true), finalProof: { complete: true, commit: null, liveVersion: null } })).toBe(false)
    expect(isConstructorContinuity({ ...continuity(true), finalProof: { complete: true, commit: 'a'.repeat(40), liveVersion: 'b'.repeat(40) } })).toBe(false)
    expect(isConstructorContinuity({ ...continuity(false), activity: [{}] })).toBe(false)

    expect(isConstructorWorkCard(workCard())).toBe(true)
    expect(isConstructorWorkCard({})).toBe(false)
    expect(isConstructorWorkCard({ ...workCard(), acceptanceCriteria: null })).toBe(false)
    expect(isConstructorWorkCard({ ...workCard(), evidence: {} })).toBe(false)
    expect(isConstructorWorkCard({ ...workCard(), plan: [{}] })).toBe(false)
    expect(isConstructorWorkCard({ ...workCard(), canonicalLink: 'javascript:alert(1)' })).toBe(false)
    expect(isConstructorWorkCard({ ...workCard(), contextLinks: ['javascript:alert(1)'] })).toBe(false)

    const stage = fs.readFileSync(new URL('./pages/Stage.tsx', import.meta.url), 'utf8')
    expect(stage).toContain('value.continuity === undefined || isConstructorContinuity(value.continuity)')
    expect(stage).toContain('value.workCard === undefined || value.workCard === null || isConstructorWorkCard(value.workCard)')
  })

  it('permite anularea exact pentru coada neatinsă și etapele workerului anulabile', () => {
    expect(constructorJobCanBeCancelled('queued', 'queued')).toBe(true)
    expect(constructorJobCanBeCancelled('running', 'claimed')).toBe(true)
    expect(constructorJobCanBeCancelled('running', 'accepted')).toBe(true)
    expect(constructorJobCanBeCancelled('running', 'working')).toBe(true)
    expect(constructorJobCanBeCancelled('running', 'gates_passed')).toBe(false)
    expect(constructorJobCanBeCancelled('done', 'deployed')).toBe(false)
  })

  it('nu prezintă o cronologie necitibilă drept zero evenimente persistente', () => {
    const readable = continuity(false).progress
    expect(constructorPersistentEventsText(readable, 0)).toBe('0')
    expect(constructorPersistentEventsText({ ...readable, source: 'unavailable' }, 0)).toBe('necitibile')
  })

  it('distinge lista de joburi goală măsurată de un envelope lipsă sau malformat', () => {
    const isJob = (value: unknown): value is { id: number } =>
      Boolean(value)
      && typeof value === 'object'
      && Number.isSafeInteger((value as { id?: unknown }).id)

    expect(constructorJobsFromSnapshot({ jobs: [] }, isJob)).toEqual([])
    expect(constructorJobsFromSnapshot({ jobs: [{ id: 7 }] }, isJob)).toEqual([{ id: 7 }])
    expect(constructorJobsFromSnapshot({}, isJob)).toBeNull()
    expect(constructorJobsFromSnapshot({ jobs: null }, isJob)).toBeNull()
    expect(constructorJobsFromSnapshot({ jobs: 'none' }, isJob)).toBeNull()
    expect(constructorJobsFromSnapshot({ jobs: [{ id: '7' }] }, isJob)).toBeNull()
  })

  it('nu promite pornire/ETA pentru busy, offline sau contract incomplet', () => {
    expect(constructorAvailabilityFromSnapshot({
      acceptingWork: true,
      workerCanStartNow: true,
      constructor: { state: 'ready' },
    })).toEqual({ state: 'ready', acceptingWork: true, workerCanStartNow: true })

    expect(constructorAvailabilityFromSnapshot({
      acceptingWork: true,
      workerCanStartNow: true,
      constructor: { state: 'busy' },
    })).toEqual({ state: 'busy', acceptingWork: true, workerCanStartNow: false })

    for (const state of ['offline', 'setup_required', 'degraded', 'unknown']) {
      expect(constructorAvailabilityFromSnapshot({
        acceptingWork: true,
        workerCanStartNow: true,
        constructor: { state },
      })).toMatchObject({ acceptingWork: false, workerCanStartNow: false })
    }
    expect(constructorAvailabilityFromSnapshot({ constructor: { state: 'ready' } }))
      .toEqual({ state: 'ready', acceptingWork: false, workerCanStartNow: false })
    expect(constructorAvailabilityFromSnapshot(null))
      .toEqual({ state: 'unknown', acceptingWork: false, workerCanStartNow: false })
  })
})
