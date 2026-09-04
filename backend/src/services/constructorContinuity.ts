export type ConstructorContinuityState =
  | 'queued'
  | 'running'
  | 'recovering'
  | 'waiting_external'
  | 'waiting_manual'
  | 'completed'
  | 'cancelled'

export type ConstructorExecutionProfile = 'fast' | 'powerful'
export type ConstructorExecutionFailureCode =
  | 'execution_timeout'
  | 'brain_unavailable'
  | 'worker_internal_failure'
export type ConstructorExecutionUnresolvedReason = 'no_changes' | 'test_failure' | 'quality_gate_failure'
export type ConstructorExecutionReasonCode = ConstructorExecutionFailureCode | ConstructorExecutionUnresolvedReason

export interface ConstructorModelOutcome {
  profile: ConstructorExecutionProfile
  result: 'unresolved' | 'technical_failure'
  reasonCode: ConstructorExecutionReasonCode
  reason: string
  manualRecommendation: null | {
    profile: 'powerful'
    reasonCode: 'fast_result_not_publishable'
    reason: string
  }
}

const FAILURE_REASONS: Readonly<Record<ConstructorExecutionReasonCode, string>> = {
  execution_timeout: 'Execuția a depășit limita măsurată de timp înainte de un rezultat verificabil.',
  test_failure: 'Porțile locale au măsurat cel puțin un test eșuat; rezultatul nu este publicabil.',
  quality_gate_failure: 'O poartă locală de build, tipuri sau lint a respins rezultatul.',
  no_changes: 'Rularea s-a încheiat fără nicio modificare verificabilă în worktree.',
  brain_unavailable: 'Serviciul local de inferență sau modelul selectat nu a fost disponibil tehnic.',
  worker_internal_failure: 'Workerul a raportat o eroare internă fără dovadă de insuficiență a modelului.',
}

const TECHNICAL_FAILURE_EVIDENCE = /^worker_failure:(execution_timeout|brain_unavailable|worker_internal_failure);profile=(fast|powerful)$/
const UNRESOLVED_EVIDENCE = /^worker_unresolved:(no_changes|test_failure|quality_gate_failure);profile=(fast|powerful)$/

/** Persistă numai taxonomia bounded semnată de worker, niciodată jurnalul lui
 * privat. `progress` este o stare canonică; nu programează nicio reluare. */
export function constructorWorkerTechnicalFailureRecord(
  code: ConstructorExecutionFailureCode,
  profile: ConstructorExecutionProfile,
): { evidence: string; progress: string } {
  return {
    evidence: `worker_failure:${code};profile=${profile}`,
    progress: 'technical_failure',
  }
}

/** `unresolved` este permis numai pentru rezultatele bounded măsurate de
 * worker: worktree gol sau porți locale respinse. Backendul nu îl deduce din
 * text liber primit prin API. */
export function constructorWorkerUnresolvedRecord(
  reason: ConstructorExecutionUnresolvedReason,
  profile: ConstructorExecutionProfile,
): { evidence: string; progress: string } {
  return {
    evidence: `worker_unresolved:${reason};profile=${profile}`,
    progress: profile === 'fast' ? 'fast_insufficient' : 'powerful_final_failure',
  }
}

export function constructorModelOutcome(log: string | null | undefined): ConstructorModelOutcome | null {
  const unresolved = UNRESOLVED_EVIDENCE.exec(log ?? '')
  const technical = TECHNICAL_FAILURE_EVIDENCE.exec(log ?? '')
  if (!unresolved && !technical) return null
  const reasonCode: ConstructorExecutionReasonCode = unresolved
    ? unresolved[1] as ConstructorExecutionUnresolvedReason
    : technical![1] as ConstructorExecutionFailureCode
  const profile = (unresolved?.[2] ?? technical![2]) as ConstructorExecutionProfile
  const result = unresolved ? 'unresolved' : 'technical_failure'
  return {
    profile,
    result,
    reasonCode,
    reason: FAILURE_REASONS[reasonCode],
    manualRecommendation: profile === 'fast' && result === 'unresolved'
      ? {
          profile: 'powerful',
          reasonCode: 'fast_result_not_publishable',
          reason: 'FAST 35B nu a produs un rezultat publicabil; poți alege manual POWERFUL 122B înainte de comanda Reia.',
        }
      : null,
  }
}

/** Acțiunea textuală derivă exclusiv din outcome-ul bounded. Disponibilitatea
 * butonului Admin `Reia` este o capabilitate separată; aici nu inventăm o
 * recomandare pentru POWERFUL terminal ori pentru o eroare tehnică. */
export function constructorModelOutcomeNextAction(outcome: ConstructorModelOutcome): string {
  if (outcome.manualRecommendation) {
    return 'Comută manual la POWERFUL 122B dacă decizi asta, apoi folosește explicit Reia.'
  }
  if (outcome.result === 'unresolved' && outcome.profile === 'powerful') {
    return 'Diagnostichează cauza măsurată; ciclul POWERFUL este terminal și nu recomandă Reia sau un model superior.'
  }
  return 'Diagnostichează și remediază cauza tehnică măsurată; acest verdict nu recomandă schimbarea modelului sau Reia.'
}

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
  modelOutcome: ConstructorModelOutcome | null
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
  const modelOutcome = job.status === 'failed' ? constructorModelOutcome(job.log) : null
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
    if (modelOutcome?.manualRecommendation) {
      message = 'Rularea FAST 35B nu a produs un rezultat publicabil; ordinul rămâne nerezolvat și nu se reia automat.'
      nextAction = constructorModelOutcomeNextAction(modelOutcome)
    } else if (modelOutcome?.profile === 'powerful' && modelOutcome.result === 'unresolved') {
      message = 'Rularea POWERFUL 122B nu a produs un rezultat publicabil; acesta este un eșec final care necesită diagnostic.'
      nextAction = constructorModelOutcomeNextAction(modelOutcome)
    } else if (modelOutcome?.result === 'technical_failure' || progress === 'technical_failure') {
      message = 'Rularea s-a oprit dintr-o cauză tehnică; aceasta nu dovedește insuficiența modelului și nu declanșează comutare sau retry.'
      nextAction = modelOutcome
        ? constructorModelOutcomeNextAction(modelOutcome)
        : 'Diagnostichează și remediază cauza tehnică măsurată; acest verdict nu recomandă schimbarea modelului sau Reia.'
    } else if (progress === 'publisher_manual_restart_required') {
      message = 'Publicarea a respins rezultatul, iar Constructorul nu pornește automat o altă execuție de model.'
      nextAction = incidentNextAction ?? 'Verifică diagnosticul publisherului; numai comanda explicită Reia pornește un ciclu nou.'
    } else {
      message = 'Rezultatul terminal legacy nu se reia automat și nu are un outcome canonic pentru o recomandare de model.'
      nextAction = 'Diagnostichează cauza și stabilește separat decizia ownerului; acest verdict legacy nu recomandă un model sau Reia.'
    }
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
    modelOutcome,
  }
}
