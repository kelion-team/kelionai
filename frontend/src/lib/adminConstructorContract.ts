import {
  isConstructorContinuity,
  isConstructorWorkCard,
  type ConstructorContinuity,
  type ConstructorJobStatus,
  type ConstructorWorkerState,
  type ConstructorWorkerSummary,
  type ConstructorWorkCard,
} from './constructorContract'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isPercentageOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)

const isGithubPullRequestUrlOrNull = (value: unknown): value is string | null => {
  if (value === null) return true
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && !url.username
      && !url.password
      && /^\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(url.pathname)
  } catch {
    return false
  }
}

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const isDateStringOrNull = (value: unknown): value is string | null =>
  value === null || isDateString(value)

const isExactIsoDateString = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

const isBoundedPlainText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && value.trim() === value
  && !/[\p{Cc}\p{Cs}]/u.test(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))

const JOB_STATUSES: readonly ConstructorJobStatus[] = ['queued', 'running', 'done', 'failed', 'cancelled']
const WORKER_STATES: readonly ConstructorWorkerState[] = ['ready', 'busy', 'offline', 'setup_required', 'degraded', 'unknown']

export interface BuildJobRow {
  id: number
  status: ConstructorJobStatus
  constructorStage: string
  executionCycle?: number
  deletable: boolean
  retryable: boolean
  orderText: string
  nume?: string
  branch: string | null
  prUrl: string | null
  tokens: number
  brain: string | null
  updatedAt: string
  progress?: string | null
  pct?: number | null
  continuity?: ConstructorContinuity
  workCard?: ConstructorWorkCard | null
}

function isBuildJobRow(value: unknown, projected: boolean): value is BuildJobRow {
  if (!isObject(value)) return false
  const base = isPositiveInteger(value.id)
    && JOB_STATUSES.includes(value.status as ConstructorJobStatus)
    && typeof value.constructorStage === 'string'
    && (value.executionCycle === undefined || (Number.isSafeInteger(value.executionCycle) && Number(value.executionCycle) >= 0))
    && typeof value.deletable === 'boolean'
    && typeof value.retryable === 'boolean'
    && typeof value.orderText === 'string'
    && isStringOrNull(value.branch)
    && isGithubPullRequestUrlOrNull(value.prUrl)
    && typeof value.tokens === 'number'
    && Number.isFinite(value.tokens)
    && value.tokens >= 0
    && isStringOrNull(value.brain)
    && isDateString(value.updatedAt)
    && isStringOrNull(value.progress)
  if (!base) return false
  if (!projected) {
    return (value.nume === undefined || typeof value.nume === 'string')
      && (value.pct === undefined || isPercentageOrNull(value.pct))
      && (value.continuity === undefined || isConstructorContinuity(value.continuity))
      && (value.workCard === undefined || value.workCard === null || isConstructorWorkCard(value.workCard))
  }
  return typeof value.nume === 'string'
    && isPercentageOrNull(value.pct)
    && isConstructorContinuity(value.continuity)
    && (value.continuity.modelOutcome === null || value.status === 'failed')
    && Object.prototype.hasOwnProperty.call(value, 'workCard')
    && (value.workCard === null || isConstructorWorkCard(value.workCard))
}

function isConstructorWorkerSummary(value: unknown): value is ConstructorWorkerSummary {
  if (!isObject(value)) return false
  return (value.cine === 'constructor_pipeline' || value.cine === 'unavailable')
    && WORKER_STATES.includes(value.state as ConstructorWorkerState)
    && typeof value.motiv === 'string'
    && isDateStringOrNull(value.lastHeartbeat)
}

interface ConstructorChainEnvelope {
  acceptingWork: boolean
  workerCanStartNow: boolean
  constructor: ConstructorWorkerSummary
}

function parseConstructorChainEnvelope(value: unknown): ConstructorChainEnvelope | null {
  if (!isObject(value) || !isConstructorWorkerSummary(value.constructor)) return null
  if (typeof value.acceptingWork !== 'boolean' || typeof value.workerCanStartNow !== 'boolean') return null
  const state = value.constructor.state
  const expectedAccepting = state === 'ready' || state === 'busy'
  const expectedStart = state === 'ready'
  const expectedIdentity = expectedAccepting ? 'constructor_pipeline' : 'unavailable'
  if (
    value.acceptingWork !== expectedAccepting
    || value.workerCanStartNow !== expectedStart
    || value.constructor.cine !== expectedIdentity
  ) return null
  return {
    acceptingWork: value.acceptingWork,
    workerCanStartNow: value.workerCanStartNow,
    constructor: value.constructor,
  }
}

export interface AdminConstructorSnapshot extends ConstructorChainEnvelope {
  jobs: BuildJobRow[]
}

