import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import Landing from './pages/Landing'
import Stage from './pages/Stage'
import { watchForUpdate } from './lib/updateCheck'
import { strings, resolveLang, browserLang } from './lib/i18n'

// Injectate la build (vezi vite.config.ts): versiunea + data compilării.
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [updateReady, setUpdateReady] = useState(false)

  const error = new URLSearchParams(window.location.search).get('error')

  useEffect(() => {
    let alive = true
    void fetchMe().then((me) => {
      if (!alive) return
      setUser(me.authenticated && me.user ? me.user : null)
      setLoading(false)
      if (error) window.history.replaceState({}, '', '/')
    })
    return () => {
      alive = false
    }
  }, [error])

  // Notify already-installed users (any platform) when a new version ships.
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), [])

  if (loading) {
    return (
      <div className="boot">
        <span className="brand-lg">Kelionai</span>
        <span className="boot-dot" />
      </div>
    )
  }

  // Language for the banner: the signed-in user's, else the browser's.
  const t = strings(user ? resolveLang(user.locale) : browserLang())

  return (
    <>
      {updateReady && (
        <div className="update-bar" role="status">
          <span>{t.updateReady}</span>
          <button
            type="button"
            onClick={() => {
              // Update refresh — restore the running conversation after reload
              // (fresh logins still start with a clean page).
              sessionStorage.setItem('kelion_restore_chat', '1')
              window.location.reload()
            }}
          >
            {t.updateNow}
          </button>
        </div>
      )}
      {user ? <Stage user={user} /> : <Landing error={error} />}
      {/* Filigran versiune + dată update — dovada vizibilă că ultima versiune e
          instalată (Adrian, 7 iul). Apare pe toate shell-urile (aceeași web app). */}
      <div className="app-watermark" aria-hidden="true">
        v{__APP_VERSION__} · {__BUILD_DATE__}
      </div>
    </>
  )
}
