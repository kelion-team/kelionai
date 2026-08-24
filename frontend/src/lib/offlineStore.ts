import {
  OFFLINE_LOCAL_DEFERRED_LIMIT,
  OFFLINE_LOCAL_HISTORY_LIMIT,
  OFFLINE_LOCAL_REJECTED_LIMIT,
  OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS,
} from '../../../backend/src/shared/offlineSyncPolicy'

const DB_NAME = 'kelion-client-state'
const DB_VERSION = 1
const ACTIVE_SCOPE_META = 'active-scope'
const LEGACY_MIGRATION_PREFIX = 'legacy-localstorage-v1:'

const STORE_HISTORY = 'history'
const STORE_OUTBOX = 'outbox'
const STORE_DEFERRED = 'deferred'
const STORE_REJECTED = 'rejected'
const STORE_META = 'meta'
const SCOPED_TIME_INDEX = 'scope-time'

const LEGACY_SYNC = 'kelion.offline.sync'
const LEGACY_REJECTED = 'kelion.offline.respinse'
const LEGACY_DEFERRED = 'kelion.offline.amanate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface StoredTurn {
  id: string
  rol: 'user' | 'assistant'
  text: string
  t: number
}

export interface StoredRejectedTurn extends StoredTurn {
  code: string
  rejectedAt: number
}

export interface StoredDeferredRequest {
  id: string
  intrebare: string
  t: number
  notifiedAt?: number
}

type ScopedRow = { pk: string; scope: string; id: string; t: number }
type HistoryRow = ScopedRow & StoredTurn & { pending: boolean }
type OutboxRow = ScopedRow & StoredTurn
type DeferredRow = ScopedRow & StoredDeferredRequest
type RejectedRow = ScopedRow & StoredRejectedTurn
type MetaRow = { key: string; value: string }

type NewTurn = Omit<StoredTurn, 'id'> & { id?: string }
type NewDeferred = Omit<StoredDeferredRequest, 'id' | 'notifiedAt'> & { id?: string }

export interface LocalWrite {
  turns: readonly NewTurn[]
  queueForSync: boolean
  deferred?: NewDeferred | null
}

let openPromise: Promise<IDBDatabase> | null = null
let openFactory: IDBFactory | null = null

function currentFactory(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw new Error('indexeddb_unavailable')
  return indexedDB
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb_transaction_aborted'))
    transaction.onerror = () => {
      // onabort is the terminal signal and preserves the concrete error.
    }
  })
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = currentFactory()
  if (openPromise && openFactory === factory) return openPromise
  openFactory = factory
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of [STORE_HISTORY, STORE_OUTBOX, STORE_DEFERRED, STORE_REJECTED]) {
        if (db.objectStoreNames.contains(storeName)) continue
        const store = db.createObjectStore(storeName, { keyPath: 'pk' })
        store.createIndex(SCOPED_TIME_INDEX, ['scope', 't', 'id'], { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        if (openFactory === factory) {
          openFactory = null
          openPromise = null
        }
      }
      resolve(db)
    }
    request.onerror = () => {
      openFactory = null
      openPromise = null
      reject(request.error ?? new Error('indexeddb_open_failed'))
    }
    request.onblocked = () => {
      openFactory = null
      openPromise = null
      reject(new Error('indexeddb_open_blocked'))
    }
  })
  return openPromise
}

function scopedPk(scope: string, id: string): string {
  return `${scope}:${id}`
}

function scopeRange(scope: string): IDBKeyRange {
  return IDBKeyRange.bound([scope, 0, ''], [scope, Number.MAX_SAFE_INTEGER, '\uffff'])
}

function normalizeId(value: unknown, used?: Set<string>): string {
  let id = typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : crypto.randomUUID()
  while (used?.has(id)) id = crypto.randomUUID()
  used?.add(id)
  return id
}

function validTurn(value: unknown): value is NewTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Partial<StoredTurn>
  return (turn.rol === 'user' || turn.rol === 'assistant') &&
    typeof turn.text === 'string' && turn.text.trim().length > 0 &&
    turn.text.length <= OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS &&
    Number.isSafeInteger(turn.t) && Number(turn.t) > 0
}

function validDeferred(value: unknown): value is NewDeferred {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<StoredDeferredRequest>
  return typeof request.intrebare === 'string' && request.intrebare.trim().length > 0 &&
    request.intrebare.length <= OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS &&
    Number.isSafeInteger(request.t) && Number(request.t) > 0
}

