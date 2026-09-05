import { config } from '../config.js'
import { requestInternalService } from './internalServiceRequest.js'

export type ConstructorModelProfile = 'fast'
export type ConstructorModelState = 'ready' | 'failed' | 'unavailable'

export interface ConstructorConfiguredModel {
  id: string
  label: string
  provider: string
}

export interface ConstructorModelSnapshot {
  mode: 'manual'
  defaultProfile: 'fast'
  model: ConstructorConfiguredModel | null
  profiles: { id: 'fast'; label: string; model: string; installed: boolean }[]
  activeProfile: ConstructorModelProfile | null
  activeModel: string | null
  state: ConstructorModelState
  requestedProfile: null
  requestId: null
  verifiedAt: string | null
  error: string | null
}

const SNAPSHOT_KEYS = ['mode', 'defaultProfile', 'model', 'profiles', 'activeProfile', 'activeModel', 'state', 'requestedProfile', 'requestId', 'verifiedAt', 'error']
const CONTROLLER_KEYS = ['mode', 'defaultProfile', 'model', 'status', 'activeProfile', 'requestedProfile', 'requestId', 'installedProfiles']
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
const plainText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cs}]/u.test(value)

function configuredModel(value: unknown): ConstructorConfiguredModel | null {
  if (!isRecord(value) || !exactKeys(value, ['id', 'label', 'provider'])) return null
  if (!plainText(value.id, 160) || !plainText(value.label, 80) || !plainText(value.provider, 80)) return null
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.id) || value.id.split('/')[0] !== value.provider) return null
  return { id: value.id, label: value.label, provider: value.provider }
}

/** Names come only from the controller's validated deployed configuration.
 * The internal fast identifier is not a model identity or a historic label. */
export function parseConstructorModelSnapshot(value: unknown): ConstructorModelSnapshot | null {
  if (!isRecord(value) || !exactKeys(value, SNAPSHOT_KEYS)) return null
  if (value.mode !== 'manual' || value.defaultProfile !== 'fast' || value.requestedProfile !== null || value.requestId !== null) return null
  const model = configuredModel(value.model)
  if (value.model !== null && model === null) return null
  if (!Array.isArray(value.profiles) || value.profiles.length !== (model ? 1 : 0)) return null
  const profile = value.profiles[0]
  if (model && (!isRecord(profile) || !exactKeys(profile, ['id', 'label', 'model', 'installed']) || profile.id !== 'fast' || profile.label !== model.label || profile.model !== model.id || typeof profile.installed !== 'boolean')) return null
  if (value.state !== 'ready' && value.state !== 'failed' && value.state !== 'unavailable') return null
  if (value.state === 'ready') {
    if (!model || !profile?.installed || value.activeProfile !== 'fast' || value.activeModel !== model.id || value.error !== null) return null
    if (typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt)) || new Date(value.verifiedAt).toISOString() !== value.verifiedAt) return null
  } else if (value.activeProfile !== null || value.activeModel !== null || value.verifiedAt !== null || typeof value.error !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value.error)) return null
  return value as unknown as ConstructorModelSnapshot
}

function unavailable(): Error {
  return new Error('constructor_model_control_unavailable')
}

export async function readConstructorModelSnapshot(now = new Date()): Promise<ConstructorModelSnapshot> {
  const control = config.constructorModelControl
  if (!control.enabled || !control.socket.startsWith('/') || !control.socket.endsWith('.sock') || control.secret.length < 32) throw unavailable()
  let value: unknown
  try {
    const response = await requestInternalService({
      socketPath: control.socket,
      secret: control.secret,
      path: '/v1/model/state',
      body: Buffer.from('{}', 'utf8'),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxResponseBytes: 32 * 1024,
    })
    if (response.status !== 200) throw unavailable()
    value = JSON.parse(response.body.toString('utf8'))
  } catch {
    throw unavailable()
  }
  if (!isRecord(value) || !exactKeys(value, CONTROLLER_KEYS) || value.mode !== 'manual' || value.defaultProfile !== 'fast' || value.requestedProfile !== null || value.requestId !== null) throw unavailable()
  const model = configuredModel(value.model)
  if ((value.model !== null && !model) || !Array.isArray(value.installedProfiles) || value.installedProfiles.length > 1 || value.installedProfiles.some((id) => id !== 'fast')) throw unavailable()
  if (!model && value.installedProfiles.length > 0) throw unavailable()
  if (value.activeProfile !== null && value.activeProfile !== 'fast') throw unavailable()
  const ready = value.status === 'ready'
  if (ready ? !model || value.activeProfile !== 'fast' || value.installedProfiles.length !== 1 : value.activeProfile !== null) throw unavailable()
  const snapshot = parseConstructorModelSnapshot({
    mode: 'manual',
    defaultProfile: 'fast',
    model,
    profiles: model ? [{ id: 'fast', label: model.label, model: model.id, installed: value.installedProfiles.includes('fast') }] : [],
    activeProfile: ready ? 'fast' : null,
    activeModel: ready ? model?.id : null,
    state: value.status,
    requestedProfile: null,
    requestId: null,
    verifiedAt: ready ? now.toISOString() : null,
    error: ready ? null : 'constructor_model_unavailable',
  })
  if (!snapshot) throw unavailable()
  return snapshot
}
