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
  anthropicKeySet: boolean
} | null> {
  try {
    const res = await fetch('/api/prefs', { credentials: 'include' })
    if (!res.ok) return null
    // Serverul NU mai trimite cheia în clar — doar dacă e setată (anthropicKeySet).
    return (await res.json()) as {
      speechLang: string | null
      meserieActiva: number | null
      anthropicKeySet: boolean
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

// Set the speech language explicitly from Settings (a paying customer choosing
// their own language). PUT /api/prefs persists it; we mirror it locally too.
export async function saveSpeechLang(code: string): Promise<boolean> {
  try {
    const res = await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ speechLang: code }),
    })
    if (res.ok) mirrorLang(code)
    return res.ok
  } catch {
    return false
  }
}

// Self-service account deletion (GDPR: dreptul la ștergere). Wipes the user's
// data server-side and clears the session cookie. Returns true on success.
export async function deleteMyAccount(): Promise<boolean> {
  try {
    const res = await fetch('/api/me/delete', {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}
