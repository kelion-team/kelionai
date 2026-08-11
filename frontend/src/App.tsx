import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import DynamicBackground from './components/DynamicBackground' // Import component

// COD-SPLIT PE RUTE (11 aug — optimizare): fiecare pagină e încărcată LENEȘ, își
// aduce doar codul ei. Un user pe /login nu mai descarcă degeaba Stage/Manual/
// Credits; three.js (avatarul) intră doar cu Landing/Stage, nu în entry.
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Credits = lazy(() => import('./pages/Credits'))
const Manual = lazy(() => import('./pages/Manual'))
const Stage = lazy(() => import('./pages/Stage'))
import {
  watchForUpdate,
  hardResetToLatest,
  fetchServerVersion,
  versionLabel,
  type ServerVersion,
} from './lib/updateCheck'
import { uiStrings } from './lib/i18n'
import { watchdogInit } from './lib/watchdog'

// MARTORUL GLOBAL de fiabilitate pornește o dată, la încărcare — prinde orice
// blocaj al firului principal, oriunde în aplicație (vedere/voce/creier/…).
watchdogInit()

// How long the blocking update gate counts down before it applies by itself.
const UPDATE_AUTO_SEC = 15

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

  // THE VERSION ROUTINE — POARTĂ BLOCANTĂ (Adrian, 11 aug: „rezolvă să fie
  // permanent asta cu anunțarea update și să nu se poată continua până nu faci
  // update-ul"). Înainte, bara de update se AMÂNA cât userul lucra (isCalm) —
  // exact de-aia telefonul lui rămăsese pe cod vechi în timpul unei sesiuni de
  // voce: numărătoarea nu pornea niciodată. Acum, la orice deploy nou, apare o
  // POARTĂ care ACOPERĂ aplicația (nu se mai poate folosi pe versiunea veche),
  // cu o numărătoare care aplică singură hard reset-ul — INDIFERENT de ce face
  // userul (nicio pauză): scopul e chiar să întrerupă și să treacă pe nou. Un
  // tab ascuns aplică imediat; butonul aplică pe loc.
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
      // Fără pauză pe activitate: poarta blochează oricum aplicația, iar update-ul
      // TREBUIE să se aplice — asta a cerut ownerul (nu continua pe versiunea veche).
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
      <Suspense
        fallback={
          <div className="boot">
            <span className="brand-lg">Kelionai</span>
            <span className="boot-dot" />
          </div>
        }
      >
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
      </Suspense>
      {/* Version + update-date watermark — the visible proof that the latest
      version is installed (Adrian, Jul 7). Now also includes the server's
      DEPLOY stamp (Jul 10): it changes on ANY publish, not just on a frontend
      build. Appears on every shell (same web app). */}
      <div className="app-watermark" aria-hidden="true">
        {versionLabel(srv)}
      </div>
      {/* POARTA DE UPDATE — BLOCANTĂ (Adrian, 11 aug: „să nu se poată continua
      până nu faci update-ul"). Acoperă TOATĂ aplicația: pe versiunea veche nu se
      mai poate lucra. Butonul aplică pe loc; numărătoarea aplică singură. În
      limba userului după logare, engleză înainte (uiStrings le acoperă). */}
      {updateReady && (
        <div className="update-gate" role="alertdialog" aria-modal="true" aria-label={uiStrings().updateReady}>
          <div className="update-gate-card">
            <span className="update-gate-title">{uiStrings().updateReady}</span>
            <span className="update-gate-msg">{uiStrings().updateBlock}</span>
            <button type="button" className="update-gate-btn" onClick={() => void hardResetToLatest()}>
              {uiStrings().updateNow}
            </button>
            <span className="update-gate-auto">{uiStrings().updateAuto.replace('{n}', String(updateIn))}</span>
          </div>
        </div>
      )}
    </>
  )
}
