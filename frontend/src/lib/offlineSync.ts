import { activeClientScope } from './clientState'
import {
  aplicaRezultatSync,
  citesteSyncDurabil,
} from './coadaOffline'
import { apiFetch } from './transport'
import { OFFLINE_SYNC_DEFAULT_MAX_TURNS } from '../../../backend/src/shared/offlineSyncPolicy'

const SYNC_BATCH_SIZE = OFFLINE_SYNC_DEFAULT_MAX_TURNS

type DrainResult = {
  batches: number
  acknowledged: number
  quarantined: number
  complete: boolean
  storageError?: boolean
}

const drainsByScope = new Map<string, Promise<DrainResult>>()

export async function offlineSyncScopeAuthenticated(scope = activeClientScope()): Promise<boolean> {
  if (!scope) return false
  try {
    const auth = await apiFetch('/auth/me', { cache: 'no-store' })
    if (!auth.ok) return false
    const me = await auth.json().catch(() => null) as {
      authenticated?: unknown
      user?: { clientStorageId?: unknown }
    } | null
    return me?.authenticated === true &&
      typeof me.user?.clientStorageId === 'string' &&
      me.user.clientStorageId.toLowerCase() === scope &&
      activeClientScope() === scope
  } catch {
    return false
  }
}

async function drainOnce(scope: string): Promise<DrainResult> {
  if (!scope) return { batches: 0, acknowledged: 0, quarantined: 0, complete: false }

  // Health poate reveni înainte ca App să fi revalidat sesiunea. Nu trimitem
  // niciun octet din coadă până când serverul confirmă exact același namespace
  // opac; un cookie expirat sau cont schimbat păstrează datele numai local.
  if (!(await offlineSyncScopeAuthenticated(scope))) {
    return { batches: 0, acknowledged: 0, quarantined: 0, complete: false }
  }

  let batches = 0
  let acknowledged = 0
  let quarantined = 0
  while (activeClientScope() === scope) {
    const durable = await citesteSyncDurabil()
    if (!durable.ok) return { batches, acknowledged, quarantined, complete: false, storageError: true }
    const batch = durable.ture.slice(0, SYNC_BATCH_SIZE)
    if (batch.length === 0) return { batches, acknowledged, quarantined, complete: true }

    try {
      const response = await apiFetch('/api/offline/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientStorageId: scope, ture: batch }),
      })
      if (!response.ok || activeClientScope() !== scope) {
        return { batches, acknowledged, quarantined, complete: false }
      }
      const body = await response.json().catch(() => null)
      const applied = await aplicaRezultatSync(body, batch, scope)
      if (!applied.ok || activeClientScope() !== scope) {
        return { batches, acknowledged, quarantined, complete: false }
      }
      batches++
      acknowledged += applied.acked
      quarantined += applied.quarantined
    } catch {
      return { batches, acknowledged, quarantined, complete: false }
    }
  }
  return { batches, acknowledged, quarantined, complete: false }
}

async function withCrossTabSyncLock(scope: string): Promise<DrainResult> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & {
        locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
      }).locks
    : undefined
  if (!locks) return drainOnce(scope)
  return locks.request(`kelion-offline-sync:${scope}`, () => drainOnce(scope))
}

/** Drenează coada contului curent o singură dată chiar dacă mount/reconnect se
 * suprapun. ACK-ul exact este cerut pentru fiecare batch înainte de ștergere. */
export function drainOfflineSync(): Promise<DrainResult> {
  const scope = activeClientScope()
  if (!scope) return Promise.resolve({ batches: 0, acknowledged: 0, quarantined: 0, complete: false })
  const existing = drainsByScope.get(scope)
  if (existing) return existing
  const running = withCrossTabSyncLock(scope).finally(() => {
    if (drainsByScope.get(scope) === running) drainsByScope.delete(scope)
  })
  drainsByScope.set(scope, running)
  return running
}
