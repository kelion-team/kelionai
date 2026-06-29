import { useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Group, Bone, Mesh, SkinnedMesh } from 'three'

// v1 avatar: fresh idle animation only (breathing, blink, micro head motion).
// Lipsync + gestures arrive with the voice milestone. No old code reused —
// only the .glb asset is carried over.
export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const root = useRef<Group>(null)
  const bones = useRef<Record<string, Bone>>({})
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })

  useLayoutEffect(() => {
    const b: Record<string, Bone> = {}
    const m: (Mesh | SkinnedMesh)[] = []
    scene.traverse((o) => {
      const obj = o as Bone & Mesh & SkinnedMesh
      if (obj.isBone) b[obj.name] = obj as Bone
      if ((obj.isMesh || obj.isSkinnedMesh) && obj.morphTargetDictionary) m.push(obj)
      if (obj.isMesh) obj.castShadow = true
    })
    bones.current = b
    morphs.current = m
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const b = bones.current

    // Breathing — gentle chest/spine rise (~8s cycle)
    const breath = Math.sin(t * 0.8) * 0.03
    const spine = b['Spine'] ?? b['Spine1']
    if (spine) spine.rotation.x = -0.04 + breath

    // Micro head movement — never perfectly still
    const head = b['Head']
    if (head) {
      head.rotation.y = Math.sin(t * 0.45) * 0.035
      head.rotation.x = Math.sin(t * 0.62) * 0.025 - 0.02
    }

    // Natural blink
    const bl = blink.current
    bl.t += delta
    if (bl.phase === 0 && bl.t >= bl.nextAt) {
      bl.phase = 1
      bl.t = 0
    }
    let eye = 0
    if (bl.phase === 1) {
      const p = bl.t / bl.duration
      eye = p < 0.5 ? p * 2 : 2 - p * 2
      if (bl.t >= bl.duration) {
        bl.phase = 0
        bl.t = 0
        bl.nextAt = 2.5 + Math.random() * 4.5
      }
    }
    for (const mesh of morphs.current) {
      const d = mesh.morphTargetDictionary
      const inf = mesh.morphTargetInfluences
      if (!d || !inf) continue
      const l = d['eyeBlinkLeft'] ?? d['eyeBlink_L']
      const r = d['eyeBlinkRight'] ?? d['eyeBlink_R']
      if (l !== undefined) inf[l] = eye
      if (r !== undefined) inf[r] = eye
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}

useGLTF.preload('/kelion-rpm.glb')
