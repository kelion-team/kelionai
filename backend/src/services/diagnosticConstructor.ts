import { dbEnabled, getPool } from '../db.js'
import { getConstructorChainStatus } from './constructorChainStatus.js'

export interface ProblemaConstructor {
  cod: string
  severitate: 'critic' | 'atentie'
  ce: string
  recomandare: string
}

export interface DiagnosticConstructor {
  sanatos: boolean
  verdict: string
  probleme: ProblemaConstructor[]
  masuratori: {
    workerConectat: boolean
    workerStatus: string
    publisherConectat: boolean
    releaseConectat: boolean
    inCoada: number
    inLucru: number
    esuate: number
    oldestQueuedSec: number | null
    runningSec: number | null
    inBackoff: number
  }
}

/** Diagnostic factual al întregului lanț, nu doar al primului worker. */
export async function diagnosticConstructorViu(now: number): Promise<DiagnosticConstructor | { error: string }> {
  if (!dbEnabled()) return { error: 'coada_necitibila' }
  let metrics: {
    queued: number
    running: number
    failed: number
    oldestQueuedAt: string | null
    oldestRunningAt: string | null
  }
  let jobs: Array<{
    id: number
    status: string
    constructorStage: string
    updatedAt: string
    incidentState: string | null
    incidentNextAction: string | null
    retryNotBefore: string | null
    publisherRetryNotBefore: string | null
    publisherLeaseUntil: string | null
    releaseRetryNotBefore: string | null
    releaseLeaseUntil: string | null
  }>
  try {
    const [aggregate, active] = await Promise.all([
      getPool().query<{
        queued: string | number
        running: string | number
        failed: string | number
        oldest_queued_at: Date | null
        oldest_running_at: Date | null
      }>(
        `SELECT
           count(*) FILTER (WHERE status='queued' AND arhivat=false) AS queued,
           count(*) FILTER (WHERE status='running' AND arhivat=false) AS running,
           count(*) FILTER (WHERE status='failed' AND arhivat=false) AS failed,
           min(updated_at) FILTER (WHERE status='queued' AND arhivat=false) AS oldest_queued_at,
           min(updated_at) FILTER (WHERE status='running' AND arhivat=false) AS oldest_running_at
         FROM build_jobs`,
      ),
      getPool().query<{
        id: string | number
        status: string
        constructor_stage: string
        updated_at: Date
        incident_state: string | null
        next_action: string | null
        retry_not_before: Date | null
        publisher_retry_not_before: Date | null
        publisher_lease_until: Date | null
        release_retry_not_before: Date | null
        release_lease_until: Date | null
      }>(
        `SELECT b.id, b.status, b.constructor_stage, b.updated_at,
                b.retry_not_before,
                p.publisher_retry_not_before, p.publisher_lease_until,
                p.release_retry_not_before, p.release_lease_until,
                incident.state AS incident_state, incident.next_action
           FROM build_jobs b
           LEFT JOIN constructor_pipeline p ON p.job_id=b.id
           LEFT JOIN LATERAL (
             SELECT state, next_action FROM constructor_incidents
              WHERE job_id=b.id ORDER BY updated_at DESC, id DESC LIMIT 1
           ) incident ON true
          WHERE b.arhivat=false AND b.status IN ('queued','running')`,
      ),
    ])
    const row = aggregate.rows[0]
    metrics = {
      queued: Number(row?.queued ?? 0),
      running: Number(row?.running ?? 0),
      failed: Number(row?.failed ?? 0),
      oldestQueuedAt: row?.oldest_queued_at?.toISOString() ?? null,
      oldestRunningAt: row?.oldest_running_at?.toISOString() ?? null,
    }
    jobs = active.rows.map((job) => ({
      id: Number(job.id),
      status: job.status,
      constructorStage: job.constructor_stage,
      updatedAt: job.updated_at.toISOString(),
      incidentState: job.incident_state,
      incidentNextAction: job.next_action,
      retryNotBefore: job.retry_not_before?.toISOString() ?? null,
      publisherRetryNotBefore: job.publisher_retry_not_before?.toISOString() ?? null,
      publisherLeaseUntil: job.publisher_lease_until?.toISOString() ?? null,
      releaseRetryNotBefore: job.release_retry_not_before?.toISOString() ?? null,
      releaseLeaseUntil: job.release_lease_until?.toISOString() ?? null,
    }))
  } catch {
    return { error: 'coada_necitibila' }
  }
  const chain = await getConstructorChainStatus(now)
  const queued = jobs.filter((j) => j.status === 'queued')
  const running = jobs.filter((j) => j.status === 'running')
  const age = (iso: string): number => Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  const future = (iso: string | null): boolean => Boolean(iso && Date.parse(iso) > now)
  const activeLease = (iso: string | null): boolean => Boolean(iso && Date.parse(iso) > now)
  const queuedEligible = queued.filter((job) => !future(job.retryNotBefore) && job.incidentState !== 'blocked')
  const publisherBackoff = running.filter((job) =>
    ['gates_passed', 'pr_opened'].includes(job.constructorStage) && future(job.publisherRetryNotBefore),
  )
  const releaseBackoff = running.filter((job) =>
    ['merged', 'release_dispatched'].includes(job.constructorStage) && future(job.releaseRetryNotBefore),
  )
  const scheduledBackoff = [
    ...queued.filter((job) => future(job.retryNotBefore)).map((job) => ({ id: job.id, until: job.retryNotBefore! })),
    ...publisherBackoff.map((job) => ({ id: job.id, until: job.publisherRetryNotBefore! })),
    ...releaseBackoff.map((job) => ({ id: job.id, until: job.releaseRetryNotBefore! })),
  ]
  const oldestQueuedSec = metrics.oldestQueuedAt ? age(metrics.oldestQueuedAt) : null
  const runningSec = metrics.oldestRunningAt ? age(metrics.oldestRunningAt) : null
  const probleme: ProblemaConstructor[] = []
  const legReady = (state: string): boolean => state === 'ready' || state === 'busy'
  const workerReady = legReady(chain.legs.worker.state)
  const publisherReady = legReady(chain.legs.publisher.state)
  const releaseReady = legReady(chain.legs.release.state)
  if (!workerReady) {
    probleme.push({
      cod: 'codex_worker_offline',
      severitate: 'critic',
      ce: 'Workerul Constructor OpenCode + Qwen local (llama.cpp) nu are un heartbeat recent de stare ready; ordinele rămân în build_jobs.',
      recomandare: 'Verifică preflightul OpenCode 1.18.25, modelul Qwen local din endpointul loopback llama.cpp și autentificarea HMAC a cozii build_jobs.',
    })
  }
  if (!publisherReady) {
    probleme.push({
      cod: 'constructor_publisher_offline',
      severitate: 'critic',
      ce: `Publisherul separat nu este disponibil: ${chain.legs.publisher.state}.`,
      recomandare: 'Verifică activarea, secretul HMAC și timerul publisherului; un handoff local nu este publicare.',
    })
  }
  if (!releaseReady) {
    probleme.push({
      cod: 'constructor_release_offline',
      severitate: 'critic',
      ce: `Serviciul separat de release nu este disponibil: ${chain.legs.release.state}.`,
      recomandare: 'Verifică activarea, secretul HMAC și timerul release; un merge nu este dovadă live.',
    })
  }
  if (metrics.failed > 0) {
    probleme.push({
      cod: 'constructor_failed_jobs',
      severitate: 'critic',
      ce: `${metrics.failed} ordin(e) nearhivate sunt în stare failed și cer o decizie explicită.`,
      recomandare: 'Deschide ordinul eșuat, verifică incidentul și folosește reluarea Admin numai dacă nu există un ledger de publicare/release.',
    })
  }
  const blocked = jobs.filter((job) => job.incidentState === 'blocked')
  if (blocked.length) {
    probleme.push({
      cod: 'constructor_external_blocked',
      severitate: 'critic',
      ce: `${blocked.length} ordin(e) așteaptă o autoritate externă verificată.`,
      recomandare: blocked.map((job) => job.incidentNextAction).find(Boolean)
        ?? 'Execută acțiunea externă exactă din incident și verifică reluarea automată.',
    })
  }
  if (scheduledBackoff.length) {
    const earliest = scheduledBackoff
      .map((item) => item.until)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
    probleme.push({
      cod: 'constructor_backoff_scheduled',
      severitate: 'atentie',
      ce: `${scheduledBackoff.length} ordin(e) au o reluare automată persistată, cea mai apropiată la ${earliest}.`,
      recomandare: 'Nu porni manual un executor paralel; verifică reluarea după expirarea deadline-ului canonic.',
    })
  }
  const oldestEligibleQueuedSec = queuedEligible.length
    ? Math.max(...queuedEligible.map((job) => age(job.updatedAt)))
    : null
  if (workerReady && metrics.running === 0 && queuedEligible.length > 0 && (oldestEligibleQueuedSec ?? 0) > 10 * 60) {
    probleme.push({
      cod: 'codex_queue_stalled',
      severitate: 'critic',
      ce: `${queuedEligible.length} ordin(e) eligibile așteaptă de peste ${Math.round((oldestEligibleQueuedSec ?? 0) / 60)} minute fără unul în lucru.`,
      recomandare: 'Verifică jurnalul workerului separat și semnarea HMAC a cererii de claim.',
    })
  }
  if (running.length && (runningSec ?? 0) > 2 * 3600) {
    probleme.push({
      cod: 'codex_job_long_running',
      severitate: 'atentie',
      ce: `Cel mai vechi ordin rulează de peste ${Math.round((runningSec ?? 0) / 3600)} ore.`,
      recomandare: 'Verifică worktree-ul executorului OpenCode + Qwen local (llama.cpp) și etapa persistată; anulează numai dacă workerul confirmă oprirea.',
    })
  }
  const stalledPublisher = running.find((job) =>
    ['gates_passed', 'pr_opened'].includes(job.constructorStage)
    && !activeLease(job.publisherLeaseUntil)
    && !future(job.publisherRetryNotBefore)
    && job.incidentState !== 'blocked'
    && age(job.updatedAt) > (job.constructorStage === 'gates_passed' ? 15 * 60 : 75 * 60),
  )
  if (stalledPublisher) {
    probleme.push({
      cod: 'constructor_publisher_stage_stalled',
      severitate: 'critic',
      ce: `Ordinul #${stalledPublisher.id} stă la ${stalledPublisher.constructorStage} fără lease publisher activ.`,
      recomandare: 'Verifică retry_not_before, incidentul și ultimul heartbeat publisher; nu declara lanțul sănătos până la o tranziție persistată.',
    })
  }
  const stalledRelease = running.find((job) =>
    ['merged', 'release_dispatched'].includes(job.constructorStage)
    && !activeLease(job.releaseLeaseUntil)
    && !future(job.releaseRetryNotBefore)
    && job.incidentState !== 'blocked'
    && age(job.updatedAt) > (job.constructorStage === 'merged' ? 30 * 60 : 8 * 3600),
  )
  if (stalledRelease) {
    probleme.push({
      cod: 'constructor_release_stage_stalled',
      severitate: 'critic',
      ce: `Ordinul #${stalledRelease.id} stă la ${stalledRelease.constructorStage} fără lease release activ.`,
      recomandare: 'Verifică backoff-ul, run-ul GitHub și dovada live; păstrează checkpointul merged.',
    })
  }
  const critice = probleme.filter((p) => p.severitate === 'critic')
  return {
    sanatos: critice.length === 0,
    verdict: critice.length ? `Constructorul nu poate încheia lanțul: ${critice[0].ce}` : 'Workerul, publisherul și releaserul sunt conectate; nu există blocaje critice măsurate.',
    probleme,
    masuratori: {
      workerConectat: workerReady,
      workerStatus: chain.legs.worker.detail ?? chain.legs.worker.state,
      publisherConectat: publisherReady,
      releaseConectat: releaseReady,
      inCoada: metrics.queued,
      inLucru: metrics.running,
      esuate: metrics.failed,
      oldestQueuedSec,
      runningSec,
      inBackoff: scheduledBackoff.length,
    },
  }
}
