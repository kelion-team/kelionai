import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { dbEnabled, loadKv, saveKvStrict } from '../db.js'
export { canonicalJson, verifyConstructorWorkerRequest } from './constructorServiceAuth.js'

// Cheie KV istorica; valoarea ramane neschimbata ca sa nu pierdem starea deja persistata.
const STATUS_KEY = 'codex_worker_status_v1'
const HEARTBEAT_FRESH_MS = 5 * 60_000

export type ConstructorWorkerState = 'offline' | 'setup_required' | 'ready' | 'busy' | 'degraded'
export type ConstructorWorkerPublicState = ConstructorWorkerState | 'unknown'

interface StoredWorkerStatus {
  status: ConstructorWorkerState
  at: string
  detail?: string
}

export const CONSTRUCTOR_EXECUTOR = 'OpenCode (motor configurat separat)' as const
export const CONSTRUCTOR_QUEUE = 'build_jobs' as const

export function parseStoredConstructorWorkerStatus(raw: string): StoredWorkerStatus | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  const allowed = new Set(['status', 'at', 'detail'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (!['offline', 'setup_required', 'ready', 'busy', 'degraded'].includes(String(value.status ?? ''))) return null
  if (typeof value.at !== 'string') return null
  const at = Date.parse(value.at)
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value.at) return null
  if (value.detail !== undefined && typeof value.detail !== 'string') return null
  return {
    status: value.status as ConstructorWorkerState,
    at: value.at,
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
  }
}

export function projectConstructorWorkerState(input: {
  readable: boolean
  configured: boolean
  storedStatus: ConstructorWorkerState | null
  heartbeatAt: string | null
  now: number
}): ConstructorWorkerPublicState {
  if (!input.readable) return 'unknown'
  if (!input.configured || input.storedStatus === 'setup_required') return 'setup_required'
  const at = input.heartbeatAt ? Date.parse(input.heartbeatAt) : Number.NaN
  const fresh = Number.isFinite(at)
    && input.now - at >= 0
    && input.now - at <= HEARTBEAT_FRESH_MS
  if (!fresh) return 'offline'
  return input.storedStatus ?? 'offline'
}

export function newConstructorTaskId(): string {
  // Prefix istoric pastrat pentru compatibilitate cu coloana codex_task_id,
  // cu branch-urile deja publicate si cu workerul instalat pe masina.
  return `codex-${randomUUID()}`
}

export async function recordConstructorWorkerStatus(input: {
  status: ConstructorWorkerState
  detail?: string
}, now = new Date()): Promise<void> {
  const stored: StoredWorkerStatus = {
    status: input.status,
    at: now.toISOString(),
    ...(input.detail ? { detail: String(input.detail).replace(/\p{Cc}+/gu, ' ').trim().slice(0, 300) } : {}),
  }
  await saveKvStrict(STATUS_KEY, JSON.stringify(stored))
}

export async function getConstructorWorkerStatus(now = Date.now()): Promise<{
  worker: { state: ConstructorWorkerPublicState; lastHeartbeat: string | null }
  setupInstructions: string | null
  status: string | null
  executor: typeof CONSTRUCTOR_EXECUTOR
  queue: typeof CONSTRUCTOR_QUEUE
}> {
  let stored: StoredWorkerStatus | null = null
  let readable = dbEnabled()
  try {
    const raw = await loadKv(STATUS_KEY)
    if (raw) {
      stored = parseStoredConstructorWorkerStatus(raw)
      if (!stored) readable = false
    }
  } catch {
    stored = null
    readable = false
  }
  const configured = config.constructorWorker.enabled && config.constructorWorker.secret.length >= 32
  const state = projectConstructorWorkerState({
    readable,
    configured,
    storedStatus: stored?.status ?? null,
    heartbeatAt: stored?.at ?? null,
    now,
  })
  const at = stored ? Date.parse(stored.at) : Number.NaN
  const fresh = Number.isFinite(at) && now - at >= 0 && now - at <= HEARTBEAT_FRESH_MS
  return {
    worker: { state, lastHeartbeat: stored?.at ?? null },
    setupInstructions: state === 'setup_required'
      ? 'Verifică preflightul OpenCode și motorul configurat și credentiala HMAC care permite workerului să revendice ordine din `build_jobs`.'
      : null,
    status: fresh && stored ? (stored.detail ?? stored.status) : null,
    executor: CONSTRUCTOR_EXECUTOR,
    queue: CONSTRUCTOR_QUEUE,
  }
}

/** Web-ul nu execută repository tools; normalizează ordinul pentru build_jobs. */
export async function planificaOrdinConstructor(order: string): Promise<string> {
  return order.trim().slice(0, 12_000)
}

/** Compatibilitate temporară pentru apelanții existenți: workerul trage singur coada. */
export async function tickConstructorWorker(): Promise<void> {
  return undefined
}
