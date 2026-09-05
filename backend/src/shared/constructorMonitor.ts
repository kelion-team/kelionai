/** Server-owned observations only; never raw logs, order text, secrets or commands. */
export interface ConstructorHostSnapshot {
  schema: 1
  measuredAt: string
  worker: { timer: 'active' | 'inactive' | 'failed'; service: 'active' | 'activating' | 'inactive' | 'failed'; mainPid: number }
  intentionalPause: boolean
  deployGate: boolean
}
export interface ConstructorMonitorThresholds {
  tickMs: number
  hostMaxAgeMs: number
  queuedGraceMs: number
  heartbeatStaleMs: number
  stageStallMs: number
  usefulActivityMs: number
}
export type ConstructorMonitorCode = 'waiting' | 'executing' | 'worker_stopped' | 'process_missing'
  | 'heartbeat_stale' | 'stage_stall' | 'terminal_failure' | 'intentional_pause' | 'deploy_gate' | 'completed' | 'cancelled' | 'unverified'
export interface ConstructorMonitorJob {
  jobId: number
  cycle: number
  attempts: number
  status: string
  stage: string
  createdAt: string
  lastActivity: string | null
  lastRealProgress: string | null
  heartbeatAt: string | null
  completedReceipt: boolean
}
export interface ConstructorMonitorCase extends ConstructorMonitorJob {
  code: ConstructorMonitorCode
  fault: boolean
  responsible: 'worker' | 'publisher' | 'release' | 'owner' | 'monitor'
  nextAction: string
  checkedAt: string
  activeExecution: boolean
  activeExecutionUntil: string | null
  host: ConstructorHostSnapshot
}
export interface ConstructorMonitorSnapshot {
  checkedAt: string | null
  lastSuccessfulCheck: string | null
  error: string | null
  state: 'unknown' | 'attention' | 'observing' | 'paused'
  activeExecution: boolean
  thresholds: ConstructorMonitorThresholds
  cases: ConstructorMonitorCase[]
}
