// ── AUZUL AMBIENTAL — BACKEND (owner, 22 aug 2026: „simte mediul") ───────────
//
// Stochează evenimentele sonore primite de la frontend (alarmă, sonerie,
// ciocănit, plâns, spargere, conversație, muzică, liniște). Le ține in-memory
// (ultimele 30), le expune creierului prin tool-ul `evenimente_sonore`.
//
// ALERTĂ: evenimentele critice (alarma, spargere, plâns) sunt marcate ca
// urgente — creierul le poate folosi pentru a NOTIFICA ownerul proactiv.

export interface EvenimentSonorStocat {
  ts: number
  tip: 'alarma' | 'sonerie' | 'ciocanit' | 'plans' | 'spargere' | 'zgomot_brusc' | 'conversatie' | 'muzica' | 'liniste'
  intensitate: number
  durataMs: number
  frecventaDominanta: number
}

const CAP_MAXIM = 30
const EXPIRA_MS = 10 * 60_000 // 10 minute
const TIPURI_URGENTE: EvenimentSonorStocat['tip'][] = ['alarma', 'spargere', 'plans']

let evenimente: EvenimentSonorStocat[] = []

/** Adaugă un eveniment sonor în buffer. */
export function adaugaEvenimentSonor(ev: EvenimentSonorStocat): void {
  const acum = Date.now()
  evenimente = evenimente.filter((e) => acum - e.ts < EXPIRA_MS)
  evenimente.push(ev)
  if (evenimente.length > CAP_MAXIM) {
    evenimente = evenimente.slice(-CAP_MAXIM)
  }
}

/** Ultimele evenimente sonore (pentru creier). */
export function evenimenteSonoreRecente(): EvenimentSonorStocat[] {
  const acum = Date.now()
  return evenimente.filter((e) => acum - e.ts < EXPIRA_MS)
}

/** Evenimente URGENTE recente (alarma, spargere, plâns). */
export function evenimenteUrgente(): EvenimentSonorStocat[] {
  const acum = Date.now()
  return evenimente.filter((e) => acum - e.ts < EXPIRA_MS && TIPURI_URGENTE.includes(e.tip))
}

/** Ultimul eveniment urgent (pentru notificare proactivă). */
export function ultimulEvenimentUrgent(): EvenimentSonorStocat | null {
  const urgente = evenimenteUrgente()
  return urgente.length > 0 ? urgente[urgente.length - 1] : null
}

/** Contextul ambiental curent (ultimul eveniment, orice tip). */
export function contextAmbientalCurent(): EvenimentSonorStocat | null {
  const acum = Date.now()
  const valide = evenimente.filter((e) => acum - e.ts < EXPIRA_MS)
  return valide.length > 0 ? valide[valide.length - 1] : null
}
