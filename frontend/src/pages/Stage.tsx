import { Suspense, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import ChatPanel from '../components/ChatPanel'
import AdminPanel from '../components/AdminPanel'
import type { User } from '../lib/api'
import { logout } from '../lib/api'
import { resolveLang, strings } from '../lib/i18n'
import { getWorkspace, subscribeWorkspace, closeWorkspace, normalizeEmbedUrl } from '../lib/workspace'

export default function Stage({ user }: { user: User }) {
  const lang = resolveLang(user.locale)
  const t = strings(lang)
  const [adminOpen, setAdminOpen] = useState(false)
  const ws = useSyncExternalStore(subscribeWorkspace, getWorkspace)
  return (
    <div className="stage">
      {/* Skill monitor mode: the workspace surface behind the avatar. */}
      <div className={`workspace-bg ${ws.open ? 'open' : ''}`}>
        {ws.open && (
          <div className="workspace-inner">
            <div className="workspace-head">
              <span>{ws.title}</span>
              <button type="button" className="ghost" onClick={closeWorkspace}>
                ✕
              </button>
            </div>
            {ws.url && (
              <iframe
                title={ws.title}
                src={normalizeEmbedUrl(ws.url)}
                className="workspace-frame"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            )}
          </div>
        )}
      </div>
      {/* Avatar canvas — shrinks to the top-right corner in monitor mode. */}
      <div className={`stage-canvas ${ws.open ? 'pip' : ''}`}>
      <Canvas shadows camera={{ position: [0, 0.7, 2.4], fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0d12']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={1.4} castShadow />
        <Suspense fallback={null}>
          <AvatarModel />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 2.3}
          maxPolarAngle={Math.PI / 1.95}
          // Kelion may only be turned ±3° around its axis (left/right).
          minAzimuthAngle={-Math.PI / 60}
          maxAzimuthAngle={Math.PI / 60}
          target={[0, 0.7, 0]}
        />
      </Canvas>
      </div>

      <header className="topbar">
        <span className="brand">Kelionai</span>
        <div className="who">
          {user.picture && <img src={user.picture} alt="" className="avatar-pic" />}
          <span>{user.name}</span>
          {user.role === 'admin' && <span className="badge">admin</span>}
          {user.role === 'admin' && (
            <button type="button" className="ghost" onClick={() => setAdminOpen(true)}>
              Admin
            </button>
          )}
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <ChatPanel lang={lang} />

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </div>
  )
}
