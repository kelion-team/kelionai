// Per-user speech-language preference. The SERVER owns this value end to end
// now: it detects the language from what the user actually writes, persists
// it, and announces a change over the chat stream (a {lang} control frame).
// The client only READS it (instant localStorage mirror + the server copy on
// load) and mirrors what the server decides — it never writes the server pref
// itself. Best-effort: never throws.

const LS_KEY = 'kelion.speechLang'
// AL CUI e mirror-ul (10 aug, ownerul: „la prima intrare, EN până se determină
// limba USERULUI"): localStorage e pe BROWSER, nu pe cont — un user nou logat pe
// un browser folosit înainte în română moștenea „ro" de la contul anterior.
// Cheia de mai jos leagă oglinda de email; alt cont => oglinda se aruncă și
// aplicația pornește pe EN, până serverul determină limba omului ăstuia.
const LS_CINE = 'kelion.speechLang.cine'

export function loadLocalLang(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

/** La montarea aplicației, cu emailul sesiunii în mână: dacă oglinda de limbă
 *  aparține ALTUI cont (sau nimănui — moștenire veche, nedovedibilă), se
 *  șterge, iar sesiunea revendică oglinda. Idempotent, sincron, best-effort. */
export function revendicaOglindaLimbii(email: string): void {
  try {
    if (localStorage.getItem(LS_CINE) !== email) {
      localStorage.removeItem(LS_KEY)
      localStorage.setItem(LS_CINE, email)
    }
  } catch {
    /* ignore */
  }
}

// The avatar's corner arrangement (vw/vh position + scale) — Adrian's,
// saved ON THE SERVER (Jul 11: "save Kelion's current size").
export interface AvatarBox {
  x: number
  y: number
  s: number
}

export async function loadServerPrefs(): Promise<{
  speechLang: string | null
  meserieActiva: number | null
  avatarBox?: AvatarBox | null
  /** The voice chosen by the user; `null` = the app's default. */
  voice?: string | null
  /** The list they can choose from. Comes from the server, so the interface
   *  doesn't keep a parallel list that goes stale when the env changes. */
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

/** Saves the chosen voice. `null` = return to the app's default voice. */
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

// Persists the avatar arrangement per user; best-effort, never throws.
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

/**
 * Mirror the server-decided language locally, for an instant read next load.
 * Best-effort: catches storage errors silently.
 */
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

// Cererea de ștergere de cont. [ADUS LA COD, lot D] Serverul REFUZĂ mereu
// (routes/me.ts → 403 `stergerea_prin_comanda_inchisa`, ordinul din 14 aug:
// „baza nu se șterge prin nicio comandă") — deci întoarce false întotdeauna;
// nimic nu se șterge de aici. Butonul din CustomerSettings pică tăcut —
// rând deschis de registru (lot D #4).
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
