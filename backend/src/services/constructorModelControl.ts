import { config } from '../config.js'
import { requestInternalService } from './internalServiceRequest.js'

export type ConstructorModelProfile = 'fast' | 'powerful'
export type ConstructorModelState = 'ready' | 'switching' | 'failed' | 'unavailable'

export interface ConstructorModelProfileInfo {
  id: ConstructorModelProfile
  label: string
  model: string
  installed: boolean
}

export interface ConstructorModelSnapshot {
  mode: 'manual'
  defaultProfile: 'fast'
  profiles: ConstructorModelProfileInfo[]
  activeProfile: ConstructorModelProfile | null
  activeModel: string | null
  state: ConstructorModelState
  requestedProfile: ConstructorModelProfile | null
  requestId: string | null
  verifiedAt: string | null
  error: string | null
}

export type ConstructorModelConflict = 'constructor_busy' | 'model_switch_in_progress'

export class ConstructorModelControlError extends Error {
  constructor(
    readonly statusCode: 409 | 503,
    readonly publicCode: ConstructorModelConflict | 'constructor_model_control_unavailable',
  ) {
    super(publicCode)
    this.name = 'ConstructorModelControlError'
  }
}

const PROFILE_IDS = ['fast', 'powerful'] as const
const PROFILE_CATALOG: Readonly<Record<ConstructorModelProfile, Omit<ConstructorModelProfileInfo, 'installed'>>> = {
  // Aliasurile sunt contractul local fix dintre OpenCode și llama.cpp; numele
  // afișate rămân aici, în server, și nu sunt duplicate în browser.
  fast: { id: 'fast', label: 'Rapid (35B)', model: 'qwen3.6-35b-a3b-local' },
  powerful: { id: 'powerful', label: 'Puternic (122B)', model: 'qwen3.5-122b-a10b-local' },
}
const SNAPSHOT_KEYS = [
  'mode',
  'defaultProfile',
  'profiles',
  'activeProfile',
  'activeModel',
  'state',
  'requestedProfile',
  'requestId',
  'verifiedAt',
  'error',
] as const
const PROFILE_KEYS = ['id', 'label', 'model', 'installed'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function displayText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return null
  if (value.trim() !== value || /\p{Cc}/u.test(value)) return null
  return value
}

function profileId(value: unknown): ConstructorModelProfile | null {
  return value === 'fast' || value === 'powerful' ? value : null
}

function nullableProfile(value: unknown): ConstructorModelProfile | null | undefined {
  if (value === null) return null
  return profileId(value) ?? undefined
}

function exactIso(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const millis = Date.parse(value)
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? value : undefined
}

function nullableRequestId(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined
}

function nullableError(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value)
    ? value
    : undefined
}

function parseProfiles(value: unknown): ConstructorModelProfileInfo[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const parsed: ConstructorModelProfileInfo[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, PROFILE_KEYS)) return null
    const id = profileId(candidate.id)
    const label = displayText(candidate.label, 80)
    const model = displayText(candidate.model, 160)
    if (!id || !label || !model || typeof candidate.installed !== 'boolean') return null
    parsed.push({ id, label, model, installed: candidate.installed })
  }
  if (new Set(parsed.map((profile) => profile.id)).size !== PROFILE_IDS.length) return null
  return PROFILE_IDS.map((id) => parsed.find((profile) => profile.id === id)!)
}

/** Controllerul host este autoritatea pentru inventarul instalat și aliasul
 * activ. Browserul primește numai acest snapshot validat, niciodată fallbackuri
 * hardcodate care ar putea descrie un model inexistent. */
