// ── THE DISPATCHER (Adrian, Aug 1) ──────────────────────────────────────────
// „ce se întâmplă când vor fi zeci sau sute de useri? … să scaleze pe o pungă
// comună." ONE brain (Kelion — the mind), ONE purse, MANY users. The
// dispatcher is the traffic light between their turns and the AI models:
//
//   1. PER-MODEL CONCURRENCY — a model never gets more simultaneous calls
//      than it can serve (that IS the „limitare" users saw: everyone rushing
//      the same model at once).
//   2. PER-MINUTE PACING — a model never gets more starts per minute than its
//      rhythm allows; the 429s the rotation had to absorb are prevented, not
//      repaired.
//   3. THE FAIR QUEUE — when EVERY candidate model is busy, the turn waits in
//      line (first come, first served) instead of dying. The user only sees
//      „Kelion compune..." a few seconds longer.
//
// The dispatcher is NOT Kelion. Kelion is the mind; this is the plumbing
// under him — invisible to users, invisible to him.
//
// Single-process by design (one container today). The counters live here; the
// day we run several containers, this module is the ONE place that moves to a
// shared store — the callers never change.

// How many simultaneous calls one model serves. Free models on OpenRouter
// die around 20 RPM shared with the whole internet; 6 in-flight keeps our
// burst under their per-minute refill.
const MAX_IN_FLIGHT_PER_MODEL = 6
// Starts per model per minute (our own pacing — under every provider cap).
const MAX_STARTS_PER_MINUTE = 18
// How long a turn may wait in the queue before the neutral „try again".
const QUEUE_TIMEOUT_MS = 25_000
// The queue's own size limit: beyond it we refuse fast instead of piling up
// seconds of wait for everyone (a flooded house fails honestly, not slowly).
const MAX_QUEUE = 200

interface ModelLoad {
  inFlight: number
  starts: number[] // timestamps of starts inside the current minute
}

const loads = new Map<string, ModelLoad>()

function loadOf(id: string): ModelLoad {
  let l = loads.get(id)
  if (!l) {
    l = { inFlight: 0, starts: [] }
    loads.set(id, l)
  }
  // Slide the minute window.
  const cutoff = Date.now() - 60_000
  while (l.starts.length && l.starts[0] < cutoff) l.starts.shift()
  return l
}

/** Try to take a slot on this model RIGHT NOW. Atomic: taken if free. */
export function iaSlotDacaLiber(modelId: string): boolean {
  const l = loadOf(modelId)
  if (l.inFlight >= MAX_IN_FLIGHT_PER_MODEL) return false
  if (l.starts.length >= MAX_STARTS_PER_MINUTE) return false
  l.inFlight += 1
  l.starts.push(Date.now())
  return true
}

/** Release a slot previously taken. Always pair with iaSlotDacaLiber. */
export function elibereazaSlot(modelId: string): void {
  const l = loads.get(modelId)
  if (!l) return
  l.inFlight = Math.max(0, l.inFlight - 1)
  trezesteCoada()
}

// ── THE QUEUE ────────────────────────────────────────────────────────────────
// A waiter polls on wake: „did any of MY candidates free up?" The wake comes
// from every release; the 500 ms poll is the safety net (a release lost to a
// crash must not hang a turn forever).
let coada = 0
const treziri = new Set<() => void>()

function trezesteCoada(): void {
  for (const t of treziri) t()
}

/**
 * Wait until one of the candidates (not yet tried) has a free slot — and take
 * it. Returns the model id with the slot HELD, or null on queue-full/timeout.
 */
export async function asteaptaLaCoada(
  candidati: () => Promise<string[]>,
  tried: Set<string>,
  timeoutMs: number = QUEUE_TIMEOUT_MS,
): Promise<string | null> {
  if (coada >= MAX_QUEUE) return null
  coada += 1
  const deadline = Date.now() + timeoutMs
  try {
    for (;;) {
      const lista = await candidati().catch(() => [] as string[])
      for (const id of lista) {
        if (tried.has(id)) continue
        if (iaSlotDacaLiber(id)) return id
      }
      const ramas = deadline - Date.now()
      if (ramas <= 0) return null
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          treziri.delete(onWake)
          resolve()
        }, Math.min(500, ramas))
        const onWake = (): void => {
          clearTimeout(t)
          treziri.delete(onWake)
          resolve()
        }
        treziri.add(onWake)
      })
    }
  } finally {
    coada -= 1
  }
}

// ── FAILURE MEMORY (Adrian, Aug 1 — „timpi sunt exceptionali de mari") ─────
// A model that fails (429, empty, error) goes to the BACK of the line for 5
// minutes — for EVERY user. A dead model stops eating everyone's seconds, one
// by one, turn after turn. Never excluded completely: if the whole pool is
// sick, the sick ones still serve (a slow answer beats none).
const ESEC_COOLDOWN_MS = 5 * 60_000
const esecuri = new Map<string, number>()

/** Mark a model as failed NOW (429 / empty answer / provider error). */
export function noteazaEsuare(modelId: string): void {
  esecuri.set(modelId, Date.now())
}

/** True while the model has no recent failure (or the cooldown expired). */
export function eSanatos(modelId: string): boolean {
  const t = esecuri.get(modelId)
  if (t === undefined) return true
  if (Date.now() - t >= ESEC_COOLDOWN_MS) {
    esecuri.delete(modelId)
    return true
  }
  return false
}

// ── THE PURSE THRESHOLD (pragul rezervei) ────────────────────────────────────
// The paid reserve exists so the app never stops — but a bad traffic day must
// not empty the purse. The owner sets a DAILY cap; over it, turns stay on the
// free pool (with the queue absorbing the peaks) and the health check flags
// it to the owner. This is the pure decision; the accounting lives in chat.ts.
export const REZERVA_CAP_ZILNIC_DEFAULT_USD = 3

export function poateFolosiRezerva(cheltuitAziUsd: number, capZilnicUsd: number): boolean {
  return cheltuitAziUsd < capZilnicUsd
}

// ── TELEMETRY for system_health / the owner's eyes ──────────────────────────
export function stareDispecer(): {
  inZbor: number
  peModele: Record<string, number>
  coada: number
  bolnavi: number
} {
  const peModele: Record<string, number> = {}
  let inZbor = 0
  for (const [id, l] of loads) {
    if (l.inFlight > 0) peModele[id] = l.inFlight
    inZbor += l.inFlight
  }
  return { inZbor, peModele, coada, bolnavi: esecuri.size }
}

// Test hook: reset all state.
export function _resetDispecer(): void {
  loads.clear()
  coada = 0
  treziri.clear()
  esecuri.clear()
}
