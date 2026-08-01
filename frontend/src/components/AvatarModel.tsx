import { useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { LoopOnce, LoopRepeat, LoadingManager } from 'three'
import { GLTFLoader } from 'three-stdlib'
import type { Group, Bone, Mesh, SkinnedMesh, AnimationClip, AnimationAction } from 'three'
import { getVoiceLevel } from '../lib/audioIO'
import { useFacialQueue, type FacialLabel } from '../lib/facialQueue'
import { fetchDisabledGestures } from '../lib/gestures'

// ── FACIAL EXPRESSIONS (ARKit blendshapes) — kept from the constructor's "avatar
// v2.3" release (its good part: the face on morphs, allowed), while
// the skeleton stays EXCLUSIVELY on library clips (rule #125).
// Gentleman style: small amplitudes, micro-expressions, no grimaces; they lay ADDITIVELY
// over the neutral face and don't touch blinking or lip-sync.
type FaceTarget = Partial<Record<string, number>>
const FACE_EXPRESSIONS: Record<FacialLabel, FaceTarget> = {
  smile: { mouthSmileLeft: 0.28, mouthSmileRight: 0.28, cheekSquintLeft: 0.12, cheekSquintRight: 0.12 },
  raisedBrow: { browInnerUp: 0.32, browOuterUpLeft: 0.22, browOuterUpRight: 0.22 },
  surprise: { browInnerUp: 0.26, eyeWideLeft: 0.3, eyeWideRight: 0.3, jawOpen: 0.07 },
  think: { browDownLeft: 0.16, browDownRight: 0.16, mouthPressLeft: 0.2, mouthPressRight: 0.2, mouthPucker: 0.08 },
  empathy: { browInnerUp: 0.18, mouthFrownLeft: 0.14, mouthFrownRight: 0.14 },
  warmth: { mouthSmileLeft: 0.16, mouthSmileRight: 0.16, cheekSquintLeft: 0.09, cheekSquintRight: 0.09, browInnerUp: 0.07 },
}
// Morph names can come in two conventions (ARKit or _L/_R).
const MORPH_ALT: Record<string, string> = {
  mouthSmileLeft: 'mouthSmile_L',
  mouthSmileRight: 'mouthSmile_R',
  cheekSquintLeft: 'cheekSquint_L',
  cheekSquintRight: 'cheekSquint_R',
  browOuterUpLeft: 'browOuterUp_L',
  browOuterUpRight: 'browOuterUp_R',
  eyeWideLeft: 'eyeWide_L',
  eyeWideRight: 'eyeWide_R',
  browDownLeft: 'browDown_L',
  browDownRight: 'browDown_R',
  mouthPressLeft: 'mouthPress_L',
  mouthPressRight: 'mouthPress_R',
  mouthFrownLeft: 'mouthFrown_L',
  mouthFrownRight: 'mouthFrown_R',
}
// A micro-expression's envelope: eases in, holds briefly, eases out.
const FACE_IN = 0.25
const FACE_HOLD = 1.6
const FACE_OUT = 0.6
// All morphs used by expressions — zeroed on every frame
// before applying the current one, so an expression interrupted by another doesn't
// stay "frozen" on the face.
const FACE_KEYS = [...new Set(Object.values(FACE_EXPRESSIONS).flatMap((t) => Object.keys(t)))].filter(
  (k) => k !== 'jawOpen',
)

// Rest pose (arms hanging down along the body, natural A-pose) for THIS RPM
// asset's skeleton. The GLB bind pose ships with arms raised, so we snap the
// arm bones down ONCE before the first paint (no T-pose flash). After the mixer’s
// first update, the library clips take over the skeleton completely.
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

// ── THE MOVEMENT DIRECTION (Adrian, Jul 11: "full control of the avatar's
// movements, sync with moves from the already existing library") ──
// The skeleton is moved EXCLUSIVELY by official Ready Player Me clips
// (animation-library, MIT, motion capture, same skeleton — zero hand-
// written code, lesson #125). The direction picks the clip by what Kelion does NOW:
//   • silent → "idle" looping + every now and then a variation (once), so he doesn't
//     look like a robot repeating the same loop forever;
//   • speaking (the REAL level of the Chirp 3 voice, not an assumption) → a talking
//     clip with gestures, chosen randomly on each reply, looping while he speaks;
//   • gesture on command → the `kelion-gesture` event (detail: the clip name)
//     runs any clip from the direction ONCE — the channel through which the brain
//     can explicitly request a gesture ("wave", "point at the monitor" etc.).
// Transitions are always crossfade (0.35s) — never a dry jump between poses.
// Blinking and lip-sync stay on morph targets (the clips don't touch them).
// The commandable clip names = exactly the names the BRAIN knows
// (eticheta [GEST nume] din chat.ts): Adrian cere prin viu grai sau tonul
// replicii o cere (context/sentimente), creierul alege numele, avatarul
// executes (Adrian, Jul 11: "movements on command for everything I want him to do" +
// "the movements must be tied to context, feelings").
const CLIP_FILES: Record<string, string> = {
  idle: '/anim/M_Standing_Idle_001.glb',
  variatie: '/anim/M_Standing_Idle_Variations_002.glb',
  // ONE SINGLE talking clip, the retained one (Adrian: "the current gestures
  // unsuitable for a gentleman") — the ample gesticulation was removed
  // from the automatic rotation; the big expressions stay ONLY on command.
  talk: '/anim/M_Talking_Variations_004.glb',
  'expresie-1': '/anim/M_Standing_Expressions_001.glb',
  'expresie-2': '/anim/M_Standing_Expressions_002.glb',
  'expresie-3': '/anim/M_Standing_Expressions_008.glb',
  'expresie-4': '/anim/M_Standing_Expressions_004.glb',
  dans: '/anim/M_Dances_001.glb',
  // The GENTLE gestures (Adrian: "what gentler gestures can he do") — idle
  // variations from the library: subtle weight shift, looking around.
  'variatie-2': '/anim/M_Standing_Idle_Variations_003.glb',
  'variatie-3': '/anim/M_Standing_Idle_Variations_007.glb',
}

// THE WHOLE LIBRARY (Adrian, Jul 11 evening: "can you load all the gestures from
// that library? he should have them") — the rest of the stationary Ready Player Me
// catalog (idle variations, expressions, conversation gestures, dances; locomotion
// makes no sense for an avatar standing in place). NOT loaded at startup:
// the core above comes through Suspense as before, and this catalog
// downloads IN THE BACKGROUND, clip by clip, a few seconds after first paint —
// the app starts just as fast, and in ~a minute Kelion has them all.
const LAZY_CLIP_FILES: Record<string, string> = {
  'variatie-4': '/anim/M_Standing_Idle_Variations_001.glb',
  'variatie-5': '/anim/M_Standing_Idle_Variations_004.glb',
  'variatie-6': '/anim/M_Standing_Idle_Variations_005.glb',
  'variatie-7': '/anim/M_Standing_Idle_Variations_006.glb',
  'variatie-8': '/anim/M_Standing_Idle_Variations_008.glb',
  'variatie-9': '/anim/M_Standing_Idle_Variations_009.glb',
  'variatie-10': '/anim/M_Standing_Idle_Variations_010.glb',
  'expresie-5': '/anim/M_Standing_Expressions_005.glb',
  'expresie-6': '/anim/M_Standing_Expressions_006.glb',
  'expresie-7': '/anim/M_Standing_Expressions_007.glb',
  'expresie-8': '/anim/M_Standing_Expressions_009.glb',
  'expresie-9': '/anim/M_Standing_Expressions_010.glb',
  'expresie-10': '/anim/M_Standing_Expressions_011.glb',
  'expresie-11': '/anim/M_Standing_Expressions_012.glb',
  'expresie-12': '/anim/M_Standing_Expressions_013.glb',
  'expresie-13': '/anim/M_Standing_Expressions_014.glb',
  'expresie-14': '/anim/M_Standing_Expressions_015.glb',
  // Conversation gestures (M_Talking_Variations; 004 is the automatic "talk" clip).
  'vorbit-1': '/anim/M_Talking_Variations_001.glb',
  'vorbit-2': '/anim/M_Talking_Variations_002.glb',
  'vorbit-3': '/anim/M_Talking_Variations_003.glb',
  'vorbit-4': '/anim/M_Talking_Variations_005.glb',
  'vorbit-5': '/anim/M_Talking_Variations_006.glb',
  'vorbit-6': '/anim/M_Talking_Variations_007.glb',
  'vorbit-7': '/anim/M_Talking_Variations_008.glb',
  'vorbit-8': '/anim/M_Talking_Variations_009.glb',
  'vorbit-9': '/anim/M_Talking_Variations_010.glb',
  'dans-2': '/anim/M_Dances_002.glb',
  'dans-3': '/anim/M_Dances_003.glb',
  'dans-4': '/anim/M_Dances_004.glb',
  'dans-5': '/anim/M_Dances_005.glb',
  'dans-6': '/anim/M_Dances_006.glb',
  'dans-7': '/anim/M_Dances_007.glb',
  'dans-8': '/anim/M_Dances_008.glb',
  'dans-9': '/anim/M_Dances_009.glb',
  'dans-10': '/anim/M_Dances_011.glb',
}

// THE GESTURE TAXONOMY (Adrian, Jul 13) — GENTLE idle allowed vs ample "warm-ups"
// banned from the automatic rotation. RESTARTED on Jul 27 (Adrian: "missing
// motorul/creierul de apelare gesturi — umane reale, decente"): regia de mai
// below it picks by itself, but ONLY from the gentle set (gentleman); the ample expressions
// and dances stay ONLY on explicit command. Everything Adrian unchecks in
// Admin→Gestures is excluded everywhere (disabledG, refreshed every 30s).
const CHAT_IDLE_CALM = ['variatie', 'variatie-2', 'variatie-4', 'variatie-5', 'variatie-6', 'variatie-8']
// (banned from the automatic rotation: variatie-3, variatie-7, variatie-9, variatie-10)

export default function AvatarModel() {
  const { scene } = useGLTF('/kelion-rpm.glb')
  const idle = useGLTF(CLIP_FILES.idle)
  const variatie = useGLTF(CLIP_FILES.variatie)
  const talk = useGLTF(CLIP_FILES.talk)
  const expr1 = useGLTF(CLIP_FILES['expresie-1'])
  const expr2 = useGLTF(CLIP_FILES['expresie-2'])
  const expr3 = useGLTF(CLIP_FILES['expresie-3'])
  const expr4 = useGLTF(CLIP_FILES['expresie-4'])
  const dans = useGLTF(CLIP_FILES.dans)
  const variatie2 = useGLTF(CLIP_FILES['variatie-2'])
  const variatie3 = useGLTF(CLIP_FILES['variatie-3'])
  const root = useRef<Group>(null)

  // THE "AVATAR LOADED" SIGNAL (Adrian, Jul 28): the component reaches here ONLY
  // after Suspense resolved `useGLTF('/kelion-rpm.glb')` — meaning the base GLB
  // is loaded and the main thread is free. We emit once the event
  // ChatPanel waits for to arm the microphone EXACTLY at this moment
  // (not during the model's heavy parsing). We also set a flag on window for
  // the case ChatPanel mounts after us (catches the state, no race).
  useEffect(() => {
    const w = window as unknown as { __kelionAvatarReady?: boolean }
    w.__kelionAvatarReady = true
    window.dispatchEvent(new CustomEvent('kelion:avatar-ready'))
  }, [])

  // Each library GLB has a single clip, all with the same generic
  // name — we rename them by role so we can call them by name.
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
    add(variatie, 'variatie')
    add(talk, 'talk')
    add(expr1, 'expresie-1')
    add(expr2, 'expresie-2')
    add(expr3, 'expresie-3')
    add(expr4, 'expresie-4')
    add(dans, 'dans')
    add(variatie2, 'variatie-2')
    add(variatie3, 'variatie-3')
    return out
  }, [idle, variatie, talk, expr1, expr2, expr3, expr4, dans, variatie2, variatie3])

  const { actions, mixer } = useAnimations(clips, root)
  const current = useRef<AnimationAction | null>(null)
  const state = useRef<'idle' | 'talking' | 'gesture'>('idle')
  // THE GESTURE ENGINE (Jul 27): the direction's tracks — how long "speaking" holds
  // after the last voice peak and when the next idle variation comes.
  const talkHold = useRef(0)
  const nextVar = useRef(30)
  // SUBTLETY (Adrian, Jul 27: "the hand gesturing and everyone's must be
  // much more subtle"): the talking clip does NOT replace the idle — it lays
  // OVER it as a small-weight layer (idle stays the base), so just a shadow
  // of gesticulation, not the whole clip in full force.
  const talkLayer = useRef<AnimationAction | null>(null)
  // The arm/forearm bones discovered in the scene, for locking them at
  // rest on every frame (Adrian, Jul 13: full stop of ample gestures).
  const armBones = useRef<Record<string, Bone | null>>({})
  // DISABLED GESTURES (Adrian, Jul 13): what Adrian unchecks in Admin → Gestures
  // does NOT play at all — neither automatically, nor on command. Refreshed periodically.
  const disabledG = useRef<Set<string>>(new Set())
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  // Hydration fix: fixed initial value, randomized in useEffect on the client.
  const blink = useRef({ t: 0, nextAt: 4, phase: 0, duration: 0.16 })
  useEffect(() => {
    blink.current.nextAt = 2 + Math.random() * 4
  }, [])
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)
  // The full-catalog clips, arrived in the background (mixer.clipAction keeps
  // the action registry by itself — one clip + same root = same action).
  const lazyClips = useRef<Record<string, AnimationClip>>({})
  // The current facial micro-expression (commanded from chat via facialQueue).
  const face = useRef<{ label: FacialLabel; t: number } | null>(null)
  useFacialQueue((label) => {
    face.current = { label, t: 0 }
  })

  const play = (name: string, once = false, fade = 0.35, timeScale = 1): void => {
    const lazy = lazyClips.current[name]
    const next = actions[name] ?? (lazy && root.current ? mixer.clipAction(lazy, root.current) : null)
    if (!next || next === current.current) return
    next.reset()
    if (once) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = false
    } else {
      next.setLoop(LoopRepeat, Infinity)
    }
    next.setEffectiveWeight(1)
    next.setEffectiveTimeScale(timeScale)
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
    // Arms down before the first frame — the clip takes over from the first update.
    // We also save the bones to lock them at rest on every frame.
    for (const key of Object.keys(ARM_REST)) {
      const target = ARM_REST[key]
      for (const name of ARM_NAMES[key]) {
        const bone = b[name]
        if (bone) {
          bone.rotation.set(target.x, target.y, target.z)
          armBones.current[key] = bone
          break
        }
      }
    }
  }, [scene])

  // Ce gesturi a scos Adrian din Admin → Gesturi (public /api/gestures/state).
  // Reloaded every 30s, so panel changes take effect without a reload.
  useEffect(() => {
    const load = (): void => void fetchDisabledGestures().then((l) => (disabledG.current = new Set(l)))
    load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    // THE ENGINE RESTARTED (Jul 27, Adrian's order): the living idle runs from
    // the first blink — the body breathes subtly; the arms stay locked at rest by
    // the useFrame padlock (only in idle), so the Jul 13 decency is preserved.
    play('idle')
    // At the end of a "once" clip (variation/gesture), smoothly back to idle.
    const onFinished = (): void => {
      state.current = 'idle'
      current.current = null
      play('idle')
      // The scene (Stage) learns the gesture ended — e.g. it returns from the dance
      // position back into Adrian's corner.
      window.dispatchEvent(new Event('kelion-gesture-done'))
    }
    mixer.addEventListener('finished', onFinished)
    // THE COMMAND CHANNEL: any part of the app (in the future: the brain, via
    // the bridge) can request a gesture by name — it plays once, then returns by itself.
    const runGesture = (name: string, allowDisabled: boolean): void => {
      if (!allowDisabled && disabledG.current.has(name)) return // debifat → nu se joacă
      if (actions[name] || lazyClips.current[name]) {
        // Stratul subtil de vorbit se stinge — gestul comandat (pe context, de
        // to the brain) has priority and plays at full expressiveness.
        talkLayer.current?.fadeOut(0.3)
        talkLayer.current = null
        state.current = 'gesture'
        play(name, true)
      }
    }
    // Normal channel (brain/command): refuses the gestures Adrian unchecked.
    const onGesture = (e: Event): void => runGesture(String((e as CustomEvent).detail ?? ''), false)
    // PREVIEW channel (Admin → Gestures "▶ Show"): plays ANYTHING, so the admin
    // sees the gesture before checking it.
    const onPreview = (e: Event): void => runGesture(String((e as CustomEvent).detail ?? ''), true)
    window.addEventListener('kelion-gesture', onGesture)
    window.addEventListener('kelion-gesture-preview', onPreview)
    return () => {
      mixer.removeEventListener('finished', onFinished)
      window.removeEventListener('kelion-gesture', onGesture)
      window.removeEventListener('kelion-gesture-preview', onPreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, mixer])

  // THE FULL CATALOG, in the background: a few seconds after first paint, the rest
  // of the library downloads sequentially (one clip at a time — doesn't compete with
  // app startup nor with voice/chat); a failed clip doesn't block
  // restul. Numele devine cel comandabil ([GEST nume]).
  useEffect(() => {
    let disposed = false
    // SEPARATE MANAGER (not DefaultLoadingManager): the background library download
    // must NOT touch `useProgress`/AvatarLoading — otherwise the loading bar
    // reappeared ~2.5s after first paint and the avatar "loaded twice"
    // (once the core, once the library). With its own manager, the indicator
    // appears ONE SINGLE time, for the base avatar, then stays.
    const loader = new GLTFLoader(new LoadingManager())
    const queue = Object.entries(LAZY_CLIP_FILES)
    const loadNext = (): void => {
      if (disposed) return
      const entry = queue.shift()
      if (!entry) return
      const [name, file] = entry
      loader.load(
        file,
        (g) => {
          if (disposed) return
          const c = g.animations[0]
          if (c) {
            c.name = name
            lazyClips.current[name] = c
          }
          loadNext()
        },
        undefined,
        () => loadNext(),
      )
    }
    const id = window.setTimeout(loadNext, 2500)
    return () => {
      disposed = true
      window.clearTimeout(id)
    }
  }, [])

  useFrame((state3, delta) => {
    const level = getVoiceLevel()
    const t = state3.clock.elapsedTime

    // ── MOTORUL DE GESTURI (Adrian, 27 iul: „umane reale, decente") ──
    // The deterministic direction, by what Kelion does NOW (the REAL voice level):
    //   speaking → the calm conversation clip looping (gentleman
    //   gesticulation, the clip Adrian retained on Jul 13);
    //   silent → living idle + a rare GENTLE variation (25–45s), from the calm set;
    //   commanded gesture (brain/living voice) → absolute priority, we don't touch it.
    // Everything unchecked in Admin→Gestures doesn't play here either (disabledG).
    if (level > 0.05) talkHold.current = t + 0.7
    const talking = t < talkHold.current
    if (state.current !== 'gesture') {
      if (talking && state.current !== 'talking' && !disabledG.current.has('talk')) {
        state.current = 'talking'
        // GENTLEMAN, NOT RUFFIAN (Adrian, Jul 27: "waving hands like that... gentleman
        // gestures"): idle stays the base; talking is just a SHADOW of a layer —
        // weight 0.25, slowed — arms practically at rest, the life shows,
        // teatrul nu. Expresivitatea vine NUMAI de la creier, pe context
        // (play_avatar_gesture: points at the monitor when presenting etc.).
        const lazy = lazyClips.current['talk']
        const act = actions['talk'] ?? (lazy && root.current ? mixer.clipAction(lazy, root.current) : null)
        if (act) {
          act.reset()
          act.setLoop(LoopRepeat, Infinity)
          act.setEffectiveWeight(0.25)
          act.setEffectiveTimeScale(0.85)
          act.fadeIn(0.6).play()
          talkLayer.current = act
        }
      } else if (!talking && state.current === 'talking') {
        state.current = 'idle'
        talkLayer.current?.fadeOut(0.6)
        talkLayer.current = null
        nextVar.current = t + 40 + Math.random() * 30
      } else if (!talking && state.current === 'idle' && t > nextVar.current) {
        const pool = CHAT_IDLE_CALM.filter((n) => !disabledG.current.has(n) && (actions[n] || lazyClips.current[n]))
        if (pool.length) {
          state.current = 'gesture'
          play(pool[Math.floor(Math.random() * pool.length)], true, 0.5, 0.9)
        }
        nextVar.current = t + 40 + Math.random() * 30
      }
    }

    // Arms locked at rest ONLY in idle (the Jul 13 decency): in talking
    // and in gestures, the motion-capture clips have a free hand.
    if (state.current === 'idle') {
      for (const key of Object.keys(ARM_REST)) {
        const bone = armBones.current[key]
        const target = ARM_REST[key]
        if (bone) bone.rotation.set(target.x, target.y, target.z)
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

    // Lip-sync — the mouth follows the real amplitude of the voice playing now (Chirp
    // 3), smoothed like the blink; MODERATE opening (Adrian once complained that
    // gura se deschide prea mult).
    mouth.current += (level - mouth.current) * 0.4
    const jawOpen = Math.min(0.5, mouth.current * 0.55)

    // The facial micro-expression: envelope in → hold → out, then done.
    let faceW = 0
    let faceTargets: FaceTarget | null = null
    const f = face.current
    if (f) {
      f.t += delta
      if (f.t < FACE_IN) faceW = f.t / FACE_IN
      else if (f.t < FACE_IN + FACE_HOLD) faceW = 1
      else if (f.t < FACE_IN + FACE_HOLD + FACE_OUT) faceW = 1 - (f.t - FACE_IN - FACE_HOLD) / FACE_OUT
      else face.current = null
      if (face.current) faceTargets = FACE_EXPRESSIONS[f.label]
    }

    for (const mesh of morphs.current) {
      const d = mesh.morphTargetDictionary
      const inf = mesh.morphTargetInfluences
      if (!d || !inf) continue
      const l = d['eyeBlinkLeft'] ?? d['eyeBlink_L']
      const r = d['eyeBlinkRight'] ?? d['eyeBlink_R']
      if (l !== undefined) inf[l] = eye
      if (r !== undefined) inf[r] = eye
      const jaw = d['jawOpen'] ?? d['mouthOpen'] ?? d['viseme_aa']
      // First cleans the previous expression's traces (an expression interrupted by
      // another must not stay on the face), then applies the current one.
      for (const k of FACE_KEYS) {
        const idx = d[k] ?? d[MORPH_ALT[k] ?? '']
        if (idx !== undefined) inf[idx] = 0
      }
      // Voice always has priority on the mouth; the expression only complements.
      let jawExtra = 0
      if (faceTargets) {
        for (const [k, v] of Object.entries(faceTargets)) {
          if (v === undefined) continue
          if (k === 'jawOpen') {
            jawExtra = v * faceW
            continue
          }
          const idx = d[k] ?? d[MORPH_ALT[k] ?? '']
          if (idx !== undefined) inf[idx] = v * faceW
        }
      }
      if (jaw !== undefined) inf[jaw] = Math.max(jawOpen, jawExtra)
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}
