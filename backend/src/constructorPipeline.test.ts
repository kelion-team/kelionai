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

const pipeline = await import('./services/constructorPipeline.js')
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

beforeEach(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE build_jobs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      codex_task_id TEXT,
      constructor_stage TEXT NOT NULL DEFAULT 'queued',
      ci TEXT,
      progress TEXT,
      log TEXT,
      progress_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      brain TEXT,
      branch TEXT,
      pr_url TEXT,
      commit_sha TEXT,
      live_version TEXT
    );
  `)
  await database.exec(readFileSync(new URL('../migrations/20260901_constructor_publication_pipeline.sql', import.meta.url), 'utf8'))
  await database.exec(readFileSync(new URL('../migrations/20260902_constructor_observability.sql', import.meta.url), 'utf8'))
  await database.query(
    `INSERT INTO build_jobs(status, codex_task_id, constructor_stage)
     VALUES ('running', $1, 'working')`,
    [taskId],
  )
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

describe('Constructor worker -> publisher -> release pipeline', () => {
  it('persists one immutable handoff, serial leases and exact idempotent receipts', { timeout: 30_000 }, async () => {
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ stage: 'gates_passed', status: 'running' })

    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ stage: 'gates_passed' })
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash3,
      gateReceiptSha256: hash2,
    })).resolves.toBeNull()

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
    await expect(pipeline.recordPublisherMerged(mergeEvent)).resolves.toMatchObject({ stage: 'merged', commit: merged })
    await expect(pipeline.recordPublisherMerged({ ...mergeEvent, receiptSha256: hash2 })).resolves.toBeNull()

    const release = await pipeline.claimReleaseJob(releaseLease)
    expect(release).toMatchObject({ jobId: '1', leaseId: releaseLease, commit: merged, headCommit: head, prNumber: 42 })
    await expect(pipeline.claimReleaseJob('223e4567-e89b-42d3-a456-426614174003')).resolves.toBeNull()
    const dispatchEvent = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      requestId,
      workflowRunId: 9001,
      receiptSha256: hash2,
    }
    await expect(pipeline.recordReleaseDispatched(dispatchEvent)).resolves.toBe(true)
    const deployedEvent = {
      jobId: 1,
      taskId,
      leaseId: releaseLease,
      requestId,
      workflowRunId: 9001,
      commit: merged,
      liveVersion: merged.slice(0, 7),
      receiptSha256: hash3,
    }
    await expect(pipeline.recordReleaseDeployed(deployedEvent)).resolves.toMatchObject({ status: 'done', stage: 'deployed', commit: merged, liveVersion: merged.slice(0, 7) })
    await expect(pipeline.recordReleaseDispatched(dispatchEvent)).resolves.toBe(true)
    await expect(pipeline.recordReleaseDeployed(deployedEvent)).resolves.toMatchObject({ status: 'done', stage: 'deployed', commit: merged, liveVersion: merged.slice(0, 7) })
    await expect(pipeline.recordReleaseDeployed({ ...deployedEvent, receiptSha256: hash1 })).resolves.toBeNull()
    await expect(pipeline.recordWorkerHandoff(1, taskId, {
      handoffId,
      baseCommit: base,
      patchSha256: hash1,
      gateReceiptSha256: hash2,
    })).resolves.toMatchObject({ status: 'done', stage: 'deployed' })
    const activity = await database.query<{ activity_key: string }>(
      'SELECT activity_key FROM constructor_activity_events WHERE job_id=1 ORDER BY id',
    )
    expect(activity.rows.map((row) => row.activity_key)).toEqual(expect.arrayContaining([
      'working', 'gates_passed', 'pr_opened', 'merged', 'release_dispatched', 'deployed',
    ]))
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
    const secondLease = '223e4567-e89b-42d3-a456-426614174003'
    const thirdLease = '323e4567-e89b-42d3-a456-426614174003'
    await expect(pipeline.claimReleaseJob(secondLease)).resolves.toMatchObject({ commit: merged })
    await expect(pipeline.failReleaseLease(1, taskId, secondLease, 'workflow_timeout')).resolves.toBe(true)
    await expect(pipeline.claimReleaseJob(thirdLease)).resolves.toMatchObject({ commit: merged })
    await expect(pipeline.failReleaseLease(1, taskId, thirdLease, 'workflow_failed')).resolves.toBe(true)
    await expect(database.query<{ status: string; constructor_stage: string }>('SELECT status, constructor_stage FROM build_jobs WHERE id=1'))
      .resolves.toMatchObject({ rows: [{ status: 'running', constructor_stage: 'merged' }] })
    const fourthLease = '423e4567-e89b-42d3-a456-426614174003'
    await expect(pipeline.claimReleaseJob(fourthLease)).resolves.toMatchObject({ commit: merged, leaseId: fourthLease })
    await expect(pipeline.failReleaseLease(1, taskId, fourthLease, 'workflow_timeout')).resolves.toBe(true)
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
    }
    await expect(pipeline.claimPublisherJob('523e4567-e89b-42d3-a456-426614174002')).resolves.toMatchObject({
      leaseId: '523e4567-e89b-42d3-a456-426614174002',
      taskId,
    })
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
