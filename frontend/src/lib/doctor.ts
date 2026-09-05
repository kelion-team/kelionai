import type { DoctorEvidence, DoctorGrant, DoctorGrantRequest, DoctorIncident, DoctorSnapshot } from '../../../backend/src/shared/doctor'
import { apiFetch } from './transport'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const code = (value: unknown): boolean => typeof value === 'string' && [
  'public_health', 'agent_registry', 'release_version', 'constructor_worker_offline', 'constructor_publisher_offline',
  'constructor_release_offline', 'chat_output_missing', 'audio_session_failure', 'camera_unavailable', 'memory_unavailable',
].includes(value)

function evidence(value: unknown): value is DoctorEvidence {
  return object(value) && date(value.checkedAt) && code(value.code)
    && ['healthy', 'defect', 'blocked', 'unverified'].includes(String(value.result))
    && typeof value.reason === 'string'
    && (value.httpStatus === null || (integer(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599))
    && (value.releaseSha === null || sha(value.releaseSha))
}

function grant(value: unknown): value is DoctorGrant {
  return object(value) && typeof value.active === 'boolean' && value.scope === 'measured-code-repair'
    && (value.expiresAt === null || date(value.expiresAt)) && integer(value.maxJobs) && value.maxJobs > 0
    && integer(value.windowHours) && value.windowHours > 0 && date(value.windowResetsAt)
    && integer(value.jobsCreated) && value.jobsCreated <= value.maxJobs && value.revocable === true
}

function incident(value: unknown): value is DoctorIncident {
  if (!object(value) || typeof value.id !== 'string' || !value.id || !code(value.code)
    || !['observed', 'blocked', 'queued', 'repairing', 'awaiting_live', 'resolved'].includes(String(value.status))
    || typeof value.summary !== 'string' || !date(value.detectedAt) || !date(value.checkedAt)
    || !(value.jobId === null || (integer(value.jobId) && value.jobId > 0))
    || !evidence(value.evidence) || value.evidence.code !== value.code) return false
  if (value.closure === null) return value.status !== 'resolved'
  return value.status === 'resolved' && value.jobId !== null && object(value.closure)
    && date(value.closure.verifiedAt) && sha(value.closure.liveSha) && evidence(value.closure.symptom)
    && value.closure.symptom.result === 'healthy' && value.closure.symptom.code === value.code
    && value.closure.symptom.releaseSha === value.closure.liveSha
}

/** Reject incomplete or inconsistent operational evidence instead of inventing an active Doctor. */
export function parseDoctorSnapshot(value: unknown): DoctorSnapshot | null {
  if (!object(value) || !(value.checkedAt === null || date(value.checkedAt))
    || !(value.error === null || typeof value.error === 'string')
    || !['disabled', 'ready', 'running', 'blocked'].includes(String(value.state))
    || !(value.grant === null || grant(value.grant))
    || !Array.isArray(value.incidents) || !value.incidents.every(incident)
    || new Set(value.incidents.map((item) => item.id)).size !== value.incidents.length
    || !object(value.limits) || !integer(value.limits.maxDurationHours) || value.limits.maxDurationHours < 1
    || !integer(value.limits.maxJobs) || value.limits.maxJobs < 1
    || !integer(value.limits.maxWindowHours) || value.limits.maxWindowHours < 1) return null
  if ((value.state === 'ready' || value.state === 'running') && !value.grant?.active) return null
  return value as unknown as DoctorSnapshot
}

async function requestDoctor(path: string, options: RequestInit): Promise<DoctorSnapshot | null> {
  try {
    const response = await apiFetch(path, { credentials: 'include', ...options })
    if (!response.ok) return null
    return parseDoctorSnapshot(await response.json())
  } catch {
    return null
  }
}

export function fetchDoctor(signal?: AbortSignal): Promise<DoctorSnapshot | null> {
  return requestDoctor('/api/admin/doctor', { signal })
}

export function setDoctorGrant(request: DoctorGrantRequest | null): Promise<DoctorSnapshot | null> {
  return requestDoctor('/api/admin/doctor/grant', request === null ? { method: 'DELETE' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  })
}

export function checkDoctorNow(): Promise<DoctorSnapshot | null> {
  return requestDoctor('/api/admin/doctor/tick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
}
