import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { AVATAR_ORBIT } from '../lib/avatarCamera'
import AvatarModel from './AvatarModel'
import AvatarLoading from './AvatarLoading'
import { themeBg } from '../lib/theme'

// SCENA 3D COMUNĂ (11 aug — dedup poarta jscpd): Landing și Stage foloseau
// EXACT aceeași scenă (lumini + model + OrbitControls + AvatarLoading), copiată
// în două fișiere → clonă. Acum e o singură definiție; wrapper-ele diferă doar
// prin cameră, transparență (gl) și dacă pictează fundalul temei. Vizual
// IDENTIC cu înainte — o schimbare de iluminare/încadrare se face într-un loc.
export default function AvatarScene({
  camera,
  showBg = true,
  keyLight = 1.6,
  gl,
}: {
  readonly camera: [number, number, number]
  readonly showBg?: boolean
  readonly keyLight?: number
  readonly gl?: { alpha?: boolean }
}) {
  return (
    <>
      <Canvas
        shadows="percentage"
        camera={{ position: camera, fov: 40 }}
        dpr={[1, 2]}
        {...(gl ? { gl } : {})}
      >
        {showBg && <color attach="background" args={[themeBg()]} />}
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={keyLight} castShadow />
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
