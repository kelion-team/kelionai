// Per-user speech-language preference. Persists server-side (survives across
// devices for as long as the user exists) with a localStorage mirror for an
// instant read on load. Best-effort: never throws.

const LS_KEY = 'kelion.speechLang'

export function loadLocalLang(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export async function loadServerLang(): Promise<string | null> {
  try {
    const res = await fetch('/api/prefs', { credentials: 'include' })
    if (!res.ok) return null
    const j = (await res.json()) as { speechLang?: string | null }
    return j.speechLang ?? null
  } catch {
    return null
  }
}

export function saveLang(code: string): void {
  try {
    localStorage.setItem(LS_KEY, code)
  } catch {
    /* ignore */
  }
  void fetch('/api/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ speechLang: code }),
  }).catch(() => undefined)
}
