import { useEffect, useState } from 'react'
import { fetchMe, type User } from './lib/api'
import Login from './pages/Login'
import Stage from './pages/Stage'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  const error = new URLSearchParams(window.location.search).get('error')

  useEffect(() => {
    let alive = true
    void fetchMe().then((me) => {
      if (!alive) return
      setUser(me.authenticated && me.user ? me.user : null)
      setLoading(false)
      if (error) window.history.replaceState({}, '', '/')
    })
    return () => {
      alive = false
    }
  }, [error])

  if (loading) {
    return (
      <div className="boot">
        <span className="brand-lg">Kelionai</span>
        <span className="boot-dot" />
      </div>
    )
  }

  return user ? <Stage user={user} /> : <Login error={error} />
}
