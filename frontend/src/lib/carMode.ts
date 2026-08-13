// ── MODUL MAȘINĂ (Adrian, 11 aug; rescris 13 aug) ────────────────────────────
// „În mașină e DOAR chat" — chatul live rapid (model rapid + creier + istoric),
// voce-first, cu glob Jarvis. Se pornește cu un BUTON (nu automat — „nu tot
// timpul vrei să pornească singură"). Kelion răspunde SCURT și cu voce.
//
// SUPRIMAREA SUPRAFEȚELOR A FOST SCOASĂ (owner, 13 aug: „când spune orice, trebuie
// să fie executat acel orice"). Înainte, la volan Kelion SPUNEA că deschide harta/
// documentul dar nu o făcea — vorbă fără faptă. Acum ce spune că face, execută;
// car mode e doar UI voce-first.
//
// Un store minuscul (ca workspace.ts) — Stage arată stratul de mașină, ChatPanel
// îi spune creierului `carMode` (răspuns scurt). Nu mai schimbă ce se execută.

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
