// ── CONTEXTUL OFFLINE: GPS + VITEZĂ + VEDERE (mod companion, faza 2) ─────────
// Owner: „doar de chat, GPS cu vedere, să-l facă uman" + „la 2 va putea spune
// viteza de deplasare?" — DA. Aici strângem semnalele pe care creierul LOCAL le
// primește ca să fie UMAN offline: unde ești (coordonate), cât de repede te miști
// (din `coords.speed`, care merge și fără net), și dacă te VEDE (fața prinsă de
// cameră). Totul MĂSURAT — un semnal lipsă e omis, nu inventat (regula #1): dacă
// nu știm viteza, nu spunem o cifră.

export interface SemnaleContext {
  lat?: number
  lon?: number
  /** m/s din `coords.speed` (senzor) sau calculat din poziții. null = necunoscut. */
  vitezaMs?: number | null
  /** Vederea: e o față prinsă de cameră ACUM? */
  fataDetectata?: boolean
  /** Opțional: eticheta expresiei feței (din face-api), dacă există. */
  expresie?: string
}

/** m/s → descriere MĂSURATĂ + treaptă umană. '' dacă viteza e necunoscută (nu
 *  inventăm). Praguri: <0.5 stă pe loc; <2.2 pe jos; <8 alergare/bicicletă;
 *  altfel vehicul (mașină/tren/avion). Cifra e cea reală, rotunjită. */
export function descrieViteza(vitezaMs?: number | null): string {
  if (vitezaMs == null || !Number.isFinite(vitezaMs) || vitezaMs < 0) return ''
  const kmh = Math.round(vitezaMs * 3.6)
  if (vitezaMs < 0.5) return 'stationary'
  if (vitezaMs < 2.2) return `walking (~${kmh} km/h)`
  if (vitezaMs < 8) return `moving (~${kmh} km/h)`
  if (vitezaMs < 70) return `travelling by vehicle (~${kmh} km/h)`
  return `travelling fast (~${kmh} km/h, likely a train or plane)`
}

/** Semnalele → un bloc SCURT de context pentru creierul local (limbaj de sistem,
 *  engleză; creierul răspunde în limba userului). PUR (testabil). Doar ce e
 *  MĂSURAT; gol dacă n-avem nimic. */
export function contextPentruCreier(s: SemnaleContext): string {
  const parti: string[] = []
  if (typeof s.lat === 'number' && typeof s.lon === 'number') {
    parti.push(`location: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`)
  }
  const v = descrieViteza(s.vitezaMs)
  if (v) parti.push(`movement: ${v}`)
  if (s.fataDetectata) {
    parti.push(s.expresie ? `you can see the person (looks ${s.expresie})` : 'you can see the person on camera')
  }
  if (!parti.length) return ''
  return (
    `LIVE CONTEXT you can sense right now (offline, from the device's sensors): ` +
    parti.join('; ') +
    `. Use it naturally and briefly when it helps (like a human companion who notices), never robotically; never invent a value that is not listed here.`
  )
}

/** Viteză din DOUĂ poziții + interval (fallback când senzorul nu dă `speed`).
 *  Haversine / dt. Întoarce m/s, sau null dacă intervalul e prea mic/invalid. */
export function vitezaDinPozitii(
  a: { lat: number; lon: number; t: number },
  b: { lat: number; lon: number; t: number },
): number | null {
  const dtSec = (b.t - a.t) / 1000
  if (!Number.isFinite(dtSec) || dtSec <= 0.2) return null
  const R = 6371000 // m
  const rad = (x: number): number => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  const dist = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
  return dist / dtSec
}
