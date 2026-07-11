import { useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Group, Bone, Mesh, SkinnedMesh } from 'three'
import { getVoiceLevel } from '../lib/audioIO'

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

// RPM / Mixamo skeleton name fallbacks (from neck down).
const BONE_NAMES = {
  hips: ['Hips', 'mixamorigHips'],
  spine: ['Spine', 'mixamorigSpine'],
  spine1: ['Spine1', 'Chest', 'mixamorigSpine1'],
  spine2: ['Spine2', 'UpperChest', 'mixamorigSpine2'],
  neck: ['Neck', 'mixamorigNeck'],
  head: ['Head', 'mixamorigHead'],
  leftShoulder: ['LeftShoulder', 'LeftCollar', 'mixamorigLeftShoulder', 'mixamorigLeftCollar'],
  rightShoulder: ['RightShoulder', 'RightCollar', 'mixamorigRightShoulder', 'mixamorigRightCollar'],
  leftForeArm: ['LeftForeArm', 'mixamorigLeftForeArm'],
  rightForeArm: ['RightForeArm', 'mixamorigRightForeArm'],
  leftHand: ['LeftHand', 'mixamorigLeftHand'],
  rightHand: ['RightHand', 'mixamorigRightHand'],
}

function firstBone(bones: Record<string, Bone>, names: string[]): Bone | null {
  for (const name of names) {
    const bone = bones[name]
    if (bone) return bone
  }
  return null
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

type GestureTarget = Partial<
  Record<'leftFore' | 'rightFore' | 'leftHand' | 'rightHand', { x: number; y: number; z: number }>
>

// v2 avatar: natural idle from the neck down — shoulders, trunk, weight shift,
// visible breathing, occasional small hand gestures — plus the existing moderate
// lip-sync and micro head motion. Everything is procedural and frame-cheap.
export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const root = useRef<Group>(null)
  const bones = useRef<Record<string, Bone>>({})
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)
  const hipsBaseY = useRef<number | null>(null)
  const gesture = useRef({
    nextAt: 3 + Math.random() * 4,
    active: false,
    t: 0,
    duration: 1.2,
    target: {} as GestureTarget,
  })

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

    const hips = firstBone(b, BONE_NAMES.hips)
    if (hips) hipsBaseY.current = hips.position.y
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const b = bones.current

    // Keep arms at the rest pose every frame (gestures are added as offsets later)
    applyArms(b)

    const hips = firstBone(b, BONE_NAMES.hips)
    const spine = firstBone(b, BONE_NAMES.spine)
    const spine1 = firstBone(b, BONE_NAMES.spine1)
    const spine2 = firstBone(b, BONE_NAMES.spine2)
    const head = firstBone(b, BONE_NAMES.head)
    const leftShoulder = firstBone(b, BONE_NAMES.leftShoulder)
    const rightShoulder = firstBone(b, BONE_NAMES.rightShoulder)
    const leftForeArm = firstBone(b, BONE_NAMES.leftForeArm)
    const rightForeArm = firstBone(b, BONE_NAMES.rightForeArm)
    const leftHand = firstBone(b, BONE_NAMES.leftHand)
    const rightHand = firstBone(b, BONE_NAMES.rightHand)

    // Breathing — slow ~8 s cycle, visible as chest/spine motion and a tiny vertical hip shift.
    const breath = Math.sin(t * 0.8)
    const breath2 = Math.sin(t * 0.8 + 1.2)

    if (hips && hipsBaseY.current !== null) {
      hips.position.y = hipsBaseY.current + breath * 0.004
      hips.rotation.z = Math.sin(t * 0.35 + 1.0) * 0.015
      hips.rotation.y = Math.sin(t * 0.28) * 0.02
    }

    if (spine) spine.rotation.x = -0.04 + breath * 0.035
    if (spine1) {
      spine1.rotation.x = breath * 0.02 + Math.sin(t * 0.45 + 0.5) * 0.01
      spine1.rotation.y = Math.sin(t * 0.31) * 0.015
    }
    if (spine2) {
      spine2.rotation.x = breath2 * 0.018
      spine2.rotation.y = Math.sin(t * 0.37 + 1.0) * 0.012
    }

    // Shoulders follow the breath with tiny independent drift.
    if (leftShoulder) {
      leftShoulder.rotation.z = 0.04 + breath * 0.015
      leftShoulder.rotation.y = Math.sin(t * 0.42) * 0.01
    }
    if (rightShoulder) {
      rightShoulder.rotation.z = -0.04 - breath * 0.015
      rightShoulder.rotation.y = Math.sin(t * 0.42 + Math.PI) * 0.01
    }

    // Micro head movement — never perfectly still (unaffected by body motion).
    if (head) {
      head.rotation.y = Math.sin(t * 0.45) * 0.035
      head.rotation.x = Math.sin(t * 0.62) * 0.025 - 0.02
    }

    // Occasional small hand gesture: one or both hands, slow and subtle.
    const g = gesture.current
    g.t += delta
    if (!g.active && g.t >= g.nextAt) {
      g.active = true
      g.t = 0
      g.duration = 0.9 + Math.random() * 1.1
      const both = Math.random() > 0.75
      const side = Math.random() > 0.5 ? 'left' : 'right'
      const make = (mag: number) => ({
        x: (Math.random() - 0.5) * 2 * mag,
        y: (Math.random() - 0.5) * 2 * mag,
        z: (Math.random() - 0.5) * 2 * mag,
      })
      const next: GestureTarget = {}
      if (both || side === 'left') {
        next.leftFore = make(0.04)
        next.leftHand = make(0.06)
      }
      if (both || side === 'right') {
        next.rightFore = make(0.04)
        next.rightHand = make(0.06)
      }
      g.target = next
    }
    if (g.active) {
      const p = Math.min(1, g.t / g.duration)
      const phase = p < 0.5 ? p * 2 : 2 - p * 2
      const f = easeInOutQuad(phase)
      const add = (bone: Bone | null, off: { x: number; y: number; z: number } | undefined) => {
        if (!bone || !off) return
        bone.rotation.x += off.x * f
        bone.rotation.y += off.y * f
        bone.rotation.z += off.z * f
      }
      add(leftForeArm, g.target.leftFore)
      add(rightForeArm, g.target.rightFore)
      add(leftHand, g.target.leftHand)
      add(rightHand, g.target.rightHand)
      if (g.t >= g.duration) {
        g.active = false
        g.t = 0
        g.nextAt = 5 + Math.random() * 7
      }
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
