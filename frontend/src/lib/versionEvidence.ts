import { apiFetch } from './transport'

export interface RuntimeVersionEvidence {
  commit: string | null
  startedAt: string | null
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
}

/** Both current canonical sources use UTC ISO instants; display is always London, never browser-local. */
export function formatLondonTimestamp(value: unknown): string | null {
  if (!timestamp(value)) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')} (London)`
}

/** /api/version.at is process boot, not deployment time. Its timestamp fallback for v is NOT a commit. */
export function parseRuntimeVersion(value: unknown): RuntimeVersionEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const commit = typeof raw.v === 'string' && /^[a-f0-9]{7,40}$/.test(raw.v)
    && (raw.ver === undefined || raw.ver === raw.v) ? raw.v : null
  const startedAt = timestamp(raw.at) ? raw.at : null
  return commit !== null || startedAt !== null ? { commit, startedAt } : null
}

export async function fetchRuntimeVersion(signal: AbortSignal): Promise<RuntimeVersionEvidence | null> {
  try {
    const response = await apiFetch('/api/version', { signal, cache: 'no-store' })
    return response.ok ? parseRuntimeVersion(await response.json()) : null
  } catch {
    return null
  }
}

export function installedBuildLabel(version: unknown, builtAt: unknown): string {
  const release = typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version) ? `V${version}` : 'versiune necunoscută'
  return `UI ${release} · build ${formatLondonTimestamp(builtAt) ?? 'necunoscut'}`
}

export function runtimeVersionLabel(evidence: RuntimeVersionEvidence | null): string {
  return `Server ${evidence?.commit ?? 'commit necunoscut'} · pornire ${formatLondonTimestamp(evidence?.startedAt) ?? 'necunoscută'}`
}
