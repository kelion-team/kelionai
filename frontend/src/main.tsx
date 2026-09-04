import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ConstructorDesktopApp from './ConstructorDesktopApp.tsx'
import { startErrorReporting } from './lib/errorReport'
import { initiazaGestiuneaEnergiei } from './lib/energie'
import { initialiseNativeAuth, installNativeFetchBoundary } from './lib/nativeAuth'

installNativeFetchBoundary()
void initialiseNativeAuth().catch(() => {
  window.dispatchEvent(new CustomEvent('kelion-native-auth-error'))
})

if (
  navigator.onLine !== false &&
  'serviceWorker' in navigator &&
  ['http:', 'https:'].includes(window.location.protocol)
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      if (navigator.onLine !== false) void registration.update()
    }).catch(() => undefined)
  })
}

// Kelion's eyes on F12: browser errors go to the server, and Kelion sees
// them in context and diagnoses for real ("why doesn't X work?").
startErrorReporting()
initiazaGestiuneaEnergiei()

const nativePlatform = document.querySelector<HTMLMetaElement>('meta[name="kelion-native-platform"]')?.content
createRoot(document.getElementById('root')!).render(
  nativePlatform === 'constructor-desktop' ? <ConstructorDesktopApp /> : <App />,
)
