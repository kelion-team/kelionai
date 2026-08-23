// ── VEDEREA CONTINUĂ — BACKEND (owner, 22 aug 2026: „simte mediul") ──────────
//
// Stochează observațiile vizuale primite de la frontend (cadre cu mișcare +
// repaus periodic), le ține într-un buffer in-memory (ultimele 20), și le
// expune creierului prin tool-ul `observatii_vizuale` pentru recall contextual.
//
// Nu persistă în DB — observațiile sunt EFEMERE (ultimele 5 minute). Ceea ce
// contează DURABIL se salvează prin `save_note` / `memorie_pune` când creierul
// decide că ceva e demn de ținut minte.

export interface ObservatieStocata {
  ts: number
  lat?: number
  lon?: number
  miscare: number
  imagine: string // base64 JPEG
}

const CAP_MAXIM = 20
const EXPIRA_MS = 5 * 60_000 // 5 minute

let observatii: ObservatieStocata[] = []

/** Adaugă o observație în buffer. Elimină cele expirate. */
export function adaugaObservatie(obs: ObservatieStocata): void {
  const acum = Date.now()
  observatii = observatii.filter((o) => acum - o.ts < EXPIRA_MS)
  observatii.push(obs)
  if (observatii.length > CAP_MAXIM) {
    observatii = observatii.slice(-CAP_MAXIM)
  }
}

/** Ultimele observații vizuale (pentru creier). Fără imagini (bandă). */
export function observatiiRecente(): Array<{ ts: number; miscare: number; lat?: number; lon?: number }> {
  const acum = Date.now()
  return observatii
    .filter((o) => acum - o.ts < EXPIRA_MS)
    .map((o) => ({ ts: o.ts, miscare: o.miscare, lat: o.lat, lon: o.lon }))
}

/** Ultima observație CU imagine (pentru tool-ul `look` al creierului). */
function ultimaObservatieCuImagine(): ObservatieStocata | null {
  const acum = Date.now()
  const valide = observatii.filter((o) => acum - o.ts < EXPIRA_MS)
  return valide.length > 0 ? valide[valide.length - 1] : null
}

/** Câte observații în ultimele N minute. */
export function numarObservatii(minute = 5): number {
  const acum = Date.now()
  return observatii.filter((o) => acum - o.ts < minute * 60_000).length
}
