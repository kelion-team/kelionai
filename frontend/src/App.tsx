import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Credits from './pages/Credits'
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

  // RUTINA DE VERSIUNE (ordin, 10 iul): deploy nou detectat → reset curat
  // AUTOMAT la ultima versiune (filigran nou, stare default, memoriile pe
  // server rămân). Fără butoane, fără întrebări — mereu ultima versiune.
  useEffect(() => watchForUpdate(() => void hardResetToLatest()), [])

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
          înapoi în aplicație. */}
      {user ? (
        <Stage user={user} />
      ) : window.location.pathname === '/login' ? (
        <Login />
      ) : window.location.pathname === '/credite' || window.location.pathname === '/credits' ? (
        <Credits />
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
    </>
  )
}
