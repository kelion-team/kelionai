import type { AdminHistoryQuery } from '../shared/adminHistory.js'

export const ADMIN_HISTORY_MAX = 200
export function parseAdminHistoryQuery(raw:Record<string,unknown>): AdminHistoryQuery | null {
  if (Object.keys(raw).some((key) => !['email','limit','beforeAt','beforeId'].includes(key))) return null
  if (typeof raw.email !== 'string' || raw.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(raw.email)) return null
  const limit = raw.limit === undefined ? 100 : Number(raw.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_HISTORY_MAX) return null
  let before:AdminHistoryQuery['before'] = null
  if (raw.beforeAt !== undefined || raw.beforeId !== undefined) {
    if (typeof raw.beforeAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(raw.beforeAt)
      || !Number.isFinite(Date.parse(raw.beforeAt)) || typeof raw.beforeId !== 'string'
      || !/^[1-9]\d{0,18}$/.test(raw.beforeId) || BigInt(raw.beforeId) > 9223372036854775807n) return null
    before = { createdAt:raw.beforeAt,id:raw.beforeId }
  }
  return { email:raw.email.trim().toLowerCase(),limit,before }
}
