import { getPool } from '../db.js'
import type { ConstructorObservabilityView } from './constructorObservability.js'

export interface ConstructorWorkCardJob {
  id: number
  orderText: string
  orderedBy?: string | null
  brain?: string | null
  status: string
  constructorStage?: string | null
  progress?: string | null
  progressAt?: string | Date | null
  updatedAt?: string | Date | null
  prUrl?: string | null
  ci?: string | null
  commit?: string | null
  liveVersion?: string | null
}

export interface ConstructorWorkCardMetadata {
  acceptanceCriteria: string[]
  contextLinks: string[]
  decisions: string[]
  approvals: string[]
  risks: string[]
  dependencies: string[]
  escalationCondition: string
}

export interface ConstructorWorkCardView {
  id: string
  canonicalLink: string
  objective: string
  acceptanceCriteria: string[]
  contextLinks: string[]
  owner: string | null
  actor: string | null
  plan: Array<{ key: string; label: string; state: 'completed' | 'current' | 'pending' }>
  currentStep: string | null
  status: string
  progress: ConstructorObservabilityView['progress']
  heartbeatAt: string | null
  activity: ConstructorObservabilityView['activity']
  decisions: string[]
  approvals: string[]
  evidence: {
    prUrl: string | null
    ci: string | null
    commit: string | null
    liveVersion: string | null
    eventCount: number
  }
  risks: string[]
  dependencies: string[]
  escalationCondition: string
  finalResult: { commit: string; liveVersion: string } | null
  closure: { resolved: boolean; closedAt: string | null }
}

export interface ConstructorWorkCardStage {
  key: string
  sequence: number
  label: string
}

const iso = (value: string | Date | null | undefined): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function projectConstructorWorkCard(
  job: ConstructorWorkCardJob,
  observation: ConstructorObservabilityView,
  metadata: ConstructorWorkCardMetadata,
  stages: readonly ConstructorWorkCardStage[],
): ConstructorWorkCardView {
  const orderedStages = [...stages].sort((a, b) => a.sequence - b.sequence)
  const reached = new Set(observation.activity.flatMap((event) => event.stage ? [event.stage] : []))
  const currentKey = job.constructorStage ?? job.status
  const resolved = observation.progress.resolved
  const closed = resolved
    || job.status === 'cancelled'
    || (job.status === 'failed' && /anulat/i.test(job.progress ?? ''))
  return {
    id: `constructor:${job.id}`,
    canonicalLink: `#constructor-work-card-${job.id}`,
    objective: job.orderText,
    acceptanceCriteria: metadata.acceptanceCriteria,
    contextLinks: metadata.contextLinks,
    owner: job.orderedBy ?? null,
    actor: job.brain === 'codex-worker'
      ? 'OpenCode + Qwen local (llama.cpp)'
      : job.brain ?? null,
    plan: orderedStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      state: stage.key === currentKey && !resolved
        ? 'current'
        : reached.has(stage.key) || resolved
          ? 'completed'
          : 'pending',
    })),
    currentStep: observation.progress.currentStage,
    status: job.status,
    progress: observation.progress,
    heartbeatAt: iso(job.progressAt ?? job.updatedAt),
    activity: observation.activity,
    decisions: metadata.decisions,
    approvals: metadata.approvals,
    evidence: {
      prUrl: job.prUrl ?? null,
      ci: job.ci ?? null,
      commit: job.commit ?? null,
      liveVersion: job.liveVersion ?? null,
      eventCount: observation.eventCount,
    },
    risks: metadata.risks,
    dependencies: metadata.dependencies,
    escalationCondition: metadata.escalationCondition,
    finalResult: resolved && job.commit && job.liveVersion
      ? { commit: job.commit, liveVersion: job.liveVersion }
      : null,
    closure: { resolved: closed, closedAt: closed ? iso(job.updatedAt) : null },
  }
}

interface CardRow {
  job_id: string
  acceptance_criteria: unknown
  context_links: unknown
  decisions: unknown
  approvals: unknown
  risks: unknown
  dependencies: unknown
  escalation_condition: string
}

interface StageRow {
  activity_key: string
  sequence_no: number
  label_ro: string
}

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : []

export async function constructorWorkCardsForJobs(
  jobs: readonly ConstructorWorkCardJob[],
  observations: ReadonlyMap<number, ConstructorObservabilityView>,
): Promise<Map<number, ConstructorWorkCardView> | null> {
  const result = new Map<number, ConstructorWorkCardView>()
  if (jobs.length === 0) return result
  try {
    const [cardsResult, stagesResult] = await Promise.all([
      getPool().query<CardRow>(
        `SELECT job_id::text, acceptance_criteria, context_links, decisions,
                approvals, risks, dependencies, escalation_condition
           FROM constructor_work_cards WHERE job_id = ANY($1::bigint[])`,
        [jobs.map((job) => job.id)],
      ),
      getPool().query<StageRow>(
        `SELECT activity_key, sequence_no, label_ro
           FROM constructor_activity_catalog
          WHERE sequence_no IS NOT NULL ORDER BY sequence_no`,
      ),
    ])
    const cards = new Map(cardsResult.rows.map((row) => [Number(row.job_id), row]))
    if (cards.size !== jobs.length) return null
    const stages = stagesResult.rows.map((row) => ({
      key: row.activity_key,
      sequence: Number(row.sequence_no),
      label: row.label_ro,
    }))
    for (const job of jobs) {
      const row = cards.get(job.id)
      const observation = observations.get(job.id)
      if (!row || !observation) continue
      result.set(job.id, projectConstructorWorkCard(job, observation, {
        acceptanceCriteria: strings(row.acceptance_criteria),
        contextLinks: strings(row.context_links),
        decisions: strings(row.decisions),
        approvals: strings(row.approvals),
        risks: strings(row.risks),
        dependencies: strings(row.dependencies),
        escalationCondition: row.escalation_condition,
      }, stages))
    }
  } catch {
    return null
  }
  return result
}