export function parseConstructorModelSnapshot(value: unknown): ConstructorModelSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return null
  if (value.mode !== 'manual' || value.defaultProfile !== 'fast') return null
  const profiles = parseProfiles(value.profiles)
  const activeProfile = nullableProfile(value.activeProfile)
  const requestedProfile = nullableProfile(value.requestedProfile)
  const requestId = nullableRequestId(value.requestId)
  const verifiedAt = exactIso(value.verifiedAt)
  const error = nullableError(value.error)
  const activeModel = value.activeModel === null ? null : displayText(value.activeModel, 160)
  const state = value.state
  if (
    !profiles
    || activeProfile === undefined
    || requestedProfile === undefined
    || requestId === undefined
    || verifiedAt === undefined
    || error === undefined
    || (state !== 'ready' && state !== 'switching' && state !== 'failed' && state !== 'unavailable')
  ) return null

  if ((activeProfile === null) !== (activeModel === null)) return null
  if ((requestedProfile === null) !== (requestId === null)) return null
  if ((activeProfile === null) !== (verifiedAt === null)) return null
  if (activeProfile !== null) {
    const active = profiles.find((profile) => profile.id === activeProfile)
    if (!active?.installed || active.model !== activeModel) return null
  }

  if (state === 'ready') {
    if (activeProfile === null || requestedProfile !== null || requestId !== null || error !== null) return null
  } else if (state === 'switching') {
    if (requestedProfile === null || requestId === null || error !== null) return null
    if (!profiles.find((profile) => profile.id === requestedProfile)?.installed) return null
  } else if (state === 'failed') {
    if (error === null) return null
  } else if (
    error === null
    || activeProfile !== null
    || activeModel !== null
    || requestedProfile !== null
    || requestId !== null
    || verifiedAt !== null
  ) return null

  return {
    mode: 'manual',
    defaultProfile: 'fast',
    profiles,
    activeProfile,
    activeModel,
    state,
    requestedProfile,
    requestId,
    verifiedAt,
    error,
  }
}

function unavailable(): ConstructorModelControlError {
  return new ConstructorModelControlError(503, 'constructor_model_control_unavailable')
}

function configured(): { socketPath: string; secret: string } {
  const control = config.constructorModelControl
  if (
    !control.enabled
    || !control.socket.startsWith('/')
    || !control.socket.endsWith('.sock')
    || control.secret.length < 32
  ) throw unavailable()
  return { socketPath: control.socket, secret: control.secret }
}

async function controlRequest(
  path: '/v1/model/state' | '/v1/model/switch',
  payload: Record<string, unknown>,
): Promise<{ status: number; decoded: unknown }> {
  const control = configured()
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  let response
  try {
    response = await requestInternalService({
      ...control,
      path,
      body,
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxResponseBytes: 32 * 1024,
    })
  } catch {
    throw unavailable()
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(response.body.toString('utf8'))
  } catch {
    throw unavailable()
  }
  return { status: response.status, decoded }
}

function parseConflict(value: unknown): ConstructorModelConflict | null {
  if (!isRecord(value) || !hasExactKeys(value, ['error'])) return null
  if (value.error === 'worker_active') return 'constructor_busy'
  if (value.error === 'switch_in_progress') return 'model_switch_in_progress'
  return null
}

interface ControllerState {
  status: ConstructorModelState
  activeProfile: ConstructorModelProfile | null
  requestedProfile: ConstructorModelProfile | null
  requestId: string | null
  installedProfiles: ConstructorModelProfile[]
}

const CONTROLLER_STATE_KEYS = [
  'mode',
  'defaultProfile',
  'status',
  'activeProfile',
  'requestedProfile',
  'requestId',
  'installedProfiles',
] as const

function parseControllerState(value: unknown): ControllerState | null {
  if (!isRecord(value) || !hasExactKeys(value, CONTROLLER_STATE_KEYS)) return null
  if (value.mode !== 'manual' || value.defaultProfile !== 'fast') return null
  if (
    value.status !== 'ready'
    && value.status !== 'switching'
    && value.status !== 'failed'
    && value.status !== 'unavailable'
  ) return null
  const activeProfile = nullableProfile(value.activeProfile)
  const requestedProfile = nullableProfile(value.requestedProfile)
  const requestId = nullableRequestId(value.requestId)
  if (activeProfile === undefined || requestedProfile === undefined || requestId === undefined) return null
  if (!Array.isArray(value.installedProfiles) || value.installedProfiles.length > PROFILE_IDS.length) return null
  const installedProfiles = value.installedProfiles.map(profileId)
  if (
    installedProfiles.some((profile) => profile === null)
    || new Set(installedProfiles).size !== installedProfiles.length
  ) return null
  const installed = installedProfiles as ConstructorModelProfile[]
  if ((requestedProfile === null) !== (requestId === null)) return null
  if (activeProfile !== null && !installed.includes(activeProfile)) return null

  if (value.status === 'ready') {
    if (activeProfile === null || requestedProfile !== null || requestId !== null) return null
  } else if (value.status === 'switching') {
    if (requestedProfile === null || requestId === null || !installed.includes(requestedProfile)) return null
  } else if (value.status === 'unavailable') {
    if (activeProfile !== null || requestedProfile !== null || requestId !== null) return null
  }
  return { status: value.status, activeProfile, requestedProfile, requestId, installedProfiles: installed }
}

