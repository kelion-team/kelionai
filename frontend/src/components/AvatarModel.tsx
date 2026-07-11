import { useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { LoopOnce, LoopRepeat } from 'three'
import type { Group, Bone, Mesh, SkinnedMesh, AnimationClip, AnimationAction } from 'three'
import { getVoiceLevel } from '../lib/audioIO'

// Rest pose (arms hanging down along the body, natural A-pose) for THIS RPM
// asset's skeleton. The GLB bind pose ships with arms raised, so we snap the
// arm bones down ONCE before the first paint (no T-pose flash). După prima
// actualizare a mixerului, clipurile din bibliotecă preiau complet scheletul.
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

// ── REGIA DE MIȘCARE (Adrian, 11 iul: „controlul full al mișcărilor
// avatarului, sincronizare cu mișcări din biblioteca deja existentă") ──
// Scheletul e mișcat EXCLUSIV de clipuri oficiale Ready Player Me
// (animation-library, MIT, captură de mișcare, același schelet — zero cod de
// mână, lecția #125). Regia alege clipul după ce face Kelion ACUM:
//   • tăcut  → „idle" în buclă + din când în când o variație (once), ca să nu
//     pară un robot care repetă aceeași buclă la nesfârșit;
//   • vorbește (nivelul REAL al vocii Chirp 3, nu presupunere) → un clip de
//     vorbit cu gesturi, ales aleator la fiecare replică, în buclă cât vorbește;
//   • gest la comandă → evenimentul `kelion-gesture` (detail: numele clipului)
//     rulează O DATĂ orice clip din regie — canalul prin care creierul va
//     putea cere explicit un gest („salută", „arată spre monitor" etc.).
// Tranzițiile sunt mereu crossfade (0.35s) — niciodată salt sec între poziții.
// Clipirea și lip-sync-ul rămân pe morph targets (clipurile nu le ating).
const CLIP_FILES: Record<string, string> = {
  idle: '/anim/M_Standing_Idle_001.glb',
  idleVar: '/anim/M_Standing_Idle_Variations_002.glb',
  talk1: '/anim/M_Talking_Variations_001.glb',
  talk2: '/anim/M_Talking_Variations_004.glb',
  expr1: '/anim/M_Standing_Expressions_001.glb',
  expr2: '/anim/M_Standing_Expressions_004.glb',
}

export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const idle = useGLTF(CLIP_FILES.idle)
  const idleVar = useGLTF(CLIP_FILES.idleVar)
  const talk1 = useGLTF(CLIP_FILES.talk1)
  const talk2 = useGLTF(CLIP_FILES.talk2)
  const expr1 = useGLTF(CLIP_FILES.expr1)
  const expr2 = useGLTF(CLIP_FILES.expr2)
  const root = useRef<Group>(null)

  // Fiecare GLB din bibliotecă are un singur clip, toate cu același nume
  // generic — le redenumim după rol ca să le putem chema pe nume.
  const clips = useMemo(() => {
    const out: AnimationClip[] = []
    const add = (g: { animations: AnimationClip[] }, name: string): void => {
      const c = g.animations[0]
      if (c) {
        c.name = name
        out.push(c)
      }
    }
    add(idle, 'idle')
    add(idleVar, 'idleVar')
    add(talk1, 'talk1')
    add(talk2, 'talk2')
    add(expr1, 'expr1')
    add(expr2, 'expr2')
    return out
  }, [idle, idleVar, talk1, talk2, expr1, expr2])

  const { actions, mixer } = useAnimations(clips, root)
  const current = useRef<AnimationAction | null>(null)
  const state = useRef<'idle' | 'talking' | 'gesture'>('idle')
  const talkHold = useRef(0) // vocea „ține" starea de vorbit peste micro-pauze
  const nextVarAt = useRef(14 + Math.random() * 14)
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)

  const play = (name: string, once = false, fade = 0.35): void => {
    const next = actions[name]
    if (!next || next === current.current) return
    next.reset()
    if (once) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = false
    } else {
      next.setLoop(LoopRepeat, Infinity)
    }
    next.fadeIn(fade).play()
    current.current?.fadeOut(fade)
    current.current = next
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

  useEffect(() => {
    play('idle')
    // La finalul unui clip „once" (variație/gest), înapoi lin la repaus.
    const onFinished = (): void => {
      state.current = 'idle'
      current.current = null
      play('idle')
    }
    mixer.addEventListener('finished', onFinished)
    // CANALUL DE COMANDĂ: orice parte a aplicației (în viitor: creierul, prin
    // punte) poate cere un gest pe nume — rulează o dată, apoi revine singur.
    const onGesture = (e: Event): void => {
      const name = String((e as CustomEvent).detail ?? '')
      if (actions[name]) {
        state.current = 'gesture'
        play(name, true)
      }
    }
    window.addEventListener('kelion-gesture', onGesture)
    return () => {
      mixer.removeEventListener('finished', onFinished)
      window.removeEventListener('kelion-gesture', onGesture)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, mixer])

  useFrame((state3, delta) => {
    const t = state3.clock.elapsedTime
    const level = getVoiceLevel()

    // ── Regia: alege mișcarea după ce face Kelion acum ──
    if (level > 0.05) talkHold.current = t + 0.7
    const talking = t < talkHold.current
    if (state.current !== 'gesture') {
      if (talking && state.current !== 'talking') {
        state.current = 'talking'
        play(Math.random() < 0.5 ? 'talk1' : 'talk2')
      } else if (!talking && state.current === 'talking') {
        state.current = 'idle'
        play('idle')
      } else if (!talking && state.current === 'idle' && t >= nextVarAt.current) {
        // Din când în când, o variație de repaus — apoi „finished" ne întoarce.
        nextVarAt.current = t + 18 + Math.random() * 16
        state.current = 'gesture'
        play('idleVar', true)
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
for (const f of Object.values(CLIP_FILES)) useGLTF.preload(f)
