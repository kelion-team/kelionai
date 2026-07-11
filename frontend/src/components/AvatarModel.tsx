import { useRef, useLayoutEffect, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import type { Group, Bone, Mesh, SkinnedMesh } from 'three'
import { getVoiceLevel } from '../lib/audioIO'

// Rest pose (arms hanging down along the body, natural A-pose) for THIS RPM
// asset's skeleton. The GLB bind pose ships with arms raised, so we snap the
// arm bones down ONCE before the first paint (no T-pose flash). După prima
// actualizare a mixerului, clipul din bibliotecă preia complet scheletul.
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

// MIȘCAREA DE CORP DIN BIBLIOTECĂ (Adrian, 11 iul: „caută în biblioteca de
// mișcări" — după ce animația procedurală scrisă de mână a deformat scheletul,
// revertată în #125). Clip oficial Ready Player Me (animation-library, MIT,
// captură de mișcare reală, ACELAȘI schelet ca avatarul — niciun retargeting):
// M_Standing_Idle_001 — respirație, greutate mutată subtil, ținută naturală.
// Regula: scheletul e mișcat DOAR de clipuri din bibliotecă; pe cod rămân doar
// clipirea și lip-sync-ul (morph targets, neatinse de clipuri).
export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const idle = useGLTF('/anim/M_Standing_Idle_001.glb')
  const root = useRef<Group>(null)
  const { actions } = useAnimations(idle.animations, root)
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)

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
    morphs.current = m
    // Brațele jos înainte de primul cadru — clipul preia din prima actualizare.
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
  }, [scene])

  // Pornește clipul de repaus în buclă, cu intrare lină.
  useEffect(() => {
    const first = Object.values(actions).find(Boolean)
    first?.reset().fadeIn(0.3).play()
    return () => {
      first?.stop()
    }
  }, [actions])

  useFrame((_state, delta) => {
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

    // Lip-sync — gura urmărește amplitudinea reală a vocii redate acum (Chirp
    // 3), netezit ca blink-ul; deschidere MODERATĂ (Adrian s-a plâns cândva că
    // gura se deschide prea mult).
    const level = getVoiceLevel()
    mouth.current += (level - mouth.current) * 0.4
    const jawOpen = Math.min(0.5, mouth.current * 0.55)

    for (const mesh of morphs.current) {
      const d = mesh.morphTargetDictionary
      const inf = mesh.morphTargetInfluences
      if (!d || !inf) continue
      const l = d['eyeBlinkLeft'] ?? d['eyeBlink_L']
      const r = d['eyeBlinkRight'] ?? d['eyeBlink_R']
      if (l !== undefined) inf[l] = eye
      if (r !== undefined) inf[r] = eye
      const jaw = d['jawOpen'] ?? d['mouthOpen'] ?? d['viseme_aa']
      if (jaw !== undefined) inf[jaw] = jawOpen
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}

useGLTF.preload('/kelion-rpm.glb')
useGLTF.preload('/anim/M_Standing_Idle_001.glb')
