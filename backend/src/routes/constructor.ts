import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { adminSiId, cerAdmin } from '../session.js'
import { advanceCodexBuildJob, claimNextBuildJob, createBuildJob, listBuildJobs, listMonitorBuildJobs, deleteBuildJob, deleteBuildJobsByScope, retryBuildJob, cancelBuildJob, getConstructorIncidentForJob, type CodexBuildEvent } from '../db.js'
import { numeleOrdinului, cineACerut } from '../services/numeOrdin.js'
import { procentDinProgres } from '../services/progresOrdin.js'
import { evalueazaOrdin, AI_CONSTRUCTORI } from '../services/evalOrdinConstructor.js'
import { getCodexWorkerStatus, newCodexTaskId, planificaOrdinConstructor, recordCodexWorkerStatus, verifyCodexWorkerRequest, type CodexWorkerState } from '../services/codexWorker.js'
import {
  claimPublisherJob,
  claimReleaseJob,
  failPublisherLease,
  failReleaseLease,
  recordPublisherMerged,
  recordPublisherPrOpened,
  recordReleaseDeployed,
  recordReleaseDispatched,
  recordWorkerHandoff,
  renewPublisherLease,
  renewReleaseLease,
} from '../services/constructorPipeline.js'
import { verifyPublisherRequest, verifyReleaseRequest } from '../services/constructorServiceAuth.js'
import { constructorContinuity } from '../services/constructorContinuity.js'
import { actOnRelease, readReleaseSnapshot } from '../services/githubReleaseIntegration.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key))
}

function internalJobIdentity(idRaw: string, body: Record<string, unknown>): { id: number; taskId: string; leaseId: string } | null {
  const id = Number(idRaw)
  const taskId = String(body.taskId ?? '').toLowerCase()
  const leaseId = String(body.leaseId ?? '').toLowerCase()
  if (!Number.isSafeInteger(id) || id <= 0 || !taskId.startsWith('codex-') || !UUID.test(taskId.slice(6)) || !UUID.test(leaseId)) return null
  return { id, taskId, leaseId }
}

