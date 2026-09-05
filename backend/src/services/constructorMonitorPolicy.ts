import type { ConstructorHostSnapshot, ConstructorMonitorCase, ConstructorMonitorCode, ConstructorMonitorJob, ConstructorMonitorThresholds } from '../shared/constructorMonitor.js'

/** Operational alert thresholds, not AI execution/retry deadlines. */
export function constructorMonitorThresholds(env: NodeJS.ProcessEnv = process.env): ConstructorMonitorThresholds {
  const threshold = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name]
    if (raw === undefined || raw === '') return fallback
    const value = Number(raw)
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('constructor_monitor_config_invalid')
    return value
  }
  return { tickMs: 60_000, hostMaxAgeMs: threshold('CONSTRUCTOR_MONITOR_HOST_MAX_AGE_MS',90_000,10_000,120_000),
    queuedGraceMs: threshold('CONSTRUCTOR_MONITOR_QUEUE_GRACE_MS',120_000,60_000,900_000),
    heartbeatStaleMs: threshold('CONSTRUCTOR_MONITOR_HEARTBEAT_STALE_MS',300_000,60_000,900_000),
    stageStallMs: threshold('CONSTRUCTOR_MONITOR_STAGE_STALL_MS',900_000,120_000,3_600_000),
    usefulActivityMs: threshold('CONSTRUCTOR_MONITOR_ACTIVITY_MS',120_000,10_000,180_000) }
}
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export function validateConstructorHostSnapshot(value: unknown, now: number, maxAge: number): ConstructorHostSnapshot {
  const v = value as ConstructorHostSnapshot | null
  const keys = (o: object, expected: string[]): boolean => Object.keys(o).length === expected.length && Object.keys(o).every((key) => expected.includes(key))
  if (!v || typeof v !== 'object' || !keys(v,['schema','measuredAt','worker','intentionalPause','deployGate'])
    || v.schema !== 1 || !iso(v.measuredAt) || Date.parse(v.measuredAt) > now || now-Date.parse(v.measuredAt) > maxAge
    || typeof v.deployGate !== 'boolean') throw new Error('constructor_host_unverified')
  if (v.deployGate) {
    if (v.worker !== null || v.intentionalPause !== null) throw new Error('constructor_host_unverified')
    return v
  }
  if (typeof v.intentionalPause !== 'boolean'
    || !v.worker || typeof v.worker !== 'object' || !keys(v.worker,['timer','service','mainPid'])
    || !['active','inactive','failed'].includes(v.worker.timer) || !['active','activating','inactive','failed'].includes(v.worker.service)
    || !Number.isSafeInteger(v.worker.mainPid) || v.worker.mainPid < 0
    || (['inactive','failed'].includes(v.worker.service) && v.worker.mainPid !== 0)
    || (v.intentionalPause && (v.worker.timer !== 'inactive' || !['inactive','failed'].includes(v.worker.service)))) throw new Error('constructor_host_unverified')
  return v
}
const ACTIONS: Record<ConstructorMonitorCode,string> = {
  waiting:'Așteaptă preluarea; verifică din nou la următorul tick, fără a crea alt ordin.',
  executing:'Urmărește dovada următoarei etape; nu relansa executorul.',
  worker_stopped:'Verifică timerul și cauza opririi pe VPS; nu porni automat și nu dubla ordinul.',
  process_missing:'Verifică dispariția procesului și lease-ul; păstrează identitatea și dovezile ordinului.',
  heartbeat_stale:'Verifică legătura HMAC și heartbeatul; lipsa semnalului nu dovedește progres.',
  stage_stall:'Inspectează etapa și receipturile: rapoartele repetate nu dovedesc avans.',
  terminal_failure:'Diagnostichează cauza și păstrează istoricul; numai Reia explicit poate crea un ciclu nou.',
  intentional_pause:'Pauză intenționată confirmată; nu reporni și nu trata pauza ca defecțiune.',
  deploy_gate:'Bariera de publicare este ocupată; starea procesului nu a fost măsurată. Așteaptă o observație nouă, fără restart.',
  cancelled:'Anularea explicită este terminală; nu relansa ordinul.',
  completed:'Receiptul de release și starea terminală sunt prezente; nu relansa ordinul.',
  unverified:'Dovada este incompletă; nu declara funcționare și verifică sursa măsurătorii.',
}
export function classifyConstructorMonitor(job: ConstructorMonitorJob, host: ConstructorHostSnapshot, now: number, limits: ConstructorMonitorThresholds): ConstructorMonitorCase {
  validateConstructorHostSnapshot(host,now,limits.hostMaxAgeMs)
  if (!Number.isSafeInteger(job.jobId) || job.jobId < 1 || !Number.isSafeInteger(job.cycle) || job.cycle < 0
    || !iso(job.createdAt) || Date.parse(job.createdAt) > now
    || [job.lastActivity,job.lastRealProgress,job.heartbeatAt].some((v) => v !== null && (!iso(v) || Date.parse(v) > now))) throw new Error('constructor_job_evidence_invalid')
  const elapsed = (value: string | null): number => value === null ? Number.POSITIVE_INFINITY : now-Date.parse(value)
  const workerStage = ['queued','claimed','accepted','working'].includes(job.stage)
  let code: ConstructorMonitorCode = 'unverified'
  if (['failed','unresolved'].includes(job.status) || ['failed','unresolved'].includes(job.stage)) code = 'terminal_failure'
  else if (job.status === 'done') code = job.stage === 'deployed' && job.completedReceipt ? 'completed' : 'unverified'
  else if (job.status === 'cancelled') code = 'cancelled'
  else if (host.intentionalPause && workerStage) code = 'intentional_pause'
  else if (host.deployGate) code = 'deploy_gate'
  else if (job.status === 'queued') {
    code = elapsed(job.lastRealProgress ?? job.createdAt) < limits.queuedGraceMs ? 'waiting'
      : host.worker?.timer !== 'active' ? 'worker_stopped'
      : elapsed(job.heartbeatAt) > limits.heartbeatStaleMs ? 'heartbeat_stale'
      : elapsed(job.lastRealProgress ?? job.createdAt) >= limits.stageStallMs ? 'stage_stall' : 'waiting'
  } else if (job.status === 'running') {
    code = workerStage && (host.worker?.service !== 'active' || (host.worker?.mainPid ?? 0) === 0) ? 'process_missing'
      : workerStage && elapsed(job.heartbeatAt) > limits.heartbeatStaleMs ? 'heartbeat_stale'
      : elapsed(job.lastRealProgress ?? job.createdAt) >= limits.stageStallMs ? 'stage_stall' : 'executing'
  }
  const fault = ['worker_stopped','process_missing','heartbeat_stale','stage_stall','terminal_failure'].includes(code)
  const until = Math.min(Date.parse(host.measuredAt)+limits.hostMaxAgeMs, Date.parse(job.lastRealProgress ?? '')+limits.usefulActivityMs)
  const activeExecution = code === 'executing' && workerStage && host.worker?.service === 'active'
    && (host.worker?.mainPid ?? 0) > 0 && Number.isFinite(until) && until > now
  const responsible = code === 'terminal_failure' ? 'owner' : code === 'unverified' ? 'monitor'
    : ['merged','release_dispatched','deployed'].includes(job.stage) ? 'release'
    : ['gates_passed','pr_opened'].includes(job.stage) ? 'publisher' : 'worker'
  return { ...job,code,fault,responsible,nextAction:ACTIONS[code],checkedAt:new Date(now).toISOString(),host,
    activeExecution,activeExecutionUntil:activeExecution ? new Date(until).toISOString() : null }
}
