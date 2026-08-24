import { randomUUID } from 'node:crypto'
import { conexiuneDb, getPool } from '../dbPool.js'

export type ConstructorServiceDomain = 'codex-worker' | 'constructor-publisher' | 'constructor-release'

export interface SqlResult<Row> {
  rows: Row[]
  rowCount?: number | null
}

export interface ConstructorSql {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<Row>>
}

const LEASE_SECONDS = 120
const MAX_ATTEMPTS = 3

interface PipelineRow {
  job_id: string | number
  task_id: string
  handoff_id: string
  base_commit_sha: string
  patch_sha256: string
  gate_receipt_sha256: string
  publisher_attempts: number
  publisher_lease_id: string | null
  publisher_branch: string | null
  publisher_head_sha: string | null
  publisher_pr_number: string | number | null
  publisher_pr_url: string | null
  publisher_receipt_sha256: string | null
  merged_commit_sha: string | null
  release_attempts: number
  release_lease_id: string | null
  release_request_id: string | null
  release_workflow_run_id: string | number | null
  release_dispatch_receipt_sha256: string | null
  release_receipt_sha256: string | null
  constructor_stage: string
  status: string
  commit_sha: string | null
  live_version: string | null
}

export interface WorkerHandoff {
  handoffId: string
  baseCommit: string
  patchSha256: string
  gateReceiptSha256: string
  progress?: string
}

export interface PublisherClaim {
  jobId: string
  taskId: string
  leaseId: string
  leaseSeconds: number
  handoffId: string
  baseCommit: string
  patchSha256: string
  gateReceiptSha256: string
  branch: string | null
  headCommit: string | null
  prNumber: number | null
  prUrl: string | null
}

export interface ReleaseClaim {
  jobId: string
  taskId: string
  leaseId: string
  leaseSeconds: number
  commit: string
  headCommit: string
  prNumber: number
  prUrl: string
  publisherReceiptSha256: string
  releaseRequestId: string | null
  workflowRunId: number | null
}

export interface PipelineEventResult {
  jobId: string
  status: string
  stage: string
  commit: string | null
  liveVersion: string | null
}

function eventResult(row: PipelineRow): PipelineEventResult {
  return {
    jobId: String(row.job_id),
    status: row.status,
    stage: row.constructor_stage,
    commit: row.commit_sha,
    liveVersion: row.live_version,
  }
}

function publisherClaim(row: PipelineRow, leaseId: string): PublisherClaim {
  return {
    jobId: String(row.job_id),
    taskId: row.task_id,
    leaseId,
    leaseSeconds: LEASE_SECONDS,
    handoffId: row.handoff_id,
    baseCommit: row.base_commit_sha,
    patchSha256: row.patch_sha256,
    gateReceiptSha256: row.gate_receipt_sha256,
    branch: row.publisher_branch,
    headCommit: row.publisher_head_sha,
    prNumber: row.publisher_pr_number == null ? null : Number(row.publisher_pr_number),
    prUrl: row.publisher_pr_url,
  }
}

function releaseClaim(row: PipelineRow, leaseId: string): ReleaseClaim | null {
  if (
    !row.merged_commit_sha
    || !row.publisher_head_sha
    || row.publisher_pr_number == null
    || !row.publisher_pr_url
    || !row.publisher_receipt_sha256
  ) return null
  return {
    jobId: String(row.job_id),
    taskId: row.task_id,
    leaseId,
    leaseSeconds: LEASE_SECONDS,
    commit: row.merged_commit_sha,
    headCommit: row.publisher_head_sha,
    prNumber: Number(row.publisher_pr_number),
    prUrl: row.publisher_pr_url,
    publisherReceiptSha256: row.publisher_receipt_sha256,
    releaseRequestId: row.release_request_id,
    workflowRunId: row.release_workflow_run_id == null ? null : Number(row.release_workflow_run_id),
  }
}

