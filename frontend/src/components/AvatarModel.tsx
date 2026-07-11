import { useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { LoopOnce, LoopRepeat } from 'three'
import { GLTFLoader } from 'three-stdlib'
import type { Group, Bone, Mesh, SkinnedMesh, AnimationClip, AnimationAction } from 'three'
import { getVoiceLevel } from '../lib/audioIO'
import { useFacialQueue, type FacialLabel } from '../lib/facialQueue'

// ── EXPRESII FACIALE (ARKit blendshapes) — păstrate din release-ul „avatar
// v2.3" al constructorului (partea lui bună: fața pe morph-uri, permisă), în
// timp ce scheletul rămâne EXCLUSIV pe clipurile din bibliotecă (regula #125).
// Stil de domn: amplitudini mici, micro-expresii, nu grimase; se așază ADITIV
// peste fața neutră și nu ating clipitul sau lip-sync-ul.
type FaceTarget = Partial<Record<string, number>>
const FACE_EXPRESSIONS: Record<FacialLabel, FaceTarget> = {
  smile: { mouthSmileLeft: 0.28, mouthSmileRight: 0.28, cheekSquintLeft: 0.12, cheekSquintRight: 0.12 },
  raisedBrow: { browInnerUp: 0.32, browOuterUpLeft: 0.22, browOuterUpRight: 0.22 },
  surprise: { browInnerUp: 0.26, eyeWideLeft: 0.3, eyeWideRight: 0.3, jawOpen: 0.07 },
  think: { browDownLeft: 0.16, browDownRight: 0.16, mouthPressLeft: 0.2, mouthPressRight: 0.2, mouthPucker: 0.08 },
  empathy: { browInnerUp: 0.18, mouthFrownLeft: 0.14, mouthFrownRight: 0.14 },
  warmth: { mouthSmileLeft: 0.16, mouthSmileRight: 0.16, cheekSquintLeft: 0.09, cheekSquintRight: 0.09, browInnerUp: 0.07 },
}
// Numele morph-urilor pot veni în două convenții (ARKit sau _L/_R).
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
// Anvelopa unei micro-expresii: intră lin, ține puțin, iese lin.
const FACE_IN = 0.25
const FACE_HOLD = 1.6
const FACE_OUT = 0.6
// Toate morph-urile folosite de expresii — se aduc la zero în fiecare cadru
// înainte de aplicarea expresiei curente, ca o expresie întreruptă de alta să
// nu rămână „înghețată" pe față.
const FACE_KEYS = [...new Set(Object.values(FACE_EXPRESSIONS).flatMap((t) => Object.keys(t)))].filter(
  (k) => k !== 'jawOpen',
)

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
// Numele clipurilor comandabile = exact numele pe care le știe CREIERUL
// (eticheta [GEST nume] din chat.ts): Adrian cere prin viu grai sau tonul
// replicii o cere (context/sentimente), creierul alege numele, avatarul
// execută (Adrian, 11 iul: „mișcări comandate la tot ce vreau să facă" +
// „mișcările trebuiesc legate de context, sentimente").
const CLIP_FILES: Record<string, string> = {
  idle: '/anim/M_Standing_Idle_001.glb',
  variatie: '/anim/M_Standing_Idle_Variations_002.glb',
  // UN SINGUR clip de vorbit, cel reținut (Adrian: „gesturile actuale
  // nepotrivite pentru gentleman") — gesticulația amplă a fost scoasă
  // din rotația automată; expresiile mari rămân DOAR la comandă.
  talk: '/anim/M_Talking_Variations_004.glb',
  'expresie-1': '/anim/M_Standing_Expressions_001.glb',
  'expresie-2': '/anim/M_Standing_Expressions_002.glb',
  'expresie-3': '/anim/M_Standing_Expressions_008.glb',
  'expresie-4': '/anim/M_Standing_Expressions_004.glb',
  dans: '/anim/M_Dances_001.glb',
  // Gesturile DOMOALE (Adrian: „ce gesturi mai domoale poate face") — variații
  // de repaus din bibliotecă: mutare subtilă de greutate, privire în jur.
  'variatie-2': '/anim/M_Standing_Idle_Variations_003.glb',
  'variatie-3': '/anim/M_Standing_Idle_Variations_007.glb',
}

// TOATĂ BIBLIOTECA (Adrian, 11 iul seara: „poți încărca toate gesturile din
// biblioteca aia? să le aibă") — restul catalogului staționar Ready Player Me
// (variații de repaus, expresii, gesturi de conversație, dansuri; locomoția
// n-are sens pentru un avatar care stă pe loc). NU se încarcă la pornire:
// nucleul de mai sus vine prin Suspense ca până acum, iar catalogul ăsta se
// descarcă ÎN FUNDAL, clip după clip, la câteva secunde după primul paint —
// aplicația pornește la fel de repede, iar în ~un minut Kelion le are pe toate.
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
  // Gesturi de conversație (M_Talking_Variations; 004 e clipul auto „talk").
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
  const talkHold = useRef(0) // vocea „ține" starea de vorbit peste micro-pauze
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  const blink = useRef({ t: 0, nextAt: 2 + Math.random() * 4, phase: 0, duration: 0.16 })
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)
  // Clipurile din catalogul complet, sosite în fundal (mixer.clipAction ține
  // singur evidența acțiunilor — un clip + aceeași rădăcină = aceeași acțiune).
  const lazyClips = useRef<Record<string, AnimationClip>>({})
  // Micro-expresia facială curentă (comandată din chat prin facialQueue).
  const face = useRef<{ label: FacialLabel; t: number } | null>(null)
  useFacialQueue((label) => {
    face.current = { label, t: 0 }
  })

  const play = (name: string, once = false, fade = 0.35): void => {
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
      // Scena (Stage) află că gestul s-a terminat — de ex. revine din poziția
      // de dans înapoi în colțul lui Adrian.
      window.dispatchEvent(new Event('kelion-gesture-done'))
    }
    mixer.addEventListener('finished', onFinished)
    // CANALUL DE COMANDĂ: orice parte a aplicației (în viitor: creierul, prin
    // punte) poate cere un gest pe nume — rulează o dată, apoi revine singur.
    const onGesture = (e: Event): void => {
      const name = String((e as CustomEvent).detail ?? '')
      if (actions[name] || lazyClips.current[name]) {
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

  // CATALOGUL COMPLET, în fundal: la câteva secunde după primul paint, restul
  // bibliotecii se descarcă secvențial (un clip odată — nu concurează cu
  // pornirea aplicației și nici cu vocea/chatul); un clip picat nu blochează
  // restul. Numele devine cel comandabil ([GEST nume]).
  useEffect(() => {
    let disposed = false
    const loader = new GLTFLoader()
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
    const t = state3.clock.elapsedTime
    const level = getVoiceLevel()

    // ── Regia: alege mișcarea după ce face Kelion acum ──
    // ȚINUTĂ DE DOMN (Adrian, 11 iul: „astea sunt gesturi de gym, nu e bine"):
    // în repaus NU se mai rulează automat nicio variație — doar respirația
    // demnă din clipul de bază. Orice alt gest vine EXCLUSIV la comandă
    // ([GEST nume] de la creier), legat de context/sentiment, cu măsură.
    if (level > 0.05) talkHold.current = t + 0.7
    const talking = t < talkHold.current
    if (state.current !== 'gesture') {
      if (talking && state.current !== 'talking') {
        state.current = 'talking'
        play('talk')
      } else if (!talking && state.current === 'talking') {
        state.current = 'idle'
        play('idle')
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

    // Micro-expresia facială: anvelopă intrare → ținere → ieșire, apoi gata.
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
      // Curăță întâi urmele expresiei anterioare (o expresie întreruptă de
      // alta nu are voie să rămână pe față), apoi aplică expresia curentă.
      for (const k of FACE_KEYS) {
        const idx = d[k] ?? d[MORPH_ALT[k] ?? '']
        if (idx !== undefined) inf[idx] = 0
      }
      // Vocea are întotdeauna prioritate la gură; expresia doar completează.
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

useGLTF.preload('/kelion-rpm.glb')
for (const f of Object.values(CLIP_FILES)) useGLTF.preload(f)
