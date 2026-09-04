import { bindClientStateToAccount, clearClientAccountScope } from './clientState'
import { apiFetch, authUrl } from './transport'
import { isNativeShell, logoutNativeSession, startNativeGoogleLogin } from './nativeAuth'
import { marcheazaPlecarea } from './errorReport'

export interface User {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  locale: string
  /** UUID opac emis de server, folosit numai pentru izolarea stării locale. */
  clientStorageId?: string
}

export interface MeResponse {
  authenticated: boolean
  user?: User
  // Nu am putut AJUNGE la server (offline/avion), spre deosebire de „serverul a spus
  // că nu ești logat". Owner 20 aug: „in avion nu se poate loga, zice ofline".
  offline?: boolean
}

// Markerul permite numai companionul local. Nu persistă identitate, rol sau poză.
const CHEIE_USER = 'kelion_last_user'
function cacheazaPrezenta(u: User | null): void {
  try {
    if (u) localStorage.setItem(CHEIE_USER, '1')
    else localStorage.removeItem(CHEIE_USER)
  } catch {
    /* storage indisponibil */
  }
}
function userDinCache(): User | null {
  try {
    const raw = localStorage.getItem(CHEIE_USER)
    if (!raw) return null
    // Migrează orice cache vechi cu PII la markerul minimal.
    if (raw !== '1') localStorage.setItem(CHEIE_USER, '1')
    return {
      email: '',
      name: 'Offline',
      picture: '',
      role: 'customer',
      locale: 'en',
    }
  } catch {
    return null
  }
}

export async function forgetCachedUser(): Promise<void> {
  cacheazaPrezenta(null)
  await clearClientAccountScope()
}

/** Deschide numai companionul local, fără nicio încercare de rețea. */
export function cachedOfflineMe(): MeResponse {
  const cached = userDinCache()
  return cached
    ? { authenticated: true, user: cached, offline: true }
    : { authenticated: false, offline: true }
}

export async function fetchMe(): Promise<MeResponse> {
  try {
    const res = await apiFetch('/auth/me')
    if (res.ok) {
      const me = (await res.json()) as MeResponse
      if (me.authenticated && me.user && !(await bindClientStateToAccount(me.user.clientStorageId ?? ''))) {
        // Un răspuns incomplet nu are voie să distrugă coada contului cunoscut.
        // Accesul online rămâne închis până când serverul furnizează UUID-ul opac.
        cacheazaPrezenta(null)
        return { authenticated: false }
      }
      cacheazaPrezenta(me.authenticated && me.user ? me.user : null)
      return me
    }
    // Sesiunea poate expira cât există ture offline. Ascundem imediat suprafețele
    // autentificate, dar păstrăm namespace-ul opac până la logout/ștergere sau
    // până când serverul confirmă un alt clientStorageId după reautentificare.
    if (res.status === 401 || res.status === 403) {
      cacheazaPrezenta(null)
      return { authenticated: false }
    }
    // Alt eșec de server (5xx/proxy) — nu e „nelogat"; cade pe cache ca la offline.
    const cache5xx = userDinCache()
    return cache5xx ? { authenticated: true, user: cache5xx, offline: true } : { authenticated: false, offline: true }
  } catch {
    // Nu am ajuns la server (offline/avion). Dacă ERA logat, îl lăsăm în companion cu
    // userul din cache; altfel, chiar nu are cont pe acest dispozitiv.
    const cache = userDinCache()
    return cache ? { authenticated: true, user: cache, offline: true } : { authenticated: false, offline: true }
  }
}

export type SafeAuthReturnPath = '/' | '/manual' | '/credite' | '/credits'

const SAFE_AUTH_RETURN_PATHS = new Set<SafeAuthReturnPath>(['/', '/manual', '/credite', '/credits'])

export type AuthNavigationSnapshot = Readonly<{
  returnTo: SafeAuthReturnPath
  error: string | null
  reason: string | null
  message: string | null
}>

const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  closed: 'KelionAI is currently private. This account does not have access.',
  blocked: 'This account is blocked. Contact support; retrying will not restore access.',
  bad_state: 'The Google security check expired or was invalid. Start sign-in again.',
  token_exchange: 'Google sign-in could not be completed. Start sign-in again.',
  no_id_token: 'Google did not return an identity. Start sign-in again.',
  invalid_identity: 'Google did not return a verified identity. Start sign-in again.',
  account_mismatch: 'Use the same Google account as the current KelionAI session, then reconnect.',
  no_refresh_token: 'Google did not grant long-term access. Reconnect and approve access.',
  token_store: 'KelionAI could not save the Google connection securely. Try again or contact support.',
  session_expired: 'The KelionAI session expired during Google connection. Sign in again, then reconnect.',
  native_request_expired: 'The sign-in request expired. Start sign-in again.',
  oauth_failed: 'Google sign-in could not be completed. Please try again.',
}

export function safeAuthReturnPath(raw: unknown): SafeAuthReturnPath {
  return typeof raw === 'string' && SAFE_AUTH_RETURN_PATHS.has(raw as SafeAuthReturnPath)
    ? raw as SafeAuthReturnPath
    : '/'
}

export function readAuthNavigation(search: string): AuthNavigationSnapshot {
  const params = new URLSearchParams(search)
  const error = params.get('error')
  const reason = params.get('reason')
  const diagnostic = error === 'oauth_failed' && reason ? reason : error
  return Object.freeze({
    returnTo: safeAuthReturnPath(params.get('next')),
    error,
    reason,
    message: diagnostic ? AUTH_ERROR_MESSAGES[diagnostic] ?? AUTH_ERROR_MESSAGES.oauth_failed : null,
  })
}

export function authNoticeForAuthenticatedUser(
  navigation: AuthNavigationSnapshot,
  authenticated: boolean,
): string | null {
  return authenticated ? navigation.message : null
}

export function startGoogleLogin(next = '/'): void {
  if (isNativeShell()) {
    void startNativeGoogleLogin().catch(() => window.dispatchEvent(new CustomEvent('kelion-native-auth-error')))
    return
  }
  const safeNext = safeAuthReturnPath(next)
  window.location.href = authUrl(`/auth/google/login?next=${encodeURIComponent(safeNext)}`)
}

export async function logout(): Promise<void> {
  await forgetCachedUser()
  // `GET /` din jurnalul serverului trebuie să poată fi atribuit: marcăm
  // plecarea, ca post-mortemul să nu o confunde cu o moarte a tabului.
  marcheazaPlecarea('navigare:logout')
  if (await logoutNativeSession()) {
    window.location.href = '/'
    return
  }
  await apiFetch('/auth/logout', { method: 'POST' })
  window.location.href = '/'
}