async function withTransaction<T>(operation: (sql: ConstructorSql) => Promise<T>): Promise<T> {
  const client = await conexiuneDb()
  const sql = client as unknown as ConstructorSql
  try {
    await sql.query('BEGIN')
    const result = await operation(sql)
    await sql.query('COMMIT')
    return result
  } catch (error) {
    await sql.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Persistă nonce-ul înainte de a executa cererea. DB indisponibilă înseamnă
 * refuz, nu fallback în memorie. */
export async function consumeConstructorServiceNonce(
  domain: ConstructorServiceDomain,
  nonce: string,
  expiresAt: Date,
  sql: ConstructorSql = getPool() as unknown as ConstructorSql,
): Promise<boolean> {
  try {
    await sql.query(
      'DELETE FROM constructor_service_nonces WHERE expires_at <= now()',
    )
    const inserted = await sql.query<{ nonce: string }>(
      `INSERT INTO constructor_service_nonces(service_domain, nonce, expires_at)
       VALUES ($1, $2::uuid, $3)
       ON CONFLICT DO NOTHING
       RETURNING nonce::text AS nonce`,
      [domain, nonce, expiresAt.toISOString()],
    )
    return inserted.rows.length === 1
  } catch {
    return false
  }
}

/** Avansul la gates_passed și înscrierea handoff-ului sunt aceeași tranzacție.
 * Un publisher nu poate vedea vreodată o etapă fără receipt sau invers. */
export async function recordWorkerHandoff(
  jobId: number,
  taskId: string,
  handoff: WorkerHandoff,
): Promise<PipelineEventResult | null> {
  try {
    return await withTransaction(async (sql) => {
      const locked = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version,
                p.*
           FROM build_jobs b
           LEFT JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.id=$1 FOR UPDATE OF b`,
        [jobId],
      )
      const current = locked.rows[0]
      if (!current) return null

      const task = await sql.query<{ codex_task_id: string | null }>(
        'SELECT codex_task_id FROM build_jobs WHERE id=$1',
        [jobId],
      )
      if (task.rows[0]?.codex_task_id !== taskId) return null

      if (current.handoff_id) {
        const same = current.task_id === taskId
          && current.handoff_id === handoff.handoffId
          && current.base_commit_sha === handoff.baseCommit
          && current.patch_sha256 === handoff.patchSha256
          && current.gate_receipt_sha256 === handoff.gateReceiptSha256
          && ['gates_passed', 'pr_opened', 'merged', 'deployed'].includes(current.constructor_stage)
        return same ? eventResult(current) : null
      }
      if (current.status !== 'running') return null
      if (!['accepted', 'working'].includes(current.constructor_stage)) return null

      await sql.query(
        `INSERT INTO constructor_pipeline
           (job_id, task_id, handoff_id, base_commit_sha, patch_sha256, gate_receipt_sha256)
         VALUES ($1, $2, $3::uuid, $4, $5, $6)`,
        [jobId, taskId, handoff.handoffId, handoff.baseCommit, handoff.patchSha256, handoff.gateReceiptSha256],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs
            SET constructor_stage='gates_passed', ci='green',
                progress=$2, progress_at=now(), updated_at=now(), brain='codex-worker'
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [jobId, (handoff.progress ?? 'gates_passed').trim().slice(0, 500)],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
    })
  } catch {
    return null
  }
}

export async function claimPublisherJob(leaseId = randomUUID()): Promise<PublisherClaim | null> {
  return withTransaction(async (sql) => {
      await sql.query(
        `UPDATE build_jobs b
            SET status='failed', progress='publisher_attempts_exhausted',
                progress_at=now(), updated_at=now()
           FROM constructor_pipeline p
          WHERE p.job_id=b.id AND b.status='running'
            AND b.constructor_stage IN ('gates_passed','pr_opened')
            AND p.merged_commit_sha IS NULL
            AND p.publisher_attempts >= $1
            AND (p.publisher_lease_until IS NULL OR p.publisher_lease_until <= now())`,
        [MAX_ATTEMPTS],
      )
      const selected = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
           FROM build_jobs b
           JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.status='running'
            AND b.constructor_stage IN ('gates_passed','pr_opened')
            AND p.merged_commit_sha IS NULL
            AND p.publisher_attempts < $1
            AND (p.publisher_lease_until IS NULL OR p.publisher_lease_until <= now())
          ORDER BY p.handoff_created_at, b.id
          LIMIT 1 FOR UPDATE OF b, p SKIP LOCKED`,
        [MAX_ATTEMPTS],
      )
      const row = selected.rows[0]
      if (!row) return null
      await sql.query(
        `UPDATE constructor_pipeline
            SET publisher_lease_id=$2::uuid,
                publisher_lease_until=now() + ($3::text || ' seconds')::interval,
                publisher_attempts=publisher_attempts + 1,
                updated_at=now()
          WHERE job_id=$1`,
        [row.job_id, leaseId, LEASE_SECONDS],
      )
    return publisherClaim(row, leaseId)
  })
}

export async function renewPublisherLease(jobId: number, taskId: string, leaseId: string): Promise<boolean> {
  try {
    const result = await getPool().query(
      `UPDATE constructor_pipeline p
          SET publisher_lease_until=now() + ($4::text || ' seconds')::interval, updated_at=now()
         FROM build_jobs b
        WHERE p.job_id=$1 AND p.task_id=$2 AND p.publisher_lease_id=$3::uuid
          AND p.publisher_lease_until > now() AND p.job_id=b.id
          AND b.status='running' AND b.constructor_stage IN ('gates_passed','pr_opened')
        RETURNING p.job_id`,
      [jobId, taskId, leaseId, LEASE_SECONDS],
    )
    return result.rows.length === 1
  } catch {
    return false
  }
}

async function lockPublisherLease(sql: ConstructorSql, jobId: number, taskId: string, leaseId: string): Promise<PipelineRow | null> {
  const locked = await sql.query<PipelineRow>(
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
       FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND p.task_id=$2 AND p.publisher_lease_id=$3::uuid
        AND p.publisher_lease_until > now()
      FOR UPDATE OF b, p`,
    [jobId, taskId, leaseId],
  )
  return locked.rows[0] ?? null
}

async function lockPublisherLeaseOrCompleted(sql: ConstructorSql, jobId: number, taskId: string, leaseId: string): Promise<PipelineRow | null> {
  const locked = await sql.query<PipelineRow>(
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
       FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND p.task_id=$2 AND p.publisher_lease_id=$3::uuid
        AND (p.publisher_lease_until > now() OR b.constructor_stage IN ('merged','deployed'))
      FOR UPDATE OF b, p`,
    [jobId, taskId, leaseId],
  )
  return locked.rows[0] ?? null
}

export async function recordPublisherPrOpened(input: {
  jobId: number
  taskId: string
  leaseId: string
  branch: string
  headCommit: string
  prNumber: number
  prUrl: string
  receiptSha256: string
  progress?: string
}): Promise<PipelineEventResult | null> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockPublisherLease(sql, input.jobId, input.taskId, input.leaseId)
      if (!row || row.status !== 'running') return null
      if (row.constructor_stage === 'pr_opened') {
        const same = row.publisher_branch === input.branch
          && row.publisher_head_sha === input.headCommit
          && Number(row.publisher_pr_number) === input.prNumber
          && row.publisher_pr_url === input.prUrl
          && row.publisher_receipt_sha256 === input.receiptSha256
        return same ? eventResult(row) : null
      }
      if (row.constructor_stage !== 'gates_passed') return null
      await sql.query(
        `UPDATE constructor_pipeline
            SET publisher_branch=$2, publisher_head_sha=$3, publisher_pr_number=$4,
                publisher_pr_url=$5, publisher_receipt_sha256=$6, updated_at=now()
          WHERE job_id=$1`,
        [input.jobId, input.branch, input.headCommit, input.prNumber, input.prUrl, input.receiptSha256],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs SET constructor_stage='pr_opened', branch=$2, pr_url=$3,
            progress=$4, progress_at=now(), updated_at=now()
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [input.jobId, input.branch, input.prUrl, (input.progress ?? 'pr_opened').trim().slice(0, 500)],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
    })
  } catch {
    return null
  }
}

