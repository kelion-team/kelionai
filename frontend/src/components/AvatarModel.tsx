import { useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Group, Bone, Mesh, SkinnedMesh } from 'three'
import { getSpeakingLevel } from '../lib/voice'

// Rest pose (arms hanging down along the body, natural A-pose) for THIS RPM
// asset's skeleton. The GLB bind pose ships with arms raised, so we override
// the arm bone rotations to bring the hands down beside the body.
const ARM_NAMES: Record<string, string[]> = {
  LeftArm: ['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'],
  RightArm: ['RightArm', 'RightUpperArm', 'mixamorigRightArm'],
  LeftForeArm: ['LeftForeArm', 'mixamorigLeftForeArm'],
  RightForeArm: ['RightForeArm', 'mixamorigRightForeArm'],
}
const ARM_REST: Record<string, { x: number; y: number; z: number }> = {
  LeftArm: { x: 1.477, y: 0.973, z: -0.147 },
  RightArm: { x: 1.477, y: -0.973, z: 0.147 },
  LeftForeArm: { x: 0.2, y: 0, z: 0 },
  RightForeArm: { x: 0.2, y: 0, z: 0 },
}

// v1 avatar: fresh idle animation (breathing, blink, micro head motion) +
// arms-down rest pose. Lipsync + gestures arrive with the voice milestone.
export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const root = useRef<Group>(null)
  const bones = useRef<Record<string, Bone>>({})
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // smoothed jaw openness for lip-sync

  const applyArms = (b: Record<string, Bone>) => {
    for (const key of Object.keys(ARM_REST)) {
      const target = ARM_REST[key]
      for (const name of ARM_NAMES[key]) {
        const bone = b[name]
        if (bone) {
          bone.rotation.set(target.x, target.y, target.z)
          break
        }
      }
    }
  }

  useLayoutEffect(() => {
    const b: Record<string, Bone> = {}
    const m: (Mesh | SkinnedMesh)[] = []
    scene.traverse((o) => {
      const obj = o as Bone & Mesh & SkinnedMesh
      if (obj.isBone) b[obj.name] = obj as Bone
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach((bn) => {
          b[bn.name] = bn
        })
      }
      if ((obj.isMesh || obj.isSkinnedMesh) && obj.morphTargetDictionary) m.push(obj)
      if (obj.isMesh) obj.castShadow = true
    })
    bones.current = b
    morphs.current = m
    applyArms(b) // snap arms down before the first paint (no T-pose flash)
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const b = bones.current

    // Keep arms at the rest pose every frame
    applyArms(b)

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

    // Lip-sync — open the jaw to the current speaking level, smoothed so it
    // tracks speech without jitter. Zero when Kelion is silent.
    const target = getSpeakingLevel()
    const k = target > mouth.current ? 0.5 : 0.25 // open fast, close softer
    mouth.current += (target - mouth.current) * k
    const jaw = mouth.current

    for (const mesh of morphs.current) {
      const d = mesh.morphTargetDictionary
      const inf = mesh.morphTargetInfluences
      if (!d || !inf) continue
      const l = d['eyeBlinkLeft'] ?? d['eyeBlink_L']
      const r = d['eyeBlinkRight'] ?? d['eyeBlink_R']
      if (l !== undefined) inf[l] = eye
      if (r !== undefined) inf[r] = eye
      // RPM/ARKit mouth morphs — use whichever the asset exposes.
      const jawOpen = d['jawOpen'] ?? d['mouthOpen'] ?? d['viseme_aa']
      if (jawOpen !== undefined) inf[jawOpen] = jaw
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}

useGLTF.preload('/kelion-rpm.glb')
