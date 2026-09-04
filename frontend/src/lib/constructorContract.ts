export type ConstructorJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'

export type ConstructorWorkerState =
  | 'ready'
  | 'busy'
  | 'offline'
  | 'setup_required'
  | 'degraded'
  | 'unknown'

export const CONSTRUCTOR_LOCAL_ACTOR = 'OpenCode + Qwen local (llama.cpp)'

/** UI compatibility for work cards persisted before the local executor. */
export function constructorActorLabel(actor: string | null | undefined): string | null {
  const value = actor?.trim()
  if (!value) return null
  // 'codex-worker' este identitatea de audit istorica pastrata in randurile deja scrise.
  return value === 'codex-worker' ? CONSTRUCTOR_LOCAL_ACTOR : value
}

export interface ConstructorActivity {
  id: string
  eventKey: string
  stage: string | null
  label: string
  state: 'completed' | 'current' | 'recovery' | 'resolved'
  at: string
  percent: number | null
}

export interface ConstructorProgress {
  percent: number | null
  completed: number
  total: number
  currentStage: string | null
  resolved: boolean
  source: 'constructor_activity_events' | 'unavailable'
}

export type ConstructorModelProfile = 'fast' | 'powerful'
export type ConstructorModelOutcomeReasonCode =
  | 'test_failure'
  | 'quality_gate_failure'
  | 'no_changes'
  | 'execution_timeout'
  | 'brain_unavailable'
  | 'worker_internal_failure'

export interface ConstructorManualModelRecommendation {
  profile: 'powerful'
  reasonCode: 'fast_result_not_publishable'
  reason: string
}

export interface ConstructorModelOutcome {
  profile: ConstructorModelProfile
  result: 'unresolved' | 'technical_failure'
  reasonCode: ConstructorModelOutcomeReasonCode
  reason: string
  manualRecommendation: ConstructorManualModelRecommendation | null
}

export interface ConstructorContinuity {
  state:
    | 'queued'
    | 'running'
    | 'recovering'
    | 'waiting_external'
    | 'waiting_manual'
    | 'completed'
    | 'cancelled'
  checkpoint: string
  message: string
  nextAction: string | null
  retry: { mode: 'automatic' | 'manual'; attempts: number }
  finalProof: {
    complete: boolean
    commit: string | null
    liveVersion: string | null
  }
  progress: ConstructorProgress
  activity: ConstructorActivity[]
  eventCount: number
  modelOutcome: ConstructorModelOutcome | null
}

export interface ConstructorWorkCard {
  id: string
  canonicalLink: string
  objective: string
  acceptanceCriteria: string[]
  contextLinks: string[]
  owner: string | null
  actor: string | null
  plan: Array<{
    key: string
    label: string
    state: 'completed' | 'current' | 'pending'
  }>
  currentStep: string | null
  status: string
  progress: ConstructorProgress
  heartbeatAt: string | null
  activity: ConstructorActivity[]
  decisions: string[]
  approvals: string[]
  risks: string[]
  dependencies: string[]
  escalationCondition: string
  finalResult: { commit: string; liveVersion: string } | null
  evidence: {
    eventCount: number
    prUrl: string | null
    ci: string | null
    commit: string | null
    liveVersion: string | null
  }
  closure: { resolved: boolean; closedAt: string | null }
}

export interface ConstructorWorkerSummary {
  cine: 'constructor_pipeline' | 'unavailable'
  state: ConstructorWorkerState
  motiv: string
  lastHeartbeat: string | null
}

export interface ConstructorAvailability {
  state: ConstructorWorkerState
  acceptingWork: boolean
  workerCanStartNow: boolean
}

const constructorRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const nullableString = (value: unknown): boolean => value === null || typeof value === 'string'
const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
const nonNegativeInteger = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0
const validIsoDate = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
const SHA40 = /^[0-9a-f]{40}$/
const UNRESOLVED_REASON_CODES = [
  'test_failure',
  'quality_gate_failure',
  'no_changes',
] as const satisfies readonly ConstructorModelOutcomeReasonCode[]
const TECHNICAL_FAILURE_REASON_CODES = [
  'execution_timeout',
  'brain_unavailable',
  'worker_internal_failure',
] as const satisfies readonly ConstructorModelOutcomeReasonCode[]
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length
  && Object.keys(value).every((key) => expected.includes(key))
const boundedReason = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 500
  && value.trim() === value
  && !/[\p{Cc}\p{Cs}]/u.test(value)
