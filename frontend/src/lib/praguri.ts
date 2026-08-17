// ── PRAGURILE ALIMENTĂRII — DOAR DE LA SERVER (LEGEA ANTI-HARDCODARE, 16 aug;
// ownerul: „ti-am cerut sa funtioneze, m-ai umplut de hardcodate, scoate tot")
// Sursa e UNA: /api/tarife → config.billing (aceeași care VALIDEAZĂ plata pe
// server). Necitit = null: textele cad pe forme FĂRĂ cifre — o cifră
// inventată în UI e exact minciuna pe care legea o interzice.
export interface Praguri {
  primaAlimentare: number
  minim: number
  pas: number
}

let cache: Praguri | null = null
let promisiune: Promise<Praguri | null> | null = null

/** Pragurile deja citite (sincron) — null până sosesc de la server. */
export function pragurileServerului(): Praguri | null {
  return cache
}

/** Citește pragurile o singură dată per sesiune de pagină (cache + dedup). */
export async function aduPragurile(): Promise<Praguri | null> {
  if (cache) return cache
  promisiune ??= fetch('/api/tarife')
    .then((r) => (r.ok ? (r.json() as Promise<{ praguri?: Partial<Praguri> }>) : null))
    .then((j) => {
      const p = j?.praguri
      if (
        p &&
        Number.isFinite(Number(p.primaAlimentare)) &&
        Number.isFinite(Number(p.minim)) &&
        Number.isFinite(Number(p.pas)) &&
        Number(p.pas) > 0
      ) {
        cache = { primaAlimentare: Number(p.primaAlimentare), minim: Number(p.minim), pas: Number(p.pas) }
      }
      return cache
    })
    .catch(() => null)
  return promisiune
}
