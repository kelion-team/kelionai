// ── MODUL MAȘINĂ (Adrian, 11 aug) ────────────────────────────────────────────
// „În mașină e DOAR chat" — chatul live rapid (model rapid + creier + istoric),
// voce-first, cu glob Jarvis. Se pornește cu un BUTON (nu automat — „nu tot
// timpul vrei să pornească singură"). Afișajul respectă legislația auto: Kelion
// SPUNE răspunsul (vreme din GPS etc.), NU deschide monitorul/hărți/video; cel
// mult text rudimentar, ca să nu distragă la volan.
//
// Un store minuscul (ca workspace.ts) — Stage arată stratul de mașină, ChatPanel
// îi spune creierului `carMode` și SUPRIMĂ deschiderea suprafețelor cât e activ.

let activ = false
const subs = new Set<() => void>()

export function setCarMode(b: boolean): void {
  if (activ === b) return
  activ = b
  for (const fn of subs) fn()
}

export function isCarMode(): boolean {
  return activ
}

export function subscribeCarMode(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}
