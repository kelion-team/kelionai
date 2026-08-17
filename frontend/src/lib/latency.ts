// The REAL response time, measured in the BROWSER (what the user actually
// feels): from sending → first visible word → complete reply. Different from
// the server-measured time (brain only) — this one includes the network + the
// whole journey. Shown on the monitor counter (Adrian, Jul 14: "the counter
// should show the real response time").
//
// Minimal external store (like workspace.ts): any component reads it with
// useSyncExternalStore(subscribeRealLatency, getRealLatency).

export interface RealLatency {
  /** sent → first visible word (ms) — the first REAL word. */
  readonly firstMs: number
  /** sent → complete reply (ms). */
  readonly totalMs: number
  /** when it was measured (epoch ms) — so the badge never shows a stale value. */
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
