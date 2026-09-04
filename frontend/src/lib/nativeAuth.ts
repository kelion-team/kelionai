import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { productConfig } from './productConfig'

type NativePlatform = 'ios' | 'desktop' | 'constructor-desktop'
type SecureKind = 'install-id' | 'access-token' | 'pending-auth' | 'pending-revocation'

interface NativeSecureSessionPlugin {
  get(options: { kind: SecureKind }): Promise<{ value: string | null }>
  set(options: { kind: SecureKind; value: string }): Promise<void>
  delete(options: { kind: SecureKind }): Promise<void>
  openAuthorize(options: { url: string }): Promise<void>
}

interface AccessRecord {
  token: string
  expiresAt: number
}

interface PendingAuth {
  platform: NativePlatform
  installId: string
  verifier: string
  state: string
  expiresAt: number
}

const iosSecure = registerPlugin<NativeSecureSessionPlugin>('NativeSecureSession')
const nativeFetch = globalThis.fetch.bind(globalThis)
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATE_RE = /^[A-Za-z0-9_-]{24,128}$/
const publicOrigin = new URL(productConfig.publicAppOrigin)

let accessCache: AccessRecord | null | undefined
let initialised: Promise<void> | null = null
let callbackInFlight: Promise<void> | null = null

function platform(): NativePlatform | null {
  if (typeof window === 'undefined') return null
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') return 'ios'
  if ('__TAURI_INTERNALS__' in window) {
    const declared = document.querySelector<HTMLMetaElement>('meta[name="kelion-native-platform"]')?.content
    return declared === 'constructor-desktop' ? 'constructor-desktop' : 'desktop'
  }
  return null
}

function nativeRedirect(current: NativePlatform): string {
  return current === 'constructor-desktop'
    ? productConfig.nativeRedirects.constructorDesktop
    : productConfig.nativeRedirects[current]
}

export function usesTauriSecureStore(current: NativePlatform | null): current is 'desktop' | 'constructor-desktop' {
  return current === 'desktop' || current === 'constructor-desktop'
}

export function isNativeShell(): boolean {
  return platform() !== null
}

async function secureGet(kind: SecureKind): Promise<string | null> {
  const current = platform()
  if (current === 'ios') return (await iosSecure.get({ kind })).value
  if (usesTauriSecureStore(current)) return invoke<string | null>('native_secure_get', { kind })
  throw new Error('native_secure_store_unavailable')
}

async function secureSet(kind: SecureKind, value: string): Promise<void> {
  const current = platform()
  if (current === 'ios') return iosSecure.set({ kind, value })
  if (usesTauriSecureStore(current)) return invoke<void>('native_secure_set', { kind, value })
  throw new Error('native_secure_store_unavailable')
}

async function secureDelete(kind: SecureKind): Promise<void> {
  const current = platform()
  if (current === 'ios') return iosSecure.delete({ kind })
  if (usesTauriSecureStore(current)) return invoke<void>('native_secure_delete', { kind })
  throw new Error('native_secure_store_unavailable')
}

function parseAccess(raw: string | null): AccessRecord | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AccessRecord>
    if (!TOKEN_RE.test(String(parsed.token ?? '')) || !Number.isSafeInteger(parsed.expiresAt) || Number(parsed.expiresAt) <= Date.now()) return null
    return { token: String(parsed.token), expiresAt: Number(parsed.expiresAt) }
  } catch {
    return null
  }
}

async function accessRecord(): Promise<AccessRecord | null> {
  if (accessCache !== undefined) return accessCache
  const raw = await secureGet('access-token')
  const parsed = parseAccess(raw)
  accessCache = parsed
  if (raw && !parsed) await secureDelete('access-token')
  return parsed
}

function firstPartyApiTarget(input: RequestInfo | URL): URL | null {
  const raw = input instanceof Request ? input.url : String(input)
  let target: URL
  try {
    target = new URL(raw, publicOrigin)
  } catch {
    return null
  }
  if (target.origin !== publicOrigin.origin || (!target.pathname.startsWith('/api/') && !target.pathname.startsWith('/auth/'))) return null
  return target
}

