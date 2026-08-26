import { describe, expect, it } from 'vitest'
import { projectConstructorWorkCard } from './constructorWorkCard.js'

describe('Constructor canonical work card', () => {
  it('projects every required field from its existing canonical authority', () => {
    const card = projectConstructorWorkCard({
      id: 42,
      orderText: 'Publica rezultatul verificat',
      orderedBy: 'owner@example.test',
      brain: 'codex-worker',
      status: 'running',
      constructorStage: 'working',
      progressAt: '2026-08-25T20:00:00.000Z',
      prUrl: 'https://github.example.invalid/pull/42',
      ci: 'green',
    }, {
      progress: { percent: 25, completed: 2, total: 8, currentStage: 'Executie', resolved: false, source: 'constructor_activity_events' },
      activity: [{ id: '1', eventKey: 'working', stage: 'working', label: 'Executie', state: 'current', at: '2026-08-25T20:00:00.000Z', percent: 25 }],
      eventCount: 1,
    }, {
      acceptanceCriteria: ['Rezultat verificat'],
      contextLinks: ['https://example.invalid/spec'],
      decisions: ['Foloseste fluxul protejat'],
      approvals: [],
      risks: ['Provider extern'],
      dependencies: ['Worker ready'],
      escalationCondition: 'Numai autoritate externa',
    }, [
      { key: 'queued', sequence: 0, label: 'Acceptata' },
      { key: 'working', sequence: 1, label: 'Executie' },
      { key: 'deployed', sequence: 2, label: 'Live' },
    ])
    expect(card).toMatchObject({
      id: 'constructor:42',
      canonicalLink: '#constructor-work-card-42',
      objective: 'Publica rezultatul verificat',
      owner: 'owner@example.test',
      actor: 'codex-worker',
      currentStep: 'Executie',
      heartbeatAt: '2026-08-25T20:00:00.000Z',
      escalationCondition: 'Numai autoritate externa',
      closure: { resolved: false, closedAt: null },
    })
    expect(card.plan.map((step) => step.state)).toEqual(['pending', 'current', 'pending'])
    expect(card.evidence.eventCount).toBe(1)
  })

  it('closes an explicitly cancelled card without fabricating a deploy result', () => {
    const card = projectConstructorWorkCard({
      id: 43,
      orderText: 'Cerere anulată',
      status: 'cancelled',
      constructorStage: 'cancelled',
      progress: 'cancelled_by_admin',
      updatedAt: '2026-08-25T20:00:00.000Z',
    }, {
      progress: { percent: 25, completed: 2, total: 8, currentStage: null, resolved: false, source: 'constructor_activity_events' },
      activity: [{ id: '2', eventKey: 'cancelled', stage: null, label: 'Anulată', state: 'resolved', at: '2026-08-25T20:00:00.000Z', percent: 25 }],
      eventCount: 1,
    }, {
      acceptanceCriteria: [],
      contextLinks: [],
      decisions: [],
      approvals: [],
      risks: [],
      dependencies: [],
      escalationCondition: 'Nicio escaladare',
    }, [
      { key: 'queued', sequence: 0, label: 'Acceptată' },
      { key: 'deployed', sequence: 1, label: 'Live' },
    ])
    expect(card.closure).toEqual({
      resolved: true,
      closedAt: '2026-08-25T20:00:00.000Z',
    })
    expect(card.finalResult).toBeNull()
  })
})
