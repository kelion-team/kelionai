import { bindClientStateToAccount, clearClientAccountScope } from './clientState'
import { apiFetch, authUrl } from './transport'
import { isNativeShell, logoutNativeSession, startNativeGoogleLogin } from './nativeAuth'

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

export function startGoogleLogin(next = '/'): void {
  if (isNativeShell()) {
    void startNativeGoogleLogin().catch(() => window.dispatchEvent(new CustomEvent('kelion-native-auth-error')))
    return
  }
  const safeNext = next === '/manual' || next === '/credite' || next === '/credits' ? next : '/'
  window.location.href = authUrl(`/auth/google/login?next=${encodeURIComponent(safeNext)}`)
}

export async function logout(): Promise<void> {
  await forgetCachedUser()
  if (await logoutNativeSession()) {
    window.location.href = '/'
    return
  }
  await apiFetch('/auth/logout', { method: 'POST' })
  window.location.href = '/'
}
