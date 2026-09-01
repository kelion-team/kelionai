import type { FastifyInstance, FastifyReply } from 'fastify'
import { config } from '../config.js'
import { adminSiId, cerAdmin, getSessionUser } from '../session.js'
import { advanceCodexBuildJob, claimNextBuildJob, createBuildJob, getBuildJobById, listBuildJobs, listArchivedBuildJobs, listMonitorBuildJobs, deleteBuildJob, archiveBuildJobsByScope, retryBuildJob, cancelBuildJob, restoreArchivedBuildJob, getConstructorIncidentsForJobs, isArchivedBuildJobsCursorTimestamp, isCodexWorkerFailureCode, noteazaAudit, type BuildJobMutationExpectation, type CodexBuildEvent } from '../db.js'
import { numeleOrdinului, cineACerut } from '../services/numeOrdin.js'
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
  recordReleaseDispatchIntended,
  recordReleaseCandidateVerified,
  recordReleaseTargetSelected,
  reconcileLegacyReleaseDispatch,
  resolveLegacyReleaseAmbiguity,
  retireReleaseDispatch,
  recordWorkerHandoff,
  renewPublisherLease,
  renewReleaseLease,
  type PublisherRetirementProof,
  RELEASE_RETIREMENT_CONCLUSIONS,
  type ReleaseRetirementConclusion,
} from '../services/constructorPipeline.js'
import { verifyPublisherRequest, verifyReleaseRequest, type ConstructorServiceAuthResult } from '../services/constructorServiceAuth.js'
import { constructorContinuity } from '../services/constructorContinuity.js'
import { readConstructorModelSnapshot } from '../services/constructorModelControl.js'
import { constructorObservabilityForJobs } from '../services/constructorObservability.js'
import { constructorWorkCardsForJobs } from '../services/constructorWorkCard.js'
import { approveRelease, readReleaseSnapshot } from '../services/githubReleaseIntegration.js'
import {
  constructorChainAcceptsWork,
  constructorWorkerCanStartNow,
  getConstructorChainStatus,
  recordConstructorServiceHeartbeat,
  type ConstructorChainStatus,
  type ConstructorPipelineService,
} from '../services/constructorChainStatus.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

async function internalConstructorAuthorized(
  verification: Promise<ConstructorServiceAuthResult>,
  reply: FastifyReply,
): Promise<boolean> {
  const result = await verification
  if (result === 'authorized') return true
  if (result === 'store_unavailable') {
    reply.code(503).send({ error: 'constructor_auth_store_unavailable' })
  } else {
    reply.code(401).send({ error: 'unauthorized' })
  }
  return false
}

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key))
}

