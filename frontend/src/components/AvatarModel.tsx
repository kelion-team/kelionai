import { useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Group, Bone, Mesh, SkinnedMesh } from 'three'
import { getVoiceLevel } from '../lib/audioIO'
import { useGestureQueue, type GestureLabel } from '../lib/gestureQueue'
import { useFacialQueue, type FacialLabel } from '../lib/facialQueue'
import { useAvatarScale } from '../lib/avatarScale'

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
  leftArm: ['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'],
  rightArm: ['RightArm', 'RightUpperArm', 'mixamorigRightArm'],
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

// ── FACIAL EXPRESSIONS (ARKit blendshapes on Ready Player Me) ─────────────────
// Gentleman style: subtle, rare, elegant. Amplitudes are intentionally low so
// they read as micro-expressions, not grimaces. They blend additively on top of
// the neutral face and never replace blink or lip-sync.

type FaceTarget = Partial<Record<string, number>>

const FACE_EXPRESSIONS: Record<FacialLabel, FaceTarget> = {
  smile: {
    mouthSmileLeft: 0.28,
    mouthSmileRight: 0.28,
    cheekSquintLeft: 0.12,
    cheekSquintRight: 0.12,
  },
  raisedBrow: {
    browInnerUp: 0.32,
    browOuterUpLeft: 0.22,
    browOuterUpRight: 0.22,
  },
  surprise: {
    browInnerUp: 0.26,
    eyeWideLeft: 0.30,
    eyeWideRight: 0.30,
    jawOpen: 0.07,
  },
  think: {
    browDownLeft: 0.16,
    browDownRight: 0.16,
    mouthPressLeft: 0.20,
    mouthPressRight: 0.20,
    mouthPucker: 0.08,
  },
  empathy: {
    browInnerUp: 0.18,
    mouthFrownLeft: 0.14,
    mouthFrownRight: 0.14,
  },
  warmth: {
    mouthSmileLeft: 0.16,
    mouthSmileRight: 0.16,
    cheekSquintLeft: 0.09,
    cheekSquintRight: 0.09,
    browInnerUp: 0.07,
  },
}

// RPM can ship blendshape names with a few conventions; try the ARKit standard
// first, then common _L/_R suffixes, then Viseme equivalents.
const MORPH_ALIASES: Record<string, string[]> = {
  eyeBlinkLeft: ['eyeBlinkLeft', 'eyeBlink_L'],
  eyeBlinkRight: ['eyeBlinkRight', 'eyeBlink_R'],
  eyeWideLeft: ['eyeWideLeft', 'eyeWide_L'],
  eyeWideRight: ['eyeWideRight', 'eyeWide_R'],
  browInnerUp: ['browInnerUp'],
  browOuterUpLeft: ['browOuterUpLeft', 'browOuterUp_L'],
  browOuterUpRight: ['browOuterUpRight', 'browOuterUp_R'],
  browDownLeft: ['browDownLeft', 'browDown_L'],
  browDownRight: ['browDownRight', 'browDown_R'],
  mouthSmileLeft: ['mouthSmileLeft', 'mouthSmile_L'],
  mouthSmileRight: ['mouthSmileRight', 'mouthSmile_R'],
  mouthFrownLeft: ['mouthFrownLeft', 'mouthFrown_L'],
  mouthFrownRight: ['mouthFrownRight', 'mouthFrown_R'],
  mouthPucker: ['mouthPucker'],
  mouthPressLeft: ['mouthPressLeft', 'mouthPress_L'],
  mouthPressRight: ['mouthPressRight', 'mouthPress_R'],
  cheekSquintLeft: ['cheekSquintLeft', 'cheekSquint_L'],
  cheekSquintRight: ['cheekSquintRight', 'cheekSquint_R'],
  jawOpen: ['jawOpen', 'mouthOpen', 'viseme_aa'],
}

function findMorphIndex(d: Record<string, number>, names: string[]): number | undefined {
  for (const n of names) {
    if (n in d) return d[n]
  }
  return undefined
}

