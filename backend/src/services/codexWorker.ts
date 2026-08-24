import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'
export { canonicalJson, verifyCodexWorkerRequest } from './constructorServiceAuth.js'

const STATUS_KEY = 'codex_worker_status_v1'
const HEARTBEAT_FRESH_MS = 5 * 60_000

export type CodexWorkerState = 'offline' | 'setup_required' | 'ready' | 'busy' | 'degraded'

interface StoredWorkerStatus {
  status: CodexWorkerState
  at: string
  taskUrl?: string
  detail?: string
  internalCostUsdMicros?: number
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
  await saveKv(STATUS_KEY, JSON.stringify(stored))
}

export async function getCodexWorkerStatus(now = Date.now()): Promise<{
  worker: { state: 'ready' | 'offline' | 'setup_required' | 'unknown'; lastHeartbeat: string | null }
  setupInstructions: string | null
  taskUrl: string | null
  status: string | null
  internalCostUsd: number | null
}> {
  let stored: StoredWorkerStatus | null = null
  let readable = true
  try {
    const raw = await loadKv(STATUS_KEY)
    if (raw) stored = JSON.parse(raw) as StoredWorkerStatus
  } catch {
    stored = null
    readable = false
  }
  const at = stored ? Date.parse(stored.at) : Number.NaN
  const fresh = Number.isFinite(at) && now - at >= 0 && now - at <= HEARTBEAT_FRESH_MS
  const configured = config.codexWorker.enabled && config.codexWorker.secret.length >= 32
  const state = !readable
    ? 'unknown'
    : !configured || stored?.status === 'setup_required'
      ? 'setup_required'
      : fresh && stored && ['ready', 'busy', 'degraded'].includes(stored.status)
        ? 'ready'
        : 'offline'
  return {
    worker: { state, lastHeartbeat: stored?.at ?? null },
    setupInstructions: state === 'setup_required'
      ? 'Autentifică workerul separat cu comanda oficială `codex login`; aplicația web nu primește credentialele.'
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
