import type { AdminHistoryCursor, AdminHistoryEntry, AdminHistoryPage } from '../../../backend/src/shared/adminHistory'
import { apiFetch } from './transport'
export type { AdminHistoryCursor, AdminHistoryEntry, AdminHistoryPage }

export function parseAdminHistoryPage(value: unknown): AdminHistoryPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const validDate = (item: unknown): item is string => typeof item === 'string' && Number.isFinite(Date.parse(item))
  const validId = (item: unknown): item is string => typeof item === 'string' && /^[1-9]\d{0,18}$/.test(item)
  if (!Number.isSafeInteger(raw.limit) || Number(raw.limit) < 1 || !Number.isSafeInteger(raw.maxLimit)
    || Number(raw.maxLimit) < Number(raw.limit) || !Array.isArray(raw.history) || raw.history.length > Number(raw.limit)) return null
  const ids = new Set<string>()
  for (const row of raw.history) {
    if (!row || typeof row !== 'object' || !validId(row.id) || ids.has(row.id) || typeof row.role !== 'string'
      || typeof row.content !== 'string' || !validDate(row.created_at)) return null
    ids.add(row.id)
  }
  const cursor = raw.nextCursor as Partial<AdminHistoryCursor> | null
  if (cursor !== null && (!cursor || typeof cursor !== 'object' || !validId(cursor.id) || !validDate(cursor.createdAt)
    || !raw.history.length || cursor.id !== raw.history[0].id || Date.parse(cursor.createdAt) !== Date.parse(raw.history[0].created_at))) return null
  return { history: raw.history as AdminHistoryEntry[], nextCursor: cursor as AdminHistoryCursor | null, limit: Number(raw.limit), maxLimit: Number(raw.maxLimit) }
}

export interface AdminHistoryState {
  email: string | null
  rows: AdminHistoryEntry[]
  nextCursor: AdminHistoryCursor | null
  loading: boolean
  error: boolean
  mode: 'recent' | 'older'
}

/** One canonical request controller: close/switch invalidates old responses, failed pages preserve history. */
export function createAdminHistoryLoader(publish: (state: AdminHistoryState) => void) {
  let state: AdminHistoryState = { email: null, rows: [], nextCursor: null, loading: false, error: false, mode: 'recent' }
  let controller: AbortController | null = null
  let generation = 0
  const update = (next: AdminHistoryState) => { state = next; publish(state) }
  const load = async (email: string, older: boolean): Promise<void> => {
    if (older && (state.loading || !state.nextCursor || state.email !== email)) return
    const previous = state
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const expected = ++generation
    update(older ? { ...state, loading: true, error: false, mode: 'older' }
      : { email, rows: [], nextCursor: null, loading: true, error: false, mode: 'recent' })
    const query = new URLSearchParams({ email })
    if (older && previous.nextCursor) {
      query.set('beforeAt', previous.nextCursor.createdAt)
      query.set('beforeId', previous.nextCursor.id)
    }
    let page: AdminHistoryPage | null = null
    try {
      const response = await apiFetch(`/api/admin/history?${query}`, { credentials: 'include', cache: 'no-store', signal })
      if (response.ok) page = parseAdminHistoryPage(await response.json())
    } catch { /* unreadable is not an empty conversation */ }
    if (expected !== generation || signal.aborted) return
    if (!page) { update({ ...state, loading: false, error: true }); return }
    if (older && previous.nextCursor && page.nextCursor?.id === previous.nextCursor.id) {
      update({ ...state, loading: false, error: true }); return
    }
    const combined = older ? [...page.history, ...previous.rows] : page.history
    update({ ...state, rows: [...new Map(combined.map((row) => [row.id, row])).values()], nextCursor: page.nextCursor, loading: false, error: false })
  }
  return {
    open: (email: string) => load(email, false),
    older: () => state.email ? load(state.email, true) : Promise.resolve(),
    close: () => {
      ++generation
      controller?.abort()
      update({ email: null, rows: [], nextCursor: null, loading: false, error: false, mode: 'recent' })
    },
  }
}