type AutoGestureTarget = Partial<
  Record<'leftFore' | 'rightFore' | 'leftHand' | 'rightHand', { x: number; y: number; z: number }>
>

type CommandedBoneKey =
  | 'leftArm'
  | 'rightArm'
  | 'leftForeArm'
  | 'rightForeArm'
  | 'leftHand'
  | 'rightHand'

// Commands from the brain: each gesture is a set of bone offsets from the rest
// pose. They play ONCE, blend in/out linearly, and the idle animation (breath,
// shoulders, head, lip-sync) continues underneath.
const COMMANDED_GESTURES: Record<GestureLabel, Partial<Record<CommandedBoneKey, { x: number; y: number; z: number }>>> = {
  raiseRightHand: {
    rightArm: { x: -1.05, y: -0.25, z: 0.1 },
    rightForeArm: { x: -0.15, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0 },
  },
  salute: {
    rightArm: { x: -1.35, y: -0.45, z: 0.2 },
    rightForeArm: { x: -1.65, y: 0.35, z: 0.45 },
    rightHand: { x: 0, y: 0, z: 0.25 },
  },
  pointMonitor: {
    rightArm: { x: -0.55, y: -0.35, z: 0.1 },
    rightForeArm: { x: -0.25, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0.2 },
  },
}

