import { config } from '../config.js'
import type { DoctorCode, DoctorEvidence } from '../shared/doctor.js'
import { getConstructorChainStatus, constructorChainAcceptsWork } from './constructorChainStatus.js'
import { evalueazaOrdin } from './evalOrdinConstructor.js'
import { planificaOrdinConstructor } from './constructorWorker.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'
import { classifyDoctorResponse, doctorRepairOrder, doctorReportedCode, DOCTOR_PROBES } from './doctorPolicy.js'
import * as store from './doctorStore.js'
import { doctorLocalReleaseSha } from './doctorRuntimeCapability.js'

const HTTP_TIMEOUT_MS = 4_000 // Bounded read-only probe; a timeout never proves a code defect.
const HTTP_MAX_BYTES = 65_536 // Never retain an unbounded or personal response body.
const PUBLIC_CODES = ['public_health', 'agent_registry', 'release_version'] as const
const SHA40 = /^[0-9a-f]{40}$/

/** Only fixed paths on the configured public origin; no redirects, credentials,
 * model calls, cookies, private headers or caller-selected URLs. */
async function publicJson(path: string): Promise<{ status: number; body: unknown }> {
  const origin = new URL(config.publicOrigin)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && (config.isProd || origin.protocol !== 'http:'))) throw new Error('doctor_origin_invalid')
  const response = await fetch(new URL(path, origin), { method:'GET',redirect:'error',credentials:'omit',
    headers:{ accept:'application/json','cache-control':'no-cache' },signal:AbortSignal.timeout(HTTP_TIMEOUT_MS) })
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('doctor_response_not_json')
  }
  if (!response.body) return { status:response.status,body:null }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > HTTP_MAX_BYTES) throw new Error('doctor_probe_too_large')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  try { return { status:response.status,body:JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } }
  catch { return { status:response.status,body:null } }
}

async function liveRelease(): Promise<string | null> {
  try {
    const response = await publicJson('/api/release-proof')
    const body = response.body as Record<string, unknown> | null
    return response.status === 200 && body?.ready === true && body.candidate === false && body.sideEffectsActive === true
      && typeof body.activeCommit === 'string' && SHA40.test(body.activeCommit) ? body.activeCommit : null
  } catch { return null }
}

async function measure(code: DoctorCode, releaseSha: string): Promise<DoctorEvidence> {
  const path = DOCTOR_PROBES[code].path
  const base: DoctorEvidence = { code,checkedAt:new Date().toISOString(),releaseSha,httpStatus:null,result:'unverified',reason:'explicit_live_probe_required' }
  if (!path) return base
  try {
    const response = await publicJson(path)
    return classifyDoctorResponse(code,response.status,response.body,releaseSha,Date.now())
  } catch { return { ...base,result:'blocked',reason:'probe_transport_unavailable' } }
}

interface DoctorDependencies {
  active: () => boolean
  localRelease: () => string | null
  liveRelease: () => Promise<string | null>
  measure: (code: DoctorCode, releaseSha: string) => Promise<DoctorEvidence>
  chain: typeof getConstructorChainStatus
  store: Pick<typeof store,'acquireDoctorLease'|'releaseDoctorLease'|'recordDoctorObservation'|'queueDoctorRepair'|'doctorPendingJobs'|'updateDoctorJob'>
}

/** Serial locally and fenced durably across blue/green processes. A new
 * instance/restart shares the same incident and job; failures never re-arm it. */
export function createDoctor(deps: DoctorDependencies): { tick: (requested?: DoctorCode) => Promise<void> } {
  let running: Promise<void> | null = null
  return {
    tick(requested) {
      if (!deps.active()) return Promise.resolve()
      if (running) return running
      const run = async (): Promise<void> => {
        const lease = await deps.store.acquireDoctorLease()
        if (!lease) return
        let failed = true
        let checkedReleaseSha: string | null = null
        try {
          const releaseSha = await deps.liveRelease()
          // An unverified live release cannot authorize a repair or closure.
          if (!releaseSha || !deps.active()) throw new Error('doctor_live_release_unverified')
          if (deps.localRelease() !== releaseSha) throw new Error('doctor_local_release_mismatch')
          const chain = await deps.chain()
          for (const leg of ['worker','publisher','release'] as const) {
            const healthy = ['ready','busy'].includes(chain.legs[leg].state)
            await deps.store.recordDoctorObservation({ code:`constructor_${leg}_offline`,checkedAt:new Date().toISOString(),
              releaseSha,httpStatus:null,result:healthy ? 'healthy' : 'blocked',reason:healthy ? 'heartbeat_verified' : 'constructor_dependency_unavailable' })
          }
          const codes: DoctorCode[] = requested ? [requested] : [...PUBLIC_CODES]
          for (const code of codes) {
            if (!deps.active()) return
            const evidence = await deps.measure(code,releaseSha)
            const id = await deps.store.recordDoctorObservation(evidence)
            const order = doctorRepairOrder(evidence)
            if (!id || !order || !constructorChainAcceptsWork(chain.state)) continue
            // Do not compare an endpoint served after a cutover to the SHA
            // observed before it, then ask AI to repair that false mismatch.
            if (await deps.liveRelease() !== releaseSha) throw new Error('doctor_live_release_changed')
            const evaluation = evalueazaOrdin(order)
            if (!evaluation.trece) continue
            await deps.store.queueDoctorRepair(id,await planificaOrdinConstructor(order),lease)
          }
          for (const job of await deps.store.doctorPendingJobs()) {
            if (!deps.active()) return
            let symptom: DoctorEvidence | null = null
            let provedSha: string | null = null
            if (job.status === 'done' && job.stage === 'deployed' && job.commit === releaseSha && job.liveVersion === releaseSha
              && job.receipt && /^[0-9a-f]{64}$/.test(job.receipt)) {
              // Bracket the repro with live proofs. An intervening release or
              // a mixed blue/green response cannot close the incident.
              symptom = await deps.measure(job.code,releaseSha)
              provedSha = await deps.liveRelease()
              if (provedSha !== releaseSha) provedSha = null
            }
            await deps.store.updateDoctorJob(job,symptom,provedSha,lease)
          }
          if (!deps.active() || await deps.liveRelease() !== releaseSha) throw new Error('doctor_live_release_changed')
          checkedReleaseSha = releaseSha
          failed = false
        } finally { await deps.store.releaseDoctorLease(lease,failed,checkedReleaseSha) }
      }
      running = run().finally(() => { running = null })
      return running
    },
  }
}

const doctor = createDoctor({ active:releaseSideEffectsEnabled,
  localRelease:() => {
    const commit = doctorLocalReleaseSha()
    return SHA40.test(commit) ? commit : null
  },liveRelease,measure,chain:getConstructorChainStatus,store })
export const tickDoctor = doctor.tick

/** Called by Kelion's existing server-side symptom recorder. A report is not
 * proof of a defect: no prompt, detail, user content or URL reaches Doctor. */
export async function relayKelionSymptom(kind: string): Promise<void> {
  if (!releaseSideEffectsEnabled()) return
  const code = doctorReportedCode(kind)
  const releaseSha = String(process.env.GIT_COMMIT_SHA ?? '').toLowerCase()
  if (!code || !SHA40.test(releaseSha)) return
  await store.recordDoctorObservation({ code,releaseSha,checkedAt:new Date().toISOString(),
    httpStatus:null,result:'unverified',reason:'reported_requires_explicit_live_probe' })
}
