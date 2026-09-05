import { marcheazaPlecarea } from './errorReport'
import { installedBuildLabel } from './versionEvidence'

declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
declare const __BUILD_COMMIT__: string | null

export function loadedUiCommit(): string | null { return __BUILD_COMMIT__ }

/** Eticheta este proprietatea buildului instalat, nu rezultatul unui poll. */
export function versionLabel(): string {
  return installedBuildLabel(__APP_VERSION__, __BUILD_DATE__, loadedUiCommit())
}

/** Doar versiunea instalata. Filigranul sta fixat peste continut, deci afiseaza
 *  minimul lizibil; dovezile complete raman in atributele data-* ale badge-ului
 *  si in titlul lui, fara sa acopere textul aplicatiei. */
export function versionShort(): string {
  return `V${__APP_VERSION__}`
}

export type ApplyPwaUpdate = () => void
const PWA_UPDATE_CHECK_MS = 60_000 // hardcod-permis: verificare standard SW, nu estimare a unui deploy.

/**
 * Semnalează exclusiv un Service Worker instalat și aflat în `waiting`.
 * Browserul verifică `sw.js` prin mecanismul standard; nu interogăm versiuni,
 * HTML sau bundle-uri și nu ștergem cache/storage. Activarea este explicită.
 */
export function watchForPwaUpdate(onWaiting: (apply: ApplyPwaUpdate) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}

  let stopped = false
  let reloading = false
  let applyRequested = false
  let checking = false
  let registration: ServiceWorkerRegistration | null = null
  let installing: ServiceWorker | null = null

  const reloadOnControllerChange = (): void => {
    if (stopped || reloading || !applyRequested) return
    reloading = true
    // Marcăm ÎNAINTE de reload: altfel post-mortemul de la pornirea următoare nu
    // poate distinge reload-ul ăsta (legitim) de un crash de randare.
    marcheazaPlecarea('reload:sw-controllerchange')
    window.location.reload()
  }

  const offerWaitingWorker = (): void => {
    const waiting = registration?.waiting
    if (!waiting || stopped) return
    onWaiting(() => {
      if (stopped) return
      applyRequested = true
      // Another tab may already have activated this worker. Reload here only
      // because this tab's user now explicitly chose to apply the update.
      if (registration?.waiting !== waiting) reloadOnControllerChange()
      else waiting.postMessage('kelion-activate-update')
    })
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

  const checkForUpdate = (): void => {
    if (stopped || checking || navigator.onLine === false || document.visibilityState === 'hidden') return
    checking = true
    void (async () => {
      // The React effect can precede main.tsx's window-load registration. Keep
      // discovery retryable; an absent registration is not permanent failure.
      if (!registration) {
        const found = await navigator.serviceWorker.getRegistration()
        if (!found || stopped) return
        registration = found
        registration.addEventListener('updatefound', onUpdateFound)
        onUpdateFound()
        offerWaitingWorker()
      }
      await registration.update()
      offerWaitingWorker()
    })().catch(() => {}).finally(() => { checking = false })
  }
  const onVisible = (): void => { if (document.visibilityState !== 'hidden') checkForUpdate() }
  const timer = window.setInterval(checkForUpdate,PWA_UPDATE_CHECK_MS)
  window.addEventListener('online',checkForUpdate)
  document.addEventListener('visibilitychange',onVisible)

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnControllerChange)
  checkForUpdate()

  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener('online',checkForUpdate)
    document.removeEventListener('visibilitychange',onVisible)
    installing?.removeEventListener('statechange', onInstallingState)
    registration?.removeEventListener('updatefound', onUpdateFound)
    navigator.serviceWorker.removeEventListener('controllerchange', reloadOnControllerChange)
  }
}
