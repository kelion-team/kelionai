import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import { PUBLIC_TEXT as PT } from './lib/publicText'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Credits from './pages/Credits'
import Manual from './pages/Manual'
import Stage from './pages/Stage'
import {
  watchForUpdate,
  hardResetToLatest,
  fetchServerVersion,
  versionLabel,
  type ServerVersion,
} from './lib/updateCheck'

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

  // THE VERSION ROUTINE, TAMED (fluidity audit, Jul 27 — defect no. 1: the
  // AUTOMATIC hard reset cut the conversation/voice live, without warning
  // — exactly "it breaks somewhere"). The rule stays "always the latest
  // version", but applying no longer tramples work in progress: new deploy →
  // visible "New version" bar with a button; the hard reset applies
  // AUTOMATICALLY only when the tab is hidden (the user is away — feels
  // nothing) or when they press it.
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), [])
  useEffect(() => {
    if (!updateReady) return
    const applyIfHidden = (): void => {
      if (document.visibilityState === 'hidden') void hardResetToLatest()
    }
    applyIfHidden()
    document.addEventListener('visibilitychange', applyIfHidden)
    return () => document.removeEventListener('visibilitychange', applyIfHidden)
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
      {/* Pagina dedicată /login (Adrian, 26 iul) — un user deja logat e trimis
          înapoi în aplicație. /credite e PUBLICĂ pentru toți (fix 27 iul —
          înainte, userul LOGAT nu putea ajunge la ea nici tastând adresa:
          verificarea de user venea prima și-l arunca mereu în scenă). */}
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
      {/* Filigran versiune + dată update — dovada vizibilă că ultima versiune e
          instalată (Adrian, 7 iul). Acum include și ștampila DEPLOY-ului de pe
          server (10 iul): se schimbă la ORICE publicare, nu doar la build de
          interfață. Apare pe toate shell-urile (aceeași web app). */}
      <div className="app-watermark" aria-hidden="true">
        {versionLabel(srv)}
      </div>
      {/* BARA DE VERSIUNE NOUĂ (27 iul): vizibilă, nu intruzivă — userul decide
          când se aplică; dacă pleacă din tab, se aplică singură, neobservat. */}
      {updateReady && (
        <div className="update-banner" role="status">
          <span>{PT.updateAvailable}</span>
          <button type="button" onClick={() => void hardResetToLatest()}>
            {PT.updateNow}
          </button>
        </div>
      )}
    </>
  )
}
