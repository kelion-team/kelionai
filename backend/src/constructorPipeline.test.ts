import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

let database: PGlite

vi.mock('./dbPool.js', () => ({
  getPool: () => ({ query: (sql: string, params?: unknown[]) => database.query(sql, params) }),
  conexiuneDb: async () => ({
    query: (sql: string, params?: unknown[]) => database.query(sql, params),
    release: vi.fn(),
  }),
}))
vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js')
  return { ...actual, config: { ...actual.config, databaseUrl: 'postgres://pglite.test/kelion' } }
})

const pipeline = await import('./services/constructorPipeline.js')
const buildJobs = await import('./db.js')
const taskId = 'codex-123e4567-e89b-42d3-a456-426614174000'
const handoffId = '123e4567-e89b-42d3-a456-426614174001'
const publisherLease = '123e4567-e89b-42d3-a456-426614174002'
const releaseLease = '123e4567-e89b-42d3-a456-426614174003'
const requestId = '123e4567-e89b-42d3-a456-426614174004'
const base = 'a'.repeat(40)
const head = 'b'.repeat(40)
const merged = 'c'.repeat(40)
const hash1 = '1'.repeat(64)
const hash2 = '2'.repeat(64)
const hash3 = '3'.repeat(64)
const hash4 = '4'.repeat(64)

