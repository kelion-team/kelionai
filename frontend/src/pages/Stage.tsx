import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import type { User } from '../lib/api'
import { logout } from '../lib/api'

export default function Stage({ user }: { user: User }) {
  return (
    <div className="stage">
      <Canvas shadows camera={{ position: [0, 0.1, 2.6], fov: 35 }} dpr={[1, 2]}>
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
          minPolarAngle={Math.PI / 2.4}
          maxPolarAngle={Math.PI / 2.0}
          target={[0, 0.05, 0]}
        />
      </Canvas>

      <header className="topbar">
        <span className="brand">Kelionai</span>
        <div className="who">
          {user.picture && <img src={user.picture} alt="" className="avatar-pic" />}
          <span>{user.name}</span>
          {user.role === 'admin' && <span className="badge">admin</span>}
          <button className="ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
    </div>
  )
}
