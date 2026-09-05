import { constructorMonitorThresholds, classifyConstructorMonitor, validateConstructorHostSnapshot } from './constructorMonitorPolicy.js'
import { readConstructorHostSnapshot } from './constructorHostSnapshot.js'
import { getConstructorWorkerStatus } from './constructorWorker.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'
import * as store from './constructorMonitorStore.js'
import { conexiuneDb } from '../db.js'
import { readExternalRemediations } from './constructorExternalRemediation.js'
import type { ExternalRemediationView } from '../shared/constructorExternalRemediation.js'
import type { ConstructorMonitorSnapshot } from '../shared/constructorMonitor.js'
import type { ConstructorHostSnapshot, ConstructorMonitorThresholds } from '../shared/constructorMonitor.js'
interface Dependencies {
  active: () => boolean
  now: () => number
  host: () => Promise<ConstructorHostSnapshot>
  heartbeat: () => Promise<string | null>
  store: Pick<typeof store,'acquireMonitorLease'|'readMonitorJobs'|'finishMonitorCheck'>
  thresholds: ConstructorMonitorThresholds
}
export function createConstructorMonitor(deps: Dependencies): { tick: () => Promise<void> } {
  let running: Promise<void> | null=null
  return { tick() {
    if (!deps.active()) return Promise.resolve()
    if (running) return running
    running=(async () => {
      const lease=await deps.store.acquireMonitorLease()
      if (!lease) return
      try {
        const host=validateConstructorHostSnapshot(await deps.host(),deps.now(),deps.thresholds.hostMaxAgeMs)
        const jobs=await deps.store.readMonitorJobs(await deps.heartbeat())
        const evidence=jobs.map((job) => classifyConstructorMonitor(job,host,deps.now(),deps.thresholds))
        await deps.store.finishMonitorCheck(lease,evidence)
      } catch {
        // Failure is durable and sanitized; never replace last success with now.
        await deps.store.finishMonitorCheck(lease,null)
      }
    })().finally(() => { running=null })
    return running
  } }
}
export const CONSTRUCTOR_MONITOR_LIMITS=constructorMonitorThresholds()
const monitor=createConstructorMonitor({ active:releaseSideEffectsEnabled,now:Date.now,host:readConstructorHostSnapshot,
  heartbeat:async () => {
    const state=await getConstructorWorkerStatus()
    if (state.worker.state === 'unknown') throw new Error('constructor_heartbeat_unreadable')
    return state.worker.lastHeartbeat
  },store,thresholds:CONSTRUCTOR_MONITOR_LIMITS })
export const tickConstructorMonitor=monitor.tick
export async function readConstructorMonitor(): Promise<ConstructorMonitorSnapshot & { servedAt:string;externalRemediations:ExternalRemediationView[] }> {
  const sql=await conexiuneDb()
  try {
    await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const now=Date.now()
    const snapshot=await store.constructorMonitorSnapshot(CONSTRUCTOR_MONITOR_LIMITS,now,sql)
    const externalRemediations=await readExternalRemediations(now,sql)
    await sql.query('COMMIT')
    return {...snapshot,servedAt:new Date(now).toISOString(),externalRemediations}
  } catch(error) { await sql.query('ROLLBACK').catch(()=>undefined);throw error }
  finally { sql.release() }
}