function mutationExpectation(
  statusRaw: unknown,
  updatedAtRaw: unknown,
): BuildJobMutationExpectation | null {
  const statuses = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
  const status = String(statusRaw ?? '')
  const updatedAt = String(updatedAtRaw ?? '')
  const parsed = Date.parse(updatedAt)
  if (!statuses.includes(status as (typeof statuses)[number]) || !Number.isFinite(parsed)) return null
  // Browserul trebuie să trimită exact versiunea ISO primită de la listare;
  // normalizarea aici evită timestampuri ambigue folosite drept precondiție.
  if (new Date(parsed).toISOString() !== updatedAt) return null
  return { status: status as BuildJobMutationExpectation['status'], updatedAt }
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
// panel). Execution belongs to the separate OpenCode + Qwen local (llama.cpp)
// worker. The public web process owns no worktree, shell or GitHub credential;
// it only writes build_jobs and records signed lifecycle events. The `codex_*`
// route/task names below are compatibility identifiers.
export async function constructorRoutes(app: FastifyInstance): Promise<void> {
  const readChain = async (): Promise<ConstructorChainStatus> => {
    try {
      return await getConstructorChainStatus()
    } catch {
      const unreadable = { state: 'unknown' as const, lastHeartbeat: null, detail: null }
      return {
        state: 'unknown',
        reason: 'starea lanțului Constructor nu a putut fi citită',
        lastHeartbeat: null,
        legs: { worker: unreadable, publisher: unreadable, release: unreadable },
      }
    }
  }
  const pipelineMutation = async <T>(operation: () => Promise<T>): Promise<
    { readable: true; value: T } | { readable: false }
  > => {
    try {
      return { readable: true, value: await operation() }
    } catch (error) {
      app.log.error({ error: error instanceof Error ? error.message : String(error) }, 'constructor pipeline persistence failed')
      return { readable: false }
    }
  }
  const serviceHeartbeat = async (
    service: ConstructorPipelineService,
    state: 'ready' | 'busy' | 'degraded',
    detail: string,
  ): Promise<boolean> => {
    try {
      await recordConstructorServiceHeartbeat(service, state, detail)
      return true
    } catch (error) {
      app.log.error({ error: error instanceof Error ? error.message : String(error), service }, 'constructor heartbeat was not persisted')
      return false
    }
  }
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
    let intake: Awaited<ReturnType<typeof createBuildJob>>
    try {
      intake = await createBuildJob(user.email, orderCuPlan)
    } catch {
      return reply.code(503).send({ error: 'db_indisponibil' })
    }
    noteazaAudit(
      user.email,
      intake.created ? 'constructor-create' : 'constructor-deduplicated',
      'build_jobs',
      String(intake.id),
      intake.status,
      intake.created ? 'queued' : 'reused-active',
    )
    // Citirea disponibilității are loc după intake, ca mesajul UI să reflecte
    // starea curentă a întregului lanț, nu snapshotul vechi de la ultimul poll.
    // Dacă ea pică, ordinul deja persistat rămâne un succes, dar orice ETA cade
    // închis: unknown / false.
    const chain = await readChain()
    return reply.send({
      ok: true,
      id: intake.id,
      jobId: String(intake.id),
      status: intake.status,
      deduplicated: !intake.created,
      commit: null,
      liveVersion: null,
      acceptingWork: constructorChainAcceptsWork(chain.state),
      workerCanStartNow: constructorWorkerCanStartNow(chain.state),
      constructor: {
        cine: constructorChainAcceptsWork(chain.state) ? 'constructor_pipeline' as const : 'unavailable' as const,
        state: chain.state,
        motiv: chain.reason,
        lastHeartbeat: chain.lastHeartbeat,
        legs: chain.legs,
      },
    })
  })

  // Evaluarea unei cerințe ÎNAINTE de trimitere. Întoarce poarta de calitate și
  // potrivirea pe capacitățile executorului local canonic. Doar citire.
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
    const observability = await constructorObservabilityForJobs(raw)
    const workCards = await constructorWorkCardsForJobs(raw, observability)
    if (!workCards) return reply.code(503).send({ error: 'constructor_work_cards_unreadable' })
    // `pct` și timeline-ul sunt proiectate din catalogul și evenimentele
    // persistate; endpointul nu deține procente sau praguri de etapă.
    const incidents = await getConstructorIncidentsForJobs(raw.map((job) => job.id))
    if (!incidents) return reply.code(503).send({ error: 'incident_register_unreadable' })
    const jobs = raw.map((j) => ({
      ...j,
      pct: observability.get(j.id)?.progress.percent ?? null,
      // P8 (owner, 15 aug: „trebuie sa fie foarte clar ce executa"): numele
      // rândului = FAPTA extrasă din ordin, nu ambalajul promptului.
      nume: numeleOrdinului(j.orderText),
      // 16 aug: și AUTORUL, pe față — „cine e acolo?" nu se mai întreabă.
      cerutDe: cineACerut(j.orderedBy),
      continuity: { ...constructorContinuity(j, incidents.get(j.id)), ...observability.get(j.id) },
      workCard: workCards.get(j.id) ?? null,
    }))
    const chain = await readChain()
    const available = constructorChainAcceptsWork(chain.state)
    return reply.send({
      jobs,
      acceptingWork: available,
      workerCanStartNow: constructorWorkerCanStartNow(chain.state),
      constructor: {
        cine: available ? 'constructor_pipeline' as const : 'unavailable' as const,
        state: chain.state,
        motiv: chain.reason,
        lastHeartbeat: chain.lastHeartbeat,
        legs: chain.legs,
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
  // review action; publisherul separat rămâne singura identitate care face merge
  // și persistă receiptul, iar browserul nu vede niciodată credentiala.
  app.get<{ Querystring: { jobId?: string } }>('/api/admin/constructor/release', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const requestedId = Number(req.query.jobId)
    let job
    try {
      if (Number.isSafeInteger(requestedId) && requestedId > 0) {
        job = await getBuildJobById(requestedId)
      } else {
        const jobs = await listBuildJobs(40)
        if (!jobs) return reply.code(503).send({ error: 'db_unreadable' })
        job = jobs.find((candidate) => candidate.status === 'running' && candidate.constructorStage === 'pr_opened' && candidate.prUrl)
          ?? jobs.find((candidate) => candidate.status === 'running' && candidate.prUrl)
          ?? jobs.find((candidate) => candidate.prUrl)
          ?? null
      }
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    return reply.send({ jobId: job?.id ?? null, ...(await readReleaseSnapshot(job?.prUrl ?? null)) })
  })

  app.post<{ Body: { jobId?: number; action?: 'approve'; prNumber?: number; headSha?: string } }>('/api/admin/constructor/release/action', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const jobId = Number(req.body?.jobId)
    const action = req.body?.action
    const prNumber = Number(req.body?.prNumber)
    const headSha = String(req.body?.headSha ?? '').toLowerCase()
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || action !== 'approve' || !Number.isSafeInteger(prNumber) || prNumber <= 0 || !SHA40.test(headSha)) return reply.code(400).send({ error: 'invalid_release_action' })
    let job
    try {
      job = await getBuildJobById(jobId)
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    if (!job) return reply.code(404).send({ error: 'job_not_found' })
    const result = await approveRelease(job.prUrl, prNumber, headSha)
    if (!result.ok) return reply.code(409).send(result)
    noteazaAudit(user.email, 'constructor-approve', 'build_jobs', String(jobId), job.constructorStage, 'approved')
    return reply.send({ ok: true, release: await readReleaseSnapshot(job.prUrl) })
  })

  // ── ȘTERGE / CURĂȚĂ / REIA din PANOU (Adrian, 3 aug: „aici nu apar butoane de
  // ștergere" + „scoate 30/31 dacă nu le poate face, ai funcțiile făcute") ─────
  // Funcțiile existau demult în db.ts (deleteBuildJob / deleteBuildJobsByScope /
  // retryBuildJob) și erau folosite DOAR de unealta `constructor_manage` a lui
  // Kelion din chat. Panoul n-avea nicio rută spre ele → niciun buton. Le expun
  // aici, admin-only ca restul panoului. Ștergerea nu atinge un ordin 'running'
  // decât la scope='all' — un ordin viu nu piere din greșeală.
  app.get<{ Querystring: { cursorUpdatedAt?: string; cursorId?: string } }>('/api/admin/constructor/arhiva', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const hasUpdatedAt = typeof req.query.cursorUpdatedAt === 'string'
    const hasId = typeof req.query.cursorId === 'string'
    if (hasUpdatedAt !== hasId) return reply.code(400).send({ error: 'invalid_archive_cursor' })
    const parsedUpdatedAt = hasUpdatedAt ? String(req.query.cursorUpdatedAt) : ''
    const parsedId = hasId ? Number(req.query.cursorId) : 0
    const cursor = hasUpdatedAt && hasId
      && Number.isSafeInteger(parsedId) && parsedId > 0
      && isArchivedBuildJobsCursorTimestamp(parsedUpdatedAt)
      ? { updatedAt: parsedUpdatedAt, id: parsedId }
      : undefined
    if (hasUpdatedAt && !cursor) return reply.code(400).send({ error: 'invalid_archive_cursor' })
    try {
      return reply.send(await listArchivedBuildJobs(40, cursor))
    } catch {
      return reply.code(503).send({ error: 'archive_unreadable' })
    }
  })

  app.post<{ Params: { id: string }; Body: { expectedStatus?: string; expectedUpdatedAt?: string } }>('/api/admin/constructor/:id/restaureaza', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    if (!exactKeys((req.body ?? {}) as Record<string, unknown>, ['expectedStatus', 'expectedUpdatedAt'])) return reply.code(400).send({ error: 'invalid_body' })
    const expected = mutationExpectation(req.body?.expectedStatus, req.body?.expectedUpdatedAt)
    if (!expected) return reply.code(400).send({ error: 'missing_or_invalid_precondition' })
    let result: Awaited<ReturnType<typeof restoreArchivedBuildJob>>
    try {
      result = await restoreArchivedBuildJob(id, expected)
    } catch {
      return reply.code(503).send({ error: 'archive_unreadable' })
    }
    if (!result.ok) {
      if (result.error === 'not_found') return reply.code(404).send({ error: 'job_not_found' })
      return reply.code(409).send({ error: result.error === 'stale_state' ? 'stale_job_state' : 'job_not_restorable' })
    }
    noteazaAudit(getSessionUser(req)?.email ?? 'admin', 'constructor-restore', 'build_jobs', String(id), 'archived', result.job.status)
    return reply.send({ ok: true, job: result.job })
  })

  app.delete<{ Params: { id: string }; Querystring: { expectedStatus?: string; expectedUpdatedAt?: string } }>('/api/admin/constructor/:id', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    const expected = mutationExpectation(req.query.expectedStatus, req.query.expectedUpdatedAt)
    if (!expected) return reply.code(400).send({ error: 'missing_or_invalid_precondition' })
    let result: Awaited<ReturnType<typeof deleteBuildJob>>
    try {
      result = await deleteBuildJob(id, expected)
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    if (result.ok) {
      noteazaAudit(getSessionUser(req)?.email ?? 'admin', 'constructor-delete', 'build_jobs', String(id), expected.status, 'deleted')
      return reply.send({ ok: true })
    }
    if (result.error === 'not_found') return reply.code(404).send({ error: 'job_not_found' })
    return reply.code(409).send({ error: result.error === 'stale_state' ? 'stale_job_state' : 'job_not_deletable' })
  })

  // Curățarea în grup este recuperabilă: arhivează numai snapshotul terminal
  // văzut de Admin. Ștergerea definitivă rămâne exclusiv acțiune individuală.
  app.post<{ Body: { scope?: string; jobs?: Array<{ id?: number; status?: string; updatedAt?: string }> } }>('/api/admin/constructor/curata', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    if (!exactKeys((req.body ?? {}) as Record<string, unknown>, ['scope', 'jobs'])) return reply.code(400).send({ error: 'invalid_body' })
    const scopeRaw = String(req.body?.scope ?? '')
    if (!['failed', 'done', 'failed_done', 'all'].includes(scopeRaw)) return reply.code(400).send({ error: 'invalid_scope' })
    const scope = scopeRaw as 'failed' | 'done' | 'failed_done' | 'all'
    if (!Array.isArray(req.body?.jobs) || req.body.jobs.length > 40) return reply.code(400).send({ error: 'invalid_snapshot' })
    const jobs = req.body.jobs.map((candidate) => {
      const id = Number(candidate?.id)
      const expected = mutationExpectation(candidate?.status, candidate?.updatedAt)
      return Number.isSafeInteger(id) && id > 0 && expected ? { id, ...expected } : null
    })
    if (jobs.some((candidate) => candidate === null)) return reply.code(400).send({ error: 'invalid_snapshot' })
    // AUDIT ADMIN (3 aug): eroarea de DB devenea „Curățat: 0 ordine șterse."
    // — zero fals. null = eșec → 500 („Nu s-a putut curăța." în panou);
    // 0 rămâne posibil doar ca număr real.
    let result: Awaited<ReturnType<typeof archiveBuildJobsByScope>>
    try {
      result = await archiveBuildJobsByScope(scope, jobs as NonNullable<(typeof jobs)[number]>[])
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    if (!result.ok) return reply.code(409).send({ error: 'stale_job_state' })
    noteazaAudit(user.email, 'constructor-archive-visible', 'build_jobs', jobs.map((job) => job!.id).join(','), 'visible-terminal-snapshot', `archived:${result.archived}`)
    return reply.send({ ok: true, arhivate: result.archived })
  })

  // ANULAREA unui ordin viu (auditul admin, 3 aug): cancelBuildJob exista în
  // db.ts din 3 aug, dar era legat DOAR de unealta constructor_manage din chat
  // — un ordin 'running' nu putea fi oprit din panou (✕ e ascuns pe running).
  // Aici e ruta pe care o cheamă butonul „oprește" de pe rândurile în curs.
  app.post<{ Params: { id: string }; Body: { expectedStatus?: string; expectedUpdatedAt?: string } }>('/api/admin/constructor/:id/anuleaza', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    if (!exactKeys((req.body ?? {}) as Record<string, unknown>, ['expectedStatus', 'expectedUpdatedAt'])) return reply.code(400).send({ error: 'invalid_body' })
    const expected = mutationExpectation(req.body?.expectedStatus, req.body?.expectedUpdatedAt)
    if (!expected) return reply.code(400).send({ error: 'missing_or_invalid_precondition' })
    let oprit: Awaited<ReturnType<typeof cancelBuildJob>>
    try {
      oprit = await cancelBuildJob(id, expected)
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    if (oprit.ok) {
      noteazaAudit(getSessionUser(req)?.email ?? 'admin', 'constructor-cancel', 'build_jobs', String(id), expected.status, 'cancelled')
      return reply.send({ ok: true })
    }
    if (oprit.error === 'not_found') return reply.code(404).send({ error: 'job_not_found' })
    return reply.code(409).send({ error: oprit.error === 'stale_state' ? 'stale_job_state' : 'past_cancellation_boundary' })
  })

  // Reia un ordin (îl repune în coadă, attempts=0), opțional cu textul reformulat.
  app.post<{ Params: { id: string }; Body: { order?: string; expectedStatus?: string; expectedUpdatedAt?: string } }>('/api/admin/constructor/:id/reia', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    if (!exactKeys((req.body ?? {}) as Record<string, unknown>, ['order', 'expectedStatus', 'expectedUpdatedAt'])) return reply.code(400).send({ error: 'invalid_body' })
    const expected = mutationExpectation(req.body?.expectedStatus, req.body?.expectedUpdatedAt)
    if (!expected) return reply.code(400).send({ error: 'missing_or_invalid_precondition' })
    const replacement = typeof req.body?.order === 'string' ? req.body.order.trim() : ''
    if (replacement) {
      const evaluation = evalueazaOrdin(replacement)
      if (!evaluation.trece) {
        return reply.code(400).send({ error: 'ordin_respins', motiv: evaluation.motiv })
      }
    }
    const planned = replacement ? await planificaOrdinConstructor(replacement) : undefined
    let retried: Awaited<ReturnType<typeof retryBuildJob>>
    try {
      retried = await retryBuildJob(id, planned, expected)
    } catch {
      return reply.code(503).send({ error: 'db_unreadable' })
    }
    if (!retried.ok) {
      return reply.code(409).send({
        error: retried.error === 'duplicate_active'
          ? 'ordin_activ_pe_acelasi_subiect'
          : retried.error === 'stale_state' ? 'stale_job_state' : 'nu_se_poate_relua',
        conflictJobId: retried.conflictJobId ? String(retried.conflictJobId) : undefined,
      })
    }
    const job = retried.job
    noteazaAudit(getSessionUser(req)?.email ?? 'admin', 'constructor-retry', 'build_jobs', String(id), 'terminal', 'queued')
    return reply.send({ ok: true, job, jobId: String(job.id), status: job.status, commit: job.commit, liveVersion: job.liveVersion })
  })

  // Contract fix, semnat, pentru workerul separat. Nu există un endpoint generic
  // de unelte/shell: workerul poate doar revendica un ordin și raporta etape.
  app.post<{ Body: { status?: string; detail?: string } }>('/api/internal/codex/status', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyCodexWorkerRequest(req), reply)) return
    if (!exactKeys(req.body, ['status', 'detail'])) return reply.code(400).send({ error: 'invalid_status' })
    const allowed: CodexWorkerState[] = ['offline', 'setup_required', 'ready', 'busy', 'degraded']
    const status = String(req.body?.status ?? '') as CodexWorkerState
    if (!allowed.includes(status)) return reply.code(400).send({ error: 'invalid_status' })
    try {
      await recordCodexWorkerStatus({
        status,
        detail: req.body.detail,
      })
    } catch {
      return reply.code(503).send({ error: 'heartbeat_not_persisted' })
    }
    return reply.send({ ok: true })
  })

  app.post<{ Body: Record<string, unknown> }>('/api/internal/codex/jobs/claim', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyCodexWorkerRequest(req), reply)) return
    if (!exactKeys(req.body, ['profile'])) return reply.code(400).send({ error: 'invalid_body' })
    const profile = req.body?.profile
    if (profile !== 'fast' && profile !== 'powerful') {
      return reply.code(400).send({ error: 'invalid_constructor_model_profile' })
    }
    let measuredProfile: 'fast' | 'powerful'
    try {
      const model = await readConstructorModelSnapshot()
      if (model.state !== 'ready' || (model.activeProfile !== 'fast' && model.activeProfile !== 'powerful')) {
        return reply.code(503).send({ error: 'constructor_model_not_ready' })
      }
      if (model.activeProfile !== profile) {
        return reply.code(409).send({ error: 'constructor_model_profile_mismatch' })
      }
      measuredProfile = model.activeProfile
    } catch {
      return reply.code(503).send({ error: 'constructor_model_control_unavailable' })
    }
    const taskId = newCodexTaskId()
    let claim: Awaited<ReturnType<typeof claimNextBuildJob>>
    try {
      // Persistăm exclusiv profilul activ măsurat de controller, niciodată
      // afirmația workerului luată ca autoritate.
      claim = await claimNextBuildJob(taskId, measuredProfile)
    } catch {
      return reply.code(503).send({ error: 'constructor_queue_unreadable' })
    }
    if (claim.state !== 'claimed') {
      return reply.send({ state: claim.state, job: null })
    }
    const job = claim.job
    const recoveryCodes = new Set(['stale_base', 'ci_failed', 'local_gate_failed', 'pr_closed'])
    const persistedFailureCode = job.log?.split('\n', 1)[0] ?? null
    const recoveryCode = persistedFailureCode && recoveryCodes.has(persistedFailureCode)
      ? persistedFailureCode
      : null
    return reply.send({
      state: 'claimed',
      job: {
        jobId: String(job.id),
        taskId,
        status: job.status,
        order: job.orderText,
        orderedBy: job.orderedBy,
        attempts: job.attempts,
        recoveryCode,
      },
    })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/codex/jobs/:id/event', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyCodexWorkerRequest(req), reply)) return
    const id = Number(req.params.id)
    const taskId = String(req.body?.taskId ?? '')
    const event = String(req.body?.event ?? '')
    if (!Number.isSafeInteger(id) || id <= 0 || !taskId.startsWith('codex-') || !UUID.test(taskId.slice(6))) return reply.code(400).send({ error: 'invalid_job' })
    const progress = typeof req.body?.progress === 'string' ? req.body.progress.trim().slice(0, 500) : undefined
    let payload: CodexBuildEvent
    if (event === 'accepted') payload = { event, progress }
    else if (event === 'progress' && progress) payload = { event, progress }
    else if (event === 'gates_passed' && req.body?.ci === 'local_gates') {
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
      let handoff
      try {
        handoff = await recordWorkerHandoff(id, taskId, { handoffId, baseCommit, patchSha256, gateReceiptSha256, progress })
      } catch {
        return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      }
      // A 409 here is a terminal answer only for this immutable handoff: the DB
      // transaction has proved that another task/stage is canonical. The worker
      // may quarantine that local receipt without poisoning every later claim.
      if (!handoff.ok) return reply.code(409).send({ error: 'stale_handoff', reason: handoff.reason })
      return reply.send({ ok: true, ...handoff.event })
    } else if (event === 'unresolved') {
      if (!exactKeys(req.body, ['taskId', 'event', 'reason', 'profile', 'progress'])) return reply.code(400).send({ error: 'invalid_body' })
      const profile = req.body?.profile
      const reason = req.body?.reason
      if (
        (reason !== 'no_changes' && reason !== 'test_failure' && reason !== 'quality_gate_failure')
        || (profile !== 'fast' && profile !== 'powerful')
      ) {
        return reply.code(400).send({ error: 'invalid_unresolved' })
      }
      payload = { event, reason, profile, progress }
    } else if (event === 'failed') {
      if (!exactKeys(req.body, ['taskId', 'event', 'code', 'profile', 'progress'])) return reply.code(400).send({ error: 'invalid_body' })
      const code = String(req.body?.code ?? '')
      const profile = req.body?.profile
      if (!isCodexWorkerFailureCode(code) || (profile !== 'fast' && profile !== 'powerful')) {
        return reply.code(400).send({ error: 'invalid_failure' })
      }
      payload = { event, code, profile, progress }
    } else return reply.code(400).send({ error: 'invalid_event' })
    let job: Awaited<ReturnType<typeof advanceCodexBuildJob>>
    try {
      job = await advanceCodexBuildJob(id, taskId, payload)
    } catch {
      return reply.code(503).send({ error: 'constructor_state_unreadable' })
    }
    if (!job) return reply.code(409).send({ error: 'invalid_transition' })
    return reply.send({ ok: true, jobId: String(job.id), status: job.status, stage: job.constructorStage, commit: job.commit, liveVersion: job.liveVersion })
  })

  // Publisherul este singura identitate care poate transforma un handoff cu
  // porți verzi într-un branch/PR și apoi într-un merge. Nu primește credentiale
  // OpenCode/Qwen sau VPS, iar rutele sale nu acceptă comenzi, căi ori ref-uri arbitrare.
  app.post<{ Body: { state?: unknown; detail?: unknown } }>('/api/internal/constructor-publisher/heartbeat', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyPublisherRequest(req), reply)) return
    if (!exactKeys(req.body, ['state', 'detail']) || req.body.state !== 'degraded'
      || typeof req.body.detail !== 'string' || req.body.detail.trim().length === 0 || req.body.detail.length > 240) {
      return reply.code(400).send({ error: 'invalid_body' })
    }
    return await serviceHeartbeat('publisher', 'degraded', req.body.detail)
      ? reply.send({ ok: true })
      : reply.code(503).send({ error: 'publisher_heartbeat_not_persisted' })
  })

  app.post<{ Body: Record<string, never> }>('/api/internal/constructor-publisher/jobs/claim', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyPublisherRequest(req), reply)) return
    if (Object.keys(req.body ?? {}).length !== 0) return reply.code(400).send({ error: 'invalid_body' })
    let job: Awaited<ReturnType<typeof claimPublisherJob>>
    try {
      job = await claimPublisherJob()
    } catch {
      return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
    }
    const heartbeatPersisted = await serviceHeartbeat('publisher', job ? 'busy' : 'ready', job ? 'Publisherul execută un handoff' : 'Publisherul a verificat coada')
    if (!heartbeatPersisted) return reply.code(503).send({ error: 'publisher_heartbeat_not_persisted' })
    return job ? reply.send({ job, heartbeatPersisted: true }) : reply.code(204).send()
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-publisher/jobs/:id/lease', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyPublisherRequest(req), reply)) return
    if (!exactKeys(req.body, ['taskId', 'leaseId'])) return reply.code(400).send({ error: 'invalid_body' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const renewed = await pipelineMutation(() => renewPublisherLease(identity.id, identity.taskId, identity.leaseId))
    if (!renewed.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
    if (!renewed.value) return reply.code(409).send({ error: 'lease_lost' })
    const heartbeatPersisted = await serviceHeartbeat('publisher', 'busy', 'Publisher lease activ')
    if (!heartbeatPersisted) return reply.code(503).send({ error: 'publisher_heartbeat_not_persisted' })
    return reply.send({ ok: true, heartbeatPersisted: true })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-publisher/jobs/:id/event', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyPublisherRequest(req), reply)) return
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
      const persisted = await pipelineMutation(() => recordPublisherPrOpened({ ...identity, branch, headCommit, prNumber, prUrl, receiptSha256, progress, jobId: identity.id }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const job = persisted.value
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
      const persisted = await pipelineMutation(() => recordPublisherMerged({ ...identity, jobId: identity.id, headCommit, prNumber, commit, receiptSha256, progress }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const job = persisted.value
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'failed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'code', 'branch', 'headCommit', 'prNumber', 'cleanupReceiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const code = String(req.body.code ?? '')
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) return reply.code(400).send({ error: 'invalid_failure' })
      const rebuild = ['stale_base', 'ci_failed', 'local_gate_failed', 'pr_closed'].includes(code)
      let retirement: PublisherRetirementProof | undefined
      if (rebuild) {
        const branch = req.body.branch == null ? null : String(req.body.branch)
        const headCommit = req.body.headCommit == null ? null : String(req.body.headCommit).toLowerCase()
        const prNumber = req.body.prNumber == null ? null : Number(req.body.prNumber)
        const cleanupReceiptSha256 = String(req.body.cleanupReceiptSha256 ?? '').toLowerCase()
        const expectedBranch = `codex/${identity.taskId.slice('codex-'.length)}`
        if (
          (branch !== null && branch !== expectedBranch)
          || (headCommit !== null && !SHA40.test(headCommit))
          || (prNumber !== null && (!Number.isSafeInteger(prNumber) || prNumber <= 0))
          || !SHA256.test(cleanupReceiptSha256)
        ) return reply.code(400).send({ error: 'invalid_retirement_receipt' })
        retirement = { branch, headCommit, prNumber, cleanupReceiptSha256 }
      }
      const persisted = await pipelineMutation(() => failPublisherLease(identity.id, identity.taskId, identity.leaseId, code, retirement))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const job = persisted.value
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    return reply.code(400).send({ error: 'invalid_event' })
  })

  // Releaserul revendică exclusiv commituri deja îmbinate. Are doar
  // credentiala de dispatch GitHub Actions; workflow-ul production environment
  // păstrează credentiala VPS și dovada blue-green.
  app.post<{ Body: { state?: unknown; detail?: unknown } }>('/api/internal/constructor-release/heartbeat', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyReleaseRequest(req), reply)) return
    if (!exactKeys(req.body, ['state', 'detail']) || req.body.state !== 'degraded'
      || typeof req.body.detail !== 'string' || req.body.detail.trim().length === 0 || req.body.detail.length > 240) {
      return reply.code(400).send({ error: 'invalid_body' })
    }
    return await serviceHeartbeat('release', 'degraded', req.body.detail)
      ? reply.send({ ok: true })
      : reply.code(503).send({ error: 'release_heartbeat_not_persisted' })
  })

  app.post<{ Body: Record<string, never> }>('/api/internal/constructor-release/jobs/claim', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyReleaseRequest(req), reply)) return
    if (Object.keys(req.body ?? {}).length !== 0) return reply.code(400).send({ error: 'invalid_body' })
    let job: Awaited<ReturnType<typeof claimReleaseJob>>
    try {
      job = await claimReleaseJob()
    } catch {
      return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
    }
    const heartbeatPersisted = await serviceHeartbeat('release', job ? 'busy' : 'ready', job ? 'Releaserul verifică un commit merged' : 'Releaserul a verificat coada')
    if (!heartbeatPersisted) return reply.code(503).send({ error: 'release_heartbeat_not_persisted' })
    return job ? reply.send({ job, heartbeatPersisted: true }) : reply.code(204).send()
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-release/jobs/:id/lease', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyReleaseRequest(req), reply)) return
    if (!exactKeys(req.body, ['taskId', 'leaseId'])) return reply.code(400).send({ error: 'invalid_body' })
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const renewed = await pipelineMutation(() => renewReleaseLease(identity.id, identity.taskId, identity.leaseId))
    if (!renewed.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
    if (!renewed.value) return reply.code(409).send({ error: 'lease_lost' })
    const heartbeatPersisted = await serviceHeartbeat('release', 'busy', 'Release lease activ')
    if (!heartbeatPersisted) return reply.code(503).send({ error: 'release_heartbeat_not_persisted' })
    return reply.send({ ok: true, heartbeatPersisted: true })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/internal/constructor-release/jobs/:id/event', async (req, reply) => {
    if (!await internalConstructorAuthorized(verifyReleaseRequest(req), reply)) return
    const identity = internalJobIdentity(req.params.id, req.body)
    if (!identity) return reply.code(400).send({ error: 'invalid_job' })
    const event = String(req.body.event ?? '')
    if (event === 'target_selected') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'targetCommit', 'receiptSha256', 'previousTargetCommit', 'previousReceiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      const previousTargetCommit = req.body.previousTargetCommit == null ? null : String(req.body.previousTargetCommit).toLowerCase()
      const previousReceiptSha256 = req.body.previousReceiptSha256 == null ? null : String(req.body.previousReceiptSha256).toLowerCase()
      if (
        !SHA40.test(targetCommit)
        || !SHA256.test(receiptSha256)
        || (previousTargetCommit !== null && !SHA40.test(previousTargetCommit))
        || (previousReceiptSha256 !== null && !SHA256.test(previousReceiptSha256))
        || ((previousTargetCommit === null) !== (previousReceiptSha256 === null))
      ) return reply.code(400).send({ error: 'invalid_release_target' })
      const persisted = await pipelineMutation(() => recordReleaseTargetSelected({ ...identity, jobId: identity.id, targetCommit, receiptSha256, previousTargetCommit, previousReceiptSha256 }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const ok = persisted.value
      return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'candidate_verified') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'targetCommit', 'ciRunId', 'buildRunId', 'artifactId', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const ciRunId = Number(req.body.ciRunId)
      const buildRunId = Number(req.body.buildRunId)
      const artifactId = Number(req.body.artifactId)
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (
        !SHA40.test(targetCommit)
        || ![ciRunId, buildRunId, artifactId].every((value) => Number.isSafeInteger(value) && value > 0)
        || !SHA256.test(receiptSha256)
      ) return reply.code(400).send({ error: 'invalid_candidate_receipt' })
      const persisted = await pipelineMutation(() => recordReleaseCandidateVerified({ ...identity, jobId: identity.id, targetCommit, ciRunId, buildRunId, artifactId, receiptSha256 }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const ok = persisted.value
      return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'legacy_dispatch_absence_resolved') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'mergedCommit', 'requestId', 'ambiguityStartedAt', 'currentMaster', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const mergedCommit = String(req.body.mergedCommit ?? '').toLowerCase()
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const ambiguityStartedAt = String(req.body.ambiguityStartedAt ?? '')
      const currentMaster = String(req.body.currentMaster ?? '').toLowerCase()
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      const parsedAmbiguityStartedAt = Date.parse(ambiguityStartedAt)
      if (
        !SHA40.test(mergedCommit)
        || !UUID.test(requestId)
        || !Number.isFinite(parsedAmbiguityStartedAt)
        || new Date(parsedAmbiguityStartedAt).toISOString() !== ambiguityStartedAt
        || !SHA40.test(currentMaster)
        || !SHA256.test(receiptSha256)
      ) return reply.code(400).send({ error: 'invalid_legacy_dispatch_absence_proof' })
      const persisted = await pipelineMutation(() => resolveLegacyReleaseAmbiguity({
        ...identity,
        jobId: identity.id,
        mergedCommit,
        requestId,
        ambiguityStartedAt,
        currentMaster,
        receiptSha256,
      }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      return persisted.value ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'legacy_dispatch_reconciled') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'targetCommit', 'targetReceiptSha256', 'requestId', 'workflowRunId', 'ciRunId', 'buildRunId', 'artifactId', 'candidateReceiptSha256', 'dispatchReceiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const targetReceiptSha256 = String(req.body.targetReceiptSha256 ?? '').toLowerCase()
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = Number(req.body.workflowRunId)
      const ciRunId = Number(req.body.ciRunId)
      const buildRunId = Number(req.body.buildRunId)
      const artifactId = Number(req.body.artifactId)
      const candidateReceiptSha256 = String(req.body.candidateReceiptSha256 ?? '').toLowerCase()
      const dispatchReceiptSha256 = String(req.body.dispatchReceiptSha256 ?? '').toLowerCase()
      if (
        !SHA40.test(targetCommit)
        || !UUID.test(requestId)
        || ![workflowRunId, ciRunId, buildRunId, artifactId].every((value) => Number.isSafeInteger(value) && value > 0)
        || ![targetReceiptSha256, candidateReceiptSha256, dispatchReceiptSha256].every((value) => SHA256.test(value))
      ) return reply.code(400).send({ error: 'invalid_legacy_dispatch_proof' })
      const persisted = await pipelineMutation(() => reconcileLegacyReleaseDispatch({
        ...identity,
        jobId: identity.id,
        targetCommit,
        targetReceiptSha256,
        requestId,
        workflowRunId,
        ciRunId,
        buildRunId,
        artifactId,
        candidateReceiptSha256,
        dispatchReceiptSha256,
      }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      return persisted.value ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'dispatch_intended') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'targetCommit', 'requestId', 'ciRunId', 'buildRunId', 'artifactId', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const ciRunId = Number(req.body.ciRunId)
      const buildRunId = Number(req.body.buildRunId)
      const artifactId = Number(req.body.artifactId)
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (
        !SHA40.test(targetCommit)
        || !UUID.test(requestId)
        || ![ciRunId, buildRunId, artifactId].every((value) => Number.isSafeInteger(value) && value > 0)
        || !SHA256.test(receiptSha256)
      ) return reply.code(400).send({ error: 'invalid_dispatch_intent' })
      const persisted = await pipelineMutation(() => recordReleaseDispatchIntended({
        ...identity,
        jobId: identity.id,
        targetCommit,
        requestId,
        ciRunId,
        buildRunId,
        artifactId,
        receiptSha256,
      }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      return persisted.value ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'dispatched') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'requestId', 'workflowRunId', 'ciRunId', 'buildRunId', 'artifactId', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = Number(req.body.workflowRunId)
      const ciRunId = Number(req.body.ciRunId)
      const buildRunId = Number(req.body.buildRunId)
      const artifactId = Number(req.body.artifactId)
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (!UUID.test(requestId) || ![workflowRunId, ciRunId, buildRunId, artifactId].every((value) => Number.isSafeInteger(value) && value > 0) || !SHA256.test(receiptSha256)) return reply.code(400).send({ error: 'invalid_dispatch_receipt' })
      const persisted = await pipelineMutation(() => recordReleaseDispatched({ ...identity, jobId: identity.id, requestId, workflowRunId, ciRunId, buildRunId, artifactId, receiptSha256 }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const ok = persisted.value
      return ok ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'dispatch_retired') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'targetCommit', 'replacementTargetCommit', 'requestId', 'workflowRunId', 'conclusion', 'receiptSha256'])) return reply.code(400).send({ error: 'invalid_body' })
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const replacementTargetCommit = String(req.body.replacementTargetCommit ?? '').toLowerCase()
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = req.body.workflowRunId == null ? null : Number(req.body.workflowRunId)
      const conclusion = String(req.body.conclusion ?? '') as ReleaseRetirementConclusion
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      if (
        !SHA40.test(targetCommit)
        || !SHA40.test(replacementTargetCommit)
        || replacementTargetCommit === targetCommit
        || !UUID.test(requestId)
        || !RELEASE_RETIREMENT_CONCLUSIONS.includes(conclusion)
        || (conclusion === 'intent_not_materialized'
          ? workflowRunId !== null
          : !Number.isSafeInteger(workflowRunId) || Number(workflowRunId) <= 0)
        || !SHA256.test(receiptSha256)
      ) return reply.code(400).send({ error: 'invalid_dispatch_retirement' })
      const persisted = await pipelineMutation(() => retireReleaseDispatch({
        ...identity,
        jobId: identity.id,
        targetCommit,
        replacementTargetCommit,
        requestId,
        workflowRunId,
        conclusion,
        receiptSha256,
      }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      return persisted.value ? reply.send({ ok: true }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'deployed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'requestId', 'workflowRunId', 'commit', 'targetCommit', 'liveVersion', 'receiptSha256', 'progress'])) return reply.code(400).send({ error: 'invalid_body' })
      const requestId = String(req.body.requestId ?? '').toLowerCase()
      const workflowRunId = Number(req.body.workflowRunId)
      const commit = String(req.body.commit ?? '').toLowerCase()
      const targetCommit = String(req.body.targetCommit ?? '').toLowerCase()
      const liveVersion = String(req.body.liveVersion ?? '').trim()
      const receiptSha256 = String(req.body.receiptSha256 ?? '').toLowerCase()
      const progress = typeof req.body.progress === 'string' ? req.body.progress.trim().slice(0, 500) : undefined
      if (!UUID.test(requestId) || !Number.isSafeInteger(workflowRunId) || workflowRunId <= 0 || !SHA40.test(commit) || !SHA40.test(targetCommit) || !SHA40.test(liveVersion) || liveVersion !== targetCommit || !SHA256.test(receiptSha256)) return reply.code(400).send({ error: 'invalid_deploy_receipt' })
      const persisted = await pipelineMutation(() => recordReleaseDeployed({ ...identity, jobId: identity.id, requestId, workflowRunId, commit, targetCommit, liveVersion, receiptSha256, progress }))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const job = persisted.value
      return job ? reply.send({ ok: true, ...job }) : reply.code(409).send({ error: 'invalid_transition' })
    }
    if (event === 'failed') {
      if (!exactKeys(req.body, ['taskId', 'leaseId', 'event', 'code'])) return reply.code(400).send({ error: 'invalid_body' })
      const code = String(req.body.code ?? '')
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) return reply.code(400).send({ error: 'invalid_failure' })
      const persisted = await pipelineMutation(() => failReleaseLease(identity.id, identity.taskId, identity.leaseId, code))
      if (!persisted.readable) return reply.code(503).send({ error: 'constructor_pipeline_unreadable' })
      const ok = persisted.value
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
    if (!jobs) return reply.code(503).send({ error: 'db_unreadable' })
    const observability = await constructorObservabilityForJobs(jobs)
    const workCards = await constructorWorkCardsForJobs(jobs, observability)
    if (!workCards) return reply.code(503).send({ error: 'constructor_work_cards_unreadable' })
    const incidents = await getConstructorIncidentsForJobs(jobs.map((job) => job.id))
    if (!incidents) return reply.code(503).send({ error: 'incident_register_unreadable' })
    return reply.send({
      // P8: `order` devine FAPTA (numeleOrdinului), nu primele litere ale
      // promptului — monitorul arată „ce execută", cum a cerut ownerul.
      // 16 aug 05:47 (ownerul, pe #330: „aici nu esti tu" / „cine e acolo?"):
      // cardul spune de-acum CINE a cerut ordinul — omul, sau o buclă automată
      // pe nume. Un ordin fără autor vizibil arată ca o fantomă.
      jobs: jobs.map((j) => ({ id: j.id, jobId: String(j.id), status: j.status, stage: j.constructorStage, order: numeleOrdinului(j.orderText), cerutDe: cineACerut(j.orderedBy), progress: j.progress, pct: observability.get(j.id)?.progress.percent ?? null, ci: j.ci, prUrl: j.prUrl, commit: j.commit, liveVersion: j.liveVersion, attempts: j.attempts, updatedAt: j.updatedAt, continuity: { ...constructorContinuity(j, incidents.get(j.id)), ...observability.get(j.id) }, workCard: workCards.get(j.id) ?? null })),
    })
  })
}
