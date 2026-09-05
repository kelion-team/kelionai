import type { DemoStats } from '../../../backend/src/shared/api-types'
import { apiFetch } from './transport'
import { formatLondonTimestamp } from './versionEvidence'

export type VisitorStats = Pick<DemoStats, 'visitsTotal' | 'visitsToday' | 'byCountry'> & { statsSince: string | null }

export function statisticsPeriodLabel(value: unknown): string {
  if (value === null) return 'Perioadă internă: tot istoricul păstrat'
  const since = formatLondonTimestamp(value)
  return since ? `Perioadă internă de la ${since}` : 'Începutul perioadei interne nu poate fi verificat'
}

export function parseVisitorStats(value: unknown): VisitorStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const count = (number: unknown): number is number => Number.isSafeInteger(number) && Number(number) >= 0
  if (!count(raw.visitsTotal) || !count(raw.visitsToday) || raw.visitsToday > raw.visitsTotal
    || !(raw.statsSince === null || formatLondonTimestamp(raw.statsSince)) || !Array.isArray(raw.byCountry)) return null
  const countries: VisitorStats['byCountry'] = []
  const codes = new Set<string>()
  for (const row of raw.byCountry) {
    if (!row || typeof row !== 'object' || typeof row.code !== 'string' || !/^[A-Z]{2}$/.test(row.code)
      || codes.has(row.code) || !count(row.count) || row.count > raw.visitsTotal) return null
    codes.add(row.code)
    countries.push({ code: row.code, count: row.count })
  }
  if (countries.reduce((total, row) => total + row.count, 0) > raw.visitsTotal) return null
  return { visitsTotal: raw.visitsTotal, visitsToday: raw.visitsToday, statsSince: raw.statsSince as string | null, byCountry: countries }
}

export async function fetchVisitorStats(signal?: AbortSignal): Promise<VisitorStats | null> {
  try {
    const response = await apiFetch('/api/admin/demos', { credentials: 'include', cache: 'no-store', signal })
    return response.ok ? parseVisitorStats(await response.json()) : null
  } catch { return null }
}

/** A strict ACK prevents an old, destructive endpoint from being shown as a successful new period. */
export async function startStatisticsPeriod(): Promise<string | null> {
  try {
    const response = await apiFetch('/api/admin/reset-counters', { method: 'POST', credentials: 'include' })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return null
    const raw = body as Record<string, unknown>
    return raw.ok === true && raw.sterse === 0 && formatLondonTimestamp(raw.statsSince) ? raw.statsSince as string : null
  } catch { return null }
}
