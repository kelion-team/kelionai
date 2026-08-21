// ── ANCORA ÎN REALITATE (spatio-temporală) a lui Kelion ──────────────────────
// Owner 21 aug: „toți senzorii ăștia ar trebui să creeze logic un MEDIU pentru el,
// localizat real — un sistem de ANCORARE ÎN REALITATE, spațio-temporală." Deci NU
// mai listăm semnale răzlețe: le strângem într-un „AICI-ȘI-ACUM" real — CÂND (ora),
// UNDE (coordonate), CUM te miști (viteza), CINE e prezent (fața), și ce e în JUR
// (vederea, ca simț AMBIENTAL). Creierul local le folosește ca să fie ancorat în
// realitate — ca un om care pur și simplu își știe împrejurimile.
//
// Vederea COMPLETEAZĂ celelalte simțuri (owner: „funcția văz completează auzit/vorbit/
// locația ambientală… NU pentru a nara «te văd în pat»"): e conștientizare de fundal,
// NU se narează; scena se descrie DOAR dacă userul întreabă explicit ce vede.
//
// Totul MĂSURAT — un semnal lipsă e OMIS, nu inventat (regula #1).

export interface SemnaleContext {
  lat?: number
  lon?: number
  /** m/s din `coords.speed` (senzor) sau calculat din poziții. null = necunoscut. */
  vitezaMs?: number | null
  /** Vederea: e o față prinsă de cameră ACUM? */
  fataDetectata?: boolean
  /** Opțional: eticheta expresiei feței (din face-api), dacă există. */
  expresie?: string
  /** Văzul offline (M5): o descriere SCURTĂ a scenei din cameră (caption local,
   *  vazOffline). Simț AMBIENTAL — NU se narează; se descrie doar la cerere. */
  vede?: string
  /** Ancora TEMPORALĂ (spatio-temporal): ora/data locală a userului, ca text scurt.
   *  Gol/absent = necunoscut → omis (regula #1). */
  ora?: string
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
  // AICI-ȘI-ACUM: când / unde / mișcare / prezență / împrejurimi (ancoră spatio-temporală).
  const parti: string[] = []
  if (s.ora) parti.push(`time now: ${s.ora}`)
  if (typeof s.lat === 'number' && typeof s.lon === 'number') {
    parti.push(`place: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`)
  }
  const v = descrieViteza(s.vitezaMs)
  if (v) parti.push(`movement: ${v}`)
  if (s.fataDetectata) {
    parti.push(s.expresie ? `the person is here with you (looks ${s.expresie})` : 'the person is here with you')
  }
  if (s.vede) {
    // Simț AMBIENTAL (owner: completează, NU narează) — ce e în jur, pe scurt.
    parti.push(`surroundings (camera, ambient): ${s.vede}`)
  }
  if (!parti.length) return ''
  let text =
    `YOUR REAL HERE-AND-NOW — a spatio-temporal anchor built from the device's own senses ` +
    `(this is where and when you actually are; stay grounded in it, like a person who simply ` +
    `knows their surroundings): ` +
    parti.join('; ') +
    `. Use it naturally and only when it helps, never robotically; never invent a value that is not listed here.`
  if (s.vede) {
    // Regula owner (21 aug): văzul NU se narează de la sine — doar la cerere.
    text +=
      ` The camera view is AMBIENT awareness only — it completes your other senses; do NOT announce or ` +
      `narrate what you see on your own (never say things like "I see you in bed"). Describe the scene ONLY ` +
      `if the person explicitly asks what you see.`
  }
  return text
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
