import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { conexiuneDb, dbEnabled, getPool } from '../db.js'
import type { ConstructorMonitorCase, ConstructorMonitorJob, ConstructorMonitorSnapshot, ConstructorMonitorThresholds } from '../shared/constructorMonitor.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'
type Sql = Pick<pg.PoolClient,'query'>
const LEASE_MS = 55_000 // One tick is 60s; a crashed observer cannot retain ownership.
const MAX_JOBS = 1000 // Overflow is an incomplete check, never a truncated healthy result.
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString()
export async function withConstructorObservationTransaction<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  if (!dbEnabled()) throw new Error('constructor_monitor_store_unavailable')
  const client = await conexiuneDb()
  try { await client.query('BEGIN'); const result=await run(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}
export async function acquireMonitorLease(): Promise<string | null> {
  if (!dbEnabled() || !releaseSideEffectsEnabled()) return null
  const id=randomUUID()
  const result=await getPool().query(`UPDATE constructor_monitor_state SET lease_owner=$1::uuid,
    lease_until=now()+($2::text || ' milliseconds')::interval
    WHERE singleton=true AND (lease_owner IS NULL OR lease_until <= now()) RETURNING lease_owner`,[id,LEASE_MS])
  return result.rows.length ? id : null
}
export async function readMonitorJobs(heartbeatAt: string | null): Promise<ConstructorMonitorJob[]> {
  if (!dbEnabled()) throw new Error('constructor_monitor_store_unavailable')
  const result=await getPool().query<{
    id:string; execution_cycle:number; attempts:number; status:string; constructor_stage:string; created_at:Date;
    last_activity:Date|null; last_real_progress:Date|null; completed_receipt:boolean
  }>(`SELECT b.id::text,b.execution_cycle,b.attempts,b.status,b.constructor_stage,b.created_at,
    GREATEST(e.last_activity,b.progress_at) AS last_activity, e.last_real_progress,
    (b.status='done' AND b.constructor_stage='deployed' AND b.ci='green'
      AND b.commit_sha ~ '^[0-9a-f]{40}$' AND b.live_version=b.commit_sha AND p.release_target_sha=b.commit_sha
      AND p.release_receipt_sha256 ~ '^[0-9a-f]{64}$') IS TRUE AS completed_receipt
    FROM build_jobs b LEFT JOIN constructor_pipeline p ON p.job_id=b.id
    LEFT JOIN LATERAL (
      SELECT max(last_at) AS last_activity,max(first_at) FILTER (WHERE sequence_no IS NOT NULL) AS last_real_progress
      FROM (
        SELECT e.activity_key,c.sequence_no,min(e.created_at) AS first_at,max(e.created_at) AS last_at
        FROM constructor_activity_events e JOIN constructor_activity_catalog c ON c.activity_key=e.activity_key
        WHERE e.job_id=b.id AND e.execution_cycle=b.execution_cycle GROUP BY e.activity_key,c.sequence_no
      ) milestones
    ) e ON true
    WHERE b.arhivat=false AND (b.status IN ('queued','running','failed')
      OR b.updated_at > now()-interval '24 hours'
      OR EXISTS (SELECT 1 FROM constructor_monitor_cases m WHERE m.job_id=b.id AND m.execution_cycle=b.execution_cycle))
    ORDER BY b.id LIMIT $1`,[MAX_JOBS+1])
  if (result.rows.length > MAX_JOBS) throw new Error('constructor_monitor_feed_overflow')
  return result.rows.map((r) => ({ jobId:Number(r.id),cycle:r.execution_cycle,attempts:r.attempts,status:r.status,
    stage:r.constructor_stage,createdAt:iso(r.created_at)!,lastActivity:iso(r.last_activity),lastRealProgress:iso(r.last_real_progress),
    heartbeatAt,completedReceipt:r.completed_receipt }))
}
async function notify(sql: Sql, title: string, message: string, payload: unknown): Promise<void> {
  // Same durable Admin Inbox channel, in the same transaction as the transition.
  // External delivery is separate; a notification failure cannot lose the event.
  await sql.query("INSERT INTO admin_notifications(type,title,message,payload) VALUES ('paznic',$1,$2,$3::jsonb)",
    [title,message.slice(0,500),JSON.stringify(payload)])
}
export async function finishMonitorCheck(lease: string, cases: ConstructorMonitorCase[] | null): Promise<void> {
  await withConstructorObservationTransaction(async (sql) => {
    const locked=await sql.query<{last_error:string|null}>(`SELECT last_error FROM constructor_monitor_state
      WHERE singleton=true AND lease_owner=$1::uuid AND lease_until > now() FOR UPDATE`,[lease])
    if (!locked.rows[0]) throw new Error('constructor_monitor_lease_lost')
    if (!releaseSideEffectsEnabled()) {
      await sql.query('UPDATE constructor_monitor_state SET lease_owner=NULL,lease_until=NULL WHERE singleton=true AND lease_owner=$1::uuid',[lease])
      return
    }
    if (cases === null) {
      if (locked.rows[0].last_error === null) await notify(sql,'Monitor Constructor: verificare indisponibilă','Responsabil: monitor. Verificarea hostului sau a bazei nu a putut fi încheiată; ultima verificare reușită se păstrează. Nu se relansează ordinul.',{ source:'constructor_monitor',code:'monitor_error' })
      await sql.query(`UPDATE constructor_monitor_state SET checked_at=now(),last_error='constructor_monitor_check_failed',
        lease_owner=NULL,lease_until=NULL WHERE singleton=true AND lease_owner=$1::uuid`,[lease])
      return
    }
    for (const evidence of cases) {
      const previous=await sql.query<{code:string;revision:number;open_incident:boolean;evidence:ConstructorMonitorCase}>(
        'SELECT code,revision,open_incident,evidence FROM constructor_monitor_cases WHERE job_id=$1 AND execution_cycle=$2 FOR UPDATE',[evidence.jobId,evidence.cycle])
      const old=previous.rows[0]
      const changed=!old || old.code !== evidence.code
      const revision=old ? old.revision+(changed ? 1 : 0) : 1
      const recovery=Boolean(old?.open_incident && !evidence.fault && ['waiting','executing','completed','cancelled'].includes(evidence.code))
      const openIncident=evidence.fault || Boolean(old?.open_incident && !recovery)
      await sql.query(`INSERT INTO constructor_monitor_cases(job_id,execution_cycle,code,revision,evidence,checked_at,open_incident)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7)
        ON CONFLICT(job_id,execution_cycle) DO UPDATE SET code=EXCLUDED.code,revision=EXCLUDED.revision,
          evidence=EXCLUDED.evidence,checked_at=EXCLUDED.checked_at,open_incident=EXCLUDED.open_incident`,
      [evidence.jobId,evidence.cycle,evidence.code,revision,JSON.stringify(evidence),evidence.checkedAt,openIncident])
      if (changed) {
        const kind=recovery ? 'recovery' : evidence.fault ? 'incident' : 'state_change'
        await sql.query(`INSERT INTO constructor_monitor_events(job_id,execution_cycle,revision,kind,evidence)
          VALUES ($1,$2,$3,$4,$5::jsonb)`,[evidence.jobId,evidence.cycle,revision,kind,JSON.stringify(evidence)])
        if (evidence.fault || old?.evidence.fault || recovery) await notify(sql,'Constructor #'+evidence.jobId+': '+evidence.code,
          evidence.code+'; responsabil: '+evidence.responsible+'. '+evidence.nextAction,
          { source:'constructor_monitor',jobId:evidence.jobId,cycle:evidence.cycle,revision,kind,code:evidence.code,
            responsible:evidence.responsible,nextAction:evidence.nextAction })
      }
    }
    if (locked.rows[0].last_error !== null) await notify(sql,'Monitor Constructor: verificarea a revenit','Responsabil: monitor. Citirea hostului și a bazei a reușit; aceasta nu dovedește finalizarea ordinului.',{ source:'constructor_monitor',code:'monitor_recovered' })
    await sql.query(`UPDATE constructor_monitor_state SET checked_at=now(),last_successful_check=now(),last_error=NULL,
      lease_owner=NULL,lease_until=NULL WHERE singleton=true AND lease_owner=$1::uuid`,[lease])
  })
}
export async function constructorMonitorSnapshot(thresholds: ConstructorMonitorThresholds, now=Date.now(), sql: Sql=getPool()): Promise<ConstructorMonitorSnapshot> {
  if (!dbEnabled()) throw new Error('constructor_monitor_store_unavailable')
  const [state,rows]=await Promise.all([
    sql.query<{checked_at:Date|null;last_successful_check:Date|null;last_error:string|null}>('SELECT checked_at,last_successful_check,last_error FROM constructor_monitor_state WHERE singleton=true'),
    sql.query<{evidence:ConstructorMonitorCase}>(`SELECT m.evidence FROM constructor_monitor_cases m
      JOIN build_jobs b ON b.id=m.job_id AND b.execution_cycle=m.execution_cycle
      WHERE b.arhivat=false ORDER BY m.checked_at DESC,m.job_id LIMIT $1`,[MAX_JOBS+1]),
  ])
  if (rows.rows.length > MAX_JOBS || !state.rows[0]) throw new Error('constructor_monitor_snapshot_unavailable')
  const last=state.rows[0]
  const checkedAt=iso(last.checked_at)
  const fresh=checkedAt !== null && now-Date.parse(checkedAt) >= 0 && now-Date.parse(checkedAt) <= thresholds.tickMs*2
  const error=last.last_error ?? (fresh ? null : checkedAt ? 'constructor_monitor_stale' : 'constructor_monitor_not_checked')
  const cases=rows.rows.map(({evidence}) => ({ ...evidence,
    activeExecution:!error && evidence.activeExecution && evidence.activeExecutionUntil !== null && Date.parse(evidence.activeExecutionUntil) > now,
    activeExecutionUntil:!error && evidence.activeExecutionUntil !== null && Date.parse(evidence.activeExecutionUntil) > now ? evidence.activeExecutionUntil : null }))
  return { checkedAt,lastSuccessfulCheck:iso(last.last_successful_check),error,thresholds,cases,
    activeExecution:cases.some((c) => c.activeExecution),
    state:error ? 'unknown' : cases.some((c) => c.fault || c.code === 'unverified') ? 'attention'
      : cases.some((c) => c.code === 'intentional_pause' || c.code === 'deploy_gate') ? 'paused' : 'observing' }
}
