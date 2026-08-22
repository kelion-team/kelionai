// ── MEMORIA EMOȚIONALĂ — BACKEND (owner, 22 aug 2026: „simte") ───────────────
//
// Stochează stările emoționale detectate de la frontend. Le ține in-memory
// (ultimele 20) și le expune creierului prin tool-ul `stare_emotionala`.
// Le salvează și ca memorie tipizată (emotional) în DB pentru recall durabil.

import { addMemory } from '../db.js'

export type Emotie = 'vesel' | 'suparat' | 'surprins' | 'trist' | 'calm' | 'stresat' | 'neutru'

export interface StareEmotionalaStocata {
  emotie: Emotie
  intensitate: number
  ts: number
}

const CAP_MAXIM = 20
const EXPIRA_MS = 30 * 60_000 // 30 minute
const SALVARE_DB_INTERVAL_MS = 5 * 60_000 // salvează în DB la 5 min

let stari: StareEmotionalaStocata[] = []
let ultimaSalvareDb = 0
let userEmailPentruSalvare = ''

/** Adaugă o stare emoțională. */
export function adaugaStareEmotionala(stare: StareEmotionalaStocata, email: string): void {
  const acum = Date.now()
  stari = stari.filter((s) => acum - s.ts < EXPIRA_MS)
  stari.push(stare)
  if (stari.length > CAP_MAXIM) stari = stari.slice(-CAP_MAXIM)
  userEmailPentruSalvare = email
  // Salvează în DB periodic (nu la fiecare detecție — ar îneca memoria)
  if (acum - ultimaSalvareDb > SALVARE_DB_INTERVAL_MS && stare.emotie !== 'neutru' && stare.emotie !== 'calm') {
    ultimaSalvareDb = acum
    const continut = `[EMOȚIONAL] ${stare.emotie.toUpperCase()} (intensitate ${stare.intensitate}%)`
    void addMemory(email, continut, 'kelion', {
      tip: 'emotional',
      importanta: 0.65,
      expiraInMs: 7 * 24 * 60 * 60 * 1000, // 7 zile
    }).catch(() => undefined)
  }
}

/** Ultimele stări emoționale (pentru creier). */
export function stariEmotionaleRecente(): StareEmotionalaStocata[] {
  const acum = Date.now()
  return stari.filter((s) => acum - s.ts < EXPIRA_MS)
}

/** Ultima stare emoțională curentă. */
export function ultimaStareEmotionala(): StareEmotionalaStocata | null {
  const recente = stariEmotionaleRecente()
  return recente.length > 0 ? recente[recente.length - 1] : null
}

/** Emoția dominantă în ultimele N minute. */
export function emotieDominanta(minute = 10): Emotie | null {
  const acum = Date.now()
  const recente = stari.filter((s) => acum - s.ts < minute * 60_000 && s.emotie !== 'neutru')
  if (recente.length === 0) return null
  const frecventa: Record<string, number> = {}
  for (const s of recente) {
    frecventa[s.emotie] = (frecventa[s.emotie] ?? 0) + 1
  }
  return Object.entries(frecventa).sort((a, b) => b[1] - a[1])[0][0] as Emotie
}
