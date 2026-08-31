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

const configuredLeaseSeconds = Number.parseInt(process.env.CONSTRUCTOR_PIPELINE_LEASE_SECONDS ?? '', 10)
const LEASE_SECONDS = Number.isInteger(configuredLeaseSeconds) && configuredLeaseSeconds > 0
  ? configuredLeaseSeconds
  : 120

function configuredRetrySeconds(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

const RETRY_BASE_SECONDS = configuredRetrySeconds('CONSTRUCTOR_RETRY_BASE_SECONDS', 60, 5, 3600)
const RETRY_MAX_SECONDS = configuredRetrySeconds('CONSTRUCTOR_RETRY_MAX_SECONDS', 1800, 30, 86_400)
const EXTERNAL_RETRY_SECONDS = configuredRetrySeconds('CONSTRUCTOR_EXTERNAL_RETRY_SECONDS', 900, 60, 86_400)

function retryDelay(attempts: number, external: boolean): number {
  if (external) return EXTERNAL_RETRY_SECONDS
  const exponent = Math.min(10, Math.max(0, attempts - 1))
  return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** exponent))
}

interface PipelineRow {
  job_id: string | number
  task_id: string
  handoff_id: string
  base_commit_sha: string
  patch_sha256: string
  gate_receipt_sha256: string
  publisher_attempts: number
  publisher_lease_id: string | null
  publisher_retry_not_before: Date | string | null
  publisher_branch: string | null
  publisher_head_sha: string | null
  publisher_pr_number: string | number | null
  publisher_pr_url: string | null
  publisher_receipt_sha256: string | null
  merged_commit_sha: string | null
  release_attempts: number
  release_lease_id: string | null
  release_retry_not_before: Date | string | null
  release_request_id: string | null
  release_intent_receipt_sha256: string | null
  release_intent_created_at: Date | string | null
  release_legacy_ambiguity_started_at: Date | string | null
  release_workflow_run_id: string | number | null
  release_dispatch_receipt_sha256: string | null
  release_receipt_sha256: string | null
  release_target_sha: string | null
  release_target_receipt_sha256: string | null
  release_ci_run_id: string | number | null
  release_build_run_id: string | number | null
  release_artifact_id: string | number | null
  release_candidate_receipt_sha256: string | null
  release_protocol_version: string | number
  constructor_stage: string
  status: string
  commit_sha: string | null
  live_version: string | null
  ci?: string | null
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
  releaseTargetCommit: string | null
  releaseTargetReceiptSha256: string | null
  releaseRequestId: string | null
  intentReceiptSha256: string | null
  intentCreatedAt: string | null
  legacyAmbiguityStartedAt: string | null
  workflowRunId: number | null
  dispatchReceiptSha256: string | null
  ciRunId: number | null
  buildRunId: number | null
  artifactId: number | null
  candidateReceiptSha256: string | null
  releaseProtocolVersion: 1 | 2
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
    releaseTargetCommit: row.release_target_sha,
    releaseTargetReceiptSha256: row.release_target_receipt_sha256,
    releaseRequestId: row.release_request_id,
    intentReceiptSha256: row.release_intent_receipt_sha256,
    intentCreatedAt: row.release_intent_created_at == null
      ? null
      : new Date(row.release_intent_created_at).toISOString(),
    legacyAmbiguityStartedAt: row.release_legacy_ambiguity_started_at == null
      ? null
      : new Date(row.release_legacy_ambiguity_started_at).toISOString(),
    workflowRunId: row.release_workflow_run_id == null ? null : Number(row.release_workflow_run_id),
    dispatchReceiptSha256: row.release_dispatch_receipt_sha256,
    ciRunId: row.release_ci_run_id == null ? null : Number(row.release_ci_run_id),
    buildRunId: row.release_build_run_id == null ? null : Number(row.release_build_run_id),
    artifactId: row.release_artifact_id == null ? null : Number(row.release_artifact_id),
    candidateReceiptSha256: row.release_candidate_receipt_sha256,
    releaseProtocolVersion: Number(row.release_protocol_version) === 1 ? 1 : 2,
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
}

/** Avansul la gates_passed și înscrierea handoff-ului sunt aceeași tranzacție.
 * Un publisher nu poate vedea vreodată o etapă fără receipt sau invers. */
export async function recordWorkerHandoff(
  jobId: number,
  taskId: string,
  handoff: WorkerHandoff,
): Promise<
  | { ok: true; event: PipelineEventResult }
  | { ok: false; reason: 'job_not_found' | 'task_mismatch' | 'handoff_conflict' | 'invalid_transition' }
