import { ceas } from './ceas'
// ── PERIODIC POLLING OF AN ENDPOINT — once only ───────────────────────────
//
// WHY (Batch E of PROCEDURA-REFACERE-CLONE.md; Adrian: "everything must go to 0"):
// `Stage.tsx` had TWO identical effects — the brain credit (admin) and the
// client credit. Both: fetch a JSON, apply it only if the component is still
// alive, repeat every 30s, clean up the interval on exit. They were 11 copied
// lines, and the real risk is leakage: if someone forgot `alive` or
// `clearInterval` in one of the copies, requests kept writing into unmounted
// components.
//
// Here once, correctly: the `alive` guard and the interval stop are guaranteed.

import { useEffect } from 'react'

/**
 * Periodically fetches a JSON from `url` and hands the result to `apply`.
 *
 * - `enabled=false` → doesn't start at all (e.g. the route is admin-only);
 * - the first request fires immediately, then repeats every `everyMs`;
 * - on unmount: the interval stops AND a late response is ignored;
 * - a failed poll never breaks the screen, but it is NO LONGER swallowed
 *   blindly (auditul admin, 3 aug): `onFail` — dacă e dat — primește statusul
 *   HTTP (sau null la eroare de rețea), ca ecranul să poată DECLARA eșecul
 *   (ex. pastila 🔒 la 423, ⚠ „citire veche" la pane) în loc să afișeze la
 *   nesfârșit ultimele valori bune ca și cum ar fi actuale.
 */
export function usePolledJson<T>(
  url: string,
  enabled: boolean,
  apply: (data: T) => void,
  everyMs = 30_000,
  onFail?: (status: number | null) => void,
): void {
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = (): void => {
      fetch(url, { credentials: 'include' })
        .then((r) => {
          if (!r.ok) {
            if (alive) onFail?.(r.status)
            return null
          }
          return r.json() as Promise<T>
        })
        .then((j) => {
          if (alive && j) apply(j)
        })
        .catch(() => {
          if (alive) onFail?.(null)
        })
    }
    load()
    const id = ceas(`sondaj ${url}`, load, everyMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // `apply` is a function defined on every render; we track it through
    // `enabled` and `url`, so polling doesn't restart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, everyMs])
}
