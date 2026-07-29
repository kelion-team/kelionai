// ── SONDAREA PERIODICĂ A UNUI ENDPOINT — o singură dată ──────────────────────
//
// DE CE (Lotul E din PROCEDURA-REFACERE-CLONE.md; Adrian: „toate trebuie pe 0"):
// `Stage.tsx` avea DOUĂ efecte identice — creditul creierului (admin) și creditul
// clientului. Amândouă: cer un JSON, îl aplică doar dacă componenta mai trăiește,
// repetă la 30s, curăță intervalul la ieșire. Erau 11 linii copiate, iar riscul
// real e scurgerea: dacă cineva uita `alive` sau `clearInterval` într-una din
// copii, rămâneau cereri care scriau în componente demontate.
//
// Aici o dată, corect: garda `alive` și oprirea intervalului sunt garantate.

import { useEffect } from 'react'

/**
 * Cere periodic un JSON de la `url` și predă rezultatul lui `apply`.
 *
 * - `enabled=false` → nu pornește deloc (ex. ruta e doar pentru admin);
 * - prima cerere pleacă imediat, apoi se repetă la `everyMs`;
 * - la demontare: intervalul se oprește ȘI un răspuns întârziat e ignorat;
 * - orice eroare (rețea sau status ne-ok) se înghite — o sondare de fundal nu
 *   are voie să spargă ecranul.
 */
export function usePolledJson<T>(
  url: string,
  enabled: boolean,
  apply: (data: T) => void,
  everyMs = 30_000,
): void {
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = (): void => {
      fetch(url, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .then((j) => {
          if (alive && j) apply(j)
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, everyMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // `apply` e o funcție definită la fiecare randare; o urmărim prin `enabled`
    // și `url`, ca sondarea să nu repornească la fiecare randare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, everyMs])
}
