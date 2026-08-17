// Kelion's gesture catalog (Adrian, Jul 13) — the canonical key is the CLIP
// NAME (same as in AvatarModel + backend). The admin panel shows every gesture
// with preview + activation checkbox; what is NOT checked is NOT used at all.
export interface GestureItem {
  clip: string // numele clipului RPM (identitatea canonică, folosită la dezactivare + preview)
  label: string // numele afișat, în română
  category: 'Expresii' | 'Repaus (domol)' | 'Conversație' | 'Dansuri'
}

export const GESTURE_CATALOG: GestureItem[] = [
  // Expressions commanded by the brain based on context/sentiment.
  { clip: 'expresie-1', label: 'Salut / rămas-bun', category: 'Expresii' },
  { clip: 'expresie-2', label: 'Arată înainte', category: 'Expresii' },
  { clip: 'expresie-3', label: 'Uimire', category: 'Expresii' },
  { clip: 'expresie-4', label: 'Dezamăgire ușoară', category: 'Expresii' },
  { clip: 'expresie-5', label: 'Nedumerire', category: 'Expresii' },
  { clip: 'expresie-6', label: 'Victorie', category: 'Expresii' },
  { clip: 'expresie-7', label: 'Mulțumire', category: 'Expresii' },
  { clip: 'expresie-8', label: 'Surpriză', category: 'Expresii' },
  { clip: 'expresie-9', label: 'Stai puțin', category: 'Expresii' },
  { clip: 'expresie-10', label: 'Gânditor', category: 'Expresii' },
  { clip: 'expresie-11', label: 'Aprobare', category: 'Expresii' },
  { clip: 'expresie-12', label: 'Entuziasm', category: 'Expresii' },
  { clip: 'expresie-13', label: 'Acord discret', category: 'Expresii' },
  { clip: 'expresie-14', label: 'Plecăciune teatrală', category: 'Expresii' },
  // Gentle idle variations (the chat rotation uses only these 6).
  { clip: 'variatie', label: 'Înclină capul', category: 'Repaus (domol)' },
  { clip: 'variatie-2', label: 'Privire în jos', category: 'Repaus (domol)' },
  { clip: 'variatie-4', label: 'Privește în jur', category: 'Repaus (domol)' },
  { clip: 'variatie-5', label: 'Se uită la mâini', category: 'Repaus (domol)' },
  { clip: 'variatie-6', label: 'Se uită ca la ceas', category: 'Repaus (domol)' },
  { clip: 'variatie-8', label: 'Mută greutatea', category: 'Repaus (domol)' },
  // Conversation gestures (once, while explaining).
  { clip: 'vorbit-1', label: 'Vorbit — calm', category: 'Conversație' },
  { clip: 'vorbit-2', label: 'Vorbit — o mână', category: 'Conversație' },
  { clip: 'vorbit-3', label: 'Vorbit — ambele mâini', category: 'Conversație' },
  { clip: 'vorbit-4', label: 'Vorbit — animat', category: 'Conversație' },
  { clip: 'vorbit-5', label: 'Vorbit — palme deschise', category: 'Conversație' },
  { clip: 'vorbit-6', label: 'Vorbit — privirea sus', category: 'Conversație' },
  { clip: 'vorbit-7', label: 'Vorbit — foarte reținut', category: 'Conversație' },
  { clip: 'vorbit-8', label: 'Vorbit — relaxat', category: 'Conversație' },
  { clip: 'vorbit-9', label: 'Vorbit — deschis calm', category: 'Conversație' },
  // Dansuri (doar la cerere).
  { clip: 'dans', label: 'Dans — energic', category: 'Dansuri' },
  { clip: 'dans-2', label: 'Dans — hip-hop', category: 'Dansuri' },
  { clip: 'dans-3', label: 'Dans — disco', category: 'Dansuri' },
  { clip: 'dans-4', label: 'Dans — brațele sus', category: 'Dansuri' },
  { clip: 'dans-5', label: 'Dans — cu picioare', category: 'Dansuri' },
  { clip: 'dans-6', label: 'Dans — ritmat', category: 'Dansuri' },
  { clip: 'dans-7', label: 'Dans — atletic', category: 'Dansuri' },
  { clip: 'dans-8', label: 'Dans — pași laterali', category: 'Dansuri' },
  { clip: 'dans-9', label: 'Dans — ridicări de picior', category: 'Dansuri' },
  { clip: 'dans-10', label: 'Dans — stilat', category: 'Dansuri' },
]

export const GESTURE_CATEGORIES = ['Expresii', 'Repaus (domol)', 'Conversație', 'Dansuri'] as const

// Preview: asks the avatar to play a gesture once (the channel AvatarModel
// listens on). The name = the clip name.
export function previewGesture(clip: string): void {
  try {
    // SEPARATE channel: the preview plays ANY gesture (so the admin sees it
    // before deciding), even if unchecked. The normal channel ('kelion-gesture') refuses
    // gesturile debifate.
    window.dispatchEvent(new CustomEvent('kelion-gesture-preview', { detail: clip }))
  } catch {
    /* ignore */
  }
}

// The gesture state (the disabled list) — read by the avatar so it doesn't
// play what's removed. Cached on window so AvatarModel sees it without
// depending on the admin.
// null = citirea a EȘUAT (auditul admin, 3 aug): vechiul [] arăta toate cele
// 39 de gesturi ca „active", iar primul toggle salva peste lista reală de pe
// server, ȘTERGÂND dezactivările anterioare — o scriere peste o bază necitită.
export async function fetchDisabledGestures(): Promise<string[] | null> {
  try {
    const r = await fetch('/api/gestures/state', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { disabled?: string[] }
    return Array.isArray(j.disabled) ? j.disabled : []
  } catch {
    return null
  }
}

export async function saveDisabledGestures(disabled: string[]): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/gestures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ disabled }),
    })
    return r.ok
  } catch {
    return false
  }
}
