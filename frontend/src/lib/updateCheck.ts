// Auto-update notification. Every shell (Windows .exe, Android app, iPhone PWA,
// plain web) loads the SAME live web app, so watching the deployed bundle here
// tells ANY installed user, for free, the moment a new version ships. We compare
// the bundle filename the app booted with against the one the server currently
// serves; when it changes, a new version is live and we invite an upgrade.

function currentBundle(): string | null {
  const s = document.querySelector('script[src*="/assets/index-"]') as HTMLScriptElement | null
  const m = s?.src.match(/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

// RESET DUR LA ULTIMA VERSIUNE (Adrian, 10 iul: „resetează ce trebuie ca să fie
// preluată ultima versiune în permanență"). Golește TOT cache-ul (shell-ul SW +
// orice altceva), cere și service worker-ului să-și golească cache-urile, apoi
// reîncarcă pagina cu un parametru anti-cache — garantat ultima versiune, fără
// build vechi lipit. Conversația se restaurează după reload (kelion_restore_chat).
let resetting = false
export async function hardResetToLatest(): Promise<void> {
  if (resetting) return
  resetting = true
  // ANTI-BUCLĂ de reload (supraviețuiește reîncărcării): dacă am resetat în
  // ultimele 30s, NU mai reîncărcăm încă o dată. Fără plasa asta, orice cauză care
  // ar chema resetul din nou după reload ar putea intra într-o buclă de reload care
  // face aplicația inutilizabilă („distrus"). 30s > timpul unei reîncărcări complete.
  try {
    const last = Number(sessionStorage.getItem('kelion_last_reset') || 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem('kelion_last_reset', String(Date.now()))
  } catch {
    /* storage indisponibil — continuăm cu resetul */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      reg?.active?.postMessage('kelion-clear-caches')
    }
  } catch {
    /* best-effort — reîncărcăm oricum */
  }
  try {
    sessionStorage.setItem('kelion_restore_chat', '1')
  } catch {
    /* storage indisponibil — nu blocăm reload-ul */
  }
  const u = new URL(window.location.href)
  u.searchParams.set('_v', String(Date.now()))
  window.location.replace(u.toString())
}

/**
 * Calls `onUpdate` once when a newer deployment is detected. Checks every 5
 * minutes and whenever the tab regains focus (so a returning user learns
 * quickly). Returns a stop function. No-ops if the boot bundle can't be read.
 */
export function watchForUpdate(onUpdate: () => void): () => void {
  const booted = currentBundle()
  if (!booted) return () => {}
  let stopped = false
  let fired = false

  const check = async (): Promise<void> => {
    if (stopped || fired) return
    try {
      const html = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text())
      const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
      if (m && m[0] !== booted) {
        fired = true
        onUpdate()
      }
    } catch {
      /* offline / transient — try again next tick */
    }
  }

  const id = window.setInterval(() => void check(), 5 * 60_000)
  const onVis = (): void => {
    if (document.visibilityState === 'visible') void check()
  }
  document.addEventListener('visibilitychange', onVis)

  return () => {
    stopped = true
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVis)
  }
}
