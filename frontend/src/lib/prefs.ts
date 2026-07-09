// Per-user speech-language preference. The SERVER owns this value end to end
// now: it detects the language from what the user actually writes, persists
// it, and announces a change over the chat stream (a {lang} control frame).
// The client only READS it (instant localStorage mirror + the server copy on
// load) and mirrors what the server decides — it never writes the server pref
// itself. Best-effort: never throws.

const LS_KEY = 'kelion.speechLang'

export function loadLocalLang(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export async function loadServerPrefs(): Promise<{
  speechLang: string | null
  meserieActiva: number | null
  anthropicKey: string | null
} | null> {
  try {
    const res = await fetch('/api/prefs', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as {
      speechLang: string | null
      meserieActiva: number | null
      anthropicKey: string | null
    }
  } catch {
    return null
  }
}

export async function saveAnthropicKey(key: string | null): Promise<boolean> {
  try {
    const res = await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ anthropicKey: key }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Mirror the server-decided language locally, for an instant read next load.
export function mirrorLang(code: string): void {
  try {
    localStorage.setItem(LS_KEY, code)
  } catch {
    /* ignore */
  }
}
