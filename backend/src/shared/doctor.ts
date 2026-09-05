/** Public Doctor contract: no account identity, raw logs, credentials or invented progress. */
export type DoctorCode = 'public_health' | 'agent_registry' | 'release_version'
  | 'constructor_worker_offline' | 'constructor_publisher_offline' | 'constructor_release_offline'
  | 'chat_output_missing' | 'audio_session_failure' | 'camera_unavailable' | 'memory_unavailable'

/** Internal authenticated Constructor wire metadata, never accepted from an
 * admin order, a model response or a worker-provided handoff. */
export interface DoctorRepairScope {
  code: 'public_health' | 'agent_registry' | 'release_version'
  allowedPaths: string[]
}
export type ConstructorAutomationAuthority = {
  automationOrigin: 'admin'; repairScope: null
} | {
  automationOrigin: 'doctor'; repairScope: DoctorRepairScope
}

export interface DoctorEvidence {
  checkedAt: string
  code: DoctorCode
  result: 'healthy' | 'defect' | 'blocked' | 'unverified'
  reason: string
  httpStatus: number | null
  releaseSha: string | null
}

export interface DoctorGrantRequest {
  scope: 'measured-code-repair'
  durationHours: number | null
  maxJobs: number
  windowHours: number
}

export interface DoctorGrant {
  active: boolean
  scope: 'measured-code-repair'
  expiresAt: string | null
  maxJobs: number
  jobsCreated: number
  windowHours: number
  windowResetsAt: string
  revocable: true
}

export interface DoctorIncident {
  id: string
  code: DoctorCode
  status: 'observed' | 'blocked' | 'queued' | 'repairing' | 'awaiting_live' | 'resolved'
  summary: string
  detectedAt: string
  checkedAt: string
  jobId: number | null
  evidence: DoctorEvidence
  closure: { verifiedAt: string; liveSha: string; symptom: DoctorEvidence } | null
}

export interface DoctorSnapshot {
  checkedAt: string | null
  error: string | null
  state: 'disabled' | 'ready' | 'running' | 'blocked'
  grant: DoctorGrant | null
  incidents: DoctorIncident[]
  limits: { maxDurationHours: number; maxJobs: number; maxWindowHours: number }
}
