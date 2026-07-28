import { useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { LoopOnce, LoopRepeat, LoadingManager } from 'three'
import { GLTFLoader } from 'three-stdlib'
import type { Group, Bone, Mesh, SkinnedMesh, AnimationClip, AnimationAction } from 'three'
import { getVoiceLevel } from '../lib/audioIO'
import { useFacialQueue, type FacialLabel } from '../lib/facialQueue'
import { fetchDisabledGestures } from '../lib/gestures'

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

// TAXONOMIA GESTURILOR (Adrian, 13 iul) — repaus DOMOL permis vs „dezmorțiri"
// ample interzise în rotația automată. REPORNITĂ pe 27 iul (Adrian: „lipsește
// motorul/creierul de apelare gesturi — umane reale, decente"): regia de mai
// jos alege singură, dar NUMAI din setul domol (gentleman); expresiile ample
// și dansurile rămân DOAR la comandă explicită. Tot ce debifează Adrian în
// Admin→Gesturi e exclus de peste tot (disabledG, reîmprospătat la 30s).
const CHAT_IDLE_CALM = ['variatie', 'variatie-2', 'variatie-4', 'variatie-5', 'variatie-6', 'variatie-8']
// (interzise în rotația automată: variatie-3, variatie-7, variatie-9, variatie-10)

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

  // SEMNAL „AVATARUL S-A ÎNCĂRCAT" (Adrian, 28 iul): componenta ajunge aici DOAR
  // după ce Suspense a rezolvat `useGLTF('/kelion-rpm.glb')` — adică GLB-ul de
  // bază e încărcat și firul principal e liber. Emitem o singură dată evenimentul
  // pe care ChatPanel îl așteaptă ca să armeze microfonul EXACT în acest moment
  // (nu în timpul parsării grele a modelului). Punem și un flag pe window pentru
  // cazul în care ChatPanel se montează după noi (prinde starea, fără cursă).
  useEffect(() => {
    const w = window as unknown as { __kelionAvatarReady?: boolean }
    w.__kelionAvatarReady = true
    window.dispatchEvent(new CustomEvent('kelion:avatar-ready'))
  }, [])

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
  // MOTORUL DE GESTURI (27 iul): urmele regiei — până când ține „vorbește"
  // după ultimul vârf de voce și când vine următoarea variație de repaus.
  const talkHold = useRef(0)
  const nextVar = useRef(30)
  // SUBTILITATE (Adrian, 27 iul: „gestica mâinilor și a tuturor trebuie să fie
  // mult mai subtile"): clipul de vorbit NU înlocuiește repausul — se așază
  // PESTE el ca strat cu greutate mică (idle rămâne baza), deci doar o umbră
  // de gesticulație, nu clipul întreg în forță.
  const talkLayer = useRef<AnimationAction | null>(null)
  // Oasele brațelor/antebrațelor descoperite în scenă, pentru blocarea lor în
  // repaus în fiecare cadru (Adrian, 13 iul: oprire completă a gesturilor ample).
  const armBones = useRef<Record<string, Bone | null>>({})
  // GESTURI DEZACTIVATE (Adrian, 13 iul): ce Adrian debifează în Admin → Gesturi
  // NU se joacă deloc — nici automat, nici comandat. Reîmprospătat periodic.
  const disabledG = useRef<Set<string>>(new Set())
  const morphs = useRef<(Mesh | SkinnedMesh)[]>([])
  // Fix hydration: valoare fixă inițial, randomizez în useEffect pe client.
  const blink = useRef({ t: 0, nextAt: 4, phase: 0, duration: 0.16 })
  useEffect(() => {
    blink.current.nextAt = 2 + Math.random() * 4
  }, [])
  const mouth = useRef(0) // nivelul gurii, netezit spre nivelul vocii (ca la blink)
  // Clipurile din catalogul complet, sosite în fundal (mixer.clipAction ține
  // singur evidența acțiunilor — un clip + aceeași rădăcină = aceeași acțiune).
  const lazyClips = useRef<Record<string, AnimationClip>>({})
  // Micro-expresia facială curentă (comandată din chat prin facialQueue).
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
    // Brațele jos înainte de primul cadru — clipul preia din prima actualizare.
    // Salvăm și oasele pentru a le bloca la repaus în fiecare cadru.
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
  // Reîncărcat la 30s, ca schimbările din panou să prindă fără reload.
  useEffect(() => {
    const load = (): void => void fetchDisabledGestures().then((l) => (disabledG.current = new Set(l)))
    load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    // MOTORUL REPORNIT (27 iul, ordinul lui Adrian): repausul viu rulează din
    // prima clipă — corpul respiră subtil; brațele rămân blocate în repaus de
    // lacătul din useFrame (doar în idle), deci decența din 13 iul se păstrează.
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
    const runGesture = (name: string, allowDisabled: boolean): void => {
      if (!allowDisabled && disabledG.current.has(name)) return // debifat → nu se joacă
      if (actions[name] || lazyClips.current[name]) {
        // Stratul subtil de vorbit se stinge — gestul comandat (pe context, de
        // la creier) are prioritate și rulează la expresivitate întreagă.
        talkLayer.current?.fadeOut(0.3)
        talkLayer.current = null
        state.current = 'gesture'
        play(name, true)
      }
    }
    // Canal normal (creier/comandă): refuză gesturile debifate de Adrian.
    const onGesture = (e: Event): void => runGesture(String((e as CustomEvent).detail ?? ''), false)
    // Canal de PREVIEW (Admin → Gesturi „▶ Arată"): joacă ORICE, ca adminul să
    // vadă gestul înainte să-l bifeze.
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

  // CATALOGUL COMPLET, în fundal: la câteva secunde după primul paint, restul
  // bibliotecii se descarcă secvențial (un clip odată — nu concurează cu
  // pornirea aplicației și nici cu vocea/chatul); un clip picat nu blochează
  // restul. Numele devine cel comandabil ([GEST nume]).
  useEffect(() => {
    let disposed = false
    // MANAGER SEPARAT (nu DefaultLoadingManager): descărcarea bibliotecii din
    // fundal NU trebuie să atingă `useProgress`/AvatarLoading — altfel bara de
    // încărcare reapărea la ~2.5s după primul paint și avatarul „se încărca de
    // 2 ori" (o dată nucleul, o dată biblioteca). Cu manager propriu, indicatorul
    // apare O SINGURĂ DATĂ, pentru avatarul de bază, apoi rămâne.
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
    // Regia deterministă, pe ce face Kelion ACUM (nivelul REAL al vocii):
    //   vorbește → clipul calm de conversație în buclă (gesticulație de
    //   gentleman, clipul reținut de Adrian pe 13 iul);
    //   tace → repaus viu + o variație DOMOLĂ rară (25–45s), din setul calm;
    //   gest comandat (creier/viu grai) → prioritate absolută, nu-l atingem.
    // Tot ce e debifat în Admin→Gesturi nu se joacă nici aici (disabledG).
    if (level > 0.05) talkHold.current = t + 0.7
    const talking = t < talkHold.current
    if (state.current !== 'gesture') {
      if (talking && state.current !== 'talking' && !disabledG.current.has('talk')) {
        state.current = 'talking'
        // GENTLEMAN, NU GOLAN (Adrian, 27 iul: „dă așa din mâini... gesturi de
        // gentleman"): idle rămâne baza; vorbitul e doar o UMBRĂ de strat —
        // greutate 0.25, încetinit — brațele practic în repaus, viața se vede,
        // teatrul nu. Expresivitatea vine NUMAI de la creier, pe context
        // (play_avatar_gesture: arată spre monitor când prezintă etc.).
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

    // Brațele blocate în repaus DOAR în idle (decența din 13 iul): în vorbit
    // și în gesturi, clipurile de captură de mișcare au mâna liberă.
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
