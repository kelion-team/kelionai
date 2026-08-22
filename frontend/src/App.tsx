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
  downloadLatestBundle,
  type ServerVersion,
} from './lib/updateCheck'
import { watchdogInit } from './lib/watchdog'
import { ConsimtamantFoto } from './components/ConsimtamantFoto'
import { BannerOffline } from './components/BannerOffline'
import { citesteConsimtamant, scrieConsimtamant, type StareConsimtamant } from './lib/consimtamant'

import { uiStrings } from './lib/i18n'

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
  // ANUNȚ DE UPDATE (owner, 20 aug: „trebuie să mă anunțe că e un update pe aplicație").
  // Update-ul se aplică tot automat, dar întâi apare un banner scurt, ca omul să VADĂ.
  // progress = 0..1, null = nu e descărcare activă.
  const [updateNou, setUpdateNou] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)

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

  // UPDATE AUTOMAT CU BARA DE PROGRES: când serverul are versiune nouă,
  // preluăm bundle-ul cu progres vizibil și oprim orice lucru — la final reload.
  useEffect(() => {
    const stop = watchForUpdate(() => {
      setUpdateNou(true)
      setUpdateProgress(0)
      // Începe descărcarea reală. Chiar dacă progresul eșuează, dăm reset.
      void downloadLatestBundle((p) => setUpdateProgress(p))
        .then(() => hardResetToLatest())
        .catch(() => hardResetToLatest())
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
      <BannerOffline />
      {updateNou && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100002,
            background: 'rgba(10, 22, 15, 0.92)',
            color: '#d8f5df',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <div>🔄 {uiStrings().updateNouAnunt}</div>
          <div
            style={{
              width: 'min(320px, 80vw)',
              height: 10,
              borderRadius: 5,
              background: '#1f3b2a',
              overflow: 'hidden',
              border: '1px solid #3a6b4a',
            }}
          >
            <div
              style={{
                width: `${Math.round((updateProgress ?? 0) * 100)}%`,
                height: '100%',
                background: '#5ee08c',
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <div style={{ fontSize: 12, fontWeight: 400, color: '#a8d4b5' }}>
            {updateProgress === null
              ? 'se pregătește…'
              : `${Math.round((updateProgress ?? 0) * 100)}% — se opresc toate lucrurile`}
          </div>
        </div>
      )}
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
