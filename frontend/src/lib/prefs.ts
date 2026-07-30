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

// Aranjarea avatarului în colț (poziție vw/vh + scală) — a lui Adrian, salvată
// PE SERVER (11 iul: „salvează mărimea actuală a lui Kelion").
export interface AvatarBox {
  x: number
  y: number
  s: number
}

export async function loadServerPrefs(): Promise<{
  speechLang: string | null
  meserieActiva: number | null
  avatarBox?: AvatarBox | null
  /** Vocea aleasă de user; `null` = cea implicită a aplicației. */
  voice?: string | null
  /** Lista din care poate alege. Vine de la server, ca interfața să nu țină o
   *  listă paralelă care se învechește când se schimbă env-ul. */
  voices?: string[]
} | null> {
  try {
    const res = await fetch('/api/prefs', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as {
      speechLang: string | null
      meserieActiva: number | null
      avatarBox?: AvatarBox | null
      voice?: string | null
      voices?: string[]
    }
  } catch {
    return null
  }
}

/** Salvează vocea aleasă. `null` = revino la vocea implicită a aplicației. */
export async function saveVoicePref(voice: string | null): Promise<boolean> {
  try {
    const r = await fetch('/api/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice }),
    })
    return r.ok
  } catch {
    return false
  }
}

// Persistă aranjarea avatarului per utilizator; best-effort, nu aruncă.
export async function saveAvatarBox(box: AvatarBox): Promise<boolean> {
  try {
    const res = await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ avatarBox: box }),
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
