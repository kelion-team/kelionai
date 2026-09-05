import { lazy, Suspense, useEffect, useState } from 'react'
import {
  cachedOfflineMe,
  fetchMe,
  type User,
  authNoticeForAuthenticatedUser,
  readAuthNavigation,
  type AuthNavigationSnapshot,
} from './lib/api'
import { useConectat } from './lib/conexiune'
import DynamicBackground from './components/DynamicBackground'

// Rutele sunt lazy; Three.js intră numai pe suprafețele cu avatar.
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Credits = lazy(() => import('./pages/Credits'))
const Manual = lazy(() => import('./pages/Manual'))
const Stage = lazy(() => import('./pages/Stage'))
import {
  watchForPwaUpdate,
  type ApplyPwaUpdate,
} from './lib/updateCheck'
import { watchdogInit } from './lib/watchdog'
import { BannerOffline } from './components/BannerOffline'
import { VersionBadge } from './components/VersionBadge'

import { uiStrings } from './lib/i18n'

// Watchdog-ul global măsoară blocarea firului principal.
watchdogInit()

function AuthenticatedAuthNotice({
  navigation,
  authenticated,
}: {
  navigation: AuthNavigationSnapshot
  authenticated: boolean
}) {
  const message = authNoticeForAuthenticatedUser(navigation, authenticated)
  if (!message) return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        left: '1rem',
        zIndex: 10000,
        margin: '0 auto',
        maxWidth: '52rem',
        border: '1px solid #a83232',
        borderRadius: '0.75rem',
        padding: '0.85rem 1rem',
        background: '#fff2f2',
        color: '#6f1717',
        boxShadow: '0 0.75rem 2rem rgba(45, 12, 12, 0.24)',
      }}
    >
      {message}
    </div>
  )
}

export default function App() {
  const [initialAuthNavigation] = useState<AuthNavigationSnapshot>(() =>
    readAuthNavigation(window.location.search),
  )
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [offlineSession, setOfflineSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applyUpdate, setApplyUpdate] = useState<ApplyPwaUpdate | null>(null)
  const online = useConectat()

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err) setError(err)
  }, [])

  useEffect(() => {
    let alive = true
    // Pierderea semnalului închide autoritatea online imediat. La revenire rămâne
    // închisă până când /auth/me reconfirmă sesiunea; cache-ul nu poate reda admin.
    setOfflineSession(true)
    const request = online ? fetchMe() : Promise.resolve(cachedOfflineMe())
    void request.then((me) => {
      if (!alive) return
      setUser(me.authenticated && me.user ? me.user : null)
      setOfflineSession(!online || Boolean(me.offline))
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [online])

  useEffect(() => {
    if (!loading && error) window.history.replaceState({}, '', '/')
  }, [error, loading])

  // Un worker nou, instalat complet, este aplicat doar la gestul utilizatorului.
  // Nu întrerupem vocea/chatul și nu ștergem cache, modele sau starea locală.
  useEffect(() => {
    return watchForPwaUpdate((apply) => setApplyUpdate(() => apply))
  }, [])

  if (loading) {
    return (
      <div className="boot">
        <span className="brand-lg">Kelionai</span>
        <span className="boot-dot" />
      </div>
    )
  }

  const effectiveOffline = !online || offlineSession

  return (
    <>
      <BannerOffline />
      <AuthenticatedAuthNotice navigation={initialAuthNavigation} authenticated={Boolean(user)} />
      {applyUpdate && (
        <button
          type="button"
          role="status"
          aria-live="polite"
          onClick={() => applyUpdate()}
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100002,
            background: 'rgba(15, 35, 22, 0.97)',
            color: '#d8f5df',
            padding: '12px 16px',
            borderRadius: 12,
            border: '1px solid #3a6b4a',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔄 {uiStrings().updateNouAnunt}
        </button>
      )}
      <DynamicBackground />
      {/* Manualul și creditele sunt rute publice; sesiunea intră în Stage. */}
      <Suspense
        fallback={
          <div className="boot">
            <span className="brand-lg">Kelionai</span>
            <span className="boot-dot" />
          </div>
        }
      >
        {window.location.pathname === '/manual' ? (
          <Manual isAdmin={!effectiveOffline && user?.role === 'admin'} />
        ) : window.location.pathname === '/credite' || window.location.pathname === '/credits' ? (
          <Credits authenticated={!effectiveOffline && user !== null} />
        ) : user ? (
          <Stage user={user} offline={effectiveOffline} />
        ) : window.location.pathname === '/login' ? (
          <Login initialAuthNavigation={initialAuthNavigation} />
        ) : (
          <Landing error={error} />
        )}
      </Suspense>
      {/* Buildul instalat și commitul serverului sunt probe distincte, nu un deploy presupus. */}
      <VersionBadge online={online} />
    </>
  )
}
