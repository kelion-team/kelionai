// ── PERIODIC POLLING OF AN ENDPOINT — once only ───────────────────────────
//
// DE CE (Lotul E din PROCEDURA-REFACERE-CLONE.md; Adrian: „toate trebuie pe 0"):
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
 * - any error (network or non-ok status) is swallowed — a background poll
 *   must never break the screen.
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
    // `apply` is a function defined on every render; we track it through
    // `enabled` and `url`, so polling doesn't restart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, everyMs])
}
