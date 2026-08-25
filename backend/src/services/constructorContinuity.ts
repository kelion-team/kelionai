export type ConstructorContinuityState =
  | 'queued'
  | 'running'
  | 'recovering'
  | 'waiting_external'
  | 'completed'
  | 'cancelled'

export interface ConstructorContinuityJob {
  status: string
  constructorStage?: string | null
  progress?: string | null
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
    mode: 'automatic'
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
  const cancelled = job.status === 'failed' && /anulat/i.test(progress)
  const complete = job.status === 'done'
    && checkpoint === 'deployed'
    && Boolean(job.commit)
    && Boolean(job.liveVersion)
  const waitingExternal = progress === 'external_action_required'
  const incidentStatus = typeof incident === 'object' && incident !== null && 'status' in incident
    ? String(incident.status)
    : null
  const recovering = !cancelled && !complete && (
    job.status === 'failed'
    || incidentStatus === 'open'
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
    nextAction = 'Finalizeaza autorizarea externa indicata in starea workerului.'
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
    retry: { mode: 'automatic', attempts: job.attempts ?? 0 },
    finalProof: {
      complete,
      commit: job.commit ?? null,
      liveVersion: job.liveVersion ?? null,
    },
  }
}
