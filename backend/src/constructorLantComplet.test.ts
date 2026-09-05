import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const cod = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

describe('lanțul unic Admin → worker Constructor → gates → master → live', () => {
  it('publică automat conform GitHub fără endpoint sau gate manual Kelion', () => {
    const route = cod('routes/constructor.ts')
    const release = cod('services/githubReleaseIntegration.ts')
    const publisher = cod('../../deploy/constructor-publisher.mjs')
    expect(route).not.toContain('/api/admin/constructor/release/action')
    expect(release).not.toContain('approveRelease')
    expect(release).not.toContain("event: 'APPROVE'")
    expect(release).not.toContain('Aprobă PR-ul din Kelion')
    expect(publisher).toContain('approvalCount >= protectionPolicy.requiredApprovalCount')
    expect(publisher).toContain('await revalidateBeforeMerge(')
    expect(publisher).not.toContain('approvalProtocol')
    expect(publisher).not.toContain('strictAdminAuthorization')
  })

  it('web-ul doar pune ordinul validat în DB și întoarce același jobId', () => {
    const route = cod('routes/constructor.ts')
    expect(route).toMatch(/evalueazaOrdin\(order\)[\s\S]{0,1000}createBuildJob\(user\.email, orderCuPlan\)/)
    expect(route).toContain('jobId: String(intake.id)')
    expect(route).not.toContain('/api/constructor/tool')
  })

  it('workerul are HMAC fix cu replay durabil, fără shell/repo/credențiale de provider', () => {
    const worker = cod('services/constructorWorker.ts')
    const auth = cod('services/constructorServiceAuth.ts')
    const pipeline = cod('services/constructorPipeline.ts')
    expect(auth).toContain("createHmac('sha256'")
    expect(auth).toContain("headerPrefix: 'x-codex'")
    expect(auth).toContain("'constructor-publisher'")
    expect(auth).toContain("'constructor-release'")
    expect(pipeline).toContain('constructor_service_nonces')
    expect(pipeline).toContain('ON CONFLICT DO NOTHING')
    expect(auth).not.toContain('seenNonces')
    expect(worker).not.toMatch(/from ['"]node:child_process['"]|\bexecFile\s*\(|\bspawn\s*\(/)
    expect(worker).not.toMatch(/GITHUB_TOKEN|OPENAI_ADMIN_KEY/)
  })

  it('claim și lifecycle sunt legate de jobId + taskId', () => {
    const route = cod('routes/constructor.ts')
    const db = cod('db.ts')
    expect(route).toContain("'/api/internal/codex/jobs/claim'")
    expect(route).toContain("'/api/internal/codex/jobs/:id/event'")
    expect(db).toContain('claimNextBuildJob(')
    expect(db).toContain('executionProfile: ConstructorExecutionProfile')
    expect(db).toContain('advanceConstructorBuildJob')
    expect(db).toMatch(/codex_task_id=\$2/)
    expect(db).toContain("pg_advisory_xact_lock(hashtext('constructor:claim-build-job'))")
    expect(db).toContain('retry_not_before')
    expect(db).not.toContain('[abandoned: 3 attempts exhausted]')
    expect(route).toContain('recoveryCode')
    expect(cod('../../deploy/codex-worker.mjs')).toContain('RECOVERY_GUIDANCE')
  })

  it('workerul local și endpointul lui acceptă numai taxonomia locală curentă', () => {
    const db = cod('db.ts')
    const worker = cod('../../deploy/codex-worker.mjs')
    const dbCatalogStart = db.indexOf('export const CONSTRUCTOR_WORKER_FAILURE_CODES = [')
    const dbCatalog = db.slice(dbCatalogStart, db.indexOf('] as const', dbCatalogStart))
    const workerCatalogStart = worker.indexOf('const WORKER_FAILURE_CODES = new Set([')
    const workerCatalog = worker.slice(workerCatalogStart, worker.indexOf('])', workerCatalogStart))
    const unresolvedCatalogStart = worker.indexOf('const WORKER_UNRESOLVED_REASONS = new Set([')
    const unresolvedCatalog = worker.slice(unresolvedCatalogStart, worker.indexOf('])', unresolvedCatalogStart))

    for (const current of [
      'execution_timeout',
      'brain_unavailable',
      'worker_internal_failure',
    ]) {
      expect(dbCatalog).toContain(`'${current}'`)
      expect(workerCatalog).toContain(`'${current}'`)
    }
    for (const unresolved of ['test_failure', 'quality_gate_failure', 'no_changes']) {
      expect(dbCatalog).not.toContain(`'${unresolved}'`)
      expect(workerCatalog).not.toContain(`'${unresolved}'`)
      expect(unresolvedCatalog).toContain(`'${unresolved}'`)
    }
    for (const retired of ['provider_auth', 'provider_credit', 'codex_exec_failed']) {
      expect(dbCatalog).not.toContain(`'${retired}'`)
      expect(workerCatalog).not.toContain(`'${retired}'`)
    }
  })

  it('un eșec worker păstrează ordinul terminal, profilul măsurat și nu programează retry', () => {
    const db = cod('db.ts')
    const route = cod('routes/constructor.ts')
    const worker = cod('../../deploy/codex-worker.mjs')
    const transition = db.slice(
      db.indexOf('export async function advanceConstructorBuildJob'),
      db.indexOf('export interface BuildJobMutationExpectation'),
    )
    const workerEvent = route.slice(
      route.indexOf("'/api/internal/codex/jobs/:id/event'"),
      route.indexOf("'/api/internal/constructor-publisher/jobs/claim'"),
    )

    // SQL behavior is exercised in constructorPipeline.test.ts; this boundary
    // additionally prevents a hidden scheduling branch in the worker handler.
    expect(transition).toContain("status=CASE WHEN $3 THEN 'failed' ELSE status END")
    expect(transition).not.toContain("THEN 'queued'")
    expect(transition).not.toContain('CONSTRUCTOR_WORKER_MAX_ATTEMPTS')
    expect(transition).toContain("failedRow.status === 'failed'")
    expect(transition).not.toMatch(/execution_cycle\s*=|worker_retry_scheduled/)
    expect(workerEvent).toContain("['taskId', 'event', 'code', 'profile', 'progress']")
    expect(workerEvent).toContain("['taskId', 'event', 'reason', 'profile', 'progress']")
    expect(workerEvent).toMatch(/reason !== 'no_changes'.*reason !== 'test_failure'.*reason !== 'quality_gate_failure'/s)
    expect(workerEvent).toMatch(/profile !== 'fast' && profile !== 'powerful'/)
    expect(worker).toMatch(/event: 'failed', code, profile: profile\.tier/g)
    expect(worker).toMatch(/event: 'unresolved',[\s\S]{0,120}reason: assertWorkerUnresolvedReason/)
    expect(worker).not.toMatch(/switchConstructorModel|CONSTRUCTOR_TURNS/)
  })

  it('claim-ul distinge lipsa unui ordin eligibil de un pipeline deja running', () => {
    const route = cod('routes/constructor.ts')
    const db = cod('db.ts')
    const worker = cod('../../deploy/codex-worker.mjs')
    const claim = db.slice(db.indexOf('export async function claimNextBuildJob'), db.indexOf('export async function deblocheazaJoburileClaimate'))
    expect(claim).toContain("state: active.rows[0]?.active === true ? 'pipeline_active' : 'no_claimable_job'")
    expect(claim).toContain('execution_profile=$3')
    expect(route).toContain("exactKeys(req.body, ['profile', 'doctorCapability'])")
    expect(route).toContain('const model = await readConstructorModelSnapshot()')
    expect(route).toContain("model.state !== 'ready'")
    expect(route).toContain('model.activeProfile !== profile')
    expect(route).toContain('measuredProfile = model.activeProfile')
    expect(route).toContain('claimNextBuildJob(taskId, measuredProfile, req.body.doctorCapability)')
    expect(route).not.toContain('claimNextBuildJob(taskId, profile)')
    expect(worker).toContain("post(value, '/api/internal/codex/jobs/claim', { profile, doctorCapability: measureDoctorCapability() })")
    expect(route).toMatch(/claim\.state !== 'claimed'[\s\S]*state: claim\.state, job: null/)
    expect(worker).toMatch(/response\.state === 'no_claimable_job'[\s\S]*'ready'/)
    expect(worker).toMatch(/response\.state === 'pipeline_active'[\s\S]*'busy'/)
    expect(worker).not.toMatch(/if \(!claimed\?\.job\) return/)
  })

  it('unresolved cere dovada accepted/working, dar claimed poate eșua tehnic', () => {
    const db = cod('db.ts')
    const transition = db.slice(
      db.indexOf('export async function advanceConstructorBuildJob'),
      db.indexOf('// Leagă identificatorul opac', db.indexOf('export async function advanceConstructorBuildJob')),
    )
    expect(transition).toContain("unresolved: ['accepted', 'working']")
    expect(transition).toContain("failed: ['claimed', 'accepted', 'working']")
    expect(transition).not.toContain("unresolved: ['claimed'")
  })

  it('watchdog-ul păstrează terminală execuția tăcută, fără schimbare de profil', () => {
    const db = cod('db.ts')
    const watchdog = db.slice(
      db.indexOf('export async function deblocheazaJoburileClaimate'),
      db.indexOf('// AUDIT ADMIN', db.indexOf('export async function deblocheazaJoburileClaimate')),
    )
    expect(watchdog).toContain("status='failed'")
    expect(watchdog).not.toContain("THEN 'queued'")
    expect(watchdog).not.toContain('CONSTRUCTOR_WORKER_MAX_ATTEMPTS')
    expect(watchdog).toContain("constructorWorkerTechnicalFailureRecord('execution_timeout', profile)")
    expect(watchdog).toContain("if (failedRow.status !== 'failed') continue")
    expect(watchdog).not.toMatch(/execution_cycle\s*=|worker_retry_scheduled/)
  })

  it('publisherul nu reinvocă modelul după un handoff respins', () => {
    const pipeline = cod('services/constructorPipeline.ts')
    const failure = pipeline.slice(
      pipeline.indexOf('export async function failPublisherLease'),
      pipeline.indexOf('export async function claimReleaseJob'),
    )
    // Nici schimbarea bazei după claim nu autorizează o altă execuție AI.
    expect(failure).toContain("code === 'stale_base'")
    expect(failure).toContain('INSERT INTO constructor_publication_retirements')
    expect(failure).not.toMatch(/STALE_BASE_MAX_REQUEUES|'queued'|attempts\s*=/)
    expect(failure).toContain("progress='publisher_manual_restart_required'")
    const stale = failure.slice(failure.indexOf("if (code === 'stale_base')"), failure.indexOf("await sql.query('DELETE FROM constructor_pipeline"))
    expect(stale).toContain("status='failed', constructor_stage='failed'")
    expect(stale).not.toMatch(/DELETE|branch=NULL|commit_sha=NULL/)
    expect(failure).not.toMatch(/execution_cycle\s*=|worker_retry_scheduled/)
  })

  it('auditul separă Reia cerut de owner de recuperările automate', () => {
    const migration = cod('../migrations/20260911_constructor_manual_model_outcomes.sql')
    expect(migration).toContain("('manual_owner_retry', NULL")
    expect(migration).toContain("WHEN NEW.progress = 'owner_retry_scheduled' THEN 'manual_owner_retry'")
    const automaticRetry = migration.slice(
      migration.indexOf("WHEN NEW.progress IN (\n      'publisher_retryable_failure'"),
      migration.indexOf(") THEN 'automatic_retry'", migration.indexOf("WHEN NEW.progress IN (\n      'publisher_retryable_failure'")),
    )
    expect(automaticRetry).not.toContain('owner_retry_scheduled')
    expect(automaticRetry).not.toContain('worker_retry_scheduled')
    expect(automaticRetry).not.toContain('stale_base_requeued')
    expect(migration).not.toContain("OLD.status = 'running' THEN 'automatic_retry'")
  })

  it('worker, publisher și release au tranziții și identități separate', () => {
    const pipeline = cod('services/constructorPipeline.ts')
    const route = cod('routes/constructor.ts')
    const workerEvent = route.slice(
      route.indexOf("'/api/internal/codex/jobs/:id/event'"),
      route.indexOf("'/api/internal/constructor-publisher/jobs/claim'"),
    )
    expect(workerEvent).not.toMatch(/event === 'pr_opened'|event === 'merged'|event === 'deployed'/)
    expect(pipeline).toMatch(/constructor_stage !== 'gates_passed'/)
    expect(pipeline).toMatch(/constructor_stage !== 'pr_opened'/)
    expect(pipeline).toMatch(/constructor_stage !== 'merged'/)
    expect(route).toContain('verifyPublisherRequest')
    expect(route).toContain('verifyReleaseRequest')
    expect(route).toContain("req.body?.ci === 'local_gates'")
    expect(route).toMatch(/event === 'deployed'[\s\S]{0,700}liveVersion/)
    expect(route).toMatch(/SHA40\.test\(liveVersion\)[\s\S]{0,120}liveVersion !== targetCommit/)
    expect(pipeline).toMatch(/input\.liveVersion !== input\.targetCommit/)
  })

  it('claim-ul și lease-ul publisher/release sunt fail-closed fără heartbeat persistat', () => {
    const route = cod('routes/constructor.ts')
    const publisherClaim = route.slice(
      route.indexOf("'/api/internal/constructor-publisher/jobs/claim'"),
      route.indexOf("'/api/internal/constructor-publisher/jobs/:id/lease'"),
    )
    const publisherLease = route.slice(
      route.indexOf("'/api/internal/constructor-publisher/jobs/:id/lease'"),
      route.indexOf("'/api/internal/constructor-publisher/jobs/:id/event'"),
    )
    const releaseClaim = route.slice(
      route.indexOf("'/api/internal/constructor-release/jobs/claim'"),
      route.indexOf("'/api/internal/constructor-release/jobs/:id/lease'"),
    )
    const releaseLease = route.slice(
      route.indexOf("'/api/internal/constructor-release/jobs/:id/lease'"),
      route.indexOf("'/api/internal/constructor-release/jobs/:id/event'"),
    )

    expect(publisherClaim).toContain("if (!heartbeatPersisted) return reply.code(503).send({ error: 'publisher_heartbeat_not_persisted' })")
    expect(publisherClaim).toContain('reply.send({ job, heartbeatPersisted: true })')
    expect(publisherLease).toContain("if (!heartbeatPersisted) return reply.code(503).send({ error: 'publisher_heartbeat_not_persisted' })")
    expect(publisherLease).toContain('reply.send({ ok: true, heartbeatPersisted: true })')
    expect(releaseClaim).toContain("if (!heartbeatPersisted) return reply.code(503).send({ error: 'release_heartbeat_not_persisted' })")
    expect(releaseClaim).toContain('reply.send({ job, heartbeatPersisted: true })')
    expect(releaseLease).toContain("if (!heartbeatPersisted) return reply.code(503).send({ error: 'release_heartbeat_not_persisted' })")
    expect(releaseLease).toContain('reply.send({ ok: true, heartbeatPersisted: true })')
  })

  it('rezultatul păstrează jobId, status, commit și liveVersion până în chat/panou', () => {
    const route = cod('routes/constructor.ts')
    const chat = cod('routes/chat.ts')
    expect(route).toMatch(/jobId: String\(job\.id\), status: job\.status, stage: job\.constructorStage, commit: job\.commit, liveVersion: job\.liveVersion/)
    expect(chat).toMatch(/jobId[\s\S]{0,400}status[\s\S]{0,400}commit[\s\S]{0,400}liveVersion/)
  })

  it('procesul web nu pornește autonomie din documente sau agenți de repo', () => {
    const index = cod('index.ts')
    expect(index).not.toContain('startAutonomie')
    expect(index).not.toMatch(/runSelfHeal|pornesteIscoadele|pornestePietarul|ruleazaSantinelaPR/)
  })
})
