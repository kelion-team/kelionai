export type ConstructorContinuityState =
  | 'queued'
  | 'running'
  | 'recovering'
  | 'waiting_external'
  | 'waiting_manual'
  | 'completed'
  | 'cancelled'

export interface ConstructorContinuityJob {
  status: string
  constructorStage?: string | null
  progress?: string | null
  log?: string | null
  attempts?: number
  commit?: string | null
  liveVersion?: string | null
}

export interface ConstructorContinuity {
  state: ConstructorContinuityState
  checkpoint: string
  message: string
  nextAction: string | null
  retry: {
    mode: 'automatic' | 'manual'
    attempts: number
  }
  finalProof: {
    complete: boolean
    commit: string | null
    liveVersion: string | null
  }
}

export function constructorContinuity(
  job: ConstructorContinuityJob,
  incident?: unknown,
): ConstructorContinuity {
  const checkpoint = job.constructorStage ?? job.status
  const progress = job.progress ?? ''
  const cancelled = job.status === 'cancelled'
    || (job.status === 'failed' && /anulat/i.test(progress))
  const complete = job.status === 'done'
    && checkpoint === 'deployed'
    && /^[0-9a-f]{40}$/.test(job.commit ?? '')
    && job.liveVersion === job.commit
  const incidentState = typeof incident === 'object' && incident !== null && 'state' in incident
    ? String(incident.state)
    : null
  const incidentNextAction = typeof incident === 'object' && incident !== null && 'nextAction' in incident
    ? String(incident.nextAction)
    : null
  const pipelineExternalAction = job.log === 'branch_protection_invalid'
    ? 'Corectează protecția ramurii master conform politicii Constructor; publisherul va relua automat.'
    : job.log === 'github_auth_required'
      ? 'Reautorizează credentiala GitHub limitată a publisherului; jobul va continua automat.'
      : null
  const waitingExternal = progress === 'external_action_required' || incidentState === 'blocked'
  const waitingManual = job.status === 'failed' && !waitingExternal
  const recovering = !cancelled && !complete && !waitingManual && (
    ['open', 'diagnosing', 'repairing', 'verifying'].includes(incidentState ?? '')
    || /retry|recover|reluare|recovery/i.test(progress)
  )

  let state: ConstructorContinuityState
  let message: string
  let nextAction: string | null = null
  if (complete) {
    state = 'completed'
    message = 'Rezultatul este live si confirmat de serviciul de release.'
  } else if (cancelled) {
    state = 'cancelled'
    message = 'Cererea a fost anulata explicit de administrator.'
  } else if (waitingExternal) {
    state = 'waiting_external'
    message = 'Fluxul asteapta o autorizare externa si se va relua automat dupa confirmare.'
    nextAction = incidentNextAction
      ?? pipelineExternalAction
      ?? 'Finalizează autorizarea externă indicată în starea workerului.'
  } else if (waitingManual) {
    state = 'waiting_manual'
    message = 'Rezultatul terminal vechi nu se reia automat; este necesară comanda explicită Reia.'
    nextAction = 'Folosește Reia numai după verificarea cauzei și a cererii curente.'
  } else if (recovering) {
    state = 'recovering'
    message = 'Constructorul recupereaza automat ultima tranzitie confirmata.'
  } else if (job.status === 'queued') {
    state = 'queued'
    message = 'Cererea este persistata si va fi preluata automat de worker.'
  } else {
    state = 'running'
    message = 'Fluxul avanseaza automat de la ultimul checkpoint confirmat.'
  }

  return {
    state,
    checkpoint,
    message,
    nextAction,
    retry: { mode: waitingManual || cancelled ? 'manual' : 'automatic', attempts: job.attempts ?? 0 },
    finalProof: {
      complete,
      commit: job.commit ?? null,
      liveVersion: job.liveVersion ?? null,
    },
  }
}