export async function recordPublisherMerged(input: {
  jobId: number
  taskId: string
  leaseId: string
  headCommit: string
  prNumber: number
  commit: string
  receiptSha256: string
  progress?: string
}): Promise<PipelineEventResult | null> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockPublisherLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return null
      if (row.publisher_head_sha !== input.headCommit || Number(row.publisher_pr_number) !== input.prNumber) return null
      if (['merged', 'deployed'].includes(row.constructor_stage)) {
        const same = row.merged_commit_sha === input.commit && row.publisher_receipt_sha256 === input.receiptSha256
        return same ? eventResult(row) : null
      }
      if (row.status !== 'running' || row.constructor_stage !== 'pr_opened' || row.merged_commit_sha) return null
      await sql.query(
        `UPDATE constructor_pipeline SET merged_commit_sha=$2,
            publisher_receipt_sha256=$3, publisher_lease_until=NULL,
            updated_at=now() WHERE job_id=$1`,
        [input.jobId, input.commit, input.receiptSha256],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs SET constructor_stage='merged', commit_sha=$2,
            progress=$3, progress_at=now(), updated_at=now()
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [input.jobId, input.commit, (input.progress ?? 'merged').trim().slice(0, 500)],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
    })
  } catch {
    return null
  }
}

export async function failPublisherLease(jobId: number, taskId: string, leaseId: string, code: string): Promise<PipelineEventResult | null> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockPublisherLease(sql, jobId, taskId, leaseId)
      if (!row || row.status !== 'running' || row.constructor_stage === 'merged') return null
      const exhausted = row.publisher_attempts >= MAX_ATTEMPTS
      await sql.query(
        `UPDATE constructor_pipeline SET publisher_lease_id=NULL,
            publisher_lease_until=NULL, publisher_last_error=$2, updated_at=now()
          WHERE job_id=$1`,
        [jobId, code],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs SET status=CASE WHEN $3 THEN 'failed' ELSE status END,
            progress=CASE WHEN $3 THEN 'publisher_attempts_exhausted' ELSE 'publisher_retryable_failure' END,
            log=$2, progress_at=now(), updated_at=now() WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [jobId, code, exhausted],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
    })
  } catch {
    return null
  }
}