beforeEach(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE build_jobs (
      id BIGSERIAL PRIMARY KEY,
      ordered_by TEXT NOT NULL DEFAULT 'owner@example.test',
      order_text TEXT NOT NULL DEFAULT 'Ordin Constructor de test',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      codex_task_id TEXT,
      constructor_stage TEXT NOT NULL DEFAULT 'queued',
      ci TEXT,
      progress TEXT,
      log TEXT,
      progress_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      brain TEXT,
      branch TEXT,
      pr_url TEXT,
      commit_sha TEXT,
      live_version TEXT
      ,arhivat BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE constructor_incidents (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'unknown_stage',
      cause_code TEXT NOT NULL DEFAULT 'unknown',
      cause_summary TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      responsible TEXT NOT NULL DEFAULT 'kelion',
      next_action TEXT NOT NULL,
      verification TEXT,
      lesson TEXT,
      recurrence_count INT NOT NULL DEFAULT 1,
      strategy JSONB,
      strategy_action_fingerprint TEXT,
      strategy_evidence_fingerprint TEXT,
      strategy_decision_count INT NOT NULL DEFAULT 0,
      strategy_pending BOOLEAN NOT NULL DEFAULT false,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await database.exec(readFileSync(new URL('../migrations/20260901_constructor_publication_pipeline.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260902_constructor_observability.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260903_constructor_work_cards.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260904_constructor_cancellation.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260905_constructor_retry_schedule.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260906_constructor_pipeline_recovery.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260907_constructor_execution_cycles.sql', import.meta.url), 'utf8'))
  // A real upgrade can already contain a completed pre-v2 deployment.  Keep
  // one in the fixture so migration 08 proves it can add the intent invariant
  // without rejecting immutable historical receipts.
  await database.query(
    `INSERT INTO build_jobs
       (id, status, codex_task_id, constructor_stage, ci, commit_sha, live_version)
     VALUES (999, 'done', $1, 'deployed', 'green', $2, $3)`,
    ['codex-923e4567-e89b-42d3-a456-426614174000', merged, merged.slice(0, 7)],
  )
  await database.query(
    `INSERT INTO constructor_pipeline
       (job_id, task_id, handoff_id, base_commit_sha, patch_sha256,
        gate_receipt_sha256, merged_commit_sha, release_request_id,
        release_workflow_run_id, release_dispatch_receipt_sha256,
        release_receipt_sha256)
     VALUES (999, $1, $2::uuid, $3, $4, $5, $6, $7::uuid, 9901, $8, $9)`,
    [
      'codex-923e4567-e89b-42d3-a456-426614174000',
      '923e4567-e89b-42d3-a456-426614174001',
      base,
      hash1,
      hash2,
      merged,
      '923e4567-e89b-42d3-a456-426614174004',
      hash3,
      hash4,
    ],
  )
  // Două rânduri merged pre-migrare separă lipsa totală a execuției vechi de
  // o claimare v1 ambiguă (attempts nu dovedește POST-ul). Primul rămâne v2;
  // al doilea se reconciliază numai dacă runul există; absența matură este
  // rezolvată durabil înainte ca următorul claim să folosească v2.
  await database.query(
    `INSERT INTO build_jobs
       (id, status, codex_task_id, constructor_stage, commit_sha)
     VALUES
       (997, 'running', $1, 'merged', $3),
       (998, 'running', $2, 'merged', $3)`,
    [
      'codex-723e4567-e89b-42d3-a456-426614174000',
      'codex-823e4567-e89b-42d3-a456-426614174000',
      merged,
    ],
  )
  await database.query(
    `INSERT INTO constructor_pipeline
       (job_id, task_id, handoff_id, base_commit_sha, patch_sha256,
        gate_receipt_sha256, merged_commit_sha, release_attempts)
     VALUES
       (997, $1, $2::uuid, $5, $6, $7, $8, 0),
       (998, $3, $4::uuid, $5, $6, $7, $8, 1)`,
    [
      'codex-723e4567-e89b-42d3-a456-426614174000',
      '723e4567-e89b-42d3-a456-426614174001',
      'codex-823e4567-e89b-42d3-a456-426614174000',
      '823e4567-e89b-42d3-a456-426614174001',
      base,
      hash1,
      hash2,
      merged,
    ],
  )
  await database.exec(readFileSync(new URL('../migrations/20260908_constructor_release_dispatch_intents.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260911_constructor_manual_model_outcomes.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260913_constructor_configured_engine_outcome.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260912_constructor_execution_profile.sql', import.meta.url), 'utf8'))
  await database.query(
    `INSERT INTO build_jobs(status, codex_task_id, execution_profile, constructor_stage, ordered_by, order_text)
     VALUES ('running', $1, 'fast', 'working', $2, $3)`,
    [taskId, 'owner@example.test', 'Implementează și verifică ordinul Constructor'],
  )
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

describe('Constructor worker -> publisher -> release pipeline', () => {
  it('terminalizes only queued legacy worker retries during an idempotent upgrade', async () => {
    await database.query(
      `INSERT INTO build_jobs
         (id, ordered_by, order_text, status, constructor_stage, progress, retry_not_before, execution_profile)
       VALUES
         (990, 'owner@example.test', 'legacy worker retry', 'queued', 'queued',
          'worker_retry_scheduled', now() + interval '1 hour', NULL),
         (991, 'owner@example.test', 'legacy stale base', 'queued', 'queued',
          'stale_base_requeued', now() + interval '1 hour', NULL),
         (992, 'owner@example.test', 'manual owner retry', 'queued', 'queued',
          'owner_retry_scheduled', NULL, NULL),
         (993, 'owner@example.test', 'initial request', 'queued', 'queued',
          'queued', NULL, NULL)`,
    )

    const migration = readFileSync(
      new URL('../migrations/20260911_constructor_manual_model_outcomes.sql', import.meta.url),
      'utf8',
    )
    await database.exec(migration)
    await database.exec(migration)

    await expect(database.query<{
      id: string
      status: string
      progress: string
      retry_not_before: Date | null
    }>(
      `SELECT id::text, status, progress, retry_not_before
         FROM build_jobs WHERE id BETWEEN 990 AND 993 ORDER BY id`,
    )).resolves.toMatchObject({ rows: [
      { id: '990', status: 'failed', progress: 'technical_failure', retry_not_before: null },
      { id: '991', status: 'failed', progress: 'technical_failure', retry_not_before: null },
      { id: '992', status: 'queued', progress: 'owner_retry_scheduled', retry_not_before: null },
      { id: '993', status: 'queued', progress: 'queued', retry_not_before: null },
    ] })
    await expect(database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM build_jobs
        WHERE status='queued'
          AND progress IN ('worker_retry_scheduled', 'stale_base_requeued')`,
    )).resolves.toMatchObject({ rows: [{ count: '0' }] })
    await expect(database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM constructor_incidents
        WHERE job_id IN (990, 991)
          AND evidence LIKE 'legacy_automatic_retry_terminalized:%'`,
    )).resolves.toMatchObject({ rows: [{ count: '2' }] })
  })

  it('registers every manual-model outcome as terminal in the durable activity catalog', async () => {
    await expect(database.query<{ activity_key: string; terminal: boolean; sequence_no: number | null }>(
      `SELECT activity_key, terminal, sequence_no
         FROM constructor_activity_catalog
        WHERE activity_key IN ('fast_insufficient', 'technical_failure', 'powerful_final_failure')
        ORDER BY activity_key`,
    )).resolves.toMatchObject({ rows: [
      { activity_key: 'fast_insufficient', terminal: true, sequence_no: null },
      { activity_key: 'powerful_final_failure', terminal: true, sequence_no: null },
      { activity_key: 'technical_failure', terminal: true, sequence_no: null },
    ] })
  })

  it.each([
    {
      label: 'unresolved no_changes/fast',
      input: { event: 'unresolved', reason: 'no_changes', profile: 'fast' } as const,
      expectedStage: 'unresolved',
      expectedProgress: 'unresolved',
      evidence: 'worker_unresolved:no_changes;profile=fast',
    },
    {
      label: 'unresolved test_failure/fast',
      input: { event: 'unresolved', reason: 'test_failure', profile: 'fast' } as const,
      expectedStage: 'unresolved',
      expectedProgress: 'unresolved',
      evidence: 'worker_unresolved:test_failure;profile=fast',
    },
    {
      label: 'unresolved quality_gate_failure/powerful',
      input: { event: 'unresolved', reason: 'quality_gate_failure', profile: 'powerful' } as const,
      expectedStage: 'unresolved',
      expectedProgress: 'unresolved',
      evidence: 'worker_unresolved:quality_gate_failure;profile=powerful',
    },
  ])(
    'keeps $label terminal without automatic retry',
    async ({ input, expectedStage, expectedProgress, evidence }) => {
      await database.query('UPDATE build_jobs SET execution_profile=$2 WHERE id=$1', [1, input.profile])
      await expect(buildJobs.advanceConstructorBuildJob(1, taskId, input))
        .resolves.toMatchObject({
          id: 1,
          status: 'failed',
          constructorStage: expectedStage,
          progress: expectedProgress,
          retryNotBefore: null,
          executionCycle: 0,
        })
      await expect(database.query<{
        status: string
        constructor_stage: string
        progress: string
        log: string
        retry_not_before: Date | null
        execution_cycle: number
      }>(
        `SELECT status, constructor_stage, progress, log, retry_not_before, execution_cycle
           FROM build_jobs WHERE id=1`,
      )).resolves.toMatchObject({ rows: [{
        status: 'failed',
        constructor_stage: expectedStage,
        progress: expectedProgress,
        log: evidence,
        retry_not_before: null,
        execution_cycle: 0,
      }] })
      await expect(database.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM constructor_activity_events
          WHERE job_id=1 AND execution_cycle=0 AND activity_key=$1`,
        [expectedProgress],
      )).resolves.toMatchObject({ rows: [{ count: '1' }] })
    },
  )

  it('terminalizes a silent worker on its persisted profile without retrying the job', async () => {
    await database.query(
      `UPDATE build_jobs
          SET execution_profile='powerful', attempts=3, execution_cycle=7,
              updated_at=now() - interval '16 minutes'
        WHERE id=1`,
    )

    await expect(buildJobs.deblocheazaJoburileClaimate())
      .resolves.toEqual({ terminalizate: 1 })
    await expect(database.query<{
      status: string
      constructor_stage: string
      progress: string
      log: string
      execution_profile: string
      codex_task_id: string
      attempts: number
      execution_cycle: number
      retry_not_before: Date | null
    }>(
      `SELECT status, constructor_stage, progress, log, execution_profile,
              codex_task_id, attempts, execution_cycle, retry_not_before
         FROM build_jobs WHERE id=1`,
    )).resolves.toMatchObject({ rows: [{
      status: 'failed',
      constructor_stage: 'failed',
      progress: 'technical_failure',
      log: 'worker_failure:execution_timeout;profile=powerful',
      execution_profile: 'powerful',
      codex_task_id: taskId,
      attempts: 3,
      execution_cycle: 7,
      retry_not_before: null,
    }] })
    await expect(database.query<{ cause_code: string; state: string }>(
      'SELECT cause_code, state FROM constructor_incidents WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ cause_code: 'timeout', state: 'diagnosing' }] })
    await expect(buildJobs.claimNextBuildJob(
      'codex-223e4567-e89b-42d3-a456-426614174000',
      'fast',
    )).resolves.toEqual({ state: 'pipeline_active', job: null })
    await expect(database.query<{ queued: string }>(
      "SELECT count(*)::text AS queued FROM build_jobs WHERE id=1 AND status='queued'",
    )).resolves.toMatchObject({ rows: [{ queued: '0' }] })
  })

  it('rejects a terminal event that claims a different profile than the signed claim', async () => {
    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'failed', code: 'worker_internal_failure', profile: 'powerful',
    })).resolves.toBeNull()
    await expect(database.query<{ status: string; execution_profile: string }>(
      'SELECT status, execution_profile FROM build_jobs WHERE id=1',
    )).resolves.toMatchObject({ rows: [{ status: 'running', execution_profile: 'fast' }] })
  })

  it('rejects unresolved directly from claimed while preserving a technical terminal exit', async () => {
    await database.query("UPDATE build_jobs SET constructor_stage='claimed' WHERE id=1")
    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'unresolved', reason: 'no_changes', profile: 'fast',
    })).resolves.toBeNull()
    await expect(database.query<{ status: string; constructor_stage: string; log: string | null }>(
      'SELECT status, constructor_stage, log FROM build_jobs WHERE id=1',
    )).resolves.toMatchObject({ rows: [{ status: 'running', constructor_stage: 'claimed', log: null }] })

    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'failed', code: 'worker_internal_failure', profile: 'fast',
    })).resolves.toMatchObject({
      status: 'queued',
      constructorStage: 'queued',
      progress: 'technical_failure',
    })
  })

  it('reia automat un esec tehnic al workerului, marginit de plafon', async () => {
    // Prima cadere: ordinul se intoarce in coada, cu asteptare, si fara sa piarda
    // dovada. Codul ramane prima linie din log si ajunge la worker ca recoveryCode.
    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'failed', code: 'brain_unavailable', profile: 'fast',
    })).resolves.toMatchObject({
      status: 'queued',
      constructorStage: 'queued',
      progress: 'technical_failure',
    })
    const dupaPrima = await database.query<{
      status: string
      constructor_stage: string
      log: string
      retry_not_before: Date | null
      codex_task_id: string | null
    }>(
      `SELECT status, constructor_stage, log, retry_not_before, codex_task_id
         FROM build_jobs WHERE id=1`,
    )
    expect(dupaPrima.rows[0]).toMatchObject({
      status: 'queued',
      constructor_stage: 'queued',
      log: 'worker_failure:brain_unavailable;profile=fast',
      codex_task_id: null,
    })
    expect(dupaPrima.rows[0].retry_not_before).toBeInstanceOf(Date)

    // Peste plafon ordinul moare definitiv: daca pica de atatea ori la rand,
    // cauza nu mai este trecatoare.
    await database.query("UPDATE build_jobs SET attempts=3, status='running', constructor_stage='working', codex_task_id=$2 WHERE id=$1", [1, taskId])
    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'failed', code: 'brain_unavailable', profile: 'fast',
    })).resolves.toMatchObject({
      status: 'failed',
      constructorStage: 'failed',
      retryNotBefore: null,
    })
  })

  it('captures the signed terminal profile for an in-flight pre-migration claim', async () => {
    await database.query('UPDATE build_jobs SET execution_profile=NULL WHERE id=1')
    await expect(buildJobs.advanceConstructorBuildJob(1, taskId, {
      event: 'failed', code: 'worker_internal_failure', profile: 'powerful',
    })).resolves.toMatchObject({
      status: 'queued',
      executionProfile: 'powerful',
      executionCycle: 0,
    })
  })

  it('migrează claim-ul release v1 ambiguu și păstrează merged-ul neatins pe v2', async () => {
    await expect(database.query<{
      job_id: number
      release_attempts: number
      release_protocol_version: number
      release_legacy_ambiguity_started_at: Date | null
    }>(
      `SELECT job_id, release_attempts, release_protocol_version,
              release_legacy_ambiguity_started_at
         FROM constructor_pipeline
        WHERE job_id IN (997, 998)
        ORDER BY job_id`,
    )).resolves.toMatchObject({ rows: [
      { job_id: 997, release_attempts: 0, release_protocol_version: 2, release_legacy_ambiguity_started_at: null },
      { job_id: 998, release_attempts: 1, release_protocol_version: 1, release_legacy_ambiguity_started_at: expect.any(Date) },
    ] })
  })

  it('convertește ambiguitatea v1 la v2 numai după cooldown și păstrează dovada append-only', async () => {
    const legacyTaskId = 'codex-823e4567-e89b-42d3-a456-426614174000'
    const legacyLease = '823e4567-e89b-42d3-a456-426614174003'
    await database.query(
      `UPDATE constructor_pipeline
          SET release_lease_id=$2::uuid,
              release_lease_until=now() + interval '10 minutes'
        WHERE job_id=$1`,
      [998, legacyLease],
    )
    const initial = await database.query<{ ambiguity_started_at: Date }>(
      `SELECT release_legacy_ambiguity_started_at AS ambiguity_started_at
         FROM constructor_pipeline WHERE job_id=998`,
    )
    const initialStartedAt = new Date(initial.rows[0]!.ambiguity_started_at).toISOString()
    const input = {
      jobId: 998,
      taskId: legacyTaskId,
      leaseId: legacyLease,
      mergedCommit: merged,
      requestId,
      ambiguityStartedAt: initialStartedAt,
      currentMaster: merged,
      receiptSha256: hash4,
    }
    await expect(pipeline.resolveLegacyReleaseAmbiguity(input)).resolves.toBe(false)

    await database.query(
      `UPDATE constructor_pipeline
          SET release_legacy_ambiguity_started_at=now() - interval '5 hours'
        WHERE job_id=998`,
    )
    const matured = await database.query<{ ambiguity_started_at: Date }>(
      `SELECT release_legacy_ambiguity_started_at AS ambiguity_started_at
         FROM constructor_pipeline WHERE job_id=998`,
    )
    const maturedInput = {
      ...input,
      ambiguityStartedAt: new Date(matured.rows[0]!.ambiguity_started_at).toISOString(),
    }
    await expect(pipeline.resolveLegacyReleaseAmbiguity(maturedInput)).resolves.toBe(true)
    await expect(pipeline.resolveLegacyReleaseAmbiguity(maturedInput)).resolves.toBe(true)
    await expect(database.query<{
      release_protocol_version: number
      release_legacy_ambiguity_started_at: Date | null
      progress: string
      proof_count: string
    }>(
      `SELECT p.release_protocol_version,
              p.release_legacy_ambiguity_started_at,
              b.progress,
              (SELECT count(*)::text
                 FROM constructor_release_legacy_resolutions r
                WHERE r.job_id=p.job_id) AS proof_count
         FROM constructor_pipeline p
         JOIN build_jobs b ON b.id=p.job_id
        WHERE p.job_id=998`,
    )).resolves.toMatchObject({ rows: [{
      release_protocol_version: 2,
      release_legacy_ambiguity_started_at: null,
      progress: 'legacy_dispatch_absence_resolved',
      proof_count: '1',
    }] })
  })

  it('migrates a completed pre-v2 deployment without losing its receipts', async () => {
    await expect(database.query<{
      release_protocol_version: number
      release_intent_receipt_sha256: string | null
      release_workflow_run_id: number
    }>(
      `SELECT release_protocol_version, release_intent_receipt_sha256,
              release_workflow_run_id
         FROM constructor_pipeline WHERE job_id=999`,
    )).resolves.toMatchObject({ rows: [{
      release_protocol_version: 1,
      release_intent_receipt_sha256: null,
      release_workflow_run_id: 9901,
    }] })
  })

  it('persists one immutable handoff, serial leases and exact idempotent receipts', { timeout: 30_000 }, async () => {
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ ok: true, event: { stage: 'gates_passed', status: 'running' } })
    await expect(database.query<{ ci: string; brain: string }>('SELECT ci, brain FROM build_jobs WHERE id=1'))
      .resolves.toMatchObject({ rows: [{ ci: 'local_gates', brain: 'OpenCode (motor configurat separat)' }] })

    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ ok: true, event: { stage: 'gates_passed' } })
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash3,
      gateReceiptSha256: hash2,
    })).resolves.toEqual({ ok: false, reason: 'handoff_conflict' })

    const claim = await pipeline.claimPublisherJob(publisherLease)
    expect(claim).toMatchObject({ jobId: '1', taskId, leaseId: publisherLease, handoffId, baseCommit: base })
    await expect(pipeline.claimPublisherJob('223e4567-e89b-42d3-a456-426614174002')).resolves.toBeNull()
    await expect(pipeline.renewPublisherLease(1, taskId, publisherLease)).resolves.toBe(true)

    const pr = {
      jobId: 1,
      taskId,
      leaseId: publisherLease,
      branch: `codex/${taskId.slice(6)}`,
      headCommit: head,
      prNumber: 42,
      prUrl: 'https://github.example.invalid/pull/42',
      receiptSha256: hash3,
    }
    await expect(pipeline.recordPublisherPrOpened(pr)).resolves.toMatchObject({ stage: 'pr_opened' })
    await expect(pipeline.recordPublisherPrOpened(pr)).resolves.toMatchObject({ stage: 'pr_opened' })
    await expect(pipeline.recordPublisherPrOpened({ ...pr, headCommit: base })).resolves.toBeNull()
    const mergeEvent = {
      jobId: 1,
      taskId,
      leaseId: publisherLease,
      headCommit: head,
      prNumber: 42,
      commit: merged,
      receiptSha256: hash1,
    }
    await expect(pipeline.recordPublisherMerged(mergeEvent)).resolves.toMatchObject({ stage: 'merged', commit: merged })
    await expect(database.query<{ ci: string }>('SELECT ci FROM build_jobs WHERE id=1'))
      .resolves.toMatchObject({ rows: [{ ci: 'pr_checks_green' }] })
    await expect(pipeline.recordPublisherMerged(mergeEvent)).resolves.toMatchObject({ stage: 'merged', commit: merged })
    await expect(pipeline.recordPublisherMerged({ ...mergeEvent, receiptSha256: hash2 })).resolves.toBeNull()

    const release = await pipeline.claimReleaseJob(releaseLease)
    expect(release).toMatchObject({ jobId: '1', leaseId: releaseLease, commit: merged, headCommit: head, prNumber: 42 })
    await expect(pipeline.claimReleaseJob('223e4567-e89b-42d3-a456-426614174003')).resolves.toBeNull()
    await expect(pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })).resolves.toBe(true)
    await expect(pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8001, buildRunId: 8002, artifactId: 8003, receiptSha256: hash3,
    })).resolves.toBe(true)
    const dispatchEvent = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      requestId,
      workflowRunId: 9001,
      ciRunId: 8001,
      buildRunId: 8002,
      artifactId: 8003,
      receiptSha256: hash2,
    }
    await expect(pipeline.recordReleaseDispatchIntended({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged, requestId,
      ciRunId: 8001, buildRunId: 8002, artifactId: 8003, receiptSha256: hash4,
    })).resolves.toBe(true)
    await expect(pipeline.recordReleaseDispatched(dispatchEvent)).resolves.toBe(true)
    // The publisher's merge POST may have committed while its response was
    // lost.  Replaying it after release advanced remains a factual success and
    // cannot overwrite release progress with a publisher incident.
    await expect(pipeline.recordPublisherMerged(mergeEvent)).resolves.toMatchObject({ stage: 'release_dispatched' })
    await expect(pipeline.failPublisherLease(1, taskId, publisherLease, 'github_unavailable')).resolves.toBeNull()
    await expect(database.query<{ progress: string }>('SELECT progress FROM build_jobs WHERE id=1'))
      .resolves.toMatchObject({ rows: [{ progress: 'release_dispatched' }] })
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ ok: true, event: { status: 'running', stage: 'release_dispatched' } })
    const deployedEvent = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      requestId,
      workflowRunId: 9001,
      commit: merged,
      targetCommit: merged,
      liveVersion: merged,
      receiptSha256: hash3,
    }
    await database.query(
      `INSERT INTO constructor_incidents(job_id, fingerprint, state, cause_summary, next_action)
       VALUES (1, 'job:1', 'repairing', 'Cauză măsurată', 'Păstrează regresia')`,
    )
    await expect(pipeline.recordReleaseDeployed({ ...deployedEvent, liveVersion: merged.slice(0, 7) })).resolves.toBeNull()
    await expect(pipeline.recordReleaseDeployed({ ...deployedEvent, liveVersion: 'f'.repeat(40) })).resolves.toBeNull()
    await expect(pipeline.recordReleaseDeployed(deployedEvent)).resolves.toMatchObject({ status: 'done', stage: 'deployed', commit: merged, liveVersion: merged })
    await expect(database.query<{ state: string; verification: string; lesson: string }>(
      'SELECT state, verification, lesson FROM constructor_incidents WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ state: 'closed', verification: expect.stringContaining(merged), lesson: expect.stringContaining('Cauză măsurată') }] })
    await expect(pipeline.recordReleaseDispatched(dispatchEvent)).resolves.toBe(true)
    await expect(pipeline.recordReleaseDeployed(deployedEvent)).resolves.toMatchObject({ status: 'done', stage: 'deployed', commit: merged, liveVersion: merged })
    await expect(pipeline.recordReleaseDeployed({ ...deployedEvent, receiptSha256: hash1 })).resolves.toBeNull()
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ ok: true, event: { status: 'done', stage: 'deployed' } })
    const activity = await database.query<{ activity_key: string }>(
      'SELECT activity_key FROM constructor_activity_events WHERE job_id=1 ORDER BY id',
    )
    expect(activity.rows.map((row) => row.activity_key)).toEqual(expect.arrayContaining([
      'working', 'gates_passed', 'pr_opened', 'merged', 'release_dispatched', 'deployed',
    ]))
    const orphanedEvents = await database.query<{ count: string }>(
      `SELECT count(*)::text FROM constructor_activity_events e
        LEFT JOIN constructor_work_cards c ON c.job_id=e.job_id
       WHERE c.job_id IS NULL`,
    )
    expect(orphanedEvents.rows[0]?.count).toBe('0')
  })

  it('keeps a failed release at merged and continues beyond the former retry cap', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await expect(pipeline.failReleaseLease(1, taskId, releaseLease, 'workflow_failed')).resolves.toBe(true)
    const job = await database.query<{ status: string; constructor_stage: string }>('SELECT status, constructor_stage FROM build_jobs WHERE id=1')
    expect(job.rows[0]).toEqual({ status: 'running', constructor_stage: 'merged' })
    await expect(database.query<{ state: string; stage: string }>(
      'SELECT state, stage FROM constructor_incidents WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ state: 'diagnosing', stage: 'release' }] })
    const secondLease = '223e4567-e89b-42d3-a456-426614174003'
    const thirdLease = '323e4567-e89b-42d3-a456-426614174003'
    await database.query('UPDATE constructor_pipeline SET release_retry_not_before=now() WHERE job_id=1')
    await expect(pipeline.claimReleaseJob(secondLease)).resolves.toMatchObject({ commit: merged })
    await expect(pipeline.failReleaseLease(1, taskId, secondLease, 'workflow_timeout')).resolves.toBe(true)
    await database.query('UPDATE constructor_pipeline SET release_retry_not_before=now() WHERE job_id=1')
    await expect(pipeline.claimReleaseJob(thirdLease)).resolves.toMatchObject({ commit: merged })
    await expect(pipeline.failReleaseLease(1, taskId, thirdLease, 'workflow_failed')).resolves.toBe(true)
    await expect(database.query<{ status: string; constructor_stage: string }>('SELECT status, constructor_stage FROM build_jobs WHERE id=1'))
      .resolves.toMatchObject({ rows: [{ status: 'running', constructor_stage: 'merged' }] })
    const fourthLease = '423e4567-e89b-42d3-a456-426614174003'
    await database.query('UPDATE constructor_pipeline SET release_retry_not_before=now() WHERE job_id=1')
    await expect(pipeline.claimReleaseJob(fourthLease)).resolves.toMatchObject({ commit: merged, leaseId: fourthLease })
    await expect(pipeline.failReleaseLease(1, taskId, fourthLease, 'workflow_timeout')).resolves.toBe(true)
  })

  it('preserves the exact dispatched run checkpoint across release recovery', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })
    await pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8101, buildRunId: 8102, artifactId: 8103, receiptSha256: hash2,
    })
    await pipeline.recordReleaseDispatchIntended({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged, requestId,
      ciRunId: 8101, buildRunId: 8102, artifactId: 8103, receiptSha256: hash4,
    })
    await pipeline.recordReleaseDispatched({
      jobId: 1, taskId, leaseId: releaseLease, requestId, workflowRunId: 9101,
      ciRunId: 8101, buildRunId: 8102, artifactId: 8103, receiptSha256: hash3,
    })
    await expect(pipeline.failReleaseLease(1, taskId, releaseLease, 'workflow_failed')).resolves.toBe(true)
    await expect(database.query<{
      constructor_stage: string
      release_request_id: string
      release_workflow_run_id: number
      release_dispatch_receipt_sha256: string
    }>(
      `SELECT b.constructor_stage, p.release_request_id::text, p.release_workflow_run_id,
              p.release_dispatch_receipt_sha256
         FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id WHERE b.id=1`,
    )).resolves.toMatchObject({ rows: [{
      constructor_stage: 'release_dispatched',
      release_request_id: requestId,
      release_workflow_run_id: 9101,
      release_dispatch_receipt_sha256: hash3,
    }] })
    await database.query('UPDATE constructor_pipeline SET release_retry_not_before=now() WHERE job_id=1')
    await expect(pipeline.claimReleaseJob('223e4567-e89b-42d3-a456-426614174003')).resolves.toMatchObject({
      releaseRequestId: requestId,
      workflowRunId: 9101,
      ciRunId: 8101,
      buildRunId: 8102,
      artifactId: 8103,
    })
  })

  it('advances safely after candidate_verified when no dispatch intent exists', { timeout: 30_000 }, async () => {
    const replacement = 'd'.repeat(40)
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })
    await pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8401, buildRunId: 8402, artifactId: 8403, receiptSha256: hash3,
    })
    await expect(pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: replacement,
      receiptSha256: hash2, previousTargetCommit: merged, previousReceiptSha256: hash1,
    })).resolves.toBe(true)
    await expect(database.query<{
      release_target_sha: string
      release_request_id: string | null
      release_candidate_receipt_sha256: string | null
      ci: string
      constructor_stage: string
    }>(
      `SELECT p.release_target_sha, p.release_request_id::text,
              p.release_candidate_receipt_sha256, b.ci, b.constructor_stage
         FROM constructor_pipeline p JOIN build_jobs b ON b.id=p.job_id
        WHERE p.job_id=1`,
    )).resolves.toMatchObject({ rows: [{
      release_target_sha: replacement,
      release_request_id: null,
      release_candidate_receipt_sha256: null,
      ci: 'in_progress',
      constructor_stage: 'merged',
    }] })
  })

  it('replaces an expired candidate proof only before a dispatch intent exists', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })
    await expect(pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8601, buildRunId: 8602, artifactId: 8603, receiptSha256: hash2,
    })).resolves.toBe(true)
    await expect(pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8701, buildRunId: 8702, artifactId: 8703, receiptSha256: hash3,
    })).resolves.toBe(true)
    await expect(database.query<{
      release_ci_run_id: number
      release_build_run_id: number
      release_artifact_id: number
      release_candidate_receipt_sha256: string
    }>(
      `SELECT release_ci_run_id, release_build_run_id, release_artifact_id,
              release_candidate_receipt_sha256
         FROM constructor_pipeline WHERE job_id=1`,
    )).resolves.toMatchObject({ rows: [{
      release_ci_run_id: 8701,
      release_build_run_id: 8702,
      release_artifact_id: 8703,
      release_candidate_receipt_sha256: hash3,
    }] })
    await pipeline.recordReleaseDispatchIntended({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged, requestId,
      ciRunId: 8701, buildRunId: 8702, artifactId: 8703, receiptSha256: hash4,
    })
    await expect(pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8801, buildRunId: 8802, artifactId: 8803, receiptSha256: hash1,
    })).resolves.toBe(false)
  })

  it('cannot advance a target until the exact failed dispatch has a durable retirement verdict', { timeout: 30_000 }, async () => {
    const replacement = 'd'.repeat(40)
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })
    await pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8201, buildRunId: 8202, artifactId: 8203, receiptSha256: hash2,
    })
    await pipeline.recordReleaseDispatchIntended({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged, requestId,
      ciRunId: 8201, buildRunId: 8202, artifactId: 8203, receiptSha256: hash3,
    })
    await pipeline.recordReleaseDispatched({
      jobId: 1, taskId, leaseId: releaseLease, requestId, workflowRunId: 9201,
      ciRunId: 8201, buildRunId: 8202, artifactId: 8203, receiptSha256: hash4,
    })

    await expect(pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: replacement,
      receiptSha256: hash2, previousTargetCommit: merged, previousReceiptSha256: hash1,
    })).resolves.toBe(false)
    await expect(pipeline.retireReleaseDispatch({
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      targetCommit: merged,
      replacementTargetCommit: replacement,
      requestId,
      workflowRunId: 9201,
      conclusion: 'failure',
      receiptSha256: '5'.repeat(64),
    })).resolves.toBe(true)
    await expect(database.query<{
      constructor_stage: string
      ci: string
      release_target_sha: string
      release_request_id: string | null
      release_workflow_run_id: number | null
      release_candidate_receipt_sha256: string | null
    }>(
      `SELECT b.constructor_stage, b.ci, p.release_target_sha,
              p.release_request_id::text, p.release_workflow_run_id,
              p.release_candidate_receipt_sha256
         FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id
        WHERE b.id=1`,
    )).resolves.toMatchObject({ rows: [{
      constructor_stage: 'merged',
      ci: 'pr_checks_green',
      release_target_sha: merged,
      release_request_id: null,
      release_workflow_run_id: null,
      release_candidate_receipt_sha256: null,
    }] })
    await expect(database.query<{ target_sha: string; replacement_target_sha: string; conclusion: string }>(
      'SELECT target_sha, replacement_target_sha, conclusion FROM constructor_release_retirements WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ target_sha: merged, replacement_target_sha: replacement, conclusion: 'failure' }] })
    await expect(pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: replacement,
      receiptSha256: hash2, previousTargetCommit: merged, previousReceiptSha256: hash1,
    })).resolves.toBe(true)
  })

  it('retires an old intent-only checkpoint only after the absence cooldown', { timeout: 30_000 }, async () => {
    const replacement = 'd'.repeat(40)
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      receiptSha256: hash1, previousTargetCommit: null, previousReceiptSha256: null,
    })
    await pipeline.recordReleaseCandidateVerified({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged,
      ciRunId: 8501, buildRunId: 8502, artifactId: 8503, receiptSha256: hash2,
    })
    await pipeline.recordReleaseDispatchIntended({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: merged, requestId,
      ciRunId: 8501, buildRunId: 8502, artifactId: 8503, receiptSha256: hash3,
    })

    const retirement = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      targetCommit: merged,
      replacementTargetCommit: replacement,
      requestId,
      workflowRunId: null,
      conclusion: 'intent_not_materialized' as const,
      receiptSha256: '6'.repeat(64),
    }
    await expect(pipeline.retireReleaseDispatch(retirement)).resolves.toBe(false)
    await database.query(
      `UPDATE constructor_pipeline
          SET release_intent_created_at=now() - interval '5 hours'
        WHERE job_id=1`,
    )
    await expect(pipeline.retireReleaseDispatch(retirement)).resolves.toBe(true)
    await expect(database.query<{
      workflow_run_id: number | null
      conclusion: string
      absence_observed_at: Date | null
    }>(
      `SELECT workflow_run_id, conclusion, absence_observed_at
         FROM constructor_release_retirements WHERE request_id=$1::uuid`,
      [requestId],
    )).resolves.toMatchObject({ rows: [{
      workflow_run_id: null,
      conclusion: 'intent_not_materialized',
      absence_observed_at: expect.any(Date),
    }] })
    await expect(pipeline.recordReleaseTargetSelected({
      jobId: 1, taskId, leaseId: releaseLease, targetCommit: replacement,
      receiptSha256: hash4, previousTargetCommit: merged, previousReceiptSha256: hash1,
    })).resolves.toBe(true)
  })

  it('upgrades an exact in-flight v1 dispatch without creating a second workflow', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1, taskId, leaseId: publisherLease, branch: `codex/${taskId.slice(6)}`,
      headCommit: head, prNumber: 42, prUrl: 'https://github.example.invalid/pull/42', receiptSha256: hash3,
    })
    await pipeline.recordPublisherMerged({ jobId: 1, taskId, leaseId: publisherLease, headCommit: head, prNumber: 42, commit: merged, receiptSha256: hash1 })
    await pipeline.claimReleaseJob(releaseLease)
    await database.query(
      `UPDATE constructor_pipeline
          SET release_protocol_version=1, release_request_id=$2::uuid,
              release_workflow_run_id=9301, release_dispatch_receipt_sha256=$3
        WHERE job_id=$1`,
      [1, requestId, hash4],
    )
    await database.query(
      `UPDATE build_jobs SET constructor_stage='release_dispatched', ci='pr_checks_green'
        WHERE id=1`,
    )

    const legacyProof = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      targetCommit: merged,
      targetReceiptSha256: hash1,
      requestId,
      workflowRunId: 9301,
      ciRunId: 8301,
      buildRunId: 8302,
      artifactId: 8303,
      candidateReceiptSha256: hash2,
      dispatchReceiptSha256: hash4,
    }
    await expect(pipeline.reconcileLegacyReleaseDispatch(legacyProof)).resolves.toBe(true)
    await expect(pipeline.reconcileLegacyReleaseDispatch(legacyProof)).resolves.toBe(true)
    await expect(database.query<{
      release_protocol_version: number
      release_target_sha: string
      release_request_id: string
      release_workflow_run_id: number
      release_ci_run_id: number
      ci: string
      constructor_stage: string
    }>(
      `SELECT p.release_protocol_version, p.release_target_sha,
              p.release_request_id::text, p.release_workflow_run_id,
              p.release_ci_run_id, b.ci, b.constructor_stage
         FROM constructor_pipeline p JOIN build_jobs b ON b.id=p.job_id
        WHERE p.job_id=1`,
    )).resolves.toMatchObject({ rows: [{
      release_protocol_version: 1,
      release_target_sha: merged,
      release_request_id: requestId,
      release_workflow_run_id: 9301,
      release_ci_run_id: 8301,
      ci: 'green',
      constructor_stage: 'release_dispatched',
    }] })
  })

  it('rejects a protocol-v2 dispatched checkpoint that has no durable intent', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })

    await expect(database.query(
      `UPDATE constructor_pipeline
          SET release_protocol_version=2, release_request_id=$2::uuid,
              release_workflow_run_id=9401, release_dispatch_receipt_sha256=$3
        WHERE job_id=$1`,
      [1, requestId, hash4],
    )).rejects.toThrow(/constructor_pipeline_release_dispatch_checkpoint_complete/i)
  })

  it('retries publisher failures without losing the last factual stage or stranding the job', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, { handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2 })
    const leases = [
      publisherLease,
      '223e4567-e89b-42d3-a456-426614174002',
      '323e4567-e89b-42d3-a456-426614174002',
      '423e4567-e89b-42d3-a456-426614174002',
    ]
    for (const lease of leases) {
      await expect(pipeline.claimPublisherJob(lease)).resolves.toMatchObject({ leaseId: lease })
      await expect(pipeline.failPublisherLease(1, taskId, lease, 'github_unavailable')).resolves.toMatchObject({
        status: 'running',
        stage: 'gates_passed',
      })
      await database.query('UPDATE constructor_pipeline SET publisher_retry_not_before=now() WHERE job_id=1')
    }
    await expect(pipeline.claimPublisherJob('523e4567-e89b-42d3-a456-426614174002')).resolves.toMatchObject({
      leaseId: '523e4567-e89b-42d3-a456-426614174002',
      taskId,
    })
  })

  it('retrage PR-ul si ramura pe stale_base, apoi reia ordinul pe noua baza', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })
    await pipeline.claimPublisherJob(publisherLease)
    await pipeline.recordPublisherPrOpened({
      jobId: 1,
      taskId,
      leaseId: publisherLease,
      branch: `codex/${taskId.slice(6)}`,
      headCommit: head,
      prNumber: 42,
      prUrl: 'https://github.example.invalid/pull/42',
      receiptSha256: hash3,
    })
    await database.query(
      'UPDATE build_jobs SET commit_sha=$2, live_version=$3 WHERE id=$1',
      [1, merged, merged.slice(0, 7)],
    )

    await expect(pipeline.failPublisherLease(1, taskId, publisherLease, 'stale_base', {
      branch: `codex/${taskId.slice(6)}`,
      headCommit: head,
      prNumber: 42,
      cleanupReceiptSha256: hash2,
    })).resolves.toEqual({
      // Ordinul nu are nicio vina: cineva a impins un commit in master cat el
      // trecea portile. PR-ul si ramura sunt retrase, dar munca modelului nu se
      // arunca — ordinul se reia pe noua baza.
      jobId: '1',
      status: 'queued',
      stage: 'queued',
      commit: null,
      liveVersion: null,
    })
    await expect(database.query<{
      id: string
      status: string
      codex_task_id: string | null
      execution_profile: string | null
      execution_cycle: number
      constructor_stage: string
      branch: string | null
      pr_url: string | null
      commit_sha: string | null
      live_version: string | null
      ci: string | null
    }>(
      `SELECT id::text, status, codex_task_id, execution_profile, execution_cycle,
              constructor_stage, branch, pr_url, commit_sha, live_version, ci
         FROM build_jobs WHERE id=1`,
    )).resolves.toMatchObject({
      rows: [{
        id: '1',
        status: 'queued',
        codex_task_id: taskId,
        execution_profile: 'fast',
        execution_cycle: 0,
        constructor_stage: 'queued',
        branch: null,
        pr_url: null,
        commit_sha: null,
        live_version: null,
        ci: null,
      }],
    })
    await expect(database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM constructor_pipeline WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ count: '0' }] })
    await expect(pipeline.claimPublisherJob('223e4567-e89b-42d3-a456-426614174002')).resolves.toBeNull()
    // Reluarea manuala nu mai este necesara: ordinul este deja in coada, cu
    // asteptare, si va fi revendicat automat de worker pe noua baza.
    const dupa = await database.query<{ status: string; retry_not_before: Date | null }>(
      'SELECT status, retry_not_before FROM build_jobs WHERE id=1',
    )
    expect(dupa.rows[0].status).toBe('queued')
    expect(dupa.rows[0].retry_not_before).toBeInstanceOf(Date)
    await expect(buildJobs.retryBuildJob(1)).resolves.toMatchObject({ ok: false })
  })

  it('keeps transport-only publisher recovery automatic for an external GitHub authority wait', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })
    await pipeline.claimPublisherJob(publisherLease)
    await expect(pipeline.failPublisherLease(1, taskId, publisherLease, 'branch_protection_invalid'))
      .resolves.toMatchObject({ status: 'running', stage: 'gates_passed' })
    await expect(database.query<{ progress: string; pipelines: string }>(
      `SELECT b.progress, count(p.job_id)::text AS pipelines
         FROM build_jobs b LEFT JOIN constructor_pipeline p ON p.job_id=b.id
        WHERE b.id=1 GROUP BY b.progress`,
    )).resolves.toMatchObject({ rows: [{ progress: 'external_action_required', pipelines: '1' }] })
    await expect(database.query<{ state: string; cause_code: string }>(
      'SELECT state, cause_code FROM constructor_incidents WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ state: 'blocked', cause_code: 'provider_auth' }] })
  })

  it('makes a deterministic CI rejection terminal instead of reinvoking the model', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })
    await pipeline.claimPublisherJob(publisherLease)
    await expect(pipeline.failPublisherLease(1, taskId, publisherLease, 'ci_failed', {
      branch: null,
      headCommit: null,
      prNumber: null,
      cleanupReceiptSha256: hash3,
    }))
      .resolves.toMatchObject({ status: 'failed', stage: 'failed' })
    await expect(database.query<{ progress: string; pipelines: string }>(
      `SELECT b.progress, count(p.job_id)::text AS pipelines
         FROM build_jobs b LEFT JOIN constructor_pipeline p ON p.job_id=b.id
        WHERE b.id=1 GROUP BY b.progress`,
    )).resolves.toMatchObject({ rows: [{ progress: 'publisher_manual_restart_required', pipelines: '0' }] })
    await expect(database.query<{ state: string; cause_code: string }>(
      'SELECT state, cause_code FROM constructor_incidents WHERE job_id=1',
    )).resolves.toMatchObject({ rows: [{ state: 'diagnosing', cause_code: 'ci_failure' }] })
  })

  it('rejects an unproved publication retirement without mutating the incident ledger', { timeout: 30_000 }, async () => {
    await pipeline.recordWorkerHandoff(1, taskId, {
      handoffId, baseCommit: base, patchSha256: hash1, gateReceiptSha256: hash2,
    })
    await pipeline.claimPublisherJob(publisherLease)
    await expect(pipeline.failPublisherLease(1, taskId, publisherLease, 'ci_failed')).resolves.toBeNull()
    await expect(database.query<{ incidents: string; pipelines: string }>(
      `SELECT
         (SELECT count(*)::text FROM constructor_incidents WHERE job_id=1) AS incidents,
         (SELECT count(*)::text FROM constructor_pipeline WHERE job_id=1) AS pipelines`,
    )).resolves.toMatchObject({ rows: [{ incidents: '0', pipelines: '1' }] })
  })

  it('consumes nonces durably and independently per HMAC domain', { timeout: 30_000 }, async () => {
    const nonce = '123e4567-e89b-42d3-a456-426614174099'
    const expiry = new Date(Date.now() + 30_000)
    const sql = { query: <Row>(text: string, params?: unknown[]) => database.query<Row>(text, params) }
    await expect(pipeline.consumeConstructorServiceNonce('constructor-publisher', nonce, expiry, sql)).resolves.toBe(true)
    await expect(pipeline.consumeConstructorServiceNonce('constructor-publisher', nonce, expiry, sql)).resolves.toBe(false)
    await expect(pipeline.consumeConstructorServiceNonce('constructor-release', nonce, expiry, sql)).resolves.toBe(true)
  })
})