function projectControllerState(value: ControllerState, verifiedAt: string): ConstructorModelSnapshot {
  const active = value.activeProfile === null ? null : PROFILE_CATALOG[value.activeProfile]
  const snapshot: ConstructorModelSnapshot = {
    mode: 'manual',
    defaultProfile: 'fast',
    profiles: PROFILE_IDS.map((id) => ({
      ...PROFILE_CATALOG[id],
      installed: value.installedProfiles.includes(id),
    })),
    activeProfile: value.activeProfile,
    activeModel: active?.model ?? null,
    state: value.status,
    requestedProfile: value.requestedProfile,
    requestId: value.requestId,
    verifiedAt: active ? verifiedAt : null,
    error: value.status === 'failed'
      ? 'constructor_model_switch_failed'
      : value.status === 'unavailable'
        ? 'constructor_model_unavailable'
        : null,
  }
  if (!parseConstructorModelSnapshot(snapshot)) throw unavailable()
  return snapshot
}

export async function readConstructorModelSnapshot(now = new Date()): Promise<ConstructorModelSnapshot> {
  const response = await controlRequest('/v1/model/state', {})
  if (response.status !== 200) throw unavailable()
  const state = parseControllerState(response.decoded)
  if (!state) throw unavailable()
  return projectControllerState(state, now.toISOString())
}

export async function requestConstructorModelSwitch(
  profile: ConstructorModelProfile,
  requestId: string,
  before: ConstructorModelSnapshot,
): Promise<{ statusCode: 200 | 202; snapshot: ConstructorModelSnapshot }> {
  const measuredBefore = parseConstructorModelSnapshot(before)
  if (
    !PROFILE_IDS.includes(profile)
    || !UUID.test(requestId)
    || !measuredBefore
    || measuredBefore.state !== 'ready'
    || measuredBefore.activeProfile === null
    || !measuredBefore.profiles.find((candidate) => candidate.id === profile)?.installed
  ) throw unavailable()
  const response = await controlRequest('/v1/model/switch', { requestId, profile })
  if (response.status === 409) {
    const conflict = parseConflict(response.decoded)
    if (!conflict) throw unavailable()
    throw new ConstructorModelControlError(409, conflict)
  }
  if (
    response.status !== 202
    || !isRecord(response.decoded)
    || !hasExactKeys(response.decoded, ['accepted', 'requestId', 'profile'])
    || response.decoded.accepted !== true
    || response.decoded.requestId !== requestId.toLowerCase()
    || response.decoded.profile !== profile
  ) throw unavailable()
  let reread: ConstructorModelSnapshot | null = null
  try {
    reread = await readConstructorModelSnapshot()
  } catch {
    // ACK-ul durabil nu devine fals 503 dacă măsurătoarea imediată pierde
    // cursa cu operația asincronă sau controllerul este momentan ocupat.
  }
  const correlatedSwitch = reread?.state === 'switching'
    && reread.requestId === requestId.toLowerCase()
    && reread.requestedProfile === profile
  // Controllerul poate termina încărcarea între ACK și recitire. În acel caz
  // requestId-ul este deja curățat, iar singura dovadă acceptată este starea
  // strict validată `ready` chiar pe profilul cerut.
  const completedBeforeRead = reread?.state === 'ready'
    && reread.activeProfile === profile
  if (correlatedSwitch || completedBeforeRead) {
    return { statusCode: completedBeforeRead ? 200 : 202, snapshot: reread! }
  }

  const acknowledged: ConstructorModelSnapshot = {
    ...measuredBefore,
    state: 'switching',
    requestedProfile: profile,
    requestId: requestId.toLowerCase(),
    error: null,
  }
  if (!parseConstructorModelSnapshot(acknowledged)) throw unavailable()
  return { statusCode: 202, snapshot: acknowledged }
}
