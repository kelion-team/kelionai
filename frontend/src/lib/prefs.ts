import { apiFetch } from './transport'
import { scopedClientKey } from './clientState'

// Per-user speech-language preference. The SERVER owns this value end to end
// now: it detects the language from what the user actually writes, persists
// it, and announces a change over the chat stream (a {lang} control frame).
// The client only READS it (instant localStorage mirror + the server copy on
// load) and mirrors what the server decides — it never writes the server pref
// itself. Best-effort: never throws.

const LS_KEY = 'kelion.speechLang'

export function loadLocalLang(): string | null {
  try {
    const key = scopedClientKey(LS_KEY)
    return key ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

/** La montarea aplicației, cu emailul sesiunii în mână: dacă oglinda de limbă
 *  aparține ALTUI cont (sau nimănui — moștenire veche, nedovedibilă), se
 *  șterge, iar sesiunea revendică oglinda. Idempotent, sincron, best-effort. */
export function revendicaOglindaLimbii(): void {
  try {
    localStorage.removeItem(LS_KEY)
    localStorage.removeItem('kelion.speechLang.cine')
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
    const res = await apiFetch('/api/prefs')
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
    const r = await apiFetch('/api/prefs', {
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
    const res = await apiFetch('/api/prefs', {
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
    const key = scopedClientKey(LS_KEY)
    if (key) localStorage.setItem(key, code)
  } catch {
    /* ignore */
  }
}

// Set the speech language explicitly from Settings (a paying customer choosing
// their own language). PUT /api/prefs persists it; we mirror it locally too.
export async function saveSpeechLang(code: string): Promise<boolean> {
  try {
    const res = await apiFetch('/api/prefs', {
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

export type DeleteAccountResult =
  | {
      ok: true
      receipt: {
        requestId: string
        completedAt: string
        deleted: string[]
        retained: { category: string; reason: string; until: string | null }[]
        backups: { beyondUse: boolean; purgeAfter: string | null }
        googleRevocation: 'completed' | 'manual_required' | 'not_applicable'
      }
    }
  | { ok: false; error: string; reauthenticatePath?: string }

/** Șterge contul numai după confirmarea explicită; succesul vine cu receipt server-side. */
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  try {
    const res = await apiFetch('/api/me/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    })
    const body = (await res.json().catch(() => ({}))) as Partial<DeleteAccountResult> & {
      error?: string
      reauthenticatePath?: string
    }
    if (res.ok && body.ok === true && 'receipt' in body && body.receipt) {
      return body as Extract<DeleteAccountResult, { ok: true }>
    }
    return {
      ok: false,
      error: body.error ?? `delete_http_${res.status}`,
      ...(body.reauthenticatePath ? { reauthenticatePath: body.reauthenticatePath } : {}),
    }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}