async function nativeAuthorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = firstPartyApiTarget(input)
  if (!platform() || !target) return nativeFetch(input, init)
  const base = input instanceof Request ? new Request(target, input) : new Request(target, init)
  const headers = new Headers(base.headers)
  const access = await accessRecord()
  if (access) headers.set('authorization', `Bearer ${access.token}`)
  return nativeFetch(new Request(base, { credentials: 'omit', headers }))
}

export function installNativeFetchBoundary(): void {
  if (!platform() || globalThis.fetch === nativeAuthorizedFetch) return
  globalThis.fetch = nativeAuthorizedFetch
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64Url(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

async function installId(): Promise<string> {
  const existing = await secureGet('install-id')
  if (existing && UUID_RE.test(existing)) return existing
  const created = crypto.randomUUID()
  await secureSet('install-id', created)
  return created
}

async function openSystemBrowser(url: string, current: NativePlatform): Promise<void> {
  if (current === 'ios') await iosSecure.openAuthorize({ url })
  else await openUrl(url)
}

export function validateNativeAuthorizeUrl(raw: unknown): string {
  const url = new URL(String(raw ?? ''))
  const keys = [...url.searchParams.keys()]
  if (
    url.origin !== publicOrigin.origin
    || url.pathname !== '/auth/native/authorize'
    || url.hash
    || keys.length !== 1
    || keys[0] !== 'request'
    || !url.searchParams.get('request')
  ) throw new Error('native_authorize_url_invalid')
  return url.toString()
}

export async function startNativeGoogleLogin(): Promise<boolean> {
  const current = platform()
  if (!current) return false
  const device = await installId()
  const { verifier, challenge } = await pkce()
  const response = await nativeFetch(new URL('/auth/native/start', publicOrigin), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: current, installId: device, codeChallenge: challenge }),
  })
  if (!response.ok) throw new Error(`native_auth_start_${response.status}`)
  const body = await response.json() as { authorizeUrl?: unknown; state?: unknown; expiresIn?: unknown }
  const authorizeUrl = validateNativeAuthorizeUrl(body.authorizeUrl)
  const state = String(body.state ?? '')
  const expiresIn = Number(body.expiresIn)
  if (!STATE_RE.test(state) || !Number.isSafeInteger(expiresIn) || expiresIn < 30 || expiresIn > 600) throw new Error('native_auth_start_invalid')
  const pending: PendingAuth = { platform: current, installId: device, verifier, state, expiresAt: Date.now() + expiresIn * 1_000 }
  await secureSet('pending-auth', JSON.stringify(pending))
  await openSystemBrowser(authorizeUrl, current)
  return true
}

function parsePending(raw: string | null): PendingAuth | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingAuth>
    if (
      !['ios', 'desktop', 'constructor-desktop'].includes(String(value.platform))
      || !UUID_RE.test(String(value.installId ?? ''))
      || !TOKEN_RE.test(String(value.verifier ?? ''))
      || !STATE_RE.test(String(value.state ?? ''))
      || !Number.isSafeInteger(value.expiresAt)
      || Number(value.expiresAt) <= Date.now()
    ) return null
    return value as PendingAuth
  } catch {
    return null
  }
}

export function nativeCallbackParameters(raw: string, current: NativePlatform): { code: string; state: string } | null {
  let callback: URL
  let expected: URL
  try {
    callback = new URL(raw)
    expected = new URL(nativeRedirect(current))
  } catch {
    return null
  }
  const keys = [...callback.searchParams.keys()].sort()
  if (
    callback.protocol !== expected.protocol
    || callback.hostname !== expected.hostname
    || callback.port !== expected.port
    || callback.pathname !== expected.pathname
    || callback.username
    || callback.password
    || callback.hash
    || keys.length !== 2
    || keys[0] !== 'code'
    || keys[1] !== 'state'
  ) return null
  const code = callback.searchParams.get('code') ?? ''
  const state = callback.searchParams.get('state') ?? ''
  return TOKEN_RE.test(code) && STATE_RE.test(state) ? { code, state } : null
}