// ── THE CONSTRUCTOR — the "order → code → PR" pipeline (Adrian, Jul 27:
// "Kelion must be able to create any software the admin asks for, any change,
// any improvement") ──────────────────────────────────────────────────────────
// The order enters here (from chat/voice through build_software or the admin
// panel). Execution belongs to a separate Codex worker: the public web process
// owns no worktree, shell, GitHub credential or ChatGPT authentication. It only
// enqueues work and records signed lifecycle events.
export async function constructorRoutes(app: FastifyInstance): Promise<void> {
  // The admin (or Kelion through a tool) queues an order.
  app.post<{ Body: { order?: string } }>('/api/admin/constructor', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const order = String(req.body?.order ?? '').trim()
    // POARTA DE CALITATE (owner, 13 aug: „să treacă orice ordin?" — NU). Ordinele
    // goale/vagi/în-afara-scopului sunt oprite AICI, cu motiv, înainte să intre în
    // coadă și să ardă credit. Poarta nu depinde de credit (doar de cerință), deci
    // rămâne rapidă — fără apel de rețea pe fiecare trimitere.
    const ev = evalueazaOrdin(order)
    if (!ev.trece) return reply.code(400).send({ error: 'ordin_respins', motiv: ev.motiv })
    // Normalizare deterministă; planificarea și editarea aparțin workerului.
    const orderCuPlan = await planificaOrdinConstructor(order)
    const id = await createBuildJob(user.email, orderCuPlan)
    if (!id) return reply.code(500).send({ error: 'db_indisponibil' })
    return reply.send({ ok: true, id, jobId: String(id), status: 'queued', commit: null, liveVersion: null })
  })

  // Evaluarea unei cerințe ÎNAINTE de trimitere (owner, 13 aug: „ordinul X →
  // cerința evaluată → se oferă AI-urile potrivite"). Întoarce poarta de calitate
  // + AI-urile potrivite pe capacitate, cu creditul LIVE din becuri. Doar citire.
  app.post<{ Body: { order?: string } }>('/api/admin/constructor/evalueaza', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const order = String(req.body?.order ?? '')
    return reply.send({ ...evalueazaOrdin(order), aiuri: AI_CONSTRUCTORI })
  })

  app.get('/api/admin/constructor', async (req, reply) => {
    // P9: poarta prin cerAdmin (sursa unică) — aceleași 401/403 pentru oameni,
    // să meargă și pe voce și în bucla autonomă, nu doar cu cookie-ul ownerului.
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): coada necitibilă (DB picat) → 500, nu 200 cu [] —
    // panoul scria „Niciun ordin încă" fără nicio măsurătoare reușită.
    const raw = await listBuildJobs(40)
    if (!raw) return reply.code(500).send({ error: 'db_unreadable' })
    // BARA 0–100% (Adrian, 3 aug): `pct` e harta etapei REALE raportate de
    // lucrător (progresOrdin.ts) — bara din panou o afișează lângă textul
    // etapei, ca cifra să poată fi confruntată oricând cu sursa ei.
    const incidents = await Promise.all(raw.map((job) => getConstructorIncidentForJob(job.id)))
    const jobs = raw.map((j, index) => ({
      ...j,
      pct: j.codexTaskId ? null : procentDinProgres(j.status, j.progress),
      // P8 (owner, 15 aug: „trebuie sa fie foarte clar ce executa"): numele
      // rândului = FAPTA extrasă din ordin, nu ambalajul promptului.
      nume: numeleOrdinului(j.orderText),
      // 16 aug: și AUTORUL, pe față — „cine e acolo?" nu se mai întreabă.
      cerutDe: cineACerut(j.orderedBy),
      continuity: constructorContinuity(j, incidents[index]),
    }))
    const worker = await getCodexWorkerStatus()
    return reply.send({
      jobs,
      constructor: {
        cine: 'codex_worker' as const,
        motiv: worker.worker.state === 'ready'
          ? 'workerul Codex separat a trimis un heartbeat recent'
          : 'workerul Codex separat nu este pregătit',
      },
    })
  })

  app.get('/api/admin/codex', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await getCodexWorkerStatus())
  })

  // ── DIAGNOSTICUL AUTONOM AL CONSTRUCTORULUI (owner, 19 aug: „nu are autonomie…
  // sa faca asta") ─────────────────────────────────────────────────────────────
  // Diagnostic read-only al cozii și heartbeatului workerului separat.
  app.get('/api/admin/constructor/diagnostic', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { diagnosticConstructorViu } = await import('../services/diagnosticConstructor.js')
    const diagnostic = await diagnosticConstructorViu(Date.now())
    if ('error' in diagnostic) return reply.code(500).send(diagnostic)
    return reply.send(diagnostic)
  })

  // Admin release console: GitHub is contacted only by a dedicated server-side
  // OAuth integration. The browser receives status and can request a bounded
  // review/merge action; it never sees a credential or bypasses branch rules.
  app.get<{ Querystring: { jobId?: string } }>('/api/admin/constructor/release', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const jobs = await listBuildJobs(40)
    if (!jobs) return reply.code(503).send({ error: 'db_unreadable' })
    const requestedId = Number(req.query.jobId)
    const job = Number.isSafeInteger(requestedId) && requestedId > 0
      ? jobs.find((candidate) => candidate.id === requestedId) ?? null
      : jobs.find((candidate) => candidate.prUrl) ?? null
    return reply.send({ jobId: job?.id ?? null, ...(await readReleaseSnapshot(job?.prUrl ?? null)) })
  })

  app.post<{ Body: { jobId?: number; action?: 'approve' | 'merge' } }>('/api/admin/constructor/release/action', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const jobId = Number(req.body?.jobId)
    const action = req.body?.action
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || (action !== 'approve' && action !== 'merge')) return reply.code(400).send({ error: 'invalid_release_action' })
    const jobs = await listBuildJobs(40)
    if (!jobs) return reply.code(503).send({ error: 'db_unreadable' })
    const job = jobs.find((candidate) => candidate.id === jobId)
    if (!job) return reply.code(404).send({ error: 'job_not_found' })
    const result = await actOnRelease(job.prUrl, action)
    if (!result.ok) return reply.code(409).send(result)
    return reply.send({ ok: true, release: await readReleaseSnapshot(job.prUrl) })
  })

  // ── ȘTERGE / CURĂȚĂ / REIA din PANOU (Adrian, 3 aug: „aici nu apar butoane de
  // ștergere" + „scoate 30/31 dacă nu le poate face, ai funcțiile făcute") ─────
  // Funcțiile existau demult în db.ts (deleteBuildJob / deleteBuildJobsByScope /
  // retryBuildJob) și erau folosite DOAR de unealta `constructor_manage` a lui
  // Kelion din chat. Panoul n-avea nicio rută spre ele → niciun buton. Le expun
  // aici, admin-only ca restul panoului. Ștergerea nu atinge un ordin 'running'
  // decât la scope='all' — un ordin viu nu piere din greșeală.
  app.delete<{ Params: { id: string } }>('/api/admin/constructor/:id', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const sters = await deleteBuildJob(id)
    return reply.send({ ok: sters })
  })

  // Ștergere în GRUP: scope=failed|done|failed_done|all (implicit failed_done —
  // curăță istoricul „eșuat/GATA", lasă cele vii). Întoarce câte a șters.
  app.post<{ Body: { scope?: string } }>('/api/admin/constructor/curata', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const scope = ['failed', 'done', 'failed_done', 'all'].includes(String(req.body?.scope))
      ? (String(req.body?.scope) as 'failed' | 'done' | 'failed_done' | 'all')
      : 'failed_done'
    // AUDIT ADMIN (3 aug): eroarea de DB devenea „Curățat: 0 ordine șterse."
    // — zero fals. null = eșec → 500 („Nu s-a putut curăța." în panou);
    // 0 rămâne posibil doar ca număr real.
    const sterse = await deleteBuildJobsByScope(scope)
    if (sterse === null) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ ok: true, sterse })
  })

  // ANULAREA unui ordin viu (auditul admin, 3 aug): cancelBuildJob exista în
  // db.ts din 3 aug, dar era legat DOAR de unealta constructor_manage din chat
  // — un ordin 'running' nu putea fi oprit din panou (✕ e ascuns pe running).
  // Aici e ruta pe care o cheamă butonul „oprește" de pe rândurile în curs.
  app.post<{ Params: { id: string } }>('/api/admin/constructor/:id/anuleaza', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const oprit = await cancelBuildJob(id)
    return reply.send({ ok: oprit })
  })

  // Reia un ordin (îl repune în coadă, attempts=0), opțional cu textul reformulat.
  app.post<{ Params: { id: string }; Body: { order?: string } }>('/api/admin/constructor/:id/reia', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const job = await retryBuildJob(id, req.body?.order)
    if (!job) return reply.code(409).send({ error: 'nu_se_poate_relua' })
    return reply.send({ ok: true, job, jobId: String(job.id), status: job.status, commit: job.commit, liveVersion: job.liveVersion })
  })

  // Contract fix, semnat, pentru workerul separat. Nu există un endpoint generic
  // de unelte/shell: workerul poate doar revendica un ordin și raporta etape.
  app.post<{ Body: { status?: string; detail?: string; taskUrl?: string; internalCostUsdMicros?: number } }>('/api/internal/codex/status', async (req, reply) => {
    if (!await verifyCodexWorkerRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    const allowed: CodexWorkerState[] = ['offline', 'setup_required', 'ready', 'busy', 'degraded']
    const status = String(req.body?.status ?? '') as CodexWorkerState
    const cost = req.body?.internalCostUsdMicros
    if (
      !allowed.includes(status)
      || (cost !== undefined && (!Number.isSafeInteger(cost) || cost < 0))
    ) return reply.code(400).send({ error: 'invalid_status' })
    await recordCodexWorkerStatus({
      status,
      taskUrl: req.body.taskUrl,
      detail: req.body.detail,
      internalCostUsdMicros: cost,
    })
    return reply.send({ ok: true })
  })

  app.post<{ Body: Record<string, never> }>('/api/internal/codex/jobs/claim', async (req, reply) => {
    if (!await verifyCodexWorkerRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (Object.keys(req.body ?? {}).length !== 0) return reply.code(400).send({ error: 'invalid_body' })
    const taskId = newCodexTaskId()
    const job = await claimNextBuildJob(taskId)
    if (!job) return reply.code(204).send()
    return reply.send({
      job: {
        jobId: String(job.id),
        taskId,
        status: job.status,
        order: job.orderText,
        orderedBy: job.orderedBy,
        attempts: job.attempts,
      },
    })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/codex/jobs/:id/event', async (req, reply) => {
    if (!await verifyCodexWorkerRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    const id = Number(req.params.id)
    const taskId = String(req.body?.taskId ?? '')
    const event = String(req.body?.event ?? '')
    if (!Number.isSafeInteger(id) || id <= 0 || !taskId.startsWith('codex-') || !UUID.test(taskId.slice(6))) return reply.code(400).send({ error: 'invalid_job' })
    const progress = typeof req.body?.progress === 'string' ? req.body.progress.trim().slice(0, 500) : undefined
    let payload: CodexBuildEvent
    if (event === 'accepted') payload = { event, progress }
    else if (event === 'progress' && progress) payload = { event, progress }
    else if (event === 'gates_passed' && req.body?.ci === 'green') {
      if (!exactKeys(req.body, ['taskId', 'event', 'ci', 'progress', 'handoffId', 'baseCommit', 'patchSha256', 'gateReceiptSha256'])) {
        return reply.code(400).send({ error: 'invalid_body' })
      }
      const handoffId = String(req.body.handoffId ?? '').toLowerCase()
      const baseCommit = String(req.body.baseCommit ?? '').toLowerCase()
      const patchSha256 = String(req.body.patchSha256 ?? '').toLowerCase()
      const gateReceiptSha256 = String(req.body.gateReceiptSha256 ?? '').toLowerCase()
      if (!UUID.test(handoffId) || !SHA40.test(baseCommit) || !SHA256.test(patchSha256) || !SHA256.test(gateReceiptSha256)) {
        return reply.code(400).send({ error: 'invalid_handoff' })
      }
      const job = await recordWorkerHandoff(id, taskId, { handoffId, baseCommit, patchSha256, gateReceiptSha256, progress })
      if (!job) return reply.code(409).send({ error: 'invalid_transition' })
      return reply.send({ ok: true, ...job })
    } else if (event === 'failed') {
      const log = String(req.body?.log ?? '').trim()
      if (!log) return reply.code(400).send({ error: 'invalid_failure' })
      payload = { event, log: log.slice(-20_000), progress }
    } else return reply.code(400).send({ error: 'invalid_event' })
    const job = await advanceCodexBuildJob(id, taskId, payload)
    if (!job) return reply.code(409).send({ error: 'invalid_transition' })
    return reply.send({ ok: true, jobId: String(job.id), status: job.status, stage: job.constructorStage, commit: job.commit, liveVersion: job.liveVersion })
  })

  // Publisherul este singura identitate care poate transforma un handoff cu
  // porți verzi într-un branch/PR și apoi într-un merge. Nu primește credentiale
  // Codex sau VPS, iar rutele sale nu acceptă comenzi, căi ori ref-uri arbitrare.
  app.post<{ Body: Record<string, never> }>('/api/internal/constructor-publisher/jobs/claim', async (req, reply) => {
    if (!await verifyPublisherRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (Object.keys(req.body ?? {}).length !== 0) return reply.code(400).send({ error: 'invalid_body' })
    const job = await claimPublisherJob()
    return job ? reply.send({ job }) : reply.code(204).send()
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-publisher/jobs/:id/lease', async (req, reply) => {
    if (!await verifyPublisherRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (!exactKeys(req.body, ['taskId', 'leaseId'])) return reply.code(400).send({ error: 'invalid_body' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const ok = await renewPublisherLease(identity.id, identity.taskId, identity.leaseId)
    return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'lease_lost' })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-publisher/jobs/:id/event', async (req, reply) => {
    if (!await verifyPublisherRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const event = String(req.body.event ?? '')
    const progress = typeof req.body.progress === 'string' ? req.body.progress.trim().slice(0, 500) : undefined
    if (event === 'pr_opened') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'branch', 'headCommit', 'prNumber', 'prUrl', 'receiptSha256', 'progress'])) {
        return reply.code(400).send({ error: 'invalid_body' })
      }
      const taskUuid = identity.taskId.slice('codex-'.length)
      const branch = String(req.body.branch ?? '')
      const headCommit = String(req.body.headCommit ?? '').toLowerCase()
      const prNumber = Number(req.body.prNumber)
      const prUrl = String(req.body.prUrl ?? '')
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      const expectedUrl = `https://github.com/${config.githubRepo}/pull/${prNumber}`
      if (branch !== `codex/${taskUuid}` || !SHA40.test(headCommit) || !Number.isSafeInteger(prNumber) || prNumber <= 0 || prUrl !== expectedUrl || !SHA256.test(receiptSha256)) {
        return reply.code(400).send({ error: 'invalid_pr_receipt' })
      }
      const job = await recordPublisherPrOpened({ ...identity, branch, headCommit, prNumber, prUrl, receiptSha256, progress, jobId: identity.id })
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'merged') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'headCommit', 'prNumber', 'commit', 'receiptSha256', 'progress'])) {
        return reply.code(400).send({ error: 'invalid_body' })
      }
      const headCommit = String(req.body.headCommit ?? '').toLowerCase()
      const commit = String(req.body.commit ?? '').toLowerCase()
      const prNumber = Number(req.body.prNumber)
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (!SHA40.test(headCommit) || !SHA40.test(commit) || !Number.isSafeInteger(prNumber) || prNumber <= 0 || !SHA256.test(receiptSha256)) {
        return reply.code(400).send({ error: 'invalid_merge_receipt' })
      }
      const job = await recordPublisherMerged({ ...identity, jobId: identity.id, headCommit, prNumber, commit, receiptSha256, progress })
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'failed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'code'])) return reply.code(400).send({ error: 'invalid_body' })
      const code = String(req.body.code ?? '')
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) return reply.code(400).send({ error: 'invalid_failure' })
      const job = await failPublisherLease(identity.id, identity.taskId, identity.leaseId, code)
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    return reply.code(400).send({ error: 'invalid_event' })
  })

  // Releaserul revendică exclusiv commituri deja îmbinate. Are doar
  // credentiala de dispatch GitHub Actions; workflow-ul production environment
  // păstrează credentiala VPS și dovada blue-green.
  app.post<{ Body: Record<string, never> }>('/api/internal/constructor-release/jobs/claim', async (req, reply) => {
    if (!await verifyReleaseRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (Object.keys(req.body ?? {}).length !== 0) return reply.code(400).send({ error: 'invalid_body' })
    const job = await claimReleaseJob()
    return job ? reply.send({ job }) : reply.code(204).send()
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-release/jobs/:id/lease', async (req, reply) => {
    if (!await verifyReleaseRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (!exactKeys(req.body, ['taskId', 'leaseId'])) return reply.code(400).send({ error: 'invalid_body' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const ok = await renewReleaseLease(identity.id, identity.taskId, identity.leaseId)
    return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'lease_lost' })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-release/jobs/:id/event', async (req, reply) => {
    if (!await verifyReleaseRequest(req)) return reply.code(401).send({ error: 'unauthorized' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const event = String(req.body.event ?? '')
    if (event === 'dispatched') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'requestId', 'workflowRunId', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = Number(req.body.workflowRunId)
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (!UUID.test(requestId) || !Number.isSafeInteger(workflowRunId) || workflowRunId <= 0 || !SHA256.test(receiptSha256)) return reply.code(400).send({ error: 'invalid_dispatch_receipt' })
      const ok = await recordReleaseDispatched({ ...identity, jobId: identity.id, requestId, workflowRunId, receiptSha256 })
      return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'deployed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'requestId', 'workflowRunId', 'commit', 'liveVersion', 'receiptSha256', 'progress'])) return reply.code(400).send({ error: 'invalid_body' })
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = Number(req.body.workflowRunId)
      const commit = String(req.body.commit ?? '').toLowerCase()
      const liveVersion = String(req.body.liveVersion ?? '').trim()
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      const progress = typeof req.body.progress === 'string' ? req.body.progress.trim().slice(0, 500) : undefined
      if (!UUID.test(requestId) || !Number.isSafeInteger(workflowRunId) || workflowRunId <= 0 || !SHA40.test(commit) || !/^[0-9a-f]{7,40}$/.test(liveVersion) || !SHA256.test(receiptSha256)) return reply.code(400).send({ error: 'invalid_deploy_receipt' })
      const job = await recordReleaseDeployed({ ...identity, jobId: identity.id, requestId, workflowRunId, commit, liveVersion, receiptSha256, progress })
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'failed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'code'])) return reply.code(400).send({ error: 'invalid_body' })
      const code = String(req.body.code ?? '')
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) return reply.code(400).send({ error: 'invalid_failure' })
      const ok = await failReleaseLease(identity.id, identity.taskId, identity.leaseId, code)
      return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    return reply.code(400).send({ error: 'invalid_event' })
  })

  // The jobs to show on the monitor (active + recently finished) + their
  // current step — for the live panel in the frontend (admin session; Stage
  // 4b). Also includes `done`/`failed` from the last minutes, so the panel
  // shows the ENDING (Done/Failed), not just the road to it.
  app.get('/api/constructor/live', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const jobs = await listMonitorBuildJobs()
    const incidents = await Promise.all(jobs.map((job) => getConstructorIncidentForJob(job.id)))
    return reply.send({
      // P8: `order` devine FAPTA (numeleOrdinului), nu primele litere ale
      // promptului — monitorul arată „ce execută", cum a cerut ownerul.
      // 16 aug 05:47 (ownerul, pe #330: „aici nu esti tu" / „cine e acolo?"):
      // cardul spune de-acum CINE a cerut ordinul — omul, sau o buclă automată
      // pe nume. Un ordin fără autor vizibil arată ca o fantomă.
      jobs: jobs.map((j, index) => ({ id: j.id, jobId: String(j.id), status: j.status, stage: j.constructorStage, order: numeleOrdinului(j.orderText), cerutDe: cineACerut(j.orderedBy), progress: j.progress, pct: j.codexTaskId ? null : procentDinProgres(j.status, j.progress), ci: j.ci, prUrl: j.prUrl, commit: j.commit, liveVersion: j.liveVersion, attempts: j.attempts, updatedAt: j.updatedAt, continuity: constructorContinuity(j, incidents[index]) })),
    })
  })
}
