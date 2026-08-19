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
import { watchdogInit } from './lib/watchdog'
import { ConsimtamantFoto } from './components/ConsimtamantFoto'
import { citesteConsimtamant, scrieConsimtamant, type StareConsimtamant } from './lib/consimtamant'
import { isCalm } from './lib/activity'

// MARTORUL GLOBAL de fiabilitate pornește o dată, la încărcare — prinde orice
// blocaj al firului principal, oriunde în aplicație (vedere/voce/creier/…).
watchdogInit()

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  // The server's DEPLOY version — on the watermark, so proof of the version
  // changes on EVERY publish (Adrian's order, Jul 10), not just on build
  // of interface. The label is composed with versionLabel (same source as under the QR).
  const [srv, setSrv] = useState<ServerVersion | null>(null)
  const [error, setError] = useState<string | null>(null)
  // POARTA DE CONSIMȚĂMÂNT FOTO (GDPR) — owner 13 aug. Alegerea locală per
  // dispozitiv; `null` = încă n-a ales → i se arată poarta blocantă.
  const [consimt, setConsimt] = useState<StareConsimtamant>(() => citesteConsimtamant())

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

  // UPDATE AUTOMAT SILENȚIOS (protocol kelion.constructor/v1): la detectarea
  // unei versiuni noi, se aplică hard reset IMEDIAT, fără niciun dialog/banner
  // de confirmare și fără numărătoare inversă. Clientul se reîncarcă transparent
  // în fundal — utilizatorul nu trebuie să facă nicio acțiune manuală.
  // Verifică isCalm() înainte de reset — nu tăia sesiuni live (voce/brain/draft).
  useEffect(() => {
    let resetPending = false
    const tryReset = (): void => {
      if (!resetPending) return
      if (isCalm()) {
        resetPending = false
        void hardResetToLatest()
      }
      // Dacă nu e calm, așteptăm și verificăm din nou la următorul tick
    }
    const stop = watchForUpdate(() => {
      resetPending = true
      tryReset()
      // Poll until calm if not already
      const poll = window.setInterval(tryReset, 1000)
      // Stop polling after 5 minutes if still not calm
      window.setTimeout(() => window.clearInterval(poll), 300_000)
    })
    return stop
  }, [])

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

  // POARTA DE CONSIMȚĂMÂNT FOTO (GDPR) — owner, 13 aug: „dacă nu acceptă captarea
  // unei poze conform GDPR, nu li se permite accesul deloc pe aplicație — refuz
  // total; anunț pe pagina de pornire." Poarta acoperă aplicația (Landing +
  // Stage). Paginile PUBLICE de utilitate — /credite (plată) și /manual (docs) —
  // rămân accesibile: nu captează nicio poză, iar blocarea plății ar lovi direct
  // în venit. Enforcement-ul real al camerei stă în ChatPanel (nu pornește
  // camera fără „acceptat"), poarta e stratul vizibil de consimțământ.
  const rutaPublica =
    window.location.pathname === '/manual' ||
    window.location.pathname === '/credite' ||
    window.location.pathname === '/credits'
  if (!rutaPublica && consimt !== 'acceptat') {
    return (
      <>
        <DynamicBackground />
        <ConsimtamantFoto
          stare={consimt}
          lang={typeof navigator !== 'undefined' ? navigator.language : 'en'}
          onDecide={(v) => {
            scrieConsimtamant(v)
            setConsimt(v)
          }}
        />
      </>
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
    </>
  )
}