> {
  return withTransaction(async (sql) => {
      const locked = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version,
                p.*
           FROM build_jobs b
           LEFT JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.id=$1 FOR UPDATE OF b`,
        [jobId],
      )
      const current = locked.rows[0]
      if (!current) return { ok: false, reason: 'job_not_found' as const }

      const task = await sql.query<{ codex_task_id: string | null }>(
        'SELECT codex_task_id FROM build_jobs WHERE id=$1',
        [jobId],
      )
      if (task.rows[0]?.codex_task_id !== taskId) return { ok: false, reason: 'task_mismatch' as const }

      if (current.handoff_id) {
        const same = current.task_id === taskId
          && current.handoff_id === handoff.handoffId
          && current.base_commit_sha === handoff.baseCommit
          && current.patch_sha256 === handoff.patchSha256
          && current.gate_receipt_sha256 === handoff.gateReceiptSha256
          && ['gates_passed', 'pr_opened', 'merged', 'release_dispatched', 'deployed'].includes(current.constructor_stage)
        return same
          ? { ok: true, event: eventResult(current) }
          : { ok: false, reason: 'handoff_conflict' as const }
      }
      if (current.status !== 'running') return { ok: false, reason: 'invalid_transition' as const }
      if (!['accepted', 'working'].includes(current.constructor_stage)) return { ok: false, reason: 'invalid_transition' as const }

      await sql.query(
        `INSERT INTO constructor_pipeline
           (job_id, task_id, handoff_id, base_commit_sha, patch_sha256, gate_receipt_sha256)
         VALUES ($1, $2, $3::uuid, $4, $5, $6)`,
        [jobId, taskId, handoff.handoffId, handoff.baseCommit, handoff.patchSha256, handoff.gateReceiptSha256],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs
            SET constructor_stage='gates_passed', ci='local_gates',
                progress=$2, progress_at=now(), updated_at=now(), brain='codex-worker'
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [jobId, (handoff.progress ?? 'gates_passed').trim().slice(0, 500)],
      )
      return updated.rows[0]
        ? { ok: true, event: eventResult(updated.rows[0]) }
        : { ok: false, reason: 'invalid_transition' as const }
    })
}

export async function claimPublisherJob(leaseId = randomUUID()): Promise<PublisherClaim | null> {
  return withTransaction(async (sql) => {
      const selected = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, p.*
           FROM build_jobs b
           JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.status='running'
             AND b.constructor_stage IN ('gates_passed','pr_opened')
             AND p.merged_commit_sha IS NULL
             AND (p.publisher_retry_not_before IS NULL OR p.publisher_retry_not_before <= now())
             AND (p.publisher_lease_until IS NULL OR p.publisher_lease_until <= now())
          ORDER BY p.handoff_created_at, b.id
          LIMIT 1 FOR UPDATE OF b, p SKIP LOCKED`,
      )
      const row = selected.rows[0]
      if (!row) return null
      await sql.query(
        `UPDATE constructor_pipeline
            SET publisher_lease_id=$2::uuid,
                publisher_lease_until=now() + ($3::text || ' seconds')::interval,
                publisher_attempts=publisher_attempts + 1,
                publisher_retry_not_before=NULL,
                publisher_last_error=NULL,
                updated_at=now()
          WHERE job_id=$1`,
        [row.job_id, leaseId, LEASE_SECONDS],
      )
      await sql.query(
        `UPDATE constructor_incidents
            SET state='repairing', stage='publisher_probe',
                evidence=left(evidence || E'\\n[publisher_probe_started_after_backoff]', 4000),
                verification=NULL, closed_at=NULL, updated_at=now()
          WHERE job_id=$1 AND state='blocked'`,
        [row.job_id],
      )
      await sql.query(
        `UPDATE build_jobs SET progress='publisher_retry_started',
            progress_at=now(), updated_at=now()
          WHERE id=$1 AND progress='external_action_required'`,
        [row.job_id],
      )
    return publisherClaim(row, leaseId)
  })
}

