import { createHash, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { config } from '../config.js'
import { conexiuneDb, dbEnabled, getPool, insertAuthorizedBuildJob } from '../db.js'
import type { DoctorCode, DoctorEvidence, DoctorGrant, DoctorGrantRequest, DoctorIncident, DoctorSnapshot } from '../shared/doctor.js'
import { DOCTOR_LEASE_SECONDS, DOCTOR_LIMITS, DOCTOR_PROBES, doctorExecutionScope, doctorVerifiedSymptom, validDoctorGrant } from './doctorPolicy.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'
import { doctorLocalReleaseSha, doctorRuntimeScopeVerified } from './doctorRuntimeCapability.js'

type Sql = Pick<pg.PoolClient, 'query'>
interface GrantRow {
  id: string; admin_email: string; scope: DoctorGrant['scope']; expires_at: Date | null
  max_jobs: number; jobs_created: number; revoked_at: Date | null
  window_hours: number; window_started_at: Date
}
interface IncidentRow {
  id: string; code: DoctorCode; status: DoctorIncident['status']; summary: string
  detected_at: Date; checked_at: Date; job_id: string | number | null
  evidence: DoctorEvidence; closure: DoctorIncident['closure']
  repair_attempted: boolean
}

const admin = (): string => config.adminEmail.trim().toLowerCase()
const sha = (value: string): boolean => /^[0-9a-f]{40}$/.test(value)

async function transaction<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  if (!dbEnabled()) throw new Error('doctor_store_unavailable')
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function accountLock(sql: Sql, email: string): Promise<void> {
  if (!email || email !== admin()) throw new Error('doctor_admin_changed')
  await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`constructor-account:${email}`])
}

function grantDto(row: GrantRow): DoctorGrant {
  const windowMs = row.window_hours * 3_600_000
  const started = row.window_started_at.getTime()
  const reset = started + windowMs
  const expiredWindow = reset <= Date.now()
  return { active: row.revoked_at === null && (row.expires_at === null || row.expires_at.getTime() > Date.now()),
    scope: row.scope, expiresAt: row.expires_at?.toISOString() ?? null, maxJobs: row.max_jobs,
    jobsCreated: expiredWindow ? 0 : row.jobs_created, windowHours:row.window_hours,
    windowResetsAt:new Date(started+(Math.max(0,Math.floor((Date.now()-started)/windowMs))+1)*windowMs).toISOString(),revocable: true }
}

function incidentDto(row: IncidentRow): DoctorIncident {
  // Older releases stored unmeasured reports as blockers. Project those
  // unattempted, unlinked rows truthfully without deleting the report or
  // inventing a healthy probe/closure. Repair failures remain blockers.
  const status = row.repair_attempted && row.job_id === null ? 'blocked'
    : !row.repair_attempted && row.job_id === null && row.status === 'blocked' && row.evidence.result === 'unverified'
      ? 'observed' : row.status
  return { id: row.id, code: row.code, status, summary: row.summary,
    detectedAt: row.detected_at.toISOString(), checkedAt: row.checked_at.toISOString(),
    jobId: row.job_id === null ? null : Number(row.job_id), evidence: row.evidence, closure: row.closure }
}