export async function claimReleaseJob(leaseId = randomUUID()): Promise<ReleaseClaim | null> {
  return withTransaction(async (sql) => {
      await sql.query(
        `UPDATE build_jobs b
            SET status='failed', progress='release_attempts_exhausted',
                progress_at=now(), updated_at=now()
           FROM constructor_pipeline p
          WHERE p.job_id=b.id AND b.status='running'
            AND b.constructor_stage='merged'
            AND p.release_receipt_sha256 IS NULL
            AND p.release_attempts >= $1
            AND (p.release_lease_until IS NULL OR p.release_lease_until <= now())`,
        [MAX_ATTEMPTS],
      )
      const selected = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
           FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.status='running' AND b.constructor_stage='merged'
            AND p.merged_commit_sha=b.commit_sha
            AND p.publisher_receipt_sha256 IS NOT NULL
            AND p.release_receipt_sha256 IS NULL
            AND p.release_attempts < $1
            AND (p.release_lease_until IS NULL OR p.release_lease_until <= now())
          ORDER BY p.updated_at, b.id
          LIMIT 1 FOR UPDATE OF b, p SKIP LOCKED`,
        [MAX_ATTEMPTS],
      )
      const row = selected.rows[0]
      if (!row) return null
      await sql.query(
        `UPDATE constructor_pipeline
            SET release_lease_id=$2::uuid,
                release_lease_until=now() + ($3::text || ' seconds')::interval,
                release_attempts=release_attempts + 1,
                release_last_error=NULL, updated_at=now()
          WHERE job_id=$1`,
        [row.job_id, leaseId, LEASE_SECONDS],
      )
    return releaseClaim(row, leaseId)
  })
}

export async function renewReleaseLease(jobId: number, taskId: string, leaseId: string): Promise<boolean> {
  try {
    const result = await getPool().query(
      `UPDATE constructor_pipeline p
          SET release_lease_until=now() + ($4::text || ' seconds')::interval, updated_at=now()
         FROM build_jobs b
        WHERE p.job_id=$1 AND p.task_id=$2 AND p.release_lease_id=$3::uuid
          AND p.release_lease_until > now() AND p.job_id=b.id
          AND b.status='running' AND b.constructor_stage='merged'
        RETURNING p.job_id`,
      [jobId, taskId, leaseId, LEASE_SECONDS],
    )
    return result.rows.length === 1
  } catch {
    return false
  }
}

async function lockReleaseLease(sql: ConstructorSql, jobId: number, taskId: string, leaseId: string): Promise<PipelineRow | null> {
  const locked = await sql.query<PipelineRow>(
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
       FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND p.task_id=$2 AND p.release_lease_id=$3::uuid
        AND p.release_lease_until > now()
      FOR UPDATE OF b, p`,
    [jobId, taskId, leaseId],
  )
  return locked.rows[0] ?? null
}

async function lockReleaseLeaseOrCompleted(sql: ConstructorSql, jobId: number, taskId: string, leaseId: string): Promise<PipelineRow | null> {
  const locked = await sql.query<PipelineRow>(
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
       FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND p.task_id=$2 AND p.release_lease_id=$3::uuid
        AND (p.release_lease_until > now() OR b.constructor_stage='deployed')
      FOR UPDATE OF b, p`,
    [jobId, taskId, leaseId],
  )
  return locked.rows[0] ?? null
}

export async function recordReleaseDispatched(input: {
  jobId: number
  taskId: string
  leaseId: string
  requestId: string
  workflowRunId: number
  receiptSha256: string
}): Promise<boolean> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockReleaseLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return false
      if (row.release_request_id) {
        return row.release_request_id === input.requestId
          && Number(row.release_workflow_run_id) === input.workflowRunId
          && row.release_dispatch_receipt_sha256 === input.receiptSha256
      }
      if (row.status !== 'running' || row.constructor_stage !== 'merged') return false
      await sql.query(
        `UPDATE constructor_pipeline SET release_request_id=$2::uuid,
            release_workflow_run_id=$3, release_dispatch_receipt_sha256=$4,
            updated_at=now() WHERE job_id=$1`,
        [input.jobId, input.requestId, input.workflowRunId, input.receiptSha256],
      )
      return true
    })
  } catch {
    return false
  }
}

export async function recordReleaseDeployed(input: {
  jobId: number
  taskId: string
  leaseId: string
  requestId: string
  workflowRunId: number
  commit: string
  liveVersion: string
  receiptSha256: string
  progress?: string
}): Promise<PipelineEventResult | null> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockReleaseLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return null
      if (
        row.merged_commit_sha !== input.commit
        || row.release_request_id !== input.requestId
        || Number(row.release_workflow_run_id) !== input.workflowRunId
      ) return null
      if (row.constructor_stage === 'deployed') {
        const same = row.status === 'done'
          && row.commit_sha === input.commit
          && row.live_version === input.liveVersion
          && row.release_receipt_sha256 === input.receiptSha256
        return same ? eventResult(row) : null
      }
      if (row.status !== 'running' || row.constructor_stage !== 'merged' || row.release_receipt_sha256) return null
      await sql.query(
        `UPDATE constructor_pipeline SET release_receipt_sha256=$2,
            release_lease_until=NULL, updated_at=now()
          WHERE job_id=$1`,
        [input.jobId, input.receiptSha256],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs SET status='done', constructor_stage='deployed',
            commit_sha=$2, live_version=$3, progress=$4,
            progress_at=now(), updated_at=now()
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [input.jobId, input.commit, input.liveVersion, (input.progress ?? 'deployed').trim().slice(0, 500)],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
    })
  } catch {
    return null
  }
}

/** Un release eșuat rămâne la merged și poate fi reluat până la plafon. Nu
 * rescriem adevărul istoric spunând că merge-ul n-a existat. */
export async function failReleaseLease(jobId: number, taskId: string, leaseId: string, code: string): Promise<boolean> {
  try {
    return await withTransaction(async (sql) => {
      const row = await lockReleaseLease(sql, jobId, taskId, leaseId)
      if (!row || row.status !== 'running' || row.constructor_stage !== 'merged') return false
      const exhausted = row.release_attempts >= MAX_ATTEMPTS
      await sql.query(
        `UPDATE constructor_pipeline SET release_lease_id=NULL, release_lease_until=NULL,
            release_last_error=$2, updated_at=now() WHERE job_id=$1`,
        [jobId, code],
      )
      await sql.query(
        `UPDATE build_jobs SET status=CASE WHEN $2 THEN 'failed' ELSE status END,
            progress=CASE WHEN $2 THEN 'release_attempts_exhausted' ELSE 'release_retryable_failure' END,
            progress_at=now(), updated_at=now()
          WHERE id=$1 AND status='running' AND constructor_stage='merged'`,
        [jobId, exhausted],
      )
      return true
    })
  } catch {
    return false
  }
}
