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
  // Versiunea DEPLOY-ului de pe server — pe filigran, ca dovada versiunii să se
  // schimbe la ORICE publicare (ordinul lui Adrian, 10 iul), nu doar la build
  // de interfață. Eticheta se compune cu versionLabel (aceeași sursă ca sub QR).
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

  // RUTINA DE VERSIUNE, ÎMBLÂNZITĂ (auditul de fluiditate, 27 iul — defectul
  // nr. 1: reset-ul dur AUTOMAT tăia conversația/vocea în viu, fără avertisment
  // — exact „se rupe pe undeva"). Regula rămâne „mereu ultima versiune", dar
  // aplicarea nu mai calcă peste lucrul în desfășurare: deploy nou → bară
  // vizibilă „Versiune nouă" cu buton; resetul dur se aplică AUTOMAT doar când
  // tab-ul e ascuns (userul e plecat — nu simte nimic) sau la apăsarea lui.
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

  // FILIGRAN MEREU LA ZI (Adrian, 10 iul: „filigranul nou să apară automat la
  // orice update, în interiorul aplicațiilor" — e scris dar nu se reflecta:
  // versiunea se citea o singură dată la pornire). Acum reîmprospătim ștampila
  // deploy-ului periodic + când tab-ul redevine vizibil, așa filigranul din
  // ORICE shell (PWA/TWA din magazine, demo, clienți) se schimbă singur la
  // fiecare publicare, fără reîncărcare. Aceeași sursă ca sub QR (fără dublare).
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