export function parseAdminConstructorSnapshot(value: unknown): AdminConstructorSnapshot | null {
  const chain = parseConstructorChainEnvelope(value)
  if (!chain || !isObject(value) || !Array.isArray(value.jobs) || !value.jobs.every((job) => isBuildJobRow(job, true))) {
    return null
  }
  return { ...chain, jobs: value.jobs as BuildJobRow[] }
}

export interface AdminConstructorIntake extends ConstructorChainEnvelope {
  id: number
  deduplicated: boolean
}

export function parseAdminConstructorIntake(value: unknown): AdminConstructorIntake | null {
  const chain = parseConstructorChainEnvelope(value)
  if (
    !chain
    || !isObject(value)
    || value.ok !== true
    || !isPositiveInteger(value.id)
    || typeof value.deduplicated !== 'boolean'
  ) return null
  return { ...chain, id: value.id, deduplicated: value.deduplicated }
}

export type ConstructorModelProfile = 'fast'
export type ConstructorModelState = 'ready' | 'failed' | 'unavailable'

export interface AdminConstructorModelSnapshot {
  mode: 'manual'
  defaultProfile: 'fast'
  model: { id: string; label: string; provider: string } | null
  profiles: { id: 'fast'; label: string; model: string; installed: boolean }[]
  activeProfile: ConstructorModelProfile | null
  activeModel: string | null
  state: ConstructorModelState
  requestedProfile: null
  requestId: null
  verifiedAt: string | null
  error: string | null
}

const MODEL_SNAPSHOT_KEYS = [
  'mode', 'defaultProfile', 'model', 'profiles', 'activeProfile', 'activeModel',
  'state', 'requestedProfile', 'requestId', 'verifiedAt', 'error',
] as const

/** Configuration metadata is measured by the server; no model names or
 * runtime capabilities are inferred from the historic fast profile key. */
export function parseAdminConstructorModelSnapshot(value: unknown): AdminConstructorModelSnapshot | null {
  if (!isObject(value) || !hasExactKeys(value, MODEL_SNAPSHOT_KEYS)) return null
  if (value.mode !== 'manual' || value.defaultProfile !== 'fast'
    || value.requestedProfile !== null || value.requestId !== null) return null
  const model = value.model
  if (model !== null && (!isObject(model) || !hasExactKeys(model, ['id', 'label', 'provider'])
    || !isBoundedPlainText(model.id, 160) || !isBoundedPlainText(model.label, 80)
    || !isBoundedPlainText(model.provider, 80)
    || !/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model.id)
    || model.id.split('/')[0] !== model.provider)) return null
  if (!Array.isArray(value.profiles) || value.profiles.length !== (model ? 1 : 0)) return null
  const profile = value.profiles[0]
  if (model && (!isObject(profile) || !hasExactKeys(profile, ['id', 'label', 'model', 'installed'])
    || profile.id !== 'fast' || profile.label !== model.label || profile.model !== model.id
    || typeof profile.installed !== 'boolean')) return null
  if (!['ready', 'failed', 'unavailable'].includes(String(value.state))) return null
  if (value.state === 'ready') {
    if (!model || !profile?.installed || value.activeProfile !== 'fast'
      || value.activeModel !== model.id || !isExactIsoDateString(value.verifiedAt)
      || value.error !== null) return null
  } else if (value.activeProfile !== null || value.activeModel !== null
    || value.verifiedAt !== null || typeof value.error !== 'string'
    || !/^[a-z][a-z0-9_]{0,79}$/.test(value.error)) return null
  return value as unknown as AdminConstructorModelSnapshot
}

export interface AdminConstructorProblem {
  cod: string
  severitate: 'critic' | 'atentie'
  ce: string
  recomandare: string
}

export interface AdminConstructorDiagnostic {
  sanatos: boolean
  verdict: string
  probleme: AdminConstructorProblem[]
  masuratori: {
    workerConectat: boolean
    workerStatus: string
    publisherConectat: boolean
    releaseConectat: boolean
    inCoada: number
    inLucru: number
    esuate: number
    oldestQueuedSec: number | null
    runningSec: number | null
    inBackoff: number
  } | null
}

