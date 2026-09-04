import { config } from '../config.js'
import { dbEnabled, loadKv, saveKvStrict } from '../db.js'
import { getConstructorWorkerStatus, type ConstructorWorkerPublicState } from './constructorWorker.js'

export type ConstructorPipelineService = 'publisher' | 'release'
export type ConstructorLegState = 'ready' | 'busy' | 'degraded' | 'offline' | 'setup_required' | 'unknown'

interface StoredServiceHeartbeat {
  state: 'ready' | 'busy' | 'degraded'
  at: string
  detail?: string
}

export interface ConstructorChainLeg {
  state: ConstructorLegState
  lastHeartbeat: string | null
  detail: string | null
}

export interface ConstructorChainStatus {
  state: ConstructorWorkerPublicState
  reason: string
  lastHeartbeat: string | null
  legs: {
    worker: ConstructorChainLeg
    publisher: ConstructorChainLeg
    release: ConstructorChainLeg
  }
}

/** Coada poate primi lucru cât lanțul este sănătos, inclusiv când execută deja
 * un ordin. Asta nu este însă o promisiune că ordinul nou pornește imediat. */
export function constructorChainAcceptsWork(state: ConstructorChainStatus['state']): boolean {
  return state === 'ready' || state === 'busy'
}

/** Numai un lanț complet pregătit și liber poate porni la următorul timer.
 * `busy` acceptă în coadă, dar nu oferă niciun ETA pentru ordinul nou. */
export function constructorWorkerCanStartNow(state: ConstructorChainStatus['state']): boolean {
  return state === 'ready'
}

const HEARTBEAT_FRESH_MS = 5 * 60_000
const keyFor = (service: ConstructorPipelineService): string =>
  `constructor_${service}_status_v1`

export async function recordConstructorServiceHeartbeat(
  service: ConstructorPipelineService,
  state: 'ready' | 'busy' | 'degraded',
  detail?: string,
  now = new Date(),
): Promise<void> {
  const stored: StoredServiceHeartbeat = {
    state,
    at: now.toISOString(),
    ...(detail
      ? { detail: String(detail).replace(/\p{Cc}+/gu, ' ').trim().slice(0, 240) }
      : {}),
  }
  await saveKvStrict(keyFor(service), JSON.stringify(stored))
}

export function projectConstructorServiceLeg(input: {
  readable: boolean
  configured: boolean
  stored: StoredServiceHeartbeat | null
  now: number
}): ConstructorChainLeg {
  if (!input.configured) return { state: 'setup_required', lastHeartbeat: input.stored?.at ?? null, detail: null }
  if (!input.readable) return { state: 'unknown', lastHeartbeat: null, detail: null }
  const at = input.stored ? Date.parse(input.stored.at) : Number.NaN
  const fresh = Number.isFinite(at) && input.now - at >= 0 && input.now - at <= HEARTBEAT_FRESH_MS
  if (!fresh) return { state: 'offline', lastHeartbeat: input.stored?.at ?? null, detail: null }
  return {
    state: input.stored?.state === 'busy'
      ? 'busy'
      : input.stored?.state === 'degraded'
        ? 'degraded'
        : 'ready',
    lastHeartbeat: input.stored?.at ?? null,
    detail: input.stored?.detail ?? null,
  }
}

async function readServiceLeg(
  service: ConstructorPipelineService,
  configured: boolean,
  now: number,
): Promise<ConstructorChainLeg> {
  let stored: StoredServiceHeartbeat | null = null
  let readable = dbEnabled()
  try {
    const raw = await loadKv(keyFor(service))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredServiceHeartbeat>
      if (
        (parsed.state === 'ready' || parsed.state === 'busy' || parsed.state === 'degraded')
        && typeof parsed.at === 'string'
      ) stored = parsed as StoredServiceHeartbeat
    }
  } catch {
    readable = false
  }
  return projectConstructorServiceLeg({ readable, configured, stored, now })
}

function oldestHeartbeat(legs: readonly ConstructorChainLeg[]): string | null {
  const values = legs
    .map((leg) => leg.lastHeartbeat)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return values[0] ?? null
}

export async function getConstructorChainStatus(now = Date.now()): Promise<ConstructorChainStatus> {
  const workerStatus = await getConstructorWorkerStatus(now)
  const publisherConfigured = config.constructorPublisher.enabled
    && config.constructorPublisher.secret.length >= 32
  const releaseConfigured = config.constructorRelease.enabled
    && config.constructorRelease.secret.length >= 32
  const [publisher, release] = await Promise.all([
    readServiceLeg('publisher', publisherConfigured, now),
    readServiceLeg('release', releaseConfigured, now),
  ])
  const worker: ConstructorChainLeg = {
    state: workerStatus.worker.state,
    lastHeartbeat: workerStatus.worker.lastHeartbeat,
    detail: workerStatus.status,
  }
  const legs = { worker, publisher, release }
  const all = [worker, publisher, release]
  const setup = Object.entries(legs).filter(([, leg]) => leg.state === 'setup_required').map(([name]) => name)
  const unknown = Object.entries(legs).filter(([, leg]) => leg.state === 'unknown').map(([name]) => name)
  const offline = Object.entries(legs).filter(([, leg]) => leg.state === 'offline').map(([name]) => name)
  const degraded = Object.entries(legs).filter(([, leg]) => leg.state === 'degraded').map(([name]) => name)
  const busy = all.some((leg) => leg.state === 'busy')
  const state: ConstructorWorkerPublicState = setup.length
    ? 'setup_required'
    : unknown.length
      ? 'unknown'
      : offline.length
        ? 'offline'
        : degraded.length
          ? 'degraded'
          : busy
            ? 'busy'
            : 'ready'
  const reason = setup.length
    ? `lanțul Constructor necesită configurare pentru: ${setup.join(', ')}`
    : unknown.length
      ? `starea nu poate fi citită pentru: ${unknown.join(', ')}`
      : offline.length
        ? `nu există heartbeat recent pentru: ${offline.join(', ')}`
        : degraded.length
          ? `lanțul este degradat pentru: ${degraded.map((name) => {
              const detail = legs[name as keyof typeof legs].detail
              return detail ? `${name} (${detail})` : name
            }).join(', ')}`
          : busy
            ? 'lanțul complet este conectat și cel puțin un serviciu execută o etapă'
            : 'workerul, publisherul și releaserul au heartbeat recent și sunt pregătite'
  return { state, reason, lastHeartbeat: oldestHeartbeat(all), legs }
}
