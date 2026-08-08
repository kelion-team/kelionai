// Timpul de răspuns REAL, măsurat în BROWSER (ce simte userul cu adevărat):
// de când trimite → primul cuvânt vizibil → răspunsul complet. Diferit de timpul
// măsurat pe server (doar creierul) — ăsta include rețeaua + tot drumul. Se afișează
// pe contorul din monitor (Adrian, 14 iul: „contorul să afișeze timpul de răspuns real").
//
// Store extern minimal (ca workspace.ts): orice componentă îl citește cu
// useSyncExternalStore(subscribeRealLatency, getRealLatency).

export interface RealLatency {
  /** trimis → primul cuvânt vizibil (ms) — primul cuvânt REAL. */
  readonly firstMs: number
  /** trimis → răspuns complet (ms). */
  readonly totalMs: number
  /** când a fost măsurat (epoch ms) — ca badge-ul să nu arate o valoare veche. */
  readonly at: number
}

let latency: RealLatency | null = null
const subscribers = new Set<() => void>()

function emit(): void {
  for (const fn of subscribers) fn()
}

export function setRealLatency(l: RealLatency): void {
  latency = l
  emit()
}

export function getRealLatency(): RealLatency | null {
  return latency
}

export function subscribeRealLatency(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}
