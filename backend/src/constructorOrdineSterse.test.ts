import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let database: PGlite

vi.mock('./dbPool.js', () => ({
  getPool: () => ({ query: (sql: string, params?: unknown[]) => database.query(sql, params) }),
  conexiuneDb: async () => ({
    query: (sql: string, params?: unknown[]) => database.query(sql, params),
    release: vi.fn(),
  }),
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://constructor-test',
    openai: { key: '' },
    billing: { userShare: 0.75, creditValue: 0.1, usdToCurrency: 1, currency: 'gbp' },
  },
}))

const {
  advanceConstructorBuildJob,
  archiveBuildJobsByScope,
  cancelBuildJob,
  deleteBuildJob,
  listArchivedBuildJobs,
  listBuildJobs,
  retryBuildJob,
} = await import('./db.js')

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

async function snapshot(id: number): Promise<{ id: number; status: JobStatus; updatedAt: string }> {
  const result = await database.query<{ id: number; status: JobStatus; updated_at: Date }>(
    'SELECT id, status, updated_at FROM build_jobs WHERE id=$1',
    [id],
  )
  const row = result.rows[0]
  if (!row) throw new Error('fixture_missing')
  return { id: Number(row.id), status: row.status, updatedAt: row.updated_at.toISOString() }
}

