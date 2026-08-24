declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

/** Eticheta este proprietatea buildului instalat, nu rezultatul unui poll. */
export function versionLabel(): string {
  return `V${__APP_VERSION__} · ${__BUILD_DATE__}`
}

export type ApplyPwaUpdate = () => void

/**
 * Semnalează exclusiv un Service Worker instalat și aflat în `waiting`.
 * Browserul verifică `sw.js` prin mecanismul standard; nu interogăm versiuni,
 * HTML sau bundle-uri și nu ștergem cache/storage. Activarea este explicită.
 */
export function watchForPwaUpdate(onWaiting: (apply: ApplyPwaUpdate) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}

  let stopped = false
  let reloading = false
  let registration: ServiceWorkerRegistration | null = null
  let installing: ServiceWorker | null = null

  const reloadOnControllerChange = (): void => {
    if (stopped || reloading) return
    reloading = true
    window.location.reload()
  }

  const offerWaitingWorker = (): void => {
    const waiting = registration?.waiting
    if (!waiting || stopped) return
    onWaiting(() => waiting.postMessage('kelion-activate-update'))
  }

  const onInstallingState = (): void => {
    if (installing?.state === 'installed' && navigator.serviceWorker.controller) {
      offerWaitingWorker()
    }
  }

  const onUpdateFound = (): void => {
    installing?.removeEventListener('statechange', onInstallingState)
    installing = registration?.installing ?? null
    installing?.addEventListener('statechange', onInstallingState)
  }

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnControllerChange)
  void navigator.serviceWorker.getRegistration().then((found) => {
    if (!found || stopped) return
    registration = found
    registration.addEventListener('updatefound', onUpdateFound)
    offerWaitingWorker()
    // O singură verificare standard la pornire. Verificările ulterioare sunt
    // responsabilitatea ciclului de viață al browserului/navigărilor.
    if (navigator.onLine !== false) void registration.update().catch(() => {})
  })

  return () => {
    stopped = true
    installing?.removeEventListener('statechange', onInstallingState)
    registration?.removeEventListener('updatefound', onUpdateFound)
    navigator.serviceWorker.removeEventListener('controllerchange', reloadOnControllerChange)
  }
}
