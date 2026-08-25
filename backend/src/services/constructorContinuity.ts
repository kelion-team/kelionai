import type { BuildJob } from '../db.js'
import type { ConstructorIncident } from './constructorIncident.js'

/**
 * The single, safe projection of a Constructor order for Admin and chat.
 * It is deliberately derived only from durable job / incident records: a
 * friendly status must never turn an unverified transition into success.
 */
export type ContinuityStepState = 'pending' | 'active' | 'verified' | 'blocked'

export interface ConstructorContinuity {
  state: 'queued' | 'running' | 'blocked' | 'completed' | 'cancelled'
  checkpoint: string
  heartbeat: { lastAt: string; stale: boolean; timeoutMinutes: number }
  steps: Array<{ id: string; label: string; state: ContinuityStepState }>
  retry: { allowed: boolean; attempts: number; nextAction: string }
  escalation: null | { cause: string; evidence: string; nextAction: string }
  proof: null | { commit: string; liveVersion: string; ci: string }
  message: string
}

const stages = ['queued', 'claimed', 'accepted', 'working', 'gates_passed', 'pr_opened', 'merged', 'deployed'] as const
const labels: Record<(typeof stages)[number], string> = {
  queued: 'Cerință salvată',
  claimed: 'Worker revendicat',
  accepted: 'Plan acceptat',
  working: 'Implementare și teste',
  gates_passed: 'Porți verificate',
  pr_opened: 'PR deschis',
  merged: 'Master actualizat',
  deployed: 'Live verificat',
}

function stageIndex(stage: string): number {
  const found = stages.indexOf(stage as (typeof stages)[number])
  return found < 0 ? 0 : found
}

function staleAt(updatedAt: string, now: number): boolean {
  const parsed = Date.parse(updatedAt)
  return !Number.isFinite(parsed) || now - parsed > 15 * 60_000
}

export function constructorContinuity(
  job: BuildJob,
  incident: ConstructorIncident | null = null,
  now = Date.now(),
): ConstructorContinuity {
  const complete = job.status === 'done' && job.constructorStage === 'deployed'
    && Boolean(job.commit && job.liveVersion && job.ci === 'green')
  const failed = job.status === 'failed' || Boolean(incident && incident.state !== 'closed')
  const activeStage = stageIndex(job.constructorStage)
  const steps = stages.map((id, index) => ({
    id,
    label: labels[id],
    state: (failed && index >= activeStage ? 'blocked' : index < activeStage || complete ? 'verified' : index === activeStage ? 'active' : 'pending') as ContinuityStepState,
  }))
  const escalation = incident ? {
    cause: incident.causeSummary,
    evidence: incident.evidence.slice(-500),
    nextAction: incident.nextAction,
  } : job.status === 'failed' ? {
    cause: 'Eșec raportat fără incident lizibil.',
    evidence: (job.log ?? job.progress ?? 'Fără dovadă disponibilă.').slice(-500),
    nextAction: 'Creează sau repară incidentul Constructor înainte de reluare.',
  } : null
  const retryAllowed = !complete && job.status !== 'cancelled' && job.attempts < 3
  const state: ConstructorContinuity['state'] = complete ? 'completed'
    : job.status === 'cancelled' ? 'cancelled'
      : failed ? 'blocked'
        : job.status === 'queued' ? 'queued' : 'running'
  const checkpoint = complete ? 'deployed' : job.constructorStage || 'queued'
  return {
    state,
    checkpoint,
    heartbeat: { lastAt: job.updatedAt, stale: state === 'running' && staleAt(job.updatedAt, now), timeoutMinutes: 15 },
    steps,
    retry: {
      allowed: retryAllowed,
      attempts: job.attempts,
      nextAction: escalation?.nextAction ?? (complete ? 'Păstrează dovada și monitorizează regresiile.' : 'Continuă de la checkpointul durabil; nu crea un job duplicat.'),
    },
    escalation,
    proof: complete ? { commit: job.commit!, liveVersion: job.liveVersion!, ci: job.ci! } : null,
    message: complete
      ? 'Finalizat cu dovadă live.'
      : escalation
        ? `Blocat: ${escalation.cause} Următorul pas: ${escalation.nextAction}`
        : `În curs la checkpointul ${checkpoint}.`,
  }
}