export async function grantDoctor(email: string, sessionHash: string, request: DoctorGrantRequest): Promise<void> {
  if (!validDoctorGrant(request) || !/^[0-9a-f]{64}$/.test(sessionHash)) throw new Error('doctor_grant_invalid')
  await transaction(async (sql) => {
    await accountLock(sql, email)
    // Verify the exact hydrated Google session again after the GDPR lock. A
    // separate active session belonging to this email is not sufficient.
    const identity = await sql.query<{ valid: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.token_hash=$1 AND lower(s.email)=$2
        AND s.auth_provider='google' AND s.revoked_at IS NULL AND s.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE lower(b.email)=$2)) AS valid`, [sessionHash, email])
    if (!identity.rows[0]?.valid) throw new Error('doctor_identity_inactive')
    // Existing account lifetime anchor. Old releases also delete user_prefs
    // during GDPR erasure; the FK revokes consent even across a code rollback.
    // Session retention/logout must not silently expire a permanent grant.
    await sql.query('INSERT INTO user_prefs(user_email) VALUES ($1) ON CONFLICT (user_email) DO NOTHING', [email])
    const existing = await sql.query<GrantRow>('SELECT * FROM doctor_grants WHERE admin_email=$1 AND revoked_at IS NULL FOR UPDATE', [email])
    const current = existing.rows[0]
    if (current && grantDto(current).active) throw new Error('doctor_grant_already_active')
    await sql.query('UPDATE doctor_grants SET revoked_at=now() WHERE admin_email=$1 AND revoked_at IS NULL', [email])
    await sql.query(`INSERT INTO doctor_grants(id,admin_email,scope,expires_at,max_jobs,window_hours)
      VALUES ($1::uuid,$2,$3,CASE WHEN $4::integer IS NULL THEN NULL ELSE now()+($4::text || ' hours')::interval END,$5,$6)`,
    [randomUUID(), email, request.scope, request.durationHours, request.maxJobs,request.windowHours])
  })
}

export async function revokeDoctor(email: string): Promise<void> {
  await transaction(async (sql) => {
    await accountLock(sql, email)
    await sql.query('UPDATE doctor_grants SET revoked_at=now() WHERE admin_email=$1 AND revoked_at IS NULL', [email])
    // A claimed job already crossed the authority boundary and may have a
    // handoff. Never stop/reverse it or its publication while revoking intake.
    await sql.query(`UPDATE build_jobs b SET status='cancelled',constructor_stage='cancelled',
      progress='doctor_grant_revoked',retry_not_before=NULL,updated_at=now()
      WHERE b.status='queued' AND b.automation_origin='doctor' AND b.ordered_by=$1
        AND b.attempts=0 AND NOT EXISTS (SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id)`, [email])
  })
}

export async function doctorSnapshot(): Promise<DoctorSnapshot> {
  if (!dbEnabled()) throw new Error('doctor_store_unavailable')
  const [grants, incidents, lease] = await Promise.all([
    getPool().query<GrantRow>('SELECT * FROM doctor_grants WHERE admin_email=$1 ORDER BY created_at DESC LIMIT 1', [admin()]),
    getPool().query<IncidentRow>('SELECT * FROM doctor_incidents ORDER BY checked_at DESC,id LIMIT 40'),
    getPool().query<{ checked_at: Date | null; checked_release_sha: string | null; running: boolean; last_error: string | null }>('SELECT checked_at,checked_release_sha,last_error, owner IS NOT NULL AND until_at > now() AS running FROM doctor_lease WHERE singleton=true'),
  ])
  const grant = grants.rows[0] ? grantDto(grants.rows[0]) : null
  const rows = incidents.rows.map(incidentDto)
  const runtimeVerified = await doctorRuntimeScopeVerified()
  const last = lease.rows[0]
  const checkedAt = last?.checked_at?.getTime() ?? Number.NaN
  const freshCheck = last?.checked_release_sha === doctorLocalReleaseSha() && Number.isFinite(checkedAt)
    && checkedAt <= Date.now() && Date.now()-checkedAt <= DOCTOR_LEASE_SECONDS*1_000
  const error = !runtimeVerified ? 'doctor_runtime_scope_unverified'
    : grant?.active && grant.jobsCreated >= grant.maxJobs ? 'doctor_window_budget_exhausted'
    : last?.last_error ?? (!last?.checked_at ? 'awaiting_first_check' : freshCheck ? null : 'doctor_check_stale')
  const state = !grant?.active || !releaseSideEffectsEnabled() ? 'disabled'
    : !runtimeVerified ? 'blocked'
    : lease.rows[0]?.running || rows.some((r) => ['queued','repairing','awaiting_live'].includes(r.status)) ? 'running'
    : error || rows.some((r) => r.status === 'blocked') ? 'blocked' : 'ready'
  return { checkedAt: lease.rows[0]?.checked_at?.toISOString() ?? null, error, state, grant, incidents: rows, limits: DOCTOR_LIMITS }
}

export async function acquireDoctorLease(): Promise<string | null> {
  if (!dbEnabled() || !releaseSideEffectsEnabled()) return null
  const id = randomUUID()
  const result = await getPool().query(`UPDATE doctor_lease SET owner=$1::uuid,
    until_at=now()+($2::text || ' seconds')::interval WHERE singleton=true
    AND (owner IS NULL OR until_at <= now()) RETURNING owner`, [id, DOCTOR_LEASE_SECONDS])
  return result.rows.length ? id : null
}

export async function releaseDoctorLease(id: string, failed = false, checkedReleaseSha: string | null = null): Promise<void> {
  const proved = !failed && checkedReleaseSha && sha(checkedReleaseSha) ? checkedReleaseSha : null
  await getPool().query('UPDATE doctor_lease SET owner=NULL,until_at=NULL,checked_at=now(),last_error=$2,checked_release_sha=$3 WHERE singleton=true AND owner=$1::uuid', [id,failed ? 'doctor_check_incomplete' : null,proved])
}

async function assertLease(sql: Sql, lease: string): Promise<void> {
  if (!releaseSideEffectsEnabled()) throw new Error('doctor_release_inactive')
  const row = await sql.query('SELECT owner FROM doctor_lease WHERE singleton=true AND owner=$1::uuid AND until_at > now() FOR UPDATE', [lease])
  if (!row.rows.length) throw new Error('doctor_lease_lost')
}

export async function recordDoctorObservation(evidence: DoctorEvidence): Promise<string | null> {
  if (!evidence.releaseSha || !sha(evidence.releaseSha)) return null
  return transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('doctor:incident'))")
    let fingerprint = createHash('sha256').update(`${evidence.code}:${evidence.releaseSha}`).digest('hex')
    // A failed repair is not a new incident merely because an unrelated
    // release was deployed. Only a resolved incident may recur on a new SHA.
    const existing = await sql.query<IncidentRow>(`SELECT * FROM doctor_incidents WHERE code=$1
      AND (status <> 'resolved' OR fingerprint=$2) ORDER BY (status='resolved'),detected_at LIMIT 1 FOR UPDATE`, [evidence.code, fingerprint])
    const found = existing.rows[0]
    if (found && found.status !== 'resolved') {
      // A missing manual probe cannot erase a measured dependency failure,
      // nor refresh its timestamp as if recovery had been measured.
      if (evidence.result === 'unverified' && found.evidence.result === 'blocked') return found.id
      const status = found.repair_attempted && found.job_id === null ? 'blocked' : found.job_id !== null ? found.status
        : evidence.result === 'blocked' ? 'blocked' : 'observed'
      await sql.query('UPDATE doctor_incidents SET evidence=$2::jsonb,status=$3,closure=NULL,checked_at=now() WHERE id=$1::uuid', [found.id,JSON.stringify(evidence),status])
      return found.id
    }
    if (evidence.result === 'healthy') return null
    // A rollback can expose the exact previously attempted release again.
    // Preserve its closure forever; record a distinct non-rearmable case
    // instead of deleting the historical proof or spending another AI run.
    const recurrence = found?.status === 'resolved'
    if (recurrence) fingerprint = createHash('sha256').update(`${fingerprint}:${found.id}`).digest('hex')
    const id = randomUUID()
    await sql.query(`INSERT INTO doctor_incidents(id,code,fingerprint,release_sha,status,summary,evidence,repair_attempted)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [id,evidence.code,fingerprint,evidence.releaseSha,
      recurrence || evidence.result === 'blocked' ? 'blocked' : 'observed',DOCTOR_PROBES[evidence.code].summary,JSON.stringify(evidence),recurrence])
    return id
  })
}

