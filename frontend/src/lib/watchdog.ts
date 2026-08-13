// ── MARTORUL DE FIABILITATE, PE TOATĂ APLICAȚIA (11 aug, ownerul: „câte unul pe
// fiecare direcție — vedere, voce, creier, constructor — să acopere toată
// aplicația") ────────────────────────────────────────────────────────────────
// Nu ghicește — MĂSOARĂ. Două mecanisme:
//   1) OBSERVATOR GLOBAL de `longtask`: prinde ORICE blocaj al firului principal
//      (>200ms) oriunde în aplicație și îl ATRIBUIE direcțiilor active în clipa
//      aceea (vedere/voce/creier/constructor…). Un singur ochi peste tot.
//   2) DOMENII NUMITE: fiecare direcție se „deschide" (watchdogEnter) și se
//      „închide" (watchdogExit); între ele, watchdogBeat măsoară pauzele (ex.
//      serverul care stă între bucățile de stream). La închidere → verdict.
// Doar observă + scrie în consolă; ZERO efect asupra logicii. Se scoate după ce
// prindem cauzele reale.

import { raporteazaSimptom } from './errorReport'

const activ = new Map<string, number>() // direcție → performance.now() la intrare
const ultimaBataie = new Map<string, number>()
const pauzaMax = new Map<string, number>()
let obs: PerformanceObserver | null = null
let pornit = false

/** Pornește observatorul global (o singură dată, la încărcarea aplicației). */
export function watchdogInit(): void {
  if (pornit || typeof PerformanceObserver === 'undefined') return
  pornit = true
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration <= 200) continue
        const unde = activ.size ? [...activ.keys()].join(' + ') : '(nicio direcție activă)'
        console.warn(`[WATCHDOG] fir principal BLOCAT ${Math.round(e.duration)}ms în timpul: ${unde}`)
        // ALERTĂ LA CREIER (owner, 13 aug): blocajele MARI (>1s) — cele care chiar
        // desincronizează fața/vocea — ajung la server, ca Kelion să le vadă și să
        // le poată analiza, nu doar în consola omului. Bucket pe secunde → dedup.
        if (e.duration > 1000)
          raporteazaSimptom(`[PERF] fir principal blocat ~${Math.round(e.duration / 1000)}s în timpul: ${unde}`)
      }
    })
    obs.observe({ entryTypes: ['longtask'] })
  } catch {
    obs = null
    pornit = false
  }
}

/** Deschide o direcție (ex. 'creier', 'vedere', 'voce', 'constructor'). */
export function watchdogEnter(directie: string): void {
  watchdogInit()
  const now = performance.now()
  activ.set(directie, now)
  ultimaBataie.set(directie, now)
  pauzaMax.set(directie, 0)
}

/** Bătaie de inimă a unei direcții (ex. o bucată din stream) — măsoară pauza. */
export function watchdogBeat(directie: string): void {
  if (!activ.has(directie)) return
  const now = performance.now()
  const last = ultimaBataie.get(directie) ?? now
  const pauza = now - last
  if (pauza > (pauzaMax.get(directie) ?? 0)) pauzaMax.set(directie, pauza)
  if (pauza > 3000) console.warn(`[WATCHDOG] „${directie}": a STAT ${Math.round(pauza)}ms (server/așteptare)`)
  ultimaBataie.set(directie, now)
}

/** Închide o direcție și scrie verdictul (total + pauza max). */
export function watchdogExit(directie: string): void {
  const start = activ.get(directie)
  if (start === undefined) return
  const total = Math.round(performance.now() - start)
  const pauza = Math.round(pauzaMax.get(directie) ?? 0)
  activ.delete(directie)
  ultimaBataie.delete(directie)
  pauzaMax.delete(directie)
  const verdict = pauza > 3000 ? ' → SERVER/așteptare (pauză mare)' : ''
  console.warn(`[WATCHDOG] „${directie}": ${total}ms total · pauză max ${pauza}ms${verdict}`)
}
