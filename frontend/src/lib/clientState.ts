import { activateOfflineDatabaseScope, purgeOfflineDatabase } from './offlineStore'

const ACTIVE_SCOPE_KEY = 'kelion.client.active-scope'
const SENSITIVE_BASE_KEYS = [
  'kelion.offline.sync',
  'kelion.offline.respinse',
  'kelion.offline.amanate',
  'kelion.draft',
  'kelion_scenariu',
  'kelion.speechLang',
  'kelion.speechLang.cine',
] as const

const OPAQUE_SCOPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function activeClientScope(): string | null {
  try {
    const scope = localStorage.getItem(ACTIVE_SCOPE_KEY)
    return scope && OPAQUE_SCOPE.test(scope) ? scope : null
  } catch {
    return null
  }
}

export function scopedClientKey(base: string): string | null {
  const scope = activeClientScope()
  return scope ? `${base}:${scope}` : null
}

function purgeSensitiveLocalState(explicitScopes: readonly (string | null)[] = []): void {
  try {
    const scopes = new Set(
      [...explicitScopes, activeClientScope()].filter((scope): scope is string => Boolean(scope)),
    )
    for (const base of SENSITIVE_BASE_KEYS) {
      localStorage.removeItem(base)
      for (const scope of scopes) localStorage.removeItem(`${base}:${scope}`)
    }
    const keys: string[] = []
    for (let index = 0; index < (localStorage.length ?? 0); index++) {
      const key = localStorage.key(index)
      if (key) keys.push(key)
    }
    for (const key of keys) {
      if (SENSITIVE_BASE_KEYS.some((base) => key === base || key.startsWith(`${base}:`))) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Storage indisponibil: nu există stare locală utilizabilă de purjat.
  }
}

export async function purgeSensitiveClientState(explicitScopes: readonly (string | null)[] = []): Promise<boolean> {
  purgeSensitiveLocalState(explicitScopes)
  return purgeOfflineDatabase()
}

export async function clearClientAccountScope(): Promise<boolean> {
  const currentScope = activeClientScope()
  try {
    // Oprește imediat orice scriere nouă din celelalte taburi. Tranzacția IDB
    // care urmează șterge apoi toate înregistrările și markerul de cont.
    localStorage.removeItem(ACTIVE_SCOPE_KEY)
  } catch {
    /* storage indisponibil */
  }
  return purgeSensitiveClientState([currentScope])
}

/** Leagă starea locală de UUID-ul opac emis de server, niciodată de email. */
export async function bindClientStateToAccount(clientStorageId: string): Promise<boolean> {
  if (!OPAQUE_SCOPE.test(clientStorageId)) {
    return false
  }
  try {
    const nextScope = clientStorageId.toLowerCase()
    const currentScope = activeClientScope()
    if (currentScope !== nextScope) {
      localStorage.removeItem(ACTIVE_SCOPE_KEY)
      if (!(await purgeSensitiveClientState([currentScope]))) return false
    }
    // IDB se activează înaintea cheii vizibile celorlalte taburi. Astfel, nici
    //un write capturat de contul vechi nu poate revendica baza după purge.
    if (!(await activateOfflineDatabaseScope(nextScope))) {
      localStorage.removeItem(ACTIVE_SCOPE_KEY)
      if (!(await purgeSensitiveClientState([currentScope]))) return false
      if (!(await activateOfflineDatabaseScope(nextScope))) return false
    }
    localStorage.setItem(ACTIVE_SCOPE_KEY, nextScope)
    return true
  } catch {
    await clearClientAccountScope()
    return false
  }
}