export async function queueDoctorRepair(incidentId: string, order: string, lease: string): Promise<number | null> {
  return transaction(async (sql) => {
    const email = admin()
    await accountLock(sql, email)
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('constructor:create-build-job'))")
    await assertLease(sql, lease)
    if (!await doctorRuntimeScopeVerified(undefined,sql)) return null
    await sql.query(`UPDATE doctor_grants SET jobs_created=0,
      window_started_at=window_started_at+floor(extract(epoch FROM now()-window_started_at)/(window_hours*3600))*window_hours*interval '1 hour'
      WHERE admin_email=$1 AND revoked_at IS NULL AND window_started_at+window_hours*interval '1 hour' <= now()`, [email])
    const grant = await sql.query<GrantRow>(`SELECT * FROM doctor_grants g WHERE admin_email=$1
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND jobs_created < max_jobs
      AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE lower(b.email)=$1) FOR UPDATE`, [email])
    if (!grant.rows[0]) return null
    const incident = await sql.query<IncidentRow>('SELECT * FROM doctor_incidents WHERE id=$1::uuid FOR UPDATE', [incidentId])
    const row = incident.rows[0]
    if (!row || row.repair_attempted || row.job_id !== null || row.status === 'resolved' || row.evidence.result !== 'defect') return row?.job_id ? Number(row.job_id) : null
    const scope = doctorExecutionScope(row.code)
    if (!scope) throw new Error('doctor_scope_invalid')
    // The intake lock also serializes explicit admin orders. Queue at most
    // one repair at a time, not one per failed probe in the same tick.
    const active = await sql.query("SELECT id FROM build_jobs WHERE status IN ('queued','running') LIMIT 1")
    if (active.rows.length) return null
    const result = await insertAuthorizedBuildJob(sql, email, order)
    // A similar existing owner order is not proof that this exact symptom is
    // being repaired. Do not seize it or change its automation authority.
    // automatic_retry_limit=1 is retained for the deployed Doctor constraint;
    // every origin now forbids automatic AI retry independently of this value.
    if (!result.created) {
      await sql.query("UPDATE doctor_incidents SET status='blocked',summary=$2,checked_at=now() WHERE id=$1::uuid", [incidentId,'Există un ordin similar activ; Doctorul nu creează o dublură.'])
      return null
    }
    await sql.query("UPDATE build_jobs SET automation_origin='doctor',automatic_retry_limit=1,repair_scope=$2::jsonb WHERE id=$1", [result.id,JSON.stringify(scope)])
    await sql.query('UPDATE doctor_grants SET jobs_created=jobs_created+1 WHERE id=$1::uuid', [grant.rows[0].id])
    await sql.query("UPDATE doctor_incidents SET grant_id=$2::uuid,job_id=$3,repair_attempted=true,status='queued',checked_at=now() WHERE id=$1::uuid", [incidentId,grant.rows[0].id,result.id])
    return result.id
  })
}

