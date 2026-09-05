import { readFileSync } from 'node:fs'
import { loadKv, saveKvStrict } from '../db.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'

export interface DoctorRuntimeCapability {
  protocol: 2
  guardSha256: string
  workerSha256: string
  publisherSha256: string
}
type Service = 'worker' | 'publisher'
interface CapabilitySql { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string,unknown>[] }> }
interface Measurement { capability: DoctorRuntimeCapability | null; receivedAt: string; releaseSha: string }
const FRESH_MS = 5 * 60_000 // Same bounded freshness as the authenticated Constructor heartbeat.
const HASH = /^[0-9a-f]{64}$/
const keys = ['protocol','guardSha256','workerSha256','publisherSha256'] as const

export function isDoctorRuntimeCapability(value: unknown): value is DoctorRuntimeCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string,unknown>
  return Object.keys(v).length === keys.length && v.protocol === 2
    && keys.slice(1).every((key) => typeof v[key] === 'string' && HASH.test(v[key] as string))
}

function sameCapability(value: unknown, expected: DoctorRuntimeCapability): boolean {
  return isDoctorRuntimeCapability(value) && keys.every((key) => value[key] === expected[key])
}

/** Immutable app-image build output, never an environment or caller supplied
 * trust anchor. A development tree or old image without it stays blocked. */
function expectedCapability(): DoctorRuntimeCapability | null {
  try {
    const raw = readFileSync(new URL('../constructor-doctor-capability.json',import.meta.url),'utf8')
    if (raw.length > 1024) return null
    const parsed: unknown = JSON.parse(raw)
    return isDoctorRuntimeCapability(parsed) ? parsed : null
  } catch { return null }
}

export const doctorLocalReleaseSha = (): string => String(process.env.GIT_COMMIT_SHA ?? '').toLowerCase()
const key = (service: Service): string => `constructor_doctor_${service}_capability_v1`

/** Called only after the existing service-specific HMAC/nonce verification.
 * Missing/null capability actively invalidates an earlier measurement. */
export async function recordDoctorRuntimeCapability(service: Service, capability: unknown, now = Date.now()): Promise<void> {
  if (capability != null && !isDoctorRuntimeCapability(capability)) throw new Error('doctor_runtime_capability_invalid')
  const value: Measurement = { capability:capability == null ? null : capability as DoctorRuntimeCapability,
    receivedAt:new Date(now).toISOString(),releaseSha:doctorLocalReleaseSha() }
  await saveKvStrict(key(service),JSON.stringify(value))
}

export function projectDoctorRuntimeCapability(expected: unknown, measurements: readonly unknown[], releaseSha: string, now = Date.now()): boolean {
  if (!isDoctorRuntimeCapability(expected) || !/^[0-9a-f]{40}$/.test(releaseSha) || measurements.length !== 2) return false
  return measurements.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const value = raw as Partial<Measurement>
    const at = typeof value.receivedAt === 'string' ? Date.parse(value.receivedAt) : Number.NaN
    return value.releaseSha === releaseSha && Number.isFinite(at) && at <= now && now-at <= FRESH_MS
      && sameCapability(value.capability,expected)
  })
}

export async function doctorRuntimeScopeVerified(claim?: { service: Service; capability: unknown }, sql?: CapabilitySql): Promise<boolean> {
  if (!releaseSideEffectsEnabled()) return false
  const expected = expectedCapability()
  if (!expected || (claim && !sameCapability(claim.capability,expected))) return false
  try {
    const measurements = await Promise.all((['worker','publisher'] as const).map(async (service) => {
      // Reuse the intake/publication transaction when one already owns locks;
      // borrowing another pool connection could deadlock a one-slot pool.
      const rows = sql ? await sql.query('SELECT value FROM kv_state WHERE key=$1',[key(service)]) : null
      const raw = rows ? rows.rows[0]?.value : await loadKv(key(service))
      if (typeof raw !== 'string') return null
      return raw ? JSON.parse(raw) as unknown : null
    }))
    return projectDoctorRuntimeCapability(expected,measurements,doctorLocalReleaseSha())
  } catch { return false }
}