const safeContextLink = (value: string): boolean => {
  if (value.startsWith('#') || value.startsWith('/')) return true
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isConstructorActivity(value: unknown): value is ConstructorActivity {
  if (!constructorRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.eventKey === 'string'
    && nullableString(value.stage)
    && typeof value.label === 'string'
    && ['completed', 'current', 'recovery', 'resolved'].includes(String(value.state ?? ''))
    && validIsoDate(value.at)
    && (value.percent === null || (typeof value.percent === 'number' && Number.isFinite(value.percent)
      && value.percent >= 0 && value.percent <= 100))
}

export function isConstructorProgress(value: unknown): value is ConstructorProgress {
  if (!constructorRecord(value)) return false
  return (value.percent === null || (typeof value.percent === 'number' && Number.isFinite(value.percent)
      && value.percent >= 0 && value.percent <= 100))
    && nonNegativeInteger(value.completed)
    && nonNegativeInteger(value.total)
    && Number(value.completed) <= Number(value.total)
    && nullableString(value.currentStage)
    && typeof value.resolved === 'boolean'
    && (value.source === 'constructor_activity_events' || value.source === 'unavailable')
}

export function isConstructorModelOutcome(value: unknown): value is ConstructorModelOutcome {
  if (!constructorRecord(value) || !exactKeys(value, [
    'profile', 'result', 'reasonCode', 'reason', 'manualRecommendation',
  ])) return false
  if (
    !['fast', 'powerful'].includes(String(value.profile ?? ''))
    || !['unresolved', 'technical_failure'].includes(String(value.result ?? ''))
    || !boundedReason(value.reason)
  ) return false

  const reasonMatchesResult = value.result === 'unresolved'
    ? UNRESOLVED_REASON_CODES.includes(value.reasonCode as typeof UNRESOLVED_REASON_CODES[number])
    : TECHNICAL_FAILURE_REASON_CODES.includes(
        value.reasonCode as typeof TECHNICAL_FAILURE_REASON_CODES[number],
      )
  if (!reasonMatchesResult) return false

  const recommendation = value.manualRecommendation
  if (value.result === 'technical_failure' || value.profile === 'powerful') {
    return recommendation === null
  }
  if (value.profile !== 'fast' || value.result !== 'unresolved' || !constructorRecord(recommendation)) {
    return false
  }
  return exactKeys(recommendation, ['profile', 'reasonCode', 'reason'])
    && recommendation.profile === 'powerful'
    && recommendation.reasonCode === 'fast_result_not_publishable'
    && boundedReason(recommendation.reason)
}

export function isConstructorContinuity(value: unknown): value is ConstructorContinuity {
  if (!constructorRecord(value)
    || !constructorRecord(value.retry)
    || !constructorRecord(value.finalProof)
    || !Object.prototype.hasOwnProperty.call(value, 'modelOutcome')) return false
  const complete = value.finalProof.complete
  const proofValid = complete === false
    ? nullableString(value.finalProof.commit) && nullableString(value.finalProof.liveVersion)
    : complete === true
      && typeof value.finalProof.commit === 'string'
      && SHA40.test(value.finalProof.commit)
      && value.finalProof.liveVersion === value.finalProof.commit
  return ['queued', 'running', 'recovering', 'waiting_external', 'waiting_manual', 'completed', 'cancelled']
    .includes(String(value.state ?? ''))
    && typeof value.checkpoint === 'string'
    && typeof value.message === 'string'
    && nullableString(value.nextAction)
    && (value.retry.mode === 'automatic' || value.retry.mode === 'manual')
    && nonNegativeInteger(value.retry.attempts)
    && proofValid
    && isConstructorProgress(value.progress)
    && Array.isArray(value.activity)
    && value.activity.every(isConstructorActivity)
    && nonNegativeInteger(value.eventCount)
    && (value.modelOutcome === null || isConstructorModelOutcome(value.modelOutcome))
}

export function isConstructorWorkCard(value: unknown): value is ConstructorWorkCard {
  if (!constructorRecord(value)
    || !constructorRecord(value.evidence)
    || !constructorRecord(value.closure)) return false
  const planValid = Array.isArray(value.plan) && value.plan.every((step) =>
    constructorRecord(step)
      && typeof step.key === 'string'
      && typeof step.label === 'string'
      && ['completed', 'current', 'pending'].includes(String(step.state ?? '')))
  const resultValid = value.finalResult === null || (constructorRecord(value.finalResult)
    && typeof value.finalResult.commit === 'string'
    && SHA40.test(value.finalResult.commit)
    && value.finalResult.liveVersion === value.finalResult.commit)
  const cardIdentity = typeof value.id === 'string' ? /^constructor:([1-9]\d*)$/.exec(value.id) : null
  return cardIdentity !== null
    && value.canonicalLink === `#constructor-work-card-${cardIdentity[1]}`
    && typeof value.objective === 'string'
    && stringArray(value.acceptanceCriteria)
    && stringArray(value.contextLinks)
    && value.contextLinks.every(safeContextLink)
    && nullableString(value.owner)
    && nullableString(value.actor)
    && planValid
    && nullableString(value.currentStep)
    && typeof value.status === 'string'
    && isConstructorProgress(value.progress)
    && (value.heartbeatAt === null || validIsoDate(value.heartbeatAt))
    && Array.isArray(value.activity)
    && value.activity.every(isConstructorActivity)
    && stringArray(value.decisions)
    && stringArray(value.approvals)
    && stringArray(value.risks)
    && stringArray(value.dependencies)
    && typeof value.escalationCondition === 'string'
    && resultValid
    && nonNegativeInteger(value.evidence.eventCount)
    && nullableString(value.evidence.prUrl)
    && nullableString(value.evidence.ci)
    && nullableString(value.evidence.commit)
    && nullableString(value.evidence.liveVersion)
    && typeof value.closure.resolved === 'boolean'
    && (value.closure.closedAt === null || validIsoDate(value.closure.closedAt))
}

/** Envelope-ul endpointurilor Constructor care întorc liste. `null` înseamnă
 * răspuns necitibil/incomplet, distinct de lista goală măsurată. Predicatul
 * opțional permite suprafeței să respingă și rânduri malformate. */
export function constructorJobsFromSnapshot<T>(
  snapshot: unknown,
  isJob?: (value: unknown) => value is T,
): T[] | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const jobs = (snapshot as Record<string, unknown>).jobs
  if (!Array.isArray(jobs)) return null
  if (isJob && !jobs.every((job) => isJob(job))) return null
  return jobs as T[]
}

/** Contract fail-closed pentru snapshotul Admin. Serverul trebuie să confirme
 * atât booleanul, cât și starea compatibilă; un câmp lipsă sau contradictoriu
 * nu poate produce o promisiune de pornire/ETA. */
export function constructorAvailabilityFromSnapshot(snapshot: unknown): ConstructorAvailability {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { state: 'unknown', acceptingWork: false, workerCanStartNow: false }
  }
  const value = snapshot as Record<string, unknown>
  const constructor = value.constructor
  if (!constructor || typeof constructor !== 'object' || Array.isArray(constructor)) {
    return { state: 'unknown', acceptingWork: false, workerCanStartNow: false }
  }
  const rawState = (constructor as Record<string, unknown>).state
  const state: ConstructorWorkerState = [
    'ready', 'busy', 'offline', 'setup_required', 'degraded', 'unknown',
  ].includes(String(rawState ?? ''))
    ? rawState as ConstructorWorkerState
    : 'unknown'
  const acceptingWork = value.acceptingWork === true && (state === 'ready' || state === 'busy')
  const workerCanStartNow = value.workerCanStartNow === true && state === 'ready' && acceptingWork
  return { state, acceptingWork, workerCanStartNow }
}

