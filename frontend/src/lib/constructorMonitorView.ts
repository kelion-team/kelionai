/** Strict read projection: none of these fields can advance the milestone bar. */
export interface MonitorJobView {
  jobId: number; cycle: number; code: string; responsible: string; nextAction: string
  checkedAt: string; lastActivity: string | null; lastRealProgress: string | null
  activeExecution: boolean; activeExecutionUntil: string | null
}
export interface ExternalRemediationView {
  jobId: number; cycle: number; coordinator: string; executionId: string
  kind: string; state: string; summary: string; nextAction: string
  lastEvidenceAt: string | null; evidenceDigest: string | null; sourceRef: string | null
  activeExternalRemediation: boolean; activeUntil: string | null
}
export interface MonitorView {
  servedAt: string; checkedAt: string | null; lastSuccessfulCheck: string | null
  error: string | null; cases: MonitorJobView[]; externalRemediations: ExternalRemediationView[]
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\p{Cc}\p{Cs}]/u.test(v)
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const maybeIso = (v: unknown): v is string | null => v === null || iso(v)
const integer = (v: unknown, min: number): v is number => Number.isSafeInteger(v) && Number(v) >= min
const codes = new Set(['waiting','executing','worker_stopped','process_missing','heartbeat_stale','stage_stall','terminal_failure','intentional_pause','deploy_gate','completed','cancelled','unverified'])
export function parseMonitorView(raw: unknown): MonitorView | null {
  if (!record(raw) || !iso(raw.servedAt) || !maybeIso(raw.checkedAt) || !maybeIso(raw.lastSuccessfulCheck)
    || !(raw.error === null || text(raw.error, 100)) || !Array.isArray(raw.cases) || raw.cases.length > 1000
    || !Array.isArray(raw.externalRemediations) || raw.externalRemediations.length > 1000) return null
  const cases: MonitorJobView[] = [], externalRemediations: ExternalRemediationView[] = []
  const uniqueCases = new Set<number>(), uniqueExternal = new Set<number>()
  for (const v of raw.cases) {
    if (!record(v) || !integer(v.jobId,1) || !integer(v.cycle,0) || uniqueCases.has(v.jobId)
      || !text(v.code,40) || !codes.has(v.code) || !text(v.responsible,160) || !text(v.nextAction)
      || !iso(v.checkedAt) || !maybeIso(v.lastActivity) || !maybeIso(v.lastRealProgress)
      || typeof v.activeExecution !== 'boolean' || !maybeIso(v.activeExecutionUntil)
      || (v.activeExecution && (v.code !== 'executing' || v.activeExecutionUntil === null || v.lastRealProgress === null))) return null
    uniqueCases.add(v.jobId)
    cases.push({jobId:v.jobId,cycle:v.cycle,code:v.code,responsible:v.responsible,nextAction:v.nextAction,
      checkedAt:v.checkedAt,lastActivity:v.lastActivity,lastRealProgress:v.lastRealProgress,
      activeExecution:v.activeExecution,activeExecutionUntil:v.activeExecutionUntil})
  }
  for (const v of raw.externalRemediations) {
    if (!record(v) || !integer(v.jobId,1) || !integer(v.cycle,0) || uniqueExternal.has(v.jobId)
      || !text(v.coordinator,160) || !text(v.executionId,36) || !/^[0-9a-f-]{36}$/i.test(v.executionId)
      || !['edit','test','build','diagnostic','deploy'].includes(String(v.kind))
      || !['working','blocked','completed'].includes(String(v.state)) || !text(v.summary,240) || !text(v.nextAction)
      || !maybeIso(v.lastEvidenceAt) || !maybeIso(v.activeUntil) || typeof v.activeExternalRemediation !== 'boolean'
      || !(v.evidenceDigest === null || (typeof v.evidenceDigest === 'string' && /^[0-9a-f]{64}$/.test(v.evidenceDigest)))
      || !(v.sourceRef === null || text(v.sourceRef,240))
      || (v.activeExternalRemediation && (v.state !== 'working' || v.lastEvidenceAt === null
        || v.activeUntil === null || v.evidenceDigest === null || v.sourceRef === null))) return null
    uniqueExternal.add(v.jobId)
    externalRemediations.push({jobId:v.jobId,cycle:v.cycle,coordinator:v.coordinator,executionId:v.executionId,
      kind:String(v.kind),state:String(v.state),summary:v.summary,nextAction:v.nextAction,lastEvidenceAt:v.lastEvidenceAt,
      evidenceDigest:v.evidenceDigest,sourceRef:v.sourceRef,activeExternalRemediation:v.activeExternalRemediation,activeUntil:v.activeUntil})
  }
  return { servedAt:raw.servedAt,checkedAt:raw.checkedAt,lastSuccessfulCheck:raw.lastSuccessfulCheck,
    error:raw.error,cases,externalRemediations }
}

export interface MonitorConnection {
  snapshot: MonitorView | null; connected: boolean; elapsedMs: number
}
export function activityForJob(connection: MonitorConnection, jobId: number, cycle: number | undefined, status: string) {
  const {snapshot,connected,elapsedMs} = connection
  const fresh = connected && elapsedMs >= 0 && elapsedMs < 20_000 && snapshot !== null
  const now = snapshot ? Date.parse(snapshot.servedAt) + Math.max(0,elapsedMs) : Infinity
  const current = snapshot?.cases.find(c => c.jobId === jobId && c.cycle === cycle) ?? null
  const external = snapshot?.externalRemediations.find(c => c.jobId === jobId && c.cycle === cycle) ?? null
  const recent = (at: string | null, until: string | null, maxMs: number) => {
    if (!at || !until) return false
    const time=Date.parse(at), deadline=Date.parse(until)
    return time <= now && deadline > now && deadline-time > 0 && deadline-time <= maxMs
  }
  const pipelineActive = status === 'running' && fresh && !snapshot.error && !!current?.activeExecution
    && recent(current.lastRealProgress,current.activeExecutionUntil,180_000)
    && now-Date.parse(current.checkedAt) >= 0 && now-Date.parse(current.checkedAt) <= 120_000
  const externalActive = ['queued','running','failed'].includes(status) && fresh && !!external?.activeExternalRemediation
    && recent(external.lastEvidenceAt,external.activeUntil,60_000)
  return {active:pipelineActive || externalActive,pipelineActive,externalActive,current,external,fresh}
}