function readLegacyArray(scope: string, base: string): unknown[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${base}:${scope}`) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function removeLegacy(scope: string): void {
  try {
    for (const base of [LEGACY_SYNC, LEGACY_REJECTED, LEGACY_DEFERRED]) {
      localStorage.removeItem(`${base}:${scope}`)
    }
  } catch {
    // Markerul tranzacțional din IndexedDB previne dublarea la următoarea pornire.
  }
}

async function requireScope(transaction: IDBTransaction, scope: string): Promise<void> {
  if (!UUID_RE.test(scope)) throw new Error('invalid_scope')
  const meta = transaction.objectStore(STORE_META)
  const current = await requestResult(meta.get(ACTIVE_SCOPE_META)) as MetaRow | undefined
  if (!current || current.value !== scope) throw new Error('scope_changed')
}

/** Activează explicit namespace-ul IDB numai pentru fluxul de autentificare.
 * Operațiile conversaționale nu au voie să revendice singure un scope gol:
 * după logout/schimbare de cont, un write vechi trebuie să eșueze, nu să
 * reactiveze identitatea precedentă. */
export async function activateOfflineDatabaseScope(scope: string): Promise<boolean> {
  if (!UUID_RE.test(scope)) return false
  try {
    const db = await openDatabase()
    const transaction = db.transaction([STORE_META], 'readwrite')
    const done = transactionDone(transaction)
    const meta = transaction.objectStore(STORE_META)
    const current = await requestResult(meta.get(ACTIVE_SCOPE_META)) as MetaRow | undefined
    if (current && current.value !== scope) {
      transaction.abort()
      await done.catch(() => {})
      return false
    }
    meta.put({ key: ACTIVE_SCOPE_META, value: scope } satisfies MetaRow)
    await done
    return true
  } catch {
    return false
  }
}

async function ensureMigrated(scope: string): Promise<void> {
  const db = await openDatabase()
  const legacyTurns = readLegacyArray(scope, LEGACY_SYNC)
  const legacyRejected = readLegacyArray(scope, LEGACY_REJECTED)
  const legacyDeferred = readLegacyArray(scope, LEGACY_DEFERRED)
  const transaction = db.transaction(
    [STORE_META, STORE_HISTORY, STORE_OUTBOX, STORE_REJECTED, STORE_DEFERRED],
    'readwrite',
  )
  const done = transactionDone(transaction)
  try {
    await requireScope(transaction, scope)
    const meta = transaction.objectStore(STORE_META)
    const markerKey = `${LEGACY_MIGRATION_PREFIX}${scope}`
    const migrated = await requestResult(meta.get(markerKey)) as MetaRow | undefined
    if (!migrated) {
      const ids = new Set<string>()
      const history = transaction.objectStore(STORE_HISTORY)
      const outbox = transaction.objectStore(STORE_OUTBOX)
      for (const raw of legacyTurns) {
        if (!validTurn(raw)) continue
        const id = normalizeId((raw as Partial<StoredTurn>).id, ids)
        const turn: StoredTurn = { id, rol: raw.rol, text: raw.text.trim(), t: raw.t }
        const pk = scopedPk(scope, id)
        history.put({ ...turn, pk, scope, pending: true } satisfies HistoryRow)
        outbox.put({ ...turn, pk, scope } satisfies OutboxRow)
      }

      const rejected = transaction.objectStore(STORE_REJECTED)
      for (const raw of legacyRejected) {
        if (!validTurn(raw)) continue
        const candidate = raw as Partial<StoredRejectedTurn>
        if (typeof candidate.code !== 'string' || !candidate.code ||
          !Number.isSafeInteger(candidate.rejectedAt) || Number(candidate.rejectedAt) <= 0) continue
        const id = normalizeId(candidate.id, ids)
        rejected.put({
          id,
          rol: raw.rol,
          text: raw.text.trim(),
          t: raw.t,
          code: candidate.code,
          rejectedAt: Number(candidate.rejectedAt),
          pk: scopedPk(scope, id),
          scope,
        } satisfies RejectedRow)
      }

      const deferred = transaction.objectStore(STORE_DEFERRED)
      for (const raw of legacyDeferred) {
        if (!validDeferred(raw)) continue
        const candidate = raw as Partial<StoredDeferredRequest>
        const id = normalizeId(candidate.id, ids)
        const notifiedAt = Number.isSafeInteger(candidate.notifiedAt) && Number(candidate.notifiedAt) > 0
          ? Number(candidate.notifiedAt)
          : undefined
        deferred.put({
          id,
          intrebare: raw.intrebare.trim(),
          t: raw.t,
          ...(notifiedAt ? { notifiedAt } : {}),
          pk: scopedPk(scope, id),
          scope,
        } satisfies DeferredRow)
      }
      meta.put({ key: markerKey, value: new Date().toISOString() } satisfies MetaRow)
    }
    await done
    removeLegacy(scope)
  } catch (error) {
    try { transaction.abort() } catch { /* already terminal */ }
    await done.catch(() => {})
    throw error
  }
}

async function rowsForScope<T>(storeName: string, scope: string): Promise<T[]> {
  await ensureMigrated(scope)
  const db = await openDatabase()
  const transaction = db.transaction([STORE_META, storeName], 'readonly')
  const done = transactionDone(transaction)
  await requireScope(transaction, scope)
  const rows = await requestResult(
    transaction.objectStore(storeName).index(SCOPED_TIME_INDEX).getAll(scopeRange(scope)),
  ) as T[]
  await done
  return rows
}

async function pruneOldestSyncedHistory(transaction: IDBTransaction, scope: string): Promise<void> {
  const store = transaction.objectStore(STORE_HISTORY)
  const rows = await requestResult(store.index(SCOPED_TIME_INDEX).getAll(scopeRange(scope))) as HistoryRow[]
  let excess = rows.length - OFFLINE_LOCAL_HISTORY_LIMIT
  if (excess <= 0) return
  for (const row of rows) {
    if (excess <= 0) break
    if (row.pending) continue
    store.delete(row.pk)
    excess--
  }
}

async function pruneStore(transaction: IDBTransaction, storeName: string, scope: string, limit: number): Promise<void> {
  const store = transaction.objectStore(storeName)
  const rows = await requestResult(store.index(SCOPED_TIME_INDEX).getAll(scopeRange(scope))) as ScopedRow[]
  for (const row of rows.slice(0, Math.max(0, rows.length - limit))) store.delete(row.pk)
}

export async function writeLocal(scope: string, write: LocalWrite): Promise<{
  turns: StoredTurn[]
  deferred: StoredDeferredRequest | null
} | null> {
  if (!UUID_RE.test(scope) || write.turns.some((turn) => !validTurn(turn)) ||
    (write.deferred && !validDeferred(write.deferred))) return null
  try {
    await ensureMigrated(scope)
    const db = await openDatabase()
    const transaction = db.transaction([STORE_META, STORE_HISTORY, STORE_OUTBOX, STORE_DEFERRED], 'readwrite')
    const done = transactionDone(transaction)
    await requireScope(transaction, scope)
    const historyStore = transaction.objectStore(STORE_HISTORY)
    const outboxStore = transaction.objectStore(STORE_OUTBOX)
    const used = new Set<string>()
    const turns = write.turns.map((candidate) => ({
      id: normalizeId(candidate.id, used),
      rol: candidate.rol,
      text: candidate.text.trim(),
      t: candidate.t,
    } satisfies StoredTurn))
    for (const turn of turns) {
      const pk = scopedPk(scope, turn.id)
      historyStore.put({ ...turn, pk, scope, pending: write.queueForSync } satisfies HistoryRow)
      if (write.queueForSync) outboxStore.put({ ...turn, pk, scope } satisfies OutboxRow)
    }
    let deferred: StoredDeferredRequest | null = null
    if (write.deferred) {
      deferred = {
        id: normalizeId(write.deferred.id, used),
        intrebare: write.deferred.intrebare.trim(),
        t: write.deferred.t,
      }
      transaction.objectStore(STORE_DEFERRED).put({
        ...deferred,
        pk: scopedPk(scope, deferred.id),
        scope,
      } satisfies DeferredRow)
    }
    await pruneOldestSyncedHistory(transaction, scope)
    await pruneStore(transaction, STORE_DEFERRED, scope, OFFLINE_LOCAL_DEFERRED_LIMIT)
    await done
    return { turns, deferred }
  } catch {
    return null
  }
}

export async function readOutbox(scope: string): Promise<StoredTurn[]> {
  const rows = await rowsForScope<OutboxRow>(STORE_OUTBOX, scope)
  return rows.map(({ id, rol, text, t }) => ({ id, rol, text, t }))
}

export async function readHistory(scope: string): Promise<StoredTurn[]> {
  const rows = await rowsForScope<HistoryRow>(STORE_HISTORY, scope)
  return rows.map(({ id, rol, text, t }) => ({ id, rol, text, t }))
}

export async function readRejected(scope: string): Promise<StoredRejectedTurn[]> {
  const rows = await rowsForScope<RejectedRow>(STORE_REJECTED, scope)
  return rows.map(({ id, rol, text, t, code, rejectedAt }) => ({ id, rol, text, t, code, rejectedAt }))
}

export async function readDeferred(scope: string): Promise<StoredDeferredRequest[]> {
  const rows = await rowsForScope<DeferredRow>(STORE_DEFERRED, scope)
  return rows.map(({ id, intrebare, t, notifiedAt }) => ({
    id,
    intrebare,
    t,
    ...(notifiedAt ? { notifiedAt } : {}),
  }))
}

export async function applyTerminalSync(
  scope: string,
  terminalIds: readonly string[],
  rejected: readonly StoredRejectedTurn[],
): Promise<boolean> {
  try {
    await ensureMigrated(scope)
    const db = await openDatabase()
    const transaction = db.transaction([STORE_META, STORE_HISTORY, STORE_OUTBOX, STORE_REJECTED], 'readwrite')
    const done = transactionDone(transaction)
    await requireScope(transaction, scope)
    const outbox = transaction.objectStore(STORE_OUTBOX)
    const history = transaction.objectStore(STORE_HISTORY)
    const rejectedStore = transaction.objectStore(STORE_REJECTED)
    for (const rawId of terminalIds) {
      const id = rawId.toLowerCase()
      const pk = scopedPk(scope, id)
      outbox.delete(pk)
      const historyRow = await requestResult(history.get(pk)) as HistoryRow | undefined
      if (historyRow) history.put({ ...historyRow, pending: false } satisfies HistoryRow)
    }
    for (const item of rejected) {
      const id = item.id.toLowerCase()
      rejectedStore.put({ ...item, id, pk: scopedPk(scope, id), scope } satisfies RejectedRow)
    }
    await pruneOldestSyncedHistory(transaction, scope)
    await pruneStore(transaction, STORE_REJECTED, scope, OFFLINE_LOCAL_REJECTED_LIMIT)
    await done
    return true
  } catch {
    return false
  }
}

export async function deleteDeferred(scope: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  try {
    await ensureMigrated(scope)
    const db = await openDatabase()
    const transaction = db.transaction([STORE_META, STORE_DEFERRED], 'readwrite')
    const done = transactionDone(transaction)
    await requireScope(transaction, scope)
    transaction.objectStore(STORE_DEFERRED).delete(scopedPk(scope, id.toLowerCase()))
    await done
    return true
  } catch {
    return false
  }
}

export async function markDeferredNotified(scope: string, id: string, notifiedAt = Date.now()): Promise<boolean> {
  if (!UUID_RE.test(id) || !Number.isSafeInteger(notifiedAt) || notifiedAt <= 0) return false
  try {
    await ensureMigrated(scope)
    const db = await openDatabase()
    const transaction = db.transaction([STORE_META, STORE_DEFERRED], 'readwrite')
    const done = transactionDone(transaction)
    await requireScope(transaction, scope)
    const store = transaction.objectStore(STORE_DEFERRED)
    const pk = scopedPk(scope, id.toLowerCase())
    const row = await requestResult(store.get(pk)) as DeferredRow | undefined
    if (!row) {
      transaction.abort()
      await done.catch(() => {})
      return false
    }
    store.put({ ...row, notifiedAt } satisfies DeferredRow)
    await done
    return true
  } catch {
    return false
  }
}

/** Șterge toate namespace-urile conversaționale într-o singură tranzacție. */
export async function purgeOfflineDatabase(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return true
  try {
    const db = await openDatabase()
    const transaction = db.transaction(
      [STORE_META, STORE_HISTORY, STORE_OUTBOX, STORE_DEFERRED, STORE_REJECTED],
      'readwrite',
    )
    const done = transactionDone(transaction)
    for (const storeName of [STORE_META, STORE_HISTORY, STORE_OUTBOX, STORE_DEFERRED, STORE_REJECTED]) {
      transaction.objectStore(storeName).clear()
    }
    await done
    return true
  } catch {
    return false
  }
}