export async function renewPublisherLease(jobId: number, taskId: string, leaseId: string): Promise<boolean> {
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
        AND (p.publisher_lease_until > now() OR b.constructor_stage IN ('merged','release_dispatched','deployed'))
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
  return withTransaction(async (sql) => {
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
  return withTransaction(async (sql) => {
      const row = await lockPublisherLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return null
      if (row.publisher_head_sha !== input.headCommit || Number(row.publisher_pr_number) !== input.prNumber) return null
      if (['merged', 'release_dispatched', 'deployed'].includes(row.constructor_stage)) {
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
            ci='pr_checks_green', progress=$3, progress_at=now(), updated_at=now()
          WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [input.jobId, input.commit, (input.progress ?? 'merged').trim().slice(0, 500)],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
  })
}

function publisherIncident(code: string): {
  state: 'blocked' | 'diagnosing'
  causeCode: string
  summary: string
  nextAction: string
} {
  if (code === 'merged_unverifiable') return {
    state: 'blocked',
    causeCode: 'ci_failure',
    summary: 'PR-ul este deja merged, dar controalele obligatorii ale headului nu mai pot valida checkpointul.',
    nextAction: 'Restabilește dovada CI pentru headul merged; nu crea o a doua implementare și nu retrage un merge existent.',
  }
  if (code === 'master_diverged') return {
    state: 'blocked',
    causeCode: 'build_failure',
    summary: 'PR-ul este merged, dar commitul rezultat nu mai este inclus în istoricul master.',
    nextAction: 'Restabilește istoricul protejat care include merge-ul sau furnizează o dovadă de roll-forward; publisherul va revalida.',
  }
  if (code === 'branch_protection_invalid') return {
    state: 'blocked',
    causeCode: 'provider_auth',
    summary: 'Politica GitHub a ramurii master nu permite fluxul protejat cerut de Constructor.',
    nextAction: 'Corectează protecția ramurii master conform politicii Constructor; publisherul va relua automat.',
  }
  if (code === 'github_auth_required') return {
    state: 'blocked',
    causeCode: 'provider_auth',
    summary: 'GitHub a respins credentiala limitată a publisherului.',
    nextAction: 'Reautorizează credentiala GitHub a publisherului cu permisiunile documentate; reluarea este automată.',
  }
  if (code === 'ci_failed') return {
    state: 'diagnosing',
    causeCode: 'ci_failure',
    summary: 'Un control CI obligatoriu a respins versiunea publicată.',
    nextAction: 'Reexecută același ordin peste masterul curent și repară cauza CI înainte de un handoff nou.',
  }
  if (code === 'local_gate_failed') return {
    state: 'diagnosing',
    causeCode: 'test_failure',
    summary: 'Revalidarea izolată a publisherului a respins handoff-ul workerului.',
    nextAction: 'Reproduce porțile în execuția OpenCode + Qwen local (llama.cpp) și repară diferența înainte de un handoff nou.',
  }
  if (code === 'stale_base') return {
    state: 'diagnosing',
    causeCode: 'build_failure',
    summary: 'Masterul s-a schimbat după crearea handoff-ului, iar baza declarată a devenit stale.',
    nextAction: 'Reexecută același ordin peste vârful master curent; nu reutiliza patch-ul vechi.',
  }
  if (code === 'pr_closed') return {
    state: 'diagnosing',
    causeCode: 'unknown',
    summary: 'PR-ul Constructor a fost închis fără merge.',
    nextAction: 'Reexecută același ordin curat și creează un handoff nou.',
  }
  return {
    state: 'diagnosing',
    causeCode: 'unknown',
    summary: 'Publisherul nu a putut avansa handoff-ul; cauza exactă nu este încă demonstrată.',
    nextAction: 'Păstrează checkpointul, citește jurnalul publisherului și reia automat după clasificarea cauzei.',
  }
}

export interface PublisherRetirementProof {
  branch: string | null
  headCommit: string | null
  prNumber: number | null
  cleanupReceiptSha256: string
}

export async function failPublisherLease(
  jobId: number,
  taskId: string,
  leaseId: string,
  code: string,
  retirement?: PublisherRetirementProof,
): Promise<PipelineEventResult | null> {
  return withTransaction(async (sql) => {
      const row = await lockPublisherLease(sql, jobId, taskId, leaseId)
      if (!row || row.status !== 'running' || !['gates_passed', 'pr_opened'].includes(row.constructor_stage)) return null
      const incident = publisherIncident(code)
      const rebuildCodes = new Set(['stale_base', 'ci_failed', 'local_gate_failed', 'pr_closed'])
      const rebuild = rebuildCodes.has(code)
      const retirementProof = retirement ?? null
      if (rebuild) {
        if (!retirementProof) return null
        const expectedBranch = `codex/${taskId.slice('codex-'.length)}`
        if (
          (retirementProof.branch !== null && retirementProof.branch !== expectedBranch)
          || (row.publisher_branch !== null && retirementProof.branch !== row.publisher_branch)
          || (row.publisher_head_sha !== null && retirementProof.headCommit !== row.publisher_head_sha)
          || (row.publisher_pr_number !== null && retirementProof.prNumber !== Number(row.publisher_pr_number))
        ) return null
      }
      await sql.query(
        `INSERT INTO constructor_incidents
           (job_id, fingerprint, state, stage, cause_code, cause_summary, evidence, responsible, next_action)
         VALUES (
           $1,
           COALESCE((SELECT fingerprint FROM constructor_incidents WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 1), 'job:' || $1::text),
           $2, 'publisher', $3, $4, $5, 'constructor-publisher', $6
         )
         ON CONFLICT (fingerprint) DO UPDATE SET
           job_id=EXCLUDED.job_id, state=EXCLUDED.state, stage=EXCLUDED.stage,
           cause_code=EXCLUDED.cause_code, cause_summary=EXCLUDED.cause_summary,
           evidence=EXCLUDED.evidence, responsible=EXCLUDED.responsible,
           next_action=EXCLUDED.next_action, verification=NULL, closed_at=NULL,
           updated_at=now()`,
        [jobId, incident.state, incident.causeCode, incident.summary, code, incident.nextAction],
      )
      if (rebuild && retirementProof) {
        await sql.query(
          `INSERT INTO constructor_publication_retirements
             (job_id, task_id, handoff_id, branch, head_sha, pr_number, failure_code, cleanup_receipt_sha256)
           VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8)
          `,
          [
            jobId,
            taskId,
            row.handoff_id,
            retirementProof.branch,
            retirementProof.headCommit,
            retirementProof.prNumber,
            code,
            retirementProof.cleanupReceiptSha256,
          ],
        )
        await sql.query('DELETE FROM constructor_pipeline WHERE job_id=$1', [jobId])
        const delay = retryDelay(Number(row.publisher_attempts), false)
        const requeued = await sql.query<PipelineRow>(
          `UPDATE build_jobs
              SET status='queued', constructor_stage='queued', execution_cycle=execution_cycle + 1, codex_task_id=NULL,
                  branch=NULL, pr_url=NULL, commit_sha=NULL, live_version=NULL, ci=NULL,
                  progress=$3, log=$2,
                  retry_not_before=now() + ($4::text || ' seconds')::interval,
                  progress_at=now(), updated_at=now()
            WHERE id=$1
            RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
          [jobId, code, code === 'stale_base' ? 'stale_base_requeued' : 'worker_retry_scheduled', delay],
        )
        return requeued.rows[0] ? eventResult(requeued.rows[0]) : null
      }
      const external = incident.state === 'blocked'
      const delay = retryDelay(Number(row.publisher_attempts), external)
      await sql.query(
        `UPDATE constructor_pipeline SET publisher_lease_id=NULL,
            publisher_lease_until=NULL, publisher_last_error=$2,
            publisher_retry_not_before=now() + ($3::text || ' seconds')::interval,
            updated_at=now()
          WHERE job_id=$1`,
        [jobId, code, delay],
      )
      const updated = await sql.query<PipelineRow>(
        `UPDATE build_jobs SET progress=$3,
            log=$2, progress_at=now(), updated_at=now() WHERE id=$1
          RETURNING id AS job_id, status, constructor_stage, commit_sha, live_version`,
        [jobId, code, external ? 'external_action_required' : 'publisher_retryable_failure'],
      )
      return updated.rows[0] ? eventResult(updated.rows[0]) : null
  })
}

export async function claimReleaseJob(leaseId = randomUUID()): Promise<ReleaseClaim | null> {
  return withTransaction(async (sql) => {
      const selected = await sql.query<PipelineRow>(
        `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, b.ci, p.*
           FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE b.status='running' AND b.constructor_stage IN ('merged','release_dispatched')
            AND b.ci IN ('pr_checks_green','in_progress','green')
            AND p.merged_commit_sha=b.commit_sha
             AND p.publisher_receipt_sha256 IS NOT NULL
             AND p.release_receipt_sha256 IS NULL
             AND (p.release_retry_not_before IS NULL OR p.release_retry_not_before <= now())
             AND (p.release_lease_until IS NULL OR p.release_lease_until <= now())
          ORDER BY p.updated_at, b.id
          LIMIT 1 FOR UPDATE OF b, p SKIP LOCKED`,
      )
      const row = selected.rows[0]
      if (!row) return null
      await sql.query(
        `UPDATE constructor_pipeline
            SET release_lease_id=$2::uuid,
                release_lease_until=now() + ($3::text || ' seconds')::interval,
                release_attempts=release_attempts + 1,
                release_retry_not_before=NULL,
                release_last_error=NULL, updated_at=now()
          WHERE job_id=$1`,
        [row.job_id, leaseId, LEASE_SECONDS],
      )
      await sql.query(
        `UPDATE constructor_incidents
            SET state='repairing', stage='release_probe',
                evidence=left(evidence || E'\\n[release_probe_started_after_backoff]', 4000),
                verification=NULL, closed_at=NULL, updated_at=now()
          WHERE job_id=$1 AND state='blocked'`,
        [row.job_id],
      )
      await sql.query(
        `UPDATE build_jobs SET progress='release_retry_started',
            progress_at=now(), updated_at=now()
          WHERE id=$1 AND progress='external_action_required'`,
        [row.job_id],
      )
      if (row.constructor_stage === 'release_dispatched') {
        await sql.query(
          `UPDATE build_jobs SET progress='release_retry_recovered',
              progress_at=now(), updated_at=now() WHERE id=$1`,
          [row.job_id],
        )
      }
    return releaseClaim(row, leaseId)
  })
}

export async function renewReleaseLease(jobId: number, taskId: string, leaseId: string): Promise<boolean> {
  const result = await getPool().query(
      `UPDATE constructor_pipeline p
          SET release_lease_until=now() + ($4::text || ' seconds')::interval, updated_at=now()
         FROM build_jobs b
        WHERE p.job_id=$1 AND p.task_id=$2 AND p.release_lease_id=$3::uuid
          AND p.release_lease_until > now() AND p.job_id=b.id
          AND b.status='running' AND b.constructor_stage IN ('merged','release_dispatched')
          AND b.ci IN ('pr_checks_green','in_progress','green')
        RETURNING p.job_id`,
      [jobId, taskId, leaseId, LEASE_SECONDS],
    )
  return result.rows.length === 1
}

async function lockReleaseLease(sql: ConstructorSql, jobId: number, taskId: string, leaseId: string): Promise<PipelineRow | null> {
  const locked = await sql.query<PipelineRow>(
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, b.ci, p.*
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
    `SELECT b.id AS job_id, b.status, b.constructor_stage, b.commit_sha, b.live_version, b.ci, p.*
       FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
      WHERE b.id=$1 AND p.task_id=$2 AND p.release_lease_id=$3::uuid
        AND (p.release_lease_until > now() OR b.constructor_stage IN ('release_dispatched','deployed'))
      FOR UPDATE OF b, p`,
    [jobId, taskId, leaseId],
  )
  return locked.rows[0] ?? null
}

interface ReleaseLeaseIdentity {
  jobId: number
  taskId: string
  leaseId: string
}

async function withLockedReleaseLease<T>(
  input: ReleaseLeaseIdentity,
  operation: (sql: ConstructorSql, row: PipelineRow | null) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    const row = await lockReleaseLease(sql, input.jobId, input.taskId, input.leaseId)
    return operation(sql, row)
  })
}

export async function recordReleaseTargetSelected(input: ReleaseLeaseIdentity & {
  targetCommit: string
  receiptSha256: string
  previousTargetCommit: string | null
  previousReceiptSha256: string | null
}): Promise<boolean> {
  return withLockedReleaseLease(input, async (sql, row) => {
    if (!row || row.status !== 'running' || !['merged', 'release_dispatched'].includes(row.constructor_stage)) return false
    if (row.release_target_sha) {
      if (
        row.release_target_sha === input.targetCommit
        && row.release_target_receipt_sha256 === input.receiptSha256
      ) return true
      if (
        row.constructor_stage !== 'merged'
        || row.release_request_id !== null
        || input.previousTargetCommit !== row.release_target_sha
        || input.previousReceiptSha256 !== row.release_target_receipt_sha256
      ) return false
      const advanced = await sql.query(
       `UPDATE constructor_pipeline
          SET release_target_sha=$2, release_target_receipt_sha256=$3,
              release_legacy_ambiguity_started_at=NULL,
                release_request_id=NULL, release_workflow_run_id=NULL,
                release_intent_receipt_sha256=NULL, release_intent_created_at=NULL,
                release_dispatch_receipt_sha256=NULL,
                release_ci_run_id=NULL, release_build_run_id=NULL,
                release_artifact_id=NULL, release_candidate_receipt_sha256=NULL,
                updated_at=now()
          WHERE job_id=$1 AND release_target_sha=$4
            AND release_target_receipt_sha256=$5
            AND release_request_id IS NULL
          RETURNING job_id`,
        [input.jobId, input.targetCommit, input.receiptSha256, input.previousTargetCommit, input.previousReceiptSha256],
      )
      if (advanced.rows.length !== 1) return false
      await sql.query(
        `UPDATE build_jobs SET constructor_stage='merged', ci='in_progress', progress='release_target_advanced',
            progress_at=now(), updated_at=now() WHERE id=$1`,
        [input.jobId],
      )
      return true
    }
    if (
      row.constructor_stage !== 'merged'
      || row.release_request_id !== null
      || input.previousTargetCommit !== null
      || input.previousReceiptSha256 !== null
    ) return false
    const updated = await sql.query(
      `UPDATE constructor_pipeline
          SET release_target_sha=$2, release_target_receipt_sha256=$3, updated_at=now()
        WHERE job_id=$1 AND release_target_sha IS NULL AND release_request_id IS NULL
        RETURNING job_id`,
      [input.jobId, input.targetCommit, input.receiptSha256],
    )
    if (updated.rows.length !== 1) return false
    await sql.query(
      `UPDATE build_jobs SET ci='in_progress', progress='release_target_selected',
          progress_at=now(), updated_at=now() WHERE id=$1`,
      [input.jobId],
    )
    return true
  })
}

/** Leagă determinist push-CI de buildul și artefactul născute din exact acel
 * run. Abia acest receipt permite eticheta factuală `green`. */
export async function recordReleaseCandidateVerified(input: ReleaseLeaseIdentity & {
  targetCommit: string
  ciRunId: number
  buildRunId: number
  artifactId: number
  receiptSha256: string
}): Promise<boolean> {
  return withLockedReleaseLease(input, async (sql, row) => {
    if (!row || row.status !== 'running' || !['merged', 'release_dispatched'].includes(row.constructor_stage)) return false
    if (row.release_target_sha !== input.targetCommit || !row.release_target_receipt_sha256) return false
    if (row.release_candidate_receipt_sha256) {
      const same = Number(row.release_ci_run_id) === input.ciRunId
        && Number(row.release_build_run_id) === input.buildRunId
        && Number(row.release_artifact_id) === input.artifactId
        && row.release_candidate_receipt_sha256 === input.receiptSha256
        && row.ci === 'green'
      if (same) return true
      if (row.release_request_id !== null || row.constructor_stage !== 'merged') return false
    }
    if (row.constructor_stage !== 'merged') return false
    await sql.query(
      `UPDATE constructor_pipeline
          SET release_ci_run_id=$2, release_build_run_id=$3, release_artifact_id=$4,
              release_candidate_receipt_sha256=$5, updated_at=now()
        WHERE job_id=$1`,
      [input.jobId, input.ciRunId, input.buildRunId, input.artifactId, input.receiptSha256],
    )
    const updated = await sql.query(
      `UPDATE build_jobs SET ci='green', progress='release_candidate_verified',
          progress_at=now(), updated_at=now()
        WHERE id=$1 AND status='running' AND constructor_stage='merged'
        RETURNING id`,
      [input.jobId],
    )
    return updated.rows.length === 1
  })
}

/** Leagă exclusiv un workflow v1 existent de dovezile exacte cerute de
 * protocolul curent. Efectul extern nu este retrimis pentru starea v1 ambiguă;
 * această tranziție persistă doar runul canonic observat. */
export async function reconcileLegacyReleaseDispatch(input: {
  jobId: number
  taskId: string
  leaseId: string
  targetCommit: string
  targetReceiptSha256: string
  requestId: string
  workflowRunId: number
  ciRunId: number
  buildRunId: number
  artifactId: number
  candidateReceiptSha256: string
  dispatchReceiptSha256: string
}): Promise<boolean> {
  return withTransaction(async (sql) => {
    const row = await lockReleaseLease(sql, input.jobId, input.taskId, input.leaseId)
    if (!row || row.status !== 'running') return false
    if (row.release_target_sha !== null || row.release_candidate_receipt_sha256 !== null) {
      return row.release_target_sha === input.targetCommit
        && row.release_target_receipt_sha256 === input.targetReceiptSha256
        && row.release_request_id === input.requestId
        && Number(row.release_workflow_run_id) === input.workflowRunId
        && Number(row.release_ci_run_id) === input.ciRunId
        && Number(row.release_build_run_id) === input.buildRunId
        && Number(row.release_artifact_id) === input.artifactId
        && row.release_candidate_receipt_sha256 === input.candidateReceiptSha256
        && row.release_dispatch_receipt_sha256 === input.dispatchReceiptSha256
        && row.constructor_stage === 'release_dispatched'
        && Number(row.release_protocol_version) === 1
        && row.release_legacy_ambiguity_started_at === null
    }
    if (
      Number(row.release_protocol_version) !== 1
      || !['merged', 'release_dispatched'].includes(row.constructor_stage)
      || row.merged_commit_sha !== input.targetCommit
      || row.release_target_sha !== null
      || row.release_target_receipt_sha256 !== null
      || row.release_ci_run_id !== null
      || row.release_build_run_id !== null
      || row.release_artifact_id !== null
      || row.release_candidate_receipt_sha256 !== null
      || row.release_intent_receipt_sha256 !== null
      || row.release_intent_created_at !== null
    ) return false
    const hasAnyDispatch = row.release_request_id !== null
      || row.release_workflow_run_id !== null
      || row.release_dispatch_receipt_sha256 !== null
    const hasCompleteDispatch = row.release_request_id !== null
      && row.release_workflow_run_id !== null
      && row.release_dispatch_receipt_sha256 !== null
    if (hasAnyDispatch && !hasCompleteDispatch) return false
    if (hasCompleteDispatch && (
      row.release_request_id !== input.requestId
      || Number(row.release_workflow_run_id) !== input.workflowRunId
      || row.release_dispatch_receipt_sha256 !== input.dispatchReceiptSha256
    )) return false
    const retired = await sql.query(
      'SELECT 1 FROM constructor_release_retirements WHERE request_id=$1::uuid',
      [input.requestId],
    )
    if (retired.rows.length > 0) return false
    const upgraded = await sql.query(
      `UPDATE constructor_pipeline
          SET release_target_sha=$2, release_target_receipt_sha256=$3,
              release_legacy_ambiguity_started_at=NULL,
              release_request_id=$4::uuid, release_workflow_run_id=$5,
              release_ci_run_id=$6, release_build_run_id=$7,
              release_artifact_id=$8, release_candidate_receipt_sha256=$9,
              release_dispatch_receipt_sha256=$10, updated_at=now()
        WHERE job_id=$1 AND release_protocol_version=1
        RETURNING job_id`,
      [
        input.jobId,
        input.targetCommit,
        input.targetReceiptSha256,
        input.requestId,
        input.workflowRunId,
        input.ciRunId,
        input.buildRunId,
        input.artifactId,
        input.candidateReceiptSha256,
        input.dispatchReceiptSha256,
      ],
    )
    if (upgraded.rows.length !== 1) return false
    const job = await sql.query(
      `UPDATE build_jobs SET constructor_stage='release_dispatched', ci='green',
          progress='legacy_release_reconciled', progress_at=now(), updated_at=now()
        WHERE id=$1 AND status='running'
          AND constructor_stage IN ('merged','release_dispatched')
        RETURNING id`,
      [input.jobId],
    )
    return job.rows.length === 1
  })
}

/** Închide durabil ambiguitatea unui claim v1 care nu are niciun checkpoint
 * extern după fereastra de consistență. Următorul claim folosește protocol v2;
 * dovada append-only păstrează exact motivul conversiei. */
export async function resolveLegacyReleaseAmbiguity(input: {
  jobId: number
  taskId: string
  leaseId: string
  mergedCommit: string
  requestId: string
  ambiguityStartedAt: string
  currentMaster: string
  receiptSha256: string
}): Promise<boolean> {
  return withTransaction(async (sql) => {
    const row = await lockReleaseLease(sql, input.jobId, input.taskId, input.leaseId)
    if (!row || row.status !== 'running') return false
    const existing = await sql.query<{
      job_id: string | number
      task_id: string
      merged_commit_sha: string
      request_id: string
      ambiguity_started_at: Date | string
      master_sha: string
    }>(
      `SELECT job_id, task_id, merged_commit_sha, request_id::text,
              ambiguity_started_at, master_sha
         FROM constructor_release_legacy_resolutions
        WHERE resolution_receipt_sha256=$1`,
      [input.receiptSha256],
    )
    const proof = existing.rows[0]
    if (proof) {
      return String(proof.job_id) === String(input.jobId)
        && proof.task_id === input.taskId
        && proof.merged_commit_sha === input.mergedCommit
        && proof.request_id === input.requestId
        && new Date(proof.ambiguity_started_at).toISOString() === input.ambiguityStartedAt
        && proof.master_sha === input.currentMaster
    }
    const ambiguityStartedAt = row.release_legacy_ambiguity_started_at == null
      ? null
      : new Date(row.release_legacy_ambiguity_started_at).toISOString()
    if (
      Number(row.release_protocol_version) !== 1
      || row.constructor_stage !== 'merged'
      || row.merged_commit_sha !== input.mergedCommit
      || ambiguityStartedAt !== input.ambiguityStartedAt
      || row.release_target_sha !== null
      || row.release_target_receipt_sha256 !== null
      || row.release_request_id !== null
      || row.release_intent_receipt_sha256 !== null
      || row.release_intent_created_at !== null
      || row.release_workflow_run_id !== null
      || row.release_dispatch_receipt_sha256 !== null
      || row.release_ci_run_id !== null
      || row.release_build_run_id !== null
      || row.release_artifact_id !== null
      || row.release_candidate_receipt_sha256 !== null
    ) return false
    const matured = await sql.query(
      `SELECT 1 FROM constructor_pipeline
        WHERE job_id=$1
          AND release_legacy_ambiguity_started_at <= now() - interval '4 hours'`,
      [input.jobId],
    )
    if (matured.rows.length !== 1) return false
    const inserted = await sql.query(
      `INSERT INTO constructor_release_legacy_resolutions
         (job_id, task_id, merged_commit_sha, request_id,
          ambiguity_started_at, master_sha, resolution_receipt_sha256)
       SELECT p.job_id, p.task_id, p.merged_commit_sha, $2::uuid,
              p.release_legacy_ambiguity_started_at, $3, $4
         FROM constructor_pipeline p
        WHERE p.job_id=$1
        RETURNING id`,
      [input.jobId, input.requestId, input.currentMaster, input.receiptSha256],
    )
    if (inserted.rows.length !== 1) return false
    const converted = await sql.query(
      `UPDATE constructor_pipeline
          SET release_protocol_version=2,
              release_legacy_ambiguity_started_at=NULL,
              release_retry_not_before=now(),
              release_last_error='legacy_dispatch_absence_resolved',
              updated_at=now()
        WHERE job_id=$1 AND release_protocol_version=1
        RETURNING job_id`,
      [input.jobId],
    )
    if (converted.rows.length !== 1) return false
    const job = await sql.query(
      `UPDATE build_jobs SET progress='legacy_dispatch_absence_resolved',
          progress_at=now(), updated_at=now()
        WHERE id=$1 AND status='running' AND constructor_stage='merged'
        RETURNING id`,
      [input.jobId],
    )
    return job.rows.length === 1
  })
}

/** Persistă intenția deterministă înainte de workflow_dispatch.  Dacă procesul
 * moare după efectul GitHub dar înainte de a primi run id, următorul lease caută
 * aceeași cerere în loc să selecteze altă țintă sau să dubleze deploy-ul. */
export async function recordReleaseDispatchIntended(input: {
  jobId: number
  taskId: string
  leaseId: string
  targetCommit: string
  requestId: string
  ciRunId: number
  buildRunId: number
  artifactId: number
  receiptSha256: string
}): Promise<boolean> {
  return withTransaction(async (sql) => {
    const row = await lockReleaseLease(sql, input.jobId, input.taskId, input.leaseId)
    if (!row || row.status !== 'running' || row.constructor_stage !== 'merged' || row.ci !== 'green') return false
    if (
      row.release_target_sha !== input.targetCommit
      || Number(row.release_ci_run_id) !== input.ciRunId
      || Number(row.release_build_run_id) !== input.buildRunId
      || Number(row.release_artifact_id) !== input.artifactId
      || !row.release_candidate_receipt_sha256
    ) return false
    if (row.release_request_id) {
      return row.release_request_id === input.requestId
        && row.release_workflow_run_id === null
        && row.release_dispatch_receipt_sha256 === null
        && row.release_intent_receipt_sha256 === input.receiptSha256
    }
    const retired = await sql.query(
      'SELECT 1 FROM constructor_release_retirements WHERE request_id=$1::uuid',
      [input.requestId],
    )
    if (retired.rows.length > 0) return false
    const updated = await sql.query(
      `UPDATE constructor_pipeline
          SET release_request_id=$2::uuid, release_intent_receipt_sha256=$3,
              release_intent_created_at=now(),
              updated_at=now()
        WHERE job_id=$1 AND release_request_id IS NULL
        RETURNING job_id`,
      [input.jobId, input.requestId, input.receiptSha256],
    )
    if (updated.rows.length !== 1) return false
    await sql.query(
      `UPDATE build_jobs SET progress='release_dispatch_intended',
          progress_at=now(), updated_at=now()
        WHERE id=$1 AND status='running' AND constructor_stage='merged'`,
      [input.jobId],
    )
    return true
  })
}

export async function recordReleaseDispatched(input: {
  jobId: number
  taskId: string
  leaseId: string
  requestId: string
  workflowRunId: number
  ciRunId: number
  buildRunId: number
  artifactId: number
  receiptSha256: string
}): Promise<boolean> {
  return withTransaction(async (sql) => {
      const row = await lockReleaseLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return false
      if (!row.release_target_sha || !row.release_target_receipt_sha256) return false
      if (
        Number(row.release_ci_run_id) !== input.ciRunId
        || Number(row.release_build_run_id) !== input.buildRunId
        || Number(row.release_artifact_id) !== input.artifactId
        || !row.release_candidate_receipt_sha256
      ) return false
      if (row.release_workflow_run_id !== null) {
        return row.release_request_id === input.requestId
          && Number(row.release_workflow_run_id) === input.workflowRunId
          && row.release_dispatch_receipt_sha256 === input.receiptSha256
      }
      if (
        row.status !== 'running'
        || row.constructor_stage !== 'merged'
        || row.ci !== 'green'
        || row.release_request_id !== input.requestId
        || !row.release_intent_receipt_sha256
        || row.release_dispatch_receipt_sha256 !== null
      ) return false
      const checkpoint = await sql.query(
        `UPDATE constructor_pipeline SET release_workflow_run_id=$2,
            release_dispatch_receipt_sha256=$3, updated_at=now()
          WHERE job_id=$1 AND release_request_id=$4::uuid
            AND release_workflow_run_id IS NULL
          RETURNING job_id`,
        [input.jobId, input.workflowRunId, input.receiptSha256, input.requestId],
      )
      if (checkpoint.rows.length !== 1) return false
      const updated = await sql.query(
        `UPDATE build_jobs SET constructor_stage='release_dispatched', progress='release_dispatched',
            progress_at=now(), updated_at=now()
          WHERE id=$1 AND status='running' AND constructor_stage='merged'
          RETURNING id`,
        [input.jobId],
      )
      return updated.rows.length === 1
  })
}

export const RELEASE_RETIREMENT_CONCLUSIONS = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'timed_out',
  'intent_not_materialized',
  'target_advanced_after_success',
] as const

export type ReleaseRetirementConclusion = typeof RELEASE_RETIREMENT_CONCLUSIONS[number]

/** Un dispatch poate fi înlocuit numai după ce identitatea lui exactă are un
 * verdict terminal (sau căutarea exhaustivă dovedește că intenția n-a produs
 * niciun run).  Receiptul rămâne într-un registru fără cascade. */
export async function retireReleaseDispatch(input: {
  jobId: number
  taskId: string
  leaseId: string
  targetCommit: string
  replacementTargetCommit: string
  requestId: string
  workflowRunId: number | null
  conclusion: ReleaseRetirementConclusion
  receiptSha256: string
}): Promise<boolean> {
  return withTransaction(async (sql) => {
    const row = await lockReleaseLease(sql, input.jobId, input.taskId, input.leaseId)
    if (!row || row.status !== 'running' || input.replacementTargetCommit === input.targetCommit) return false
    const existing = await sql.query<{
      job_id: string | number
      task_id: string
      target_sha: string
      replacement_target_sha: string
      request_id: string
      workflow_run_id: string | number | null
      conclusion: string
    }>(
      `SELECT job_id, task_id, target_sha, replacement_target_sha,
              request_id::text, workflow_run_id, conclusion
         FROM constructor_release_retirements
        WHERE retirement_receipt_sha256=$1`,
      [input.receiptSha256],
    )
    const retired = existing.rows[0]
    if (retired) {
      return String(retired.job_id) === String(input.jobId)
        && retired.task_id === input.taskId
        && retired.target_sha === input.targetCommit
        && retired.replacement_target_sha === input.replacementTargetCommit
        && retired.request_id === input.requestId
        && (retired.workflow_run_id == null ? null : Number(retired.workflow_run_id)) === input.workflowRunId
        && retired.conclusion === input.conclusion
    }
    if (
      row.release_target_sha !== input.targetCommit
      || !row.release_target_receipt_sha256
      || row.release_request_id !== input.requestId
      || !row.release_ci_run_id
      || !row.release_build_run_id
      || !row.release_artifact_id
      || !row.release_candidate_receipt_sha256
    ) return false
    const intentOnly = input.conclusion === 'intent_not_materialized'
    if (intentOnly) {
      if (
        input.workflowRunId !== null
        || row.constructor_stage !== 'merged'
        || row.release_workflow_run_id !== null
        || row.release_dispatch_receipt_sha256 !== null
        || !row.release_intent_receipt_sha256
        || !row.release_intent_created_at
      ) return false
      const matured = await sql.query(
        `SELECT 1 FROM constructor_pipeline
          WHERE job_id=$1
            AND release_intent_created_at <= now() - interval '4 hours'`,
        [input.jobId],
      )
      if (matured.rows.length !== 1) return false
    } else if (
      input.workflowRunId === null
      || row.constructor_stage !== 'release_dispatched'
      || Number(row.release_workflow_run_id) !== input.workflowRunId
      || !row.release_dispatch_receipt_sha256
    ) return false
    await sql.query(
      `INSERT INTO constructor_release_retirements
         (job_id, task_id, target_sha, replacement_target_sha,
          target_receipt_sha256, request_id, workflow_run_id,
          ci_run_id, build_run_id, artifact_id, candidate_receipt_sha256,
           intent_receipt_sha256, dispatch_receipt_sha256, conclusion,
           absence_observed_at, retirement_receipt_sha256)
       VALUES ($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,
               CASE WHEN $14='intent_not_materialized' THEN now() ELSE NULL END,$15)`,
      [
        input.jobId,
        input.taskId,
        row.release_target_sha,
        input.replacementTargetCommit,
        row.release_target_receipt_sha256,
        row.release_request_id,
        input.workflowRunId,
        Number(row.release_ci_run_id),
        Number(row.release_build_run_id),
        Number(row.release_artifact_id),
        row.release_candidate_receipt_sha256,
        row.release_intent_receipt_sha256,
        intentOnly ? null : row.release_dispatch_receipt_sha256,
        input.conclusion,
        input.receiptSha256,
      ],
    )
    await sql.query(
      `UPDATE constructor_pipeline
          SET release_protocol_version=2,
              release_request_id=NULL, release_intent_receipt_sha256=NULL,
              release_intent_created_at=NULL,
              release_workflow_run_id=NULL, release_dispatch_receipt_sha256=NULL,
              release_ci_run_id=NULL, release_build_run_id=NULL,
              release_artifact_id=NULL, release_candidate_receipt_sha256=NULL,
              release_last_error=$2, updated_at=now()
        WHERE job_id=$1`,
      [input.jobId, `dispatch_retired:${input.conclusion}`],
    )
    const reset = await sql.query(
      `UPDATE build_jobs SET constructor_stage='merged', ci='pr_checks_green',
          progress='release_dispatch_retired', progress_at=now(), updated_at=now()
        WHERE id=$1 AND status='running'
          AND constructor_stage IN ('merged','release_dispatched')
        RETURNING id`,
      [input.jobId],
    )
    return reset.rows.length === 1
  })
}

export async function recordReleaseDeployed(input: {
  jobId: number
  taskId: string
  leaseId: string
  requestId: string
  workflowRunId: number
  commit: string
  targetCommit: string
  liveVersion: string
  receiptSha256: string
  progress?: string
}): Promise<PipelineEventResult | null> {
  return withTransaction(async (sql) => {
      if (!/^[0-9a-f]{40}$/.test(input.liveVersion) || input.liveVersion !== input.targetCommit) return null
      const row = await lockReleaseLeaseOrCompleted(sql, input.jobId, input.taskId, input.leaseId)
      if (!row) return null
      if (
        row.ci !== 'green'
        ||
        row.merged_commit_sha !== input.commit
        || row.release_target_sha !== input.targetCommit
        || row.release_request_id !== input.requestId
        || Number(row.release_workflow_run_id) !== input.workflowRunId
      ) return null
      if (row.constructor_stage === 'deployed') {
        const same = row.status === 'done'
          && row.commit_sha === input.targetCommit
          && row.live_version === input.liveVersion
          && row.release_receipt_sha256 === input.receiptSha256
        return same ? eventResult(row) : null
      }
      if (row.status !== 'running' || row.constructor_stage !== 'release_dispatched' || row.release_receipt_sha256) return null
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
        [input.jobId, input.targetCommit, input.liveVersion, (input.progress ?? 'deployed').trim().slice(0, 500)],
      )
      const deployed = updated.rows[0]
      if (!deployed) return null
      await sql.query(
        `UPDATE constructor_incidents
            SET state='closed',
                verification=$2,
                lesson=left('Cauză: ' || cause_summary || ' Prevenție: ' || next_action || ' Verificare: ' || $2, 4000),
                next_action='Monitorizează reapariția aceleiași amprente; redeschide cazul la recurență.',
                closed_at=now(), updated_at=now()
          WHERE job_id=$1 AND state <> 'closed'`,
        [input.jobId, `order #${input.jobId} deployed; merged ${input.commit}; target ${input.targetCommit}; live ${input.liveVersion}`],
      )
      return eventResult(deployed)
  })
}

function releaseIncident(code: string): {
  state: 'blocked' | 'diagnosing'
  causeCode: string
  summary: string
  nextAction: string
} {
  if (code === 'master_diverged') return {
    state: 'blocked',
    causeCode: 'provider_auth',
    summary: 'Istoricul master nu mai conține commitul Constructor merged; politica externă a ramurii a fost încălcată.',
    nextAction: 'Restabilește un istoric master liniar care conține commitul merged sau furnizează dovada de roll-forward; release-ul va revalida automat.',
  }
  if (code === 'target_advanced') return {
    state: 'diagnosing',
    causeCode: 'build_failure',
    summary: 'Masterul a avansat după selectarea țintei release, înainte de dispatch.',
    nextAction: 'Selectează monotonic noul vârf master care include commitul Constructor și revalidează CI/artefactul înainte de dispatch.',
  }
  if (code === 'github_auth_required') return {
    state: 'blocked',
    causeCode: 'provider_auth',
    summary: 'GitHub a respins credentiala limitată a serviciului de release.',
    nextAction: 'Reautorizează credentiala GitHub a releaserului; același commit va fi reluat automat.',
  }
  if (code === 'ci_failed') return {
    state: 'diagnosing',
    causeCode: 'ci_failure',
    summary: 'Controalele push obligatorii nu au confirmat commitul merged.',
    nextAction: 'Păstrează commitul merged și reia verificarea automată până când controalele obligatorii sunt verzi.',
  }
  if (code === 'artifact_missing') return {
    state: 'diagnosing',
    causeCode: 'build_failure',
    summary: 'Artefactul OCI semnat nu a fost disponibil pentru commitul merged.',
    nextAction: 'Reia automat verificarea buildului semnat pentru același commit, fără un nou merge.',
  }
  if (code === 'release_workflow_failed') return {
    state: 'diagnosing',
    causeCode: 'ci_failure',
    summary: 'Workflow-ul de producție a terminat cu un verdict nereușit.',
    nextAction: 'Relansează joburile eșuate ale aceluiași run și păstrează același request id.',
  }
  if (code === 'release_dispatch_ambiguous') return {
    state: 'blocked',
    causeCode: 'provider_auth',
    summary: 'GitHub nu confirmă încă dacă intenția de dispatch a materializat workflow-ul exact.',
    nextAction: 'Verifică request id-ul în istoricul Actions; nu porni alt deploy și nu avansa ținta până la un verdict extern neechivoc.',
  }
  if (code === 'live_proof_failed') return {
    state: 'diagnosing',
    causeCode: 'build_failure',
    summary: 'Readiness/version nu au confirmat încă acel commit în producție.',
    nextAction: 'Reia dovada externă pentru același commit și nu marca jobul done înainte de confirmare.',
  }
  return {
    state: 'diagnosing',
    causeCode: 'unknown',
    summary: 'Serviciul de release nu a putut avansa commitul merged; cauza exactă rămâne de diagnosticat.',
    nextAction: 'Păstrează checkpointul merged și reia automat de la ultima dovadă durabilă.',
  }
}

/** Un release eșuat rămâne la merged și este reluat automat fără plafon terminal. Nu
 * rescriem adevărul istoric spunând că merge-ul n-a existat. */
export async function failReleaseLease(jobId: number, taskId: string, leaseId: string, code: string): Promise<boolean> {
  return withTransaction(async (sql) => {
      const row = await lockReleaseLease(sql, jobId, taskId, leaseId)
      if (!row || row.status !== 'running' || !['merged', 'release_dispatched'].includes(row.constructor_stage)) return false
      const incident = releaseIncident(code)
      await sql.query(
        `INSERT INTO constructor_incidents
           (job_id, fingerprint, state, stage, cause_code, cause_summary, evidence, responsible, next_action)
         VALUES (
           $1,
           COALESCE((SELECT fingerprint FROM constructor_incidents WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 1), 'job:' || $1::text),
           $2, 'release', $3, $4, $5, 'constructor-release', $6
         )
         ON CONFLICT (fingerprint) DO UPDATE SET
           job_id=EXCLUDED.job_id, state=EXCLUDED.state, stage=EXCLUDED.stage,
           cause_code=EXCLUDED.cause_code, cause_summary=EXCLUDED.cause_summary,
           evidence=EXCLUDED.evidence, responsible=EXCLUDED.responsible,
           next_action=EXCLUDED.next_action, verification=NULL, closed_at=NULL,
           updated_at=now()`,
        [jobId, incident.state, incident.causeCode, incident.summary, code, incident.nextAction],
      )
      const delay = retryDelay(Number(row.release_attempts), incident.state === 'blocked')
      await sql.query(
        `UPDATE constructor_pipeline SET release_lease_id=NULL, release_lease_until=NULL,
            release_retry_not_before=now() + ($3::text || ' seconds')::interval,
            release_last_error=$2, updated_at=now() WHERE job_id=$1`,
        [jobId, code, delay],
      )
      await sql.query(
        `UPDATE build_jobs SET progress=$2,
            progress_at=now(), updated_at=now()
          WHERE id=$1 AND status='running' AND constructor_stage IN ('merged','release_dispatched')`,
        [jobId, incident.state === 'blocked' ? 'external_action_required' : 'release_retryable_failure'],
      )
      return true
  })
}