export function constructorFinalResultText(
  result: ConstructorWorkCard['finalResult'],
): string | null {
  if (!result) return null
  return `commit ${result.commit.slice(0, 7)} · versiune live ${result.liveVersion}`
}

export function constructorCiText(ci: string | null): string | null {
  if (ci === 'local_gates') return 'porți locale verzi'
  if (ci === 'pr_checks_green') return 'verificări PR verzi; push CI încă neverificat'
  if (ci === 'green') return 'CI GitHub verde'
  if (ci === 'red') return 'CI GitHub roșu'
  if (ci === 'in_progress') return 'CI GitHub în curs'
  return null
}

export function constructorHasVerifiedLiveResult(
  status: ConstructorJobStatus,
  continuity?: ConstructorContinuity,
): boolean {
  return status === 'done' && continuity?.finalProof?.complete === true
}

export function constructorJobCanBeCancelled(
  status: ConstructorJobStatus,
  stage: string,
): boolean {
  return (status === 'queued' && stage === 'queued')
    || (status === 'running' && ['claimed', 'accepted', 'working'].includes(stage))
}

export function constructorPersistentEventsText(
  progress: ConstructorProgress,
  eventCount: number,
): string {
  return progress.source === 'unavailable' ? 'necitibile' : String(eventCount)
}
