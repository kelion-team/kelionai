import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { dbEnabled, loadKv, saveKvStrict } from '../db.js'
export { canonicalJson, verifyCodexWorkerRequest } from './constructorServiceAuth.js'

const STATUS_KEY = 'codex_worker_status_v1'
const HEARTBEAT_FRESH_MS = 5 * 60_000

export type CodexWorkerState = 'offline' | 'setup_required' | 'ready' | 'busy' | 'degraded'
export type CodexWorkerPublicState = CodexWorkerState | 'unknown'

interface StoredWorkerStatus {
  status: CodexWorkerState
  at: string
  detail?: string
}

export const CONSTRUCTOR_EXECUTOR = 'OpenCode + Qwen local (llama.cpp)' as const
export const CONSTRUCTOR_QUEUE = 'build_jobs' as const

export function parseStoredCodexWorkerStatus(raw: string): StoredWorkerStatus | null {
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
    status: value.status as CodexWorkerState,
    at: value.at,
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
  }
}

export function projectCodexWorkerState(input: {
  readable: boolean
  configured: boolean
  storedStatus: CodexWorkerState | null
  heartbeatAt: string | null
  now: number
}): CodexWorkerPublicState {
  if (!input.readable) return 'unknown'
  if (!input.configured || input.storedStatus === 'setup_required') return 'setup_required'
  const at = input.heartbeatAt ? Date.parse(input.heartbeatAt) : Number.NaN
  const fresh = Number.isFinite(at)
    && input.now - at >= 0
    && input.now - at <= HEARTBEAT_FRESH_MS
  if (!fresh) return 'offline'
  return input.storedStatus ?? 'offline'
}

export function newCodexTaskId(): string {
  // Prefix compatibil cu schema/workerul deja instalat; nu descrie executorul.
  return `codex-${randomUUID()}`
}

export async function recordCodexWorkerStatus(input: {
  status: CodexWorkerState
  detail?: string
}, now = new Date()): Promise<void> {
  const stored: StoredWorkerStatus = {
    status: input.status,
    at: now.toISOString(),
    ...(input.detail ? { detail: String(input.detail).replace(/\p{Cc}+/gu, ' ').trim().slice(0, 300) } : {}),
  }
  await saveKvStrict(STATUS_KEY, JSON.stringify(stored))
}

export async function getCodexWorkerStatus(now = Date.now()): Promise<{
  worker: { state: CodexWorkerPublicState; lastHeartbeat: string | null }
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
      stored = parseStoredCodexWorkerStatus(raw)
      if (!stored) readable = false
    }
  } catch {
    stored = null
    readable = false
  }
  const configured = config.codexWorker.enabled && config.codexWorker.secret.length >= 32
  const state = projectCodexWorkerState({
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
      ? 'Verifică preflightul OpenCode 1.18.25 + Qwen local (llama.cpp) și credentiala HMAC care permite workerului să revendice ordine din `build_jobs`.'
      : null,
    status: fresh && stored ? (stored.detail ?? stored.status) : null,
    executor: CONSTRUCTOR_EXECUTOR,
    queue: CONSTRUCTOR_QUEUE,
  }
}

/** Web-ul nu execută repository tools; doar normalizează ordinul pentru build_jobs. */
export async function planificaOrdinConstructor(order: string): Promise<string> {
  return order.trim().slice(0, 12_000)
}

/** Compatibilitate temporară pentru apelanții existenți: workerul trage singur coada. */
export async function tickCodexWorker(): Promise<void> {
  return undefined
}