export async function handleNativeAuthCallback(raw: string): Promise<boolean> {
  const current = platform()
  if (!current) return false
  const parameters = nativeCallbackParameters(raw, current)
  if (!parameters) return false
  const pendingRaw = await secureGet('pending-auth')
  const pending = parsePending(pendingRaw)
  if (!pending || pending.platform !== current || parameters.state !== pending.state) {
    await secureDelete('pending-auth')
    throw new Error('native_auth_callback_state_invalid')
  }
  const response = await nativeFetch(new URL('/auth/native/exchange', publicOrigin), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: current,
      installId: pending.installId,
      code: parameters.code,
      state: parameters.state,
      verifier: pending.verifier,
    }),
  })
  if (!response.ok) throw new Error(`native_auth_exchange_${response.status}`)
  const body = await response.json() as { accessToken?: unknown; tokenType?: unknown; expiresIn?: unknown }
  const token = String(body.accessToken ?? '')
  const expiresIn = Number(body.expiresIn)
  if (!TOKEN_RE.test(token) || body.tokenType !== 'Bearer' || !Number.isSafeInteger(expiresIn) || expiresIn < 60) {
    throw new Error('native_auth_exchange_invalid')
  }
  const access: AccessRecord = { token, expiresAt: Date.now() + expiresIn * 1_000 }
  await secureSet('access-token', JSON.stringify(access))
  await secureDelete('pending-auth')
  accessCache = access
  window.dispatchEvent(new CustomEvent('kelion-native-authenticated'))
  return true
}

async function processCallback(raw: string): Promise<void> {
  if (callbackInFlight) return callbackInFlight
  callbackInFlight = handleNativeAuthCallback(raw)
    .then((handled) => { if (handled) window.location.replace('/') })
    .catch(() => { window.dispatchEvent(new CustomEvent('kelion-native-auth-error')) })
    .finally(() => { callbackInFlight = null })
  return callbackInFlight
}

async function retryPendingRevocation(): Promise<void> {
  const token = await secureGet('pending-revocation')
  if (!token || !TOKEN_RE.test(token)) {
    if (token) await secureDelete('pending-revocation')
    return
  }
  const response = await nativeFetch(new URL('/auth/native/logout', publicOrigin), {
    method: 'POST', credentials: 'omit', headers: { authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (response?.status === 204) await secureDelete('pending-revocation')
}

export async function initialiseNativeAuth(): Promise<void> {
  const current = platform()
  if (!current) return
  if (initialised) return initialised
  installNativeFetchBoundary()
  initialised = (async () => {
    if (navigator.onLine !== false) await retryPendingRevocation()
    else {
      const retryOnReconnect = (): void => {
        window.removeEventListener('online', retryOnReconnect)
        void retryPendingRevocation()
      }
      window.addEventListener('online', retryOnReconnect, { once: true })
    }
    if (current === 'ios') {
      await App.addListener('appUrlOpen', ({ url }) => { void processCallback(url) })
      const launch = await App.getLaunchUrl()
      if (launch?.url) await processCallback(launch.url)
    } else {
      await onOpenUrl((urls) => { for (const url of urls) void processCallback(url) })
      const urls = await getCurrent()
      for (const url of urls ?? []) await processCallback(url)
    }
  })()
  return initialised
}

export async function logoutNativeSession(): Promise<boolean> {
  if (!platform()) return false
  const access = await accessRecord()
  accessCache = null
  if (access) {
    await secureSet('pending-revocation', access.token)
    await secureDelete('access-token')
    await retryPendingRevocation()
  } else {
    await secureDelete('access-token')
  }
  return true
}

export async function nativeChannelTicket(audience: 'vocal-live' | 'apel' | 'deploy-status'): Promise<string | null> {
  if (!platform()) return null
  const response = await nativeAuthorizedFetch(new URL('/api/auth/native/channel-ticket', publicOrigin), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audience }),
  })
  if (!response.ok) throw new Error(`native_channel_ticket_${response.status}`)
  const body = await response.json() as { ticket?: unknown; protocol?: unknown; expiresIn?: unknown }
  const ticket = String(body.ticket ?? '')
  if (!TOKEN_RE.test(ticket) || body.protocol !== 'kelion-native' || Number(body.expiresIn) > 30) throw new Error('native_channel_ticket_invalid')
  return ticket
}
