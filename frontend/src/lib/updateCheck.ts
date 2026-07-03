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
