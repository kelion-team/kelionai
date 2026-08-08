// Catalogul de gesturi al lui Kelion (Adrian, 13 iul) — cheia canonică e NUMELE
// CLIPULUI (la fel ca în AvatarModel + backend). Panoul admin arată fiecare gest
// cu preview + casetă de activare; ce NU e bifat NU se folosește deloc.
export interface GestureItem {
  clip: string // numele clipului RPM (identitatea canonică, folosită la dezactivare + preview)
  label: string // numele afișat, în română
  category: 'Expresii' | 'Repaus (domol)' | 'Conversație' | 'Dansuri'
}

export const GESTURE_CATALOG: GestureItem[] = [
  // Expresii comandate de creier după context/sentiment.
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
  // Variații domoale de repaus (rotația din chat folosește doar aceste 6).
  { clip: 'variatie', label: 'Înclină capul', category: 'Repaus (domol)' },
  { clip: 'variatie-2', label: 'Privire în jos', category: 'Repaus (domol)' },
  { clip: 'variatie-4', label: 'Privește în jur', category: 'Repaus (domol)' },
  { clip: 'variatie-5', label: 'Se uită la mâini', category: 'Repaus (domol)' },
  { clip: 'variatie-6', label: 'Se uită ca la ceas', category: 'Repaus (domol)' },
  { clip: 'variatie-8', label: 'Mută greutatea', category: 'Repaus (domol)' },
  // Gesturi de conversație (o dată, cât explică).
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

// Preview: cere avatarului să joace un gest o dată (canalul pe care AvatarModel
// îl ascultă). Numele = numele clipului.
export function previewGesture(clip: string): void {
  try {
    // Canal SEPARAT: preview-ul joacă ORICE gest (ca adminul să-l vadă înainte
    // să decidă), chiar dacă e debifat. Canalul normal ('kelion-gesture') refuză
    // gesturile debifate.
    window.dispatchEvent(new CustomEvent('kelion-gesture-preview', { detail: clip }))
  } catch {
    /* ignore */
  }
}

// Starea de gesturi (lista dezactivată) — citită de avatar ca să nu joace ce e
// scos. Cache pe window ca AvatarModel s-o vadă fără să depindă de admin.
export async function fetchDisabledGestures(): Promise<string[]> {
  try {
    const r = await fetch('/api/gestures/state', { credentials: 'include' })
    if (!r.ok) return []
    const j = (await r.json()) as { disabled?: string[] }
    return Array.isArray(j.disabled) ? j.disabled : []
  } catch {
    return []
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
