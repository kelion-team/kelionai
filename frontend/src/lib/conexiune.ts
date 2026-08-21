import { useEffect, useState } from 'react'

// ── PREZENȚA ONLINE ↔ OFFLINE (mod companion, faza 0) ───────────────────────
// Separat de retea.ts (aia e CALITATEA țevii — 2G/3G/4G). Aici e un singur adevăr:
// ajung REAL la serverul lui Kelion? `navigator.onLine` MINTE (e true și pe un
// router fără internet / portal captiv), deci nu ne bazăm pe el singur — facem un
// PING real la /health. Fără ping, „online" ar fi o afirmație nemăsurată (regula
// #1). SW-ul lasă /health mereu la rețea (network-only), deci pică rapid când nu e
// net. Strat PUR de citire — nu atinge nimic din calea online.

let online = typeof navigator !== 'undefined' ? navigator.onLine : true
const abonati = new Set<(o: boolean) => void>()
let pornit = false

function seteaza(o: boolean): void {
  if (o === online) return
  online = o
  for (const f of abonati) f(o)
}

/** Ping REAL: chiar ajung la /health? (HEAD, no-store, timeout scurt.) Actualizează
 *  starea și o întoarce. Exportat ca să fie probat + folosit la comutarea creierului
 *  din fazele următoare. */
export async function verificaConexiuneReala(): Promise<boolean> {
  // Scurtătură sigură DOAR când browserul spune EXPLICIT `false` (nicio interfață
  // de rețea) — ăsta e un „no" de încredere, nu dăm ping degeaba. `undefined`
  // (API-ul lipsește, ex. Node/unele browsere) NU e „offline": necunoscut ≠ măsurat
  // (regula #1) → mergem mai departe la pingul real.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    seteaza(false)
    return false
  }
  // AbortController (nu AbortSignal.timeout): merge în orice mediu (jsdom nu are
  // .timeout). Timeout scurt ca detectorul să nu atârne pe o rețea moartă.
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 4000)
  try {
    const r = await fetch('/health', { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })
    seteaza(r.ok)
    return r.ok
  } catch {
    seteaza(false)
    return false
  } finally {
    clearTimeout(t)
  }
}

function porneste(): void {
  if (pornit || typeof window === 'undefined') return
  pornit = true
  window.addEventListener('online', () => void verificaConexiuneReala())
  window.addEventListener('offline', () => seteaza(false))
  // La revenirea în prim-plan (owner, 21 aug: „când îi vine accesul la net nu se
  // reconectează automat"): reverificăm IMEDIAT. De multe ori omul restaurează netul
  // din altă parte și revine la filă, iar evenimentul `online` al browserului nu e
  // de încredere (poate să nu se declanșeze) — vizibilitatea e semnalul sigur.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void verificaConexiuneReala()
    })
  }
  // Poll ADAPTIV: rar cât suntem online (30s — doar să prindem „conectat fără net"),
  // DES cât suntem offline (5s — ca revenirea semnalului să se prindă în câteva
  // secunde, nu în până la 30s). Timeout care se reprogramează singur, cu pasul ales
  // din starea CURENTĂ după fiecare măsurătoare.
  const programeaza = (): void => {
    window.setTimeout(() => {
      void verificaConexiuneReala().finally(programeaza)
    }, online ? 30_000 : 5_000)
  }
  void verificaConexiuneReala().finally(programeaza)
}

function abonare(f: (o: boolean) => void): () => void {
  porneste()
  abonati.add(f)
  f(online)
  return () => {
    abonati.delete(f)
  }
}

/** Ultima stare cunoscută (fără să forțeze un ping). Pentru comutarea creier
 *  online/offline din fazele 1+. */
export function esteConectat(): boolean {
  return online
}

/** Hook React: `const online = useConectat()`. Pornește detectorul la prima folosire. */
export function useConectat(): boolean {
  const [o, setO] = useState(online)
  useEffect(() => abonare(setO), [])
  return o
}
