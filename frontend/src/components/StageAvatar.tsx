import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { AVATAR_ORBIT } from '../lib/avatarCamera'
import AvatarModel from './AvatarModel'
import AvatarLoading from './AvatarLoading'
import { themeBg } from '../lib/theme'

// AVATARUL STAGE, ÎNCĂRCAT LENEȘ (11 aug — optimizare bundle): tot three.js +
// @react-three (≈1 MB) stă în chunk-ul ăsta, adus DOAR când se randează
// scena, nu în încărcarea inițială. Interfața aplicației apare instant, avatarul
// se strecoară după (fallback-ul de Suspense e AvatarLoading, prin părinte).
// Comportamentul vizual e IDENTIC cu cel de dinainte — doar CÂND se încarcă codul.
export default function StageAvatar({ monitorOn }: { readonly monitorOn: boolean }) {
  return (
    <>
      <Canvas shadows="percentage" camera={{ position: [0, -0.25, 4.6], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
        {!monitorOn && <color attach="background" args={[themeBg()]} />}
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.6} castShadow />
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
