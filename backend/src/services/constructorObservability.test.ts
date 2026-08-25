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
  it('derives progress from persisted catalog sequence rather than fixed percentages', () => {
    const view = projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'working' },
      catalog,
      [event('1', 'queued', 'queued', 0), event('2', 'working', 'working', 10)],
    )
    expect(view.progress.percent).toBe(25)
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
    expect(first.progress.percent).toBe(25)
    expect(first.activity.at(-1)?.state).toBe('recovery')
  })

  it('reaches 100 only with the authoritative deployed result', () => {
    const deployed = event('3', 'deployed', 'deployed', 40)
    expect(projectConstructorObservability(
      { id: 7, status: 'running', constructorStage: 'deployed' }, catalog, [deployed],
    ).progress.percent).toBeLessThan(100)
    expect(projectConstructorObservability(
      { id: 7, status: 'done', constructorStage: 'deployed', commit: 'a'.repeat(40), liveVersion: 'v1' },
      catalog,
      [deployed],
    ).progress.percent).toBe(100)
  })
})