export interface DoctorJobProof {
  incidentId: string; code: DoctorCode; jobId: number; status: string; stage: string
  commit: string | null; liveVersion: string | null; receipt: string | null
}

export async function doctorPendingJobs(): Promise<DoctorJobProof[]> {
  const result = await getPool().query<{ id: string; code: DoctorCode; job_id: string; status: string;
    constructor_stage: string; commit_sha: string | null; live_version: string | null; release_receipt_sha256: string | null }>(
    `SELECT d.id,d.code,b.id AS job_id,b.status,b.constructor_stage,b.commit_sha,b.live_version,p.release_receipt_sha256
      FROM doctor_incidents d JOIN build_jobs b ON b.id=d.job_id
      LEFT JOIN constructor_pipeline p ON p.job_id=b.id WHERE d.status <> 'resolved' ORDER BY d.detected_at LIMIT 40`)
  return result.rows.map((r) => ({ incidentId:r.id,code:r.code,jobId:Number(r.job_id),status:r.status,
    stage:r.constructor_stage,commit:r.commit_sha,liveVersion:r.live_version,receipt:r.release_receipt_sha256 }))
}

export async function updateDoctorJob(job: DoctorJobProof, symptom: DoctorEvidence | null, liveSha: string | null, lease: string): Promise<void> {
  await transaction(async (sql) => {
    await assertLease(sql, lease)
    // Revalidate the immutable pipeline receipt and latest job state after the
    // HTTP probe, inside the write transaction. Browser claims cannot close it.
    const complete = await sql.query(`SELECT b.id FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND b.status='done' AND b.constructor_stage='deployed' AND b.ci='green'
        AND b.commit_sha=$2 AND b.live_version=$2 AND p.release_target_sha=$2
        AND p.release_receipt_sha256 ~ '^[0-9a-f]{64}$' AND p.release_receipt_sha256=$3`, [job.jobId,liveSha,job.receipt])
    const verified = Boolean(liveSha && sha(liveSha) && complete.rows.length
      && job.status === 'done' && job.stage === 'deployed' && job.commit === liveSha && job.liveVersion === liveSha
      && doctorVerifiedSymptom(symptom,job.code,liveSha))
    const closure = verified ? { verifiedAt:symptom!.checkedAt,liveSha:liveSha!,symptom:symptom! } : null
    const status = verified ? 'resolved' : ['failed','cancelled'].includes(job.status) ? 'blocked'
      : job.status === 'done' ? 'awaiting_live' : job.status === 'running' ? 'repairing' : 'queued'
    await sql.query(`UPDATE doctor_incidents SET status=$2,closure=$3::jsonb,checked_at=now(),
      evidence=COALESCE($4::jsonb,evidence) WHERE id=$1::uuid AND status <> 'resolved' AND job_id=$5`,
    [job.incidentId,status,closure ? JSON.stringify(closure) : null,symptom ? JSON.stringify(symptom) : null,job.jobId])
  })
}