// v2.2 avatar: natural idle from the neck down — shoulders, trunk, weight shift,
// visible breathing, rare small hand gestures synced to breath — plus the existing
// moderate lip-sync and micro head motion. Everything is procedural and frame-cheap.
// NEW: commanded one-time gestures from the brain blend on top without breaking idle.
export default function AvatarModel() {
  const [scale] = useAvatarScale()
  const { scene } = useGLTF('/kelion-rpm.glb')
  const root = useRef<Group>(null)
  const bones = useRef<Record<string, Bone>>({})
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)
  const hipsBaseY = useRef<number | null>(null)
  const gesture = useRef({
    nextAt: 6 + Math.random() * 6,
    active: false,
    t: 0,
    duration: 2,
    target: {} as AutoGestureTarget,
  })

  // Commanded gesture state: attack -> hold -> release, then cleared.
  const cmd = useRef<
    | { label: GestureLabel; t: number; phase: 'in' | 'hold' | 'out' }
    | null
  >(null)

  useGestureQueue((label) => {
    cmd.current = { label, t: 0, phase: 'in' }
  })

  // Facial expression state: commanded expressions interrupt the autonomous
  // micro-expression cycle and take precedence until they release.
  const face = useRef({
    current: {} as FaceTarget,       // smoothed current values
    commanded: null as { label: FacialLabel; t: number; phase: 'in' | 'hold' | 'out' } | null,
    auto: {
      nextAt: 4 + Math.random() * 5,
      active: false,
      t: 0,
      duration: 0,
      label: null as FacialLabel | null,
    },
    voiceSmile: 0,
  })

  useFacialQueue((label) => {
    face.current.commanded = { label, t: 0, phase: 'in' }
    face.current.auto.active = false
    face.current.auto.label = null
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
    const leftArm = firstBone(b, BONE_NAMES.leftArm)
    const rightArm = firstBone(b, BONE_NAMES.rightArm)
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

    // Commanded gesture: linear blend in / hold / blend out. The set of bones
    // touched by the current gesture is recorded so the idle hand gesture below
    // does not fight it on the same bones.
    const affected = new Set<Bone>()
    const c = cmd.current
    let cmdWeight = 0
    if (c) {
      c.t += delta
      const attack = 0.35
      const hold = 0.85
      const release = 0.5
      if (c.phase === 'in') {
        cmdWeight = Math.min(1, c.t / attack)
        if (c.t >= attack) {
          c.phase = 'hold'
          c.t = 0
        }
      } else if (c.phase === 'hold') {
        cmdWeight = 1
        if (c.t >= hold) {
          c.phase = 'out'
          c.t = 0
        }
      } else {
        cmdWeight = Math.max(0, 1 - c.t / release)
        if (c.t >= release) cmd.current = null
      }

      const addCmd = (
        bone: Bone | null,
        off: { x: number; y: number; z: number } | undefined,
      ) => {
        if (!bone || !off) return
        bone.rotation.x += off.x * cmdWeight
        bone.rotation.y += off.y * cmdWeight
        bone.rotation.z += off.z * cmdWeight
        affected.add(bone)
      }

      const target = COMMANDED_GESTURES[c.label]
      addCmd(leftArm, target.leftArm)
      addCmd(rightArm, target.rightArm)
      addCmd(leftForeArm, target.leftForeArm)
      addCmd(rightForeArm, target.rightForeArm)
      addCmd(leftHand, target.leftHand)
      addCmd(rightHand, target.rightHand)
    }

    // Occasional hand gesture: rare, small, slow, and synced to breath so the
    // hands feel relaxed, not agitated. A gesture only starts during the exhale
    // half of the breath cycle; its size is modulated by that same breath phase.
    // It is suppressed on bones already occupied by a commanded gesture.
    const g = gesture.current
    g.t += delta
    if (!g.active && g.t >= g.nextAt && breath > 0) {
      g.active = true
      g.t = 0
      g.duration = 1.8 + Math.random() * 1.2
      const both = Math.random() > 0.9
      const side = Math.random() > 0.5 ? 'left' : 'right'
      // Exhale = slightly fuller motion; inhale = more restrained.
      const breathMod = 0.55 + ((breath + 1) / 2) * 0.45
      const make = (mag: number) => ({
        x: (Math.random() - 0.5) * 2 * mag * breathMod,
        y: (Math.random() - 0.5) * 2 * mag * breathMod,
        z: (Math.random() - 0.5) * 2 * mag * breathMod,
      })
      const next: AutoGestureTarget = {}
      if (both || side === 'left') {
        next.leftFore = make(0.018)
        next.leftHand = make(0.025)
      }
      if (both || side === 'right') {
        next.rightFore = make(0.018)
        next.rightHand = make(0.025)
      }
      g.target = next
    }
    if (g.active) {
      const p = Math.min(1, g.t / g.duration)
      const phase = p < 0.5 ? p * 2 : 2 - p * 2
      const f = easeInOutQuad(phase)
      const add = (bone: Bone | null, off: { x: number; y: number; z: number } | undefined) => {
        if (!bone || !off || affected.has(bone)) return
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
        g.nextAt = 10 + Math.random() * 10
      }
    }

    // ── FACE: natural blink, lip-sync, and gentleman micro-expressions ─────────

    // Natural blink with occasional double-blinks and variable timing.
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
        // Occasional double-blink (3%) and natural interval 2.5–6.5s.
        if (Math.random() < 0.03) {
          bl.nextAt = 0.12
        } else {
          bl.nextAt = 2.5 + Math.random() * 4
        }
      }
    }

    // Lip-sync — mouth follows real voice amplitude, smoothed.
    const level = getVoiceLevel()
    mouth.current += (level - mouth.current) * 0.4
    const jawOpen = Math.min(0.55, mouth.current * 0.55)

    // Voice-driven subtle warmth while speaking: a gentle smile that breathes
    // with the voice so the face feels alive during sentences.
    const f = face.current
    const voiceSmileTarget = Math.min(0.16, level * 0.35)
    f.voiceSmile += (voiceSmileTarget - f.voiceSmile) * 0.25

    // Commanded facial expression: attack / hold / release.
    let exprWeight = 0
    let exprTarget: FaceTarget = {}
    const fc = f.commanded
    if (fc) {
      fc.t += delta
      const attack = 0.45
      const hold = 1.2
      const release = 0.55
      if (fc.phase === 'in') {
        exprWeight = Math.min(1, fc.t / attack)
        if (fc.t >= attack) {
          fc.phase = 'hold'
          fc.t = 0
        }
      } else if (fc.phase === 'hold') {
        exprWeight = 1
        if (fc.t >= hold) {
          fc.phase = 'out'
          fc.t = 0
        }
      } else {
        exprWeight = Math.max(0, 1 - fc.t / release)
        if (fc.t >= release) f.commanded = null
      }
      exprTarget = FACE_EXPRESSIONS[fc.label]
    }

    // Autonomous micro-expression: rare, small, brief — gentleman style.
    const a = f.auto
    if (!fc) {
      a.t += delta
      if (!a.active && a.t >= a.nextAt) {
        // 25% chance to actually start, so most intervals stay neutral.
        if (Math.random() < 0.25) {
          const labels: FacialLabel[] = ['smile', 'raisedBrow', 'warmth', 'think']
          a.active = true
          a.t = 0
          a.label = labels[Math.floor(Math.random() * labels.length)]
          a.duration = 1.2 + Math.random() * 1.3
        } else {
          a.nextAt = 4 + Math.random() * 5
          a.t = 0
        }
      }
      if (a.active && a.label) {
        const p = Math.min(1, a.t / a.duration)
        const phase = p < 0.5 ? p * 2 : 2 - p * 2
        exprWeight = easeInOutQuad(phase) * 0.55 // micro-expressions at 55% intensity
        exprTarget = FACE_EXPRESSIONS[a.label]
        if (a.t >= a.duration) {
          a.active = false
          a.label = null
          a.t = 0
          a.nextAt = 5 + Math.random() * 6
        }
      }
    }

    // Blend expression + voice-smile into the target face state.
    const desired: FaceTarget = {}
    for (const [key, base] of Object.entries(exprTarget)) {
      const v = (base ?? 0) * exprWeight
      if (v !== 0) desired[key] = (desired[key] ?? 0) + v
    }
    desired.mouthSmileLeft = (desired.mouthSmileLeft ?? 0) + f.voiceSmile
    desired.mouthSmileRight = (desired.mouthSmileRight ?? 0) + f.voiceSmile
    desired.cheekSquintLeft = (desired.cheekSquintLeft ?? 0) + f.voiceSmile * 0.6
    desired.cheekSquintRight = (desired.cheekSquintRight ?? 0) + f.voiceSmile * 0.6

    // Smooth all face channels toward desired values.
    for (const key of Object.keys(MORPH_ALIASES)) {
      const cur = f.current[key] ?? 0
      const tgt = desired[key] ?? 0
      f.current[key] = cur + (tgt - cur) * 0.18
    }

    for (const mesh of morphs.current) {
      const d = mesh.morphTargetDictionary as Record<string, number> | undefined
      const inf = mesh.morphTargetInfluences
      if (!d || !inf) continue
      const blinkL = findMorphIndex(d, MORPH_ALIASES.eyeBlinkLeft)
      const blinkR = findMorphIndex(d, MORPH_ALIASES.eyeBlinkRight)
      if (blinkL !== undefined) inf[blinkL] = eye
      if (blinkR !== undefined) inf[blinkR] = eye

      // Lip-sync jaw is additive to any surprise micro-expression, but clamped.
      const jawIdx = findMorphIndex(d, MORPH_ALIASES.jawOpen)
      if (jawIdx !== undefined) {
        inf[jawIdx] = Math.min(0.8, jawOpen + (f.current.jawOpen ?? 0))
      }

      for (const [key, aliases] of Object.entries(MORPH_ALIASES)) {
        if (key === 'eyeBlinkLeft' || key === 'eyeBlinkRight' || key === 'jawOpen') continue
        const idx = findMorphIndex(d, aliases)
        if (idx !== undefined) inf[idx] = f.current[key] ?? 0
      }
    }
  })

  return <primitive ref={root} object={scene} scale={scale} position={[0, -1.65, 0]} />
}

useGLTF.preload('/kelion-rpm.glb')
