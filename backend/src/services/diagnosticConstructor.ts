import { listBuildJobs } from '../db.js'
import { getCodexWorkerStatus } from './codexWorker.js'

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
    inCoada: number
    inLucru: number
    esuate: number
    oldestQueuedSec: number | null
    runningSec: number | null
  }
}

/** Diagnostic factual: heartbeatul workerului separat + starea cozii. */
export async function diagnosticConstructorViu(now: number): Promise<DiagnosticConstructor | { error: string }> {
  const jobs = await listBuildJobs(40)
  if (!jobs) return { error: 'coada_necitibila' }
  const worker = await getCodexWorkerStatus(now)
  const queued = jobs.filter((j) => j.status === 'queued')
  const running = jobs.filter((j) => j.status === 'running')
  const age = (iso: string): number => Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  const oldestQueuedSec = queued.length ? Math.max(...queued.map((j) => age(j.updatedAt))) : null
  const runningSec = running.length ? Math.max(...running.map((j) => age(j.updatedAt))) : null
  const probleme: ProblemaConstructor[] = []
  const workerReady = worker.worker.state === 'ready'
  if (!workerReady) {
    probleme.push({
      cod: 'codex_worker_offline',
      severitate: 'critic',
      ce: 'Workerul Codex separat nu are un heartbeat recent de stare ready; comenzile rămân în coadă.',
      recomandare: 'Rulează autentificarea oficială `codex login` numai în worker și verifică serviciul separat; procesul web nu primește credentialele.',
    })
  }
  if (workerReady && !running.length && queued.length && (oldestQueuedSec ?? 0) > 10 * 60) {
    probleme.push({
      cod: 'codex_queue_stalled',
      severitate: 'critic',
      ce: `${queued.length} ordin(e) așteaptă de peste ${Math.round((oldestQueuedSec ?? 0) / 60)} minute fără unul în lucru.`,
      recomandare: 'Verifică jurnalul workerului separat și semnarea HMAC a cererii de claim.',
    })
  }
  if (running.length && (runningSec ?? 0) > 2 * 3600) {
    probleme.push({
      cod: 'codex_job_long_running',
      severitate: 'atentie',
      ce: `Cel mai vechi ordin rulează de peste ${Math.round((runningSec ?? 0) / 3600)} ore.`,
      recomandare: 'Verifică taskul Codex și etapa raportată; anulează numai dacă workerul confirmă oprirea.',
    })
  }
  const critice = probleme.filter((p) => p.severitate === 'critic')
  return {
    sanatos: critice.length === 0,
    verdict: critice.length ? `Constructorul nu poate încheia lanțul: ${critice[0].ce}` : 'Constructorul Codex separat este conectat; coada nu are blocaje critice măsurate.',
    probleme,
    masuratori: {
      workerConectat: workerReady,
      workerStatus: worker.status ?? worker.worker.state,
      inCoada: queued.length,
      inLucru: running.length,
      esuate: jobs.filter((j) => j.status === 'failed').length,
      oldestQueuedSec,
      runningSec,
    },
  }
}
