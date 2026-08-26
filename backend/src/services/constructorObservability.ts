import { getPool } from '../db.js'
import { procentDinEtapePersistate } from './progresOrdin.js'

export interface ConstructorCatalogEntry {
  activityKey: string
  sequenceNo: number | null
  label: string
  terminal: boolean
}

export interface ConstructorPersistedEvent {
  id: string
  jobId: number
  activityKey: string
  stageKey: string | null
  status: string
  createdAt: string
  label: string
  sequenceNo: number | null
}

export interface ConstructorObservableJob {
  id: number
  status: string
  constructorStage?: string | null
  commit?: string | null
  liveVersion?: string | null
}

export interface ConstructorActivityView {
  id: string
  eventKey: string
  stage: string | null
  label: string
  state: 'completed' | 'current' | 'recovery' | 'resolved'
  at: string
  percent: number | null
}

export interface ConstructorObservabilityView {
  progress: {
    percent: number | null
    completed: number
    total: number
    currentStage: string | null
    resolved: boolean
    source: 'constructor_activity_events' | 'unavailable'
  }
  activity: ConstructorActivityView[]
  /** Numărul total durabil; `activity` conține numai fereastra recentă. */
  eventCount: number
}

const unavailable = (): ConstructorObservabilityView => ({
  progress: {
    percent: null,
    completed: 0,
    total: 0,
    currentStage: null,
    resolved: false,
    source: 'unavailable',
  },
  activity: [],
  eventCount: 0,
})

export function projectConstructorObservability(
  job: ConstructorObservableJob,
  catalog: readonly ConstructorCatalogEntry[],
  events: readonly ConstructorPersistedEvent[],
  summary?: { eventCount: number; highestSequence: number | null },
): ConstructorObservabilityView {
  const sequenced = catalog
    .filter((entry): entry is ConstructorCatalogEntry & { sequenceNo: number } => entry.sequenceNo !== null)
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
  if (sequenced.length < 2) return unavailable()

  const byKey = new Map(catalog.map((entry) => [entry.activityKey, entry]))
  const total = sequenced[sequenced.length - 1].sequenceNo - sequenced[0].sequenceNo
  const finalResolved = job.status === 'done'
    && job.constructorStage === 'deployed'
    && /^[0-9a-f]{40}$/.test(job.commit ?? '')
    && job.liveVersion === job.commit

  let highestSequence = Math.max(
    sequenced[0].sequenceNo,
    summary?.highestSequence ?? sequenced[0].sequenceNo,
  )
  const orderedEvents = [...events].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return byTime || a.id.localeCompare(b.id, undefined, { numeric: true })
  })
  for (const event of orderedEvents) {
    if (event.sequenceNo !== null) highestSequence = Math.max(highestSequence, event.sequenceNo)
  }
  const currentCatalog = byKey.get(job.constructorStage ?? job.status)
  if (currentCatalog?.sequenceNo !== null && currentCatalog?.sequenceNo !== undefined) {
    highestSequence = Math.max(highestSequence, currentCatalog.sequenceNo)
  }
  const completed = Math.max(0, highestSequence - sequenced[0].sequenceNo)
  const percent = procentDinEtapePersistate(completed, total, finalResolved)

  let runningSequence = sequenced[0].sequenceNo
  const activity = orderedEvents.map((event, index): ConstructorActivityView => {
    if (event.sequenceNo !== null) runningSequence = Math.max(runningSequence, event.sequenceNo)
    const isLast = index === orderedEvents.length - 1
    const isRecovery = event.activityKey === 'automatic_retry'
      || event.activityKey === 'external_action_required'
    const isResolved = event.activityKey === 'deployed' || event.activityKey === 'cancelled'
    return {
      id: event.id,
      eventKey: event.activityKey,
      stage: event.stageKey,
      label: event.label,
      state: isResolved ? 'resolved' : isRecovery ? 'recovery' : isLast ? 'current' : 'completed',
      at: event.createdAt,
      percent: procentDinEtapePersistate(
        Math.max(0, runningSequence - sequenced[0].sequenceNo),
        total,
        finalResolved && event.activityKey === 'deployed',
      ),
    }
  })

  return {
    progress: {
      percent,
      completed,
      total,
      currentStage: currentCatalog?.label ?? null,
      resolved: finalResolved,
      source: 'constructor_activity_events',
    },
    activity,
    eventCount: summary?.eventCount ?? events.length,
  }
}

interface CatalogRow {
  activity_key: string
  sequence_no: number | null
  label_ro: string
  terminal: boolean
}

interface EventRow {
  id: string
  job_id: string
  activity_key: string
  stage_key: string | null
  status: string
  created_at: Date | string
  label_ro: string
  sequence_no: number | null
  total_events: string | number
  highest_sequence: string | number | null
}

export async function constructorObservabilityForJobs(
  jobs: readonly ConstructorObservableJob[],
): Promise<Map<number, ConstructorObservabilityView>> {
  const result = new Map<number, ConstructorObservabilityView>()
  if (jobs.length === 0) return result
  try {
    const [catalogResult, eventResult] = await Promise.all([
      getPool().query<CatalogRow>(
        `SELECT activity_key, sequence_no, label_ro, terminal
           FROM constructor_activity_catalog
          ORDER BY sequence_no NULLS LAST, activity_key`,
      ),
      getPool().query<EventRow>(
        `WITH ranked AS (
           SELECT e.id, e.job_id, e.activity_key, e.stage_key, e.status,
                  e.created_at, c.label_ro, c.sequence_no,
                  count(*) OVER (PARTITION BY e.job_id) AS total_events,
                  max(c.sequence_no) OVER (PARTITION BY e.job_id) AS highest_sequence,
                  row_number() OVER (
                    PARTITION BY e.job_id ORDER BY e.created_at DESC, e.id DESC
                  ) AS recent_rank
             FROM constructor_activity_events e
             JOIN build_jobs b ON b.id=e.job_id AND b.execution_cycle=e.execution_cycle
             JOIN constructor_activity_catalog c ON c.activity_key=e.activity_key
            WHERE e.job_id = ANY($1::bigint[])
         )
         SELECT id::text, job_id::text, activity_key, stage_key, status,
                created_at, label_ro, sequence_no, total_events, highest_sequence
           FROM ranked WHERE recent_rank <= 100
          ORDER BY job_id, created_at, id`,
        [jobs.map((job) => job.id)],
      ),
    ])
    const catalog = catalogResult.rows.map((row) => ({
      activityKey: row.activity_key,
      sequenceNo: row.sequence_no === null ? null : Number(row.sequence_no),
      label: row.label_ro,
      terminal: row.terminal,
    }))
    for (const job of jobs) {
      const events = eventResult.rows
        .filter((row) => Number(row.job_id) === job.id)
        .map((row) => ({
          id: row.id,
          jobId: Number(row.job_id),
          activityKey: row.activity_key,
          stageKey: row.stage_key,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
          label: row.label_ro,
          sequenceNo: row.sequence_no === null ? null : Number(row.sequence_no),
        }))
      const first = eventResult.rows.find((row) => Number(row.job_id) === job.id)
      result.set(job.id, projectConstructorObservability(job, catalog, events, first ? {
        eventCount: Number(first.total_events),
        highestSequence: first.highest_sequence === null ? null : Number(first.highest_sequence),
      } : undefined))
    }
  } catch {
    for (const job of jobs) result.set(job.id, unavailable())
  }
  return result
}