beforeEach(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE TABLE build_jobs (
      id BIGSERIAL PRIMARY KEY,
      ordered_by TEXT NOT NULL DEFAULT 'admin',
      order_text TEXT NOT NULL DEFAULT 'ordin test',
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      execution_cycle INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      arhivat BOOLEAN NOT NULL DEFAULT false,
      constructor_stage TEXT NOT NULL DEFAULT 'queued',
      codex_task_id TEXT,
      progress TEXT,
      retry_not_before TIMESTAMPTZ,
      erasure_request_id UUID,
      progress_at TIMESTAMPTZ,
      log TEXT,
      ci TEXT,
      branch TEXT,
      pr_url TEXT,
      commit_sha TEXT,
      live_version TEXT,
      brain TEXT,
      tokens BIGINT NOT NULL DEFAULT 0,
      cost_usd NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE constructor_incidents (
      job_id BIGINT NOT NULL,
      state TEXT NOT NULL,
      stage TEXT,
      verification TEXT,
      lesson TEXT,
      next_action TEXT,
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE constructor_pipeline (job_id BIGINT PRIMARY KEY);
    INSERT INTO build_jobs(id,status,constructor_stage,codex_task_id) VALUES
      (1,'queued','queued',NULL),
      (2,'running','working','codex-123e4567-e89b-42d3-a456-426614174000'),
      (3,'failed','working',NULL),
      (4,'done','deployed',NULL),
      (5,'cancelled','cancelled',NULL),
      (6,'done','deployed',NULL);
  `)
}, 30_000)

afterEach(async () => {
  await database.close()
}, 30_000)

describe('curățarea în grup este exactă și recuperabilă', () => {
  it('pagina arhivei nu pierde rânduri cu același timestamptz la microsecundă', async () => {
    await database.query(
      `INSERT INTO build_jobs(id,status,constructor_stage,arhivat,updated_at)
       SELECT 1000 + value, 'done', 'deployed', true, '2026-08-26 10:11:12.123456+00'::timestamptz
       FROM generate_series(1,81) AS value`,
    )
    const first = await listArchivedBuildJobs(40)
    expect(first.jobs).toHaveLength(40)
    expect(first.nextCursor?.updatedAt).toBe('2026-08-26T10:11:12.123456Z')
    const second = await listArchivedBuildJobs(40, first.nextCursor ?? undefined)
    const third = await listArchivedBuildJobs(40, second.nextCursor ?? undefined)
    const ids = [...first.jobs, ...second.jobs, ...third.jobs].map((job) => job.id)
    expect(ids).toHaveLength(81)
    expect(new Set(ids).size).toBe(81)
  })

  it('arhivează numai snapshotul terminal vizibil și nu atinge ordinele vii sau nevăzute', async () => {
    const expected = await Promise.all([snapshot(3), snapshot(4), snapshot(5)])
    await expect(archiveBuildJobsByScope('all', expected)).resolves.toEqual({ ok: true, archived: 3 })
    const rows = await database.query<{ id: number; arhivat: boolean }>('SELECT id, arhivat FROM build_jobs ORDER BY id')
    expect(rows.rows.map((row) => [Number(row.id), row.arhivat])).toEqual([
      [1, false], [2, false], [3, true], [4, true], [5, true], [6, false],
    ])
  })

  it('refuză atomic un snapshot care nu se potrivește scope-ului', async () => {
    const done = await snapshot(4)
    await expect(archiveBuildJobsByScope('failed', [done])).resolves.toEqual({ ok: false, error: 'stale_state' })
    await expect(database.query<{ arhivat: boolean }>('SELECT arhivat FROM build_jobs WHERE id=4'))
      .resolves.toMatchObject({ rows: [{ arhivat: false }] })
  })

  it('refuză cursa în care workerul a schimbat starea după snapshot', async () => {
    const failed = await snapshot(3)
    await database.query("UPDATE build_jobs SET status='running', updated_at=now() + interval '1 second' WHERE id=3")
    await expect(archiveBuildJobsByScope('failed', [failed])).resolves.toEqual({ ok: false, error: 'stale_state' })
  })
})

describe('controalele țintite păstrează tranziția canonică', () => {
  it('ștergerea definitivă nu poate elimina un ordin viu', async () => {
    const running = await snapshot(2)
    await expect(deleteBuildJob(2, running)).resolves.toEqual({ ok: false, error: 'not_deletable' })
    await expect(database.query<{ count: string }>('SELECT count(*)::text AS count FROM build_jobs WHERE id=2'))
      .resolves.toMatchObject({ rows: [{ count: '1' }] })
  })

  it('ștergerea definitivă nu poate elimina ledgerul unui rezultat publicat', async () => {
    await database.query('INSERT INTO constructor_pipeline(job_id) VALUES (4)')
    const deployed = await snapshot(4)
    await expect(deleteBuildJob(4, deployed)).resolves.toEqual({ ok: false, error: 'not_deletable' })
    await expect(database.query<{ count: string }>('SELECT count(*)::text AS count FROM constructor_pipeline WHERE job_id=4'))
      .resolves.toMatchObject({ rows: [{ count: '1' }] })
  })

  it('expune capabilitatea de ștergere din același guard folosit de mutație', async () => {
    await database.query('INSERT INTO constructor_pipeline(job_id) VALUES (4)')
    const jobs = await listBuildJobs()
    expect(jobs?.find((job) => job.id === 3)?.deletable).toBe(true)
    expect(jobs?.find((job) => job.id === 3)?.retryable).toBe(true)
    expect(jobs?.find((job) => job.id === 4)?.deletable).toBe(false)
    expect(jobs?.find((job) => job.id === 4)?.retryable).toBe(false)
    expect(jobs?.find((job) => job.id === 6)?.deletable).toBe(false)
  })

  it('reluarea generică refuză un rezultat terminal care are ledger de publicație', async () => {
    await database.query('INSERT INTO constructor_pipeline(job_id) VALUES (3)')
    const failed = await snapshot(3)
    await expect(retryBuildJob(3, undefined, failed)).resolves.toEqual({ ok: false, error: 'not_retryable' })
    await expect(database.query<{ status: string; pipeline_count: string }>(
      `SELECT b.status,
              (SELECT count(*)::text FROM constructor_pipeline p WHERE p.job_id=b.id) AS pipeline_count
         FROM build_jobs b WHERE b.id=3`,
    )).resolves.toMatchObject({ rows: [{ status: 'failed', pipeline_count: '1' }] })
  })

  it('un ordin pseudonimizat de erasure nu mai este expus sau acceptat pentru retry', async () => {
    await database.query(
      "UPDATE build_jobs SET order_text='[erased]', erasure_request_id='123e4567-e89b-42d3-a456-426614174000' WHERE id=5",
    )
    const jobs = await listBuildJobs()
    expect(jobs?.find((job) => job.id === 5)?.retryable).toBe(false)
    const erased = await snapshot(5)
    await expect(retryBuildJob(5, undefined, erased)).resolves.toEqual({ ok: false, error: 'not_retryable' })
    await expect(database.query<{ status: string; order_text: string; execution_cycle: number }>(
      'SELECT status, order_text, execution_cycle FROM build_jobs WHERE id=5',
    )).resolves.toMatchObject({ rows: [{ status: 'cancelled', order_text: '[erased]', execution_cycle: 0 }] })
  })

  it('anularea persistă statusul, etapa, progresul și desprinde taskul workerului', async () => {
    const running = await snapshot(2)
    const oldTaskId = 'codex-123e4567-e89b-42d3-a456-426614174000'
    await expect(cancelBuildJob(2, running)).resolves.toEqual({ ok: true })
    await expect(database.query<{ status: string; constructor_stage: string; progress: string; codex_task_id: string | null }>(
      'SELECT status, constructor_stage, progress, codex_task_id FROM build_jobs WHERE id=2',
    )).resolves.toMatchObject({
      rows: [{ status: 'cancelled', constructor_stage: 'cancelled', progress: 'cancelled_by_admin', codex_task_id: null }],
    })
    await expect(advanceConstructorBuildJob(2, oldTaskId, { event: 'progress', progress: 'late-after-cancel' }))
      .resolves.toBeNull()
    await expect(database.query<{ status: string; constructor_stage: string; progress: string; codex_task_id: string | null }>(
      'SELECT status, constructor_stage, progress, codex_task_id FROM build_jobs WHERE id=2',
    )).resolves.toMatchObject({
      rows: [{ status: 'cancelled', constructor_stage: 'cancelled', progress: 'cancelled_by_admin', codex_task_id: null }],
    })
  })
})
