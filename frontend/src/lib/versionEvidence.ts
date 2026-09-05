import { apiFetch } from './transport'

export interface RuntimeVersionEvidence {
  commit: string | null
  startedAt: string | null
}

export interface ReleaseVersionEvidence {
  runtime: RuntimeVersionEvidence | null
  liveCommit: string | null
  state: 'synced' | 'ui_different' | 'runtime_mismatch' | 'unverified'
}
const FULL_SHA = /^[a-f0-9]{40}$/

export function parseReleaseCommit(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string,unknown>
  if (raw.ready !== true || raw.candidate !== false || raw.sideEffectsActive !== true
    || typeof raw.activeCommit !== 'string' || !FULL_SHA.test(raw.activeCommit)) return null
  if (raw.release !== undefined) {
    const nested = raw.release as Record<string,unknown> | null
    if (!nested || nested.candidate !== false || nested.sideEffectsActive !== true) return null
  }
  return raw.activeCommit
}

export function compareReleaseVersions(uiCommit: unknown, runtime: RuntimeVersionEvidence | null, before: string | null, after: string | null): ReleaseVersionEvidence {
  const liveCommit = before && FULL_SHA.test(before) && before === after ? before : null
  let state: ReleaseVersionEvidence['state'] = 'unverified'
  if (liveCommit && runtime?.commit && FULL_SHA.test(runtime.commit)) {
    if (runtime.commit !== liveCommit) state = 'runtime_mismatch'
    else if (typeof uiCommit === 'string' && FULL_SHA.test(uiCommit)) state = uiCommit === liveCommit ? 'synced' : 'ui_different'
  }
  return { runtime,liveCommit,state }
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
  const shortCommit = typeof raw.v === 'string' && /^[a-f0-9]{7,40}$/.test(raw.v)
    && (raw.ver === undefined || raw.ver === raw.v) ? raw.v : null
  const commit = raw.commit === undefined ? shortCommit
    : typeof raw.commit === 'string' && FULL_SHA.test(raw.commit) && shortCommit && raw.commit.startsWith(shortCommit) ? raw.commit : null
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

async function fetchReleaseCommit(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await apiFetch('/api/release-proof', { signal,cache:'no-store' })
    return response.ok ? parseReleaseCommit(await response.json()) : null
  } catch { return null }
}

/** Bracket the runtime read with exact active proofs. A cutover or failed read
 * is unverified; short prefix coincidence is never full-SHA equality. */
export async function fetchReleaseVersions(uiCommit: unknown, signal: AbortSignal): Promise<ReleaseVersionEvidence> {
  const before = await fetchReleaseCommit(signal)
  const runtime = await fetchRuntimeVersion(signal)
  const after = await fetchReleaseCommit(signal)
  return compareReleaseVersions(uiCommit,runtime,before,after)
}

export function releaseComparisonLabel(evidence: ReleaseVersionEvidence | null): string {
  if (evidence?.state === 'synced') return 'UI și live sincronizate · SHA complet verificat'
  if (evidence?.state === 'ui_different') return 'UI diferită de live · aplică actualizarea când ești pregătit'
  if (evidence?.state === 'runtime_mismatch') return 'Neconcordanță server / release · nu este confirmată sincronizarea'
  return 'Sincronizare UI / live neverificată'
}

export function installedBuildLabel(version: unknown, builtAt: unknown, commit?: unknown): string {
  const release = typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version) ? `V${version}` : 'versiune necunoscută'
  const revision = typeof commit === 'string' && FULL_SHA.test(commit) ? commit.slice(0,7) : 'necunoscut'
  return `UI ${release} · commit ${revision} · build ${formatLondonTimestamp(builtAt) ?? 'necunoscut'}`
}

export function runtimeVersionLabel(evidence: RuntimeVersionEvidence | null): string {
  return `Server ${evidence?.commit ?? 'commit necunoscut'} · pornire ${formatLondonTimestamp(evidence?.startedAt) ?? 'necunoscută'}`
}
