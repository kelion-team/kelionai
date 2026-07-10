import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import Landing from './pages/Landing'
import Stage from './pages/Stage'
import { watchForUpdate, hardResetToLatest, fetchServerVersion } from './lib/updateCheck'

// Injectate la build (vezi vite.config.ts): versiunea + data compilării.
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  // Ștampila DEPLOY-ului de pe server — pe filigran, ca dovada versiunii să se
  // schimbe la ORICE publicare (ordinul lui Adrian, 10 iul), nu doar la build
  // de interfață.
  const [srvV, setSrvV] = useState('')

  const error = new URLSearchParams(window.location.search).get('error')

  useEffect(() => {
    let alive = true
    void fetchMe().then((me) => {
      if (!alive) return
      setUser(me.authenticated && me.user ? me.user : null)
      setLoading(false)
      if (error) window.history.replaceState({}, '', '/')
    })
    void fetchServerVersion().then((j) => {
      // Ștampila arată ORA publicării serverului (mereu alta la orice deploy);
      // sha-ul apare doar dacă platforma îl oferă.
      if (alive && j?.at)
        setSrvV(
          `deploy${j.v && !j.v.includes('T') ? ` ${j.v}` : ''} ${j.at.slice(0, 16).replace('T', ' ')} UTC`,
        )
    })
    return () => {
      alive = false
    }
  }, [error])

  // RUTINA DE VERSIUNE (ordin, 10 iul): deploy nou detectat → reset curat
  // AUTOMAT la ultima versiune (filigran nou, stare default, memoriile pe
  // server rămân). Fără butoane, fără întrebări — mereu ultima versiune.
  useEffect(() => watchForUpdate(() => void hardResetToLatest()), [])

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
      {user ? <Stage user={user} /> : <Landing error={error} />}
      {/* Filigran versiune + dată update — dovada vizibilă că ultima versiune e
          instalată (Adrian, 7 iul). Acum include și ștampila DEPLOY-ului de pe
          server (10 iul): se schimbă la ORICE publicare, nu doar la build de
          interfață. Apare pe toate shell-urile (aceeași web app). */}
      <div className="app-watermark" aria-hidden="true">
        v{__APP_VERSION__} · {__BUILD_DATE__}
        {srvV ? ` · ${srvV}` : ''}
      </div>
    </>
  )
}
