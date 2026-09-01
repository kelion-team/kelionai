import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { AdminConstructor } from './components/admin/AdminProductie'
import { fetchMe, logout, startGoogleLogin, type User } from './lib/api'
import { productConfig } from './lib/productConfig'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'forbidden'; user: User }
  | { kind: 'ready'; user: User }

export default function ConstructorDesktopApp() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })

  const refreshIdentity = useCallback(async () => {
    setAuth({ kind: 'loading' })
    const response = await fetchMe()
    if (!response.authenticated || !response.user || response.offline) {
      setAuth({ kind: 'signed-out', error: response.offline ? 'Serverul Kelion nu poate fi contactat.' : undefined })
      return
    }
    setAuth(response.user.role === 'admin'
      ? { kind: 'ready', user: response.user }
      : { kind: 'forbidden', user: response.user })
  }, [])

  useEffect(() => {
    void refreshIdentity()
    const authenticated = () => { void refreshIdentity() }
    const failed = () => setAuth({ kind: 'signed-out', error: 'Autentificarea Google nu a fost finalizată.' })
    window.addEventListener('kelion-native-authenticated', authenticated)
    window.addEventListener('kelion-native-auth-error', failed)
    return () => {
      window.removeEventListener('kelion-native-authenticated', authenticated)
      window.removeEventListener('kelion-native-auth-error', failed)
    }
  }, [refreshIdentity])

  const frame: CSSProperties = {
    minHeight: '100vh',
    padding: '24px',
    color: '#f5f7ff',
    background: 'radial-gradient(circle at top, #182446 0, #090c16 48%, #05070d 100%)',
  }

  if (auth.kind === 'loading') {
    return <main style={{ ...frame, display: 'grid', placeItems: 'center' }}><div role="status">Se verifică sesiunea Constructor…</div></main>
  }

  if (auth.kind === 'signed-out') {
    return (
      <main style={{ ...frame, display: 'grid', placeItems: 'center' }}>
        <section className="admin-card" style={{ width: 'min(520px, 100%)' }}>
          <h1>Kelion Constructor</h1>
          <p>Clientul dedicat trimite ordine în aceeași coadă Kelion și urmărește același worker.</p>
          {auth.error && <p role="alert" style={{ color: '#ff9b9b' }}>{auth.error}</p>}
          <button type="button" className="ghost" onClick={() => startGoogleLogin('/')}>Conectare Google Admin</button>
        </section>
      </main>
    )
  }

  if (auth.kind === 'forbidden') {
    return (
      <main style={{ ...frame, display: 'grid', placeItems: 'center' }}>
        <section className="admin-card" style={{ width: 'min(620px, 100%)' }}>
          <h1>Acces refuzat</h1>
          <p>Contul {auth.user.email} este autentificat, dar nu este Adminul Kelion verificat.</p>
          <button type="button" className="ghost" onClick={() => void logout()}>Deconectare</button>
        </section>
      </main>
    )
  }

  return (
    <main style={frame} data-client="kelion-constructor-desktop">
      <header style={{ maxWidth: 1180, margin: '0 auto 16px', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Kelion Constructor</h1>
          <div className="chat-hint">
            API: {productConfig.publicAppHost} · identitate: {auth.user.email} · coada canonică: Constructor Kelion
          </div>
        </div>
        <button type="button" className="ghost" onClick={() => void logout()}>Deconectare</button>
      </header>
      <section className="admin-content" style={{ maxWidth: 1180, margin: '0 auto' }}>
        <AdminConstructor dedicatedClient />
      </section>
    </main>
  )
}
