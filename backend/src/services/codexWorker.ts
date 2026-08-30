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
  taskUrl?: string
  detail?: string
  internalCostUsdMicros?: number
}

export function parseStoredCodexWorkerStatus(raw: string): StoredWorkerStatus | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  const allowed = new Set(['status', 'at', 'taskUrl', 'detail', 'internalCostUsdMicros'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (!['offline', 'setup_required', 'ready', 'busy', 'degraded'].includes(String(value.status ?? ''))) return null
  if (typeof value.at !== 'string') return null
  const at = Date.parse(value.at)
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value.at) return null
  if (value.taskUrl !== undefined && typeof value.taskUrl !== 'string') return null
  if (value.detail !== undefined && typeof value.detail !== 'string') return null
  if (value.internalCostUsdMicros !== undefined && (
    typeof value.internalCostUsdMicros !== 'number'
    || !Number.isSafeInteger(value.internalCostUsdMicros)
    || value.internalCostUsdMicros < 0
  )) return null
  return value as unknown as StoredWorkerStatus
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

function officialCodexUrl(raw: string): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const official = host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'openai.com' || host.endsWith('.openai.com')
    if (u.protocol !== 'https:' || !official || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

export function codexTaskUrl(raw = config.codexWorker.taskUrl): string | null {
  return officialCodexUrl(raw)
}

export function newCodexTaskId(): string {
  return `codex-${randomUUID()}`
}

export async function recordCodexWorkerStatus(input: {
  status: CodexWorkerState
  taskUrl?: string
  detail?: string
  internalCostUsdMicros?: number
}, now = new Date()): Promise<void> {
  const taskUrl = input.taskUrl ? codexTaskUrl(input.taskUrl) : null
  const stored: StoredWorkerStatus = {
    status: input.status,
    at: now.toISOString(),
    ...(taskUrl ? { taskUrl } : {}),
    ...(input.detail ? { detail: String(input.detail).replace(/\p{Cc}+/gu, ' ').trim().slice(0, 300) } : {}),
    ...(Number.isSafeInteger(input.internalCostUsdMicros) && Number(input.internalCostUsdMicros) >= 0
      ? { internalCostUsdMicros: Number(input.internalCostUsdMicros) }
      : {}),
  }
  await saveKvStrict(STATUS_KEY, JSON.stringify(stored))
}

export async function getCodexWorkerStatus(now = Date.now()): Promise<{
  worker: { state: CodexWorkerPublicState; lastHeartbeat: string | null }
  setupInstructions: string | null
  taskUrl: string | null
  status: string | null
  internalCostUsd: number | null
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
      ? 'Verifică credentiala systemd `openai-project-key` și bridge-ul VPS; workerul rulează `codex login --with-api-key` numai pe stdin, iar aplicația web nu primește cheia.'
      : null,
    taskUrl: codexTaskUrl(stored?.taskUrl ?? '') ?? codexTaskUrl(),
    status: fresh && stored ? (stored.detail ?? stored.status) : null,
    internalCostUsd: typeof stored?.internalCostUsdMicros === 'number'
      ? stored.internalCostUsdMicros / 1_000_000
      : null,
  }
}

/** Web-ul nu execută Codex; păstrează doar adaptorul de planificare compatibil. */
export async function planificaOrdinConstructor(order: string): Promise<string> {
  return order.trim().slice(0, 12_000)
}

/** Compatibilitate temporară pentru apelanții existenți: workerul trage singur coada. */
export async function tickCodexWorker(): Promise<void> {
  return undefined
}