export function parseAdminConstructorDiagnostic(value: unknown): AdminConstructorDiagnostic | null {
  if (!isObject(value) || !Array.isArray(value.probleme) || !isObject(value.masuratori)) return null
  const measurements = value.masuratori
  const problemsValid = value.probleme.every((problem) => isObject(problem)
    && typeof problem.cod === 'string'
    && (problem.severitate === 'critic' || problem.severitate === 'atentie')
    && typeof problem.ce === 'string'
    && typeof problem.recomandare === 'string')
  const measurementsValid = typeof measurements.workerConectat === 'boolean'
    && typeof measurements.workerStatus === 'string'
    && typeof measurements.publisherConectat === 'boolean'
    && typeof measurements.releaseConectat === 'boolean'
    && isNonNegativeInteger(measurements.inCoada)
    && isNonNegativeInteger(measurements.inLucru)
    && isNonNegativeInteger(measurements.esuate)
    && (measurements.oldestQueuedSec === null || (typeof measurements.oldestQueuedSec === 'number' && Number.isFinite(measurements.oldestQueuedSec) && measurements.oldestQueuedSec >= 0))
    && (measurements.runningSec === null || (typeof measurements.runningSec === 'number' && Number.isFinite(measurements.runningSec) && measurements.runningSec >= 0))
    && isNonNegativeInteger(measurements.inBackoff)
  if (typeof value.sanatos !== 'boolean' || typeof value.verdict !== 'string' || !problemsValid || !measurementsValid) return null
  return value as unknown as AdminConstructorDiagnostic
}

export interface BuildArchiveCursor {
  updatedAt: string
  id: number
}

export interface AdminBuildArchiveSnapshot {
  jobs: BuildJobRow[]
  nextCursor: BuildArchiveCursor | null
}

function isArchiveCursor(value: unknown): value is BuildArchiveCursor {
  return isObject(value) && isPositiveInteger(value.id) && isDateString(value.updatedAt)
}

export function parseAdminBuildArchive(value: unknown): AdminBuildArchiveSnapshot | null {
  if (!isObject(value) || !Array.isArray(value.jobs) || !value.jobs.every((job) => isBuildJobRow(job, false))) return null
  if (!Object.prototype.hasOwnProperty.call(value, 'nextCursor')) return null
  if (value.nextCursor !== null && !isArchiveCursor(value.nextCursor)) return null
  return { jobs: value.jobs as BuildJobRow[], nextCursor: value.nextCursor }
}

export interface AdminReleaseSnapshot {
  jobId: number | null
  integration: 'ready' | 'setup_required' | 'unavailable'
  setupInstructions: string | null
  pr: null | {
    number: number
    title: string
    url: string
    state: 'open' | 'closed'
    merged: boolean
    headSha: string
    baseRef: string
  }
  checks: 'passed' | 'pending' | 'failed' | 'unknown'
  approval: 'approved' | 'required' | 'unknown'
  merge: 'ready' | 'blocked' | 'merged' | 'unknown'
  nextAction: string
}

type AdminReleaseDetails = Omit<AdminReleaseSnapshot, 'jobId'>

function parseAdminReleaseDetails(value: unknown): AdminReleaseDetails | null {
  if (!isObject(value)) return null
  const pr = value.pr
  const prValid = pr === null || (isObject(pr)
    && isPositiveInteger(pr.number)
    && typeof pr.title === 'string'
    && typeof pr.url === 'string'
    && /^https:\/\/github\.com\//.test(pr.url)
    && (pr.state === 'open' || pr.state === 'closed')
    && typeof pr.merged === 'boolean'
    && typeof pr.headSha === 'string'
    && /^[0-9a-f]{40}$/.test(pr.headSha)
    && typeof pr.baseRef === 'string')
  if (
    !['ready', 'setup_required', 'unavailable'].includes(String(value.integration ?? ''))
    || !isStringOrNull(value.setupInstructions)
    || !prValid
    || !['passed', 'pending', 'failed', 'unknown'].includes(String(value.checks ?? ''))
    || !['approved', 'required', 'unknown'].includes(String(value.approval ?? ''))
    || !['ready', 'blocked', 'merged', 'unknown'].includes(String(value.merge ?? ''))
    || typeof value.nextAction !== 'string'
  ) return null
  return value as unknown as AdminReleaseDetails
}

export function parseAdminReleaseSnapshot(value: unknown): AdminReleaseSnapshot | null {
  if (!isObject(value) || !(value.jobId === null || isPositiveInteger(value.jobId))) return null
  const details = parseAdminReleaseDetails(value)
  return details ? { jobId: value.jobId, ...details } : null
}

export function adminMutationAcknowledged(value: unknown): boolean {
  return isObject(value) && value.ok === true
}

export function parseAdminArchiveAcknowledgement(value: unknown): number | null {
  if (!adminMutationAcknowledged(value) || !isObject(value) || !isNonNegativeInteger(value.arhivate)) return null
  return value.arhivate
}

export function parseAdminRestoreAcknowledgement(value: unknown): BuildJobRow | null {
  if (!adminMutationAcknowledged(value) || !isObject(value) || !isBuildJobRow(value.job, false)) return null
  return value.job
}

export function adminContractText(value: unknown, key: string): string | null {
  if (!isObject(value)) return null
  const text = value[key]
  return typeof text === 'string' ? text : null
}
