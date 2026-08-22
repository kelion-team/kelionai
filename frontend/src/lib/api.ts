export interface User {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  locale: string
  // True once the user has granted the heavy Google scopes via "Connect Google"
  // (Gmail, Calendar, Drive, Tasks, Contacts). Login alone no longer grants them.
  googleConnected?: boolean
}

export interface MeResponse {
  authenticated: boolean
  user?: User
  // Nu am putut AJUNGE la server (offline/avion), spre deosebire de „serverul a spus
  // că nu ești logat". Owner 20 aug: „in avion nu se poate loga, zice ofline".
  offline?: boolean
}

// URMA ULTIMULUI USER LOGAT — ca un user care ERA logat și pierde semnalul (avion) să
// intre în mod companion offline, nu să fie trimis la login (unde oricum nu poate,
// n-are net). Offline NU expune date de cont (fără server/Google/memorie — vezi
// creierLocal), iar la revenire serverul reconfirmă; deci e sigur.
const CHEIE_USER = 'kelion_last_user'
function cacheazaUser(u: User | null): void {
  try {
    if (u) localStorage.setItem(CHEIE_USER, JSON.stringify(u))
    else localStorage.removeItem(CHEIE_USER)
  } catch {
    /* storage indisponibil */
  }
}
export function userDinCache(): User | null {
  try {
    const raw = localStorage.getItem(CHEIE_USER)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export async function fetchMe(): Promise<MeResponse> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' })
    if (res.ok) {
      const me = (await res.json()) as MeResponse
      cacheazaUser(me.authenticated && me.user ? me.user : null)
      return me
    }
    // Serverul a răspuns EXPLICIT „nu ești logat" → definitiv: curăță cache-ul.
    if (res.status === 401 || res.status === 403) {
      cacheazaUser(null)
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

export function startGoogleLogin(): void {
  window.location.href = '/auth/google/login'
}

// "Connect Google services": incremental consent for the heavy scopes (Gmail,
// Calendar, Drive, Tasks, Contacts). Only meaningful for a signed-in user; the
// backend redirects to the login page otherwise.
export function startGoogleConnect(): void {
  window.location.href = '/auth/google/connect'
}


export async function logout(): Promise<void> {
  cacheazaUser(null) // la logout, uită userul din cache (nu-l mai lăsa în companion offline)
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/'
}
