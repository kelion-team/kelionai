import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { AVATAR_ORBIT } from '../lib/avatarCamera'
import AvatarModel from './AvatarModel'
import AvatarLoading from './AvatarLoading'
import { themeBg } from '../lib/theme'

// AVATARUL DE PE LANDING, ÎNCĂRCAT LENEȘ (11 aug — optimizare bundle): scoate
// three.js + @react-three din calea critică, ca TEXTUL landing-ului să apară
// instant pentru un vizitator nou, iar avatarul 3D să se strecoare după.
// Vizual identic — doar momentul încărcării codului diferă.
export default function LandingAvatar() {
  return (
    <>
      <Canvas shadows="percentage" camera={{ position: [0, 0.7, 2.4], fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={[themeBg()]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.7} castShadow />
        <directionalLight position={[-2.5, 1.2, -2]} intensity={0.7} color="#8fb6ff" />
        <Suspense fallback={null}>
          <AvatarModel />
        </Suspense>
        <OrbitControls {...AVATAR_ORBIT} />
      </Canvas>
      <AvatarLoading />
    </>
  )
}
