import { describe, expect, it } from 'vitest'
import {
  projectConstructorObservability,
  type ConstructorCatalogEntry,
  type ConstructorPersistedEvent,
} from './constructorObservability.js'

const catalog: ConstructorCatalogEntry[] = [
  { activityKey: 'queued', sequenceNo: 0, label: 'Acceptata', terminal: false },
  { activityKey: 'working', sequenceNo: 10, label: 'Executata', terminal: false },
  { activityKey: 'deployed', sequenceNo: 40, label: 'Live', terminal: true },
  { activityKey: 'automatic_retry', sequenceNo: null, label: 'Reluare automata', terminal: false },
  { activityKey: 'manual_owner_retry', sequenceNo: null, label: 'Reluare ceruta de owner', terminal: false },
]

const event = (
  id: string,
  activityKey: string,
  stageKey: string | null,
  sequenceNo: number | null,
): ConstructorPersistedEvent => ({
  id,
  jobId: 7,
  activityKey,
  stageKey,
  status: 'running',
  createdAt: `2026-08-25T00:00:0${id}.000Z`,
  label: catalog.find((entry) => entry.activityKey === activityKey)?.label ?? activityKey,
  sequenceNo,
})

describe('Constructor observability', () => {
  it('does not invent progress from a stage string without persistent events', () => {
    const view = projectConstructorObservability({ id: 7, status: 'running', constructorStage: 'working' }, catalog, [])
    expect(view.progress.percent).toBeNull()
    expect(view.progress.completed).toBe(0)
    expect(view.progress.total).toBe(2)
  })

  it('does not advance beyond the last measured event when the stage string moves ahead', () => {
    const view = projectConstructorObservability({ id: 7, status: 'running', constructorStage: 'deployed' }, catalog, [event('1', 'working', 'working', 10)])
    expect(view.progress.percent).toBe(50)
  })
  it('counts confirmed catalog milestones instead of treating sequence gaps as completed work', () => {
    const view = projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'working' },
      catalog,
      [event('1', 'queued', 'queued', 0), event('2', 'working', 'working', 10)],
    )
    expect(view.progress.percent).toBe(50)
    expect(view.progress.source).toBe('constructor_activity_events')
    expect(view.activity.map((item) => item.label)).toEqual(['Acceptata', 'Executata'])
  })

  it('keeps progress monotonic through a persisted automatic retry and survives reconstruction', () => {
    const persisted = [
      event('1', 'queued', 'queued', 0),
      event('2', 'working', 'working', 10),
      event('3', 'automatic_retry', 'queued', null),
    ]
    const first = projectConstructorObservability(
      { id: 7, status: 'queued', constructorStage: 'queued' }, catalog, persisted,
    )
    const afterRefresh = projectConstructorObservability(
      { id: 7, status: 'queued', constructorStage: 'queued' }, catalog, JSON.parse(JSON.stringify(persisted)),
    )
    expect(afterRefresh).toEqual(first)
    expect(first.progress.percent).toBe(50)
    expect(first.activity.at(-1)?.state).toBe('recovery')
  })

  it('attributes an explicit owner retry separately from automatic recovery', () => {
    const view = projectConstructorObservability(
      { id: 7, status: 'queued', constructorStage: 'queued' },
      catalog,
      [
        event('1', 'working', 'working', 10),
        event('2', 'manual_owner_retry', 'queued', null),
      ],
    )
    expect(view.activity.at(-1)).toMatchObject({
      eventKey: 'manual_owner_retry',
      label: 'Reluare ceruta de owner',
      state: 'recovery',
    })
  })

  it('reaches 100 only with the authoritative deployed result', () => {
    const deployed = event('3', 'deployed', 'deployed', 40)
    expect(projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'deployed' }, catalog, [deployed],
    ).progress.percent).toBeLessThan(100)
    expect(projectConstructorObservability(
      { id: 7, status: 'done', constructorStage: 'deployed', commit: 'a'.repeat(40), liveVersion: 'a'.repeat(40) },
      catalog,
      [deployed],
    ).progress.percent).toBe(100)
  })

  it('keeps the durable total and highest stage while returning only a recent window', () => {
    const view = projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'working' },
      catalog,
      [event('9', 'automatic_retry', 'queued', null)],
      { eventCount: 10_000, highestSequence: 40 },
    )
    expect(view.eventCount).toBe(10_000)
    expect(view.activity).toHaveLength(1)
    expect(view.progress.percent).toBe(99)
  })

  it('marks an unreadable or incomplete catalog unavailable instead of projecting factual zero progress', () => {
    const view = projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'working' },
      [],
      [],
    )
    expect(view.progress.source).toBe('unavailable')
    expect(view.progress.percent).toBeNull()
    expect(view.progress.resolved).toBe(false)
  })
})
