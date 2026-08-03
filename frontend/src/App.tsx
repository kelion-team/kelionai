import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Credits from './pages/Credits'
import Manual from './pages/Manual'
import Stage from './pages/Stage'
import DynamicBackground from './components/DynamicBackground' // Import component
import {
  watchForUpdate,
  hardResetToLatest,
  fetchServerVersion,
  versionLabel,
  type ServerVersion,
} from './lib/updateCheck'
import { isCalm } from './lib/activity'
import { uiStrings } from './lib/i18n'

// How long the new-version bar counts down before it applies by itself
// (ticking only while the app is calm — see below).
const UPDATE_AUTO_SEC = 60

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  // The server's DEPLOY version — on the watermark, so proof of the version
  // changes on EVERY publish (Adrian's order, Jul 10), not just on build
  // of interface. The label is composed with versionLabel (same source as under the QR).
  const [srv, setSrv] = useState<ServerVersion | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err) setError(err)
  }, [])

  useEffect(() => {
    let alive = true
    void fetchMe().then((me) => {
      if (!alive) return
      setUser(me.authenticated && me.user ? me.user : null)
      setLoading(false)
      if (error) window.history.replaceState({}, '', '/')
    })
    void fetchServerVersion().then((j) => {
      if (alive && j) setSrv(j)
    })
    return () => {
      alive = false
    }
  }, [error])

  // THE VERSION ROUTINE, SELF-APPLYING (Adrian, Aug 1: "the deploy didn't take
  // everything" — his tab was open and VISIBLE, so the old interface ran for an
  // hour after the publish while the bar waited for a click). The rule "always
  // the latest version" now really holds: a new deploy shows the bar with a
  // COUNTDOWN that applies the hard reset by itself. The countdown ticks only
  // while the app is calm (no live voice, no request in flight, no draft —
  // see lib/activity.ts), so it never cuts work; a hidden tab applies
  // immediately, as before; the button applies on the spot.
  const [updateReady, setUpdateReady] = useState(false)
  const [updateIn, setUpdateIn] = useState(UPDATE_AUTO_SEC)
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), [])
  useEffect(() => {
    if (!updateReady) return
    const applyIfHidden = (): void => {
      if (document.visibilityState === 'hidden') void hardResetToLatest()
    }
    applyIfHidden()
    document.addEventListener('visibilitychange', applyIfHidden)
    const id = window.setInterval(() => {
      if (!isCalm()) return // paused — live voice / request / draft
      setUpdateIn((n) => {
        if (n > 1) return n - 1
        window.clearInterval(id)
        void hardResetToLatest()
        return 0
      })
    }, 1000)
    return () => {
      document.removeEventListener('visibilitychange', applyIfHidden)
      window.clearInterval(id)
    }
  }, [updateReady])

  // WATERMARK ALWAYS UP TO DATE (Adrian, Jul 10: "the new watermark should
  // appear automatically on any update, inside the apps" — it was written but
  // not reflected: the version was read once at startup). Now we refresh the
  // deploy stamp periodically + when the tab becomes visible again, so the
  // watermark in ANY shell (store PWA/TWA, demo, clients) changes by itself on
  // every publish, without reload. Same source as under the QR (no duplication).
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void fetchServerVersion().then((j) => {
        if (alive && j) setSrv(j)
      })
    }
    const id = window.setInterval(refresh, 60_000)
    const onVis = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  if (loading) {
    return (
      <div className="boot">
        <span className="brand-lg">Kelionai</span>
        <span className="boot-dot" />
      </div>
    )
  }

  return (
    <>
      <DynamicBackground />
      {/* Dedicated /login page (Adrian, Jul 26) — an already logged-in user is
      sent back into the app. /credite is PUBLIC for everyone (fix Jul 27 —
      before, a LOGGED-IN user could not reach it even by typing the address:
      the user check came first and always threw him onto the stage). */}
      {window.location.pathname === '/manual' ? (
        <Manual />
      ) : window.location.pathname === '/credite' || window.location.pathname === '/credits' ? (
        <Credits />
      ) : user ? (
        <Stage user={user} />
      ) : window.location.pathname === '/login' ? (
        <Login />
      ) : (
        <Landing error={error} />
      )}
      {/* Version + update-date watermark — the visible proof that the latest
      version is installed (Adrian, Jul 7). Now also includes the server's
      DEPLOY stamp (Jul 10): it changes on ANY publish, not just on a frontend
      build. Appears on every shell (same web app). */}
      <div className="app-watermark" aria-hidden="true">
        {versionLabel(srv)}
      </div>
      {/* THE NEW VERSION BAR: visible, with a countdown that applies by itself
      (paused while the user works); the button applies on the spot. In the
      USER'S language after login, English before it (uiStrings handles both). */}
      {updateReady && (
        <div className="update-banner" role="status">
          <span>
            {uiStrings().updateReady} · {uiStrings().updateAuto.replace('{n}', String(updateIn))}
          </span>
          <button type="button" onClick={() => void hardResetToLatest()}>
            {uiStrings().updateNow}
          </button>
        </div>
      )}
    </>
  )
}
