import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  streamChat,
  type ChatMessage,
  type Coords,
  type ChatControl,
} from '../lib/chat'
import { ceas } from '../lib/ceas'
import { strings, resolveLang, uiStrings, type Lang } from '../lib/i18n'
import CameraView from './CameraView'
import { WorkClock } from './WorkClock'
import { cameraSupported, type Facing } from '../lib/camera'
import {
  cameraActivationAllowed,
  cameraImageRequested,
} from '../lib/cameraConsent'
import { defaultSpeechLang } from '../lib/languages'
import { loadLocalLang, loadServerPrefs, mirrorLang } from '../lib/prefs'
import {
  openWorkspace,
  openWorkspaceCard,
  openWorkspaceDoc,
  openWorkspaceApp,
  openWorkspaceBuild,
  openWorkspaceExecutie,
  adaugaPasExecutie,
  getStareExecutie,
  closeWorkspace,
  closeTasksByKind,
  closeAllTasks,
  switchToKind,
  getWorkspace,
  subscribeWorkspace,
  isMonitorWorking,
  getMonitorContent,
  getStareTranzactii,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  playVoice,
  stopVoice,
  isVoicePlaying,
  getVoiceVolume,
  setVoiceVolume,
} from '../lib/audioIO'
import {
  registerLiveFocus,
  unregisterLiveFocus,
  requestTtsFocus,
  releaseTtsFocus,
  interruptAll,
  setForeignVoiceLock,
} from '../lib/audioFocus'
import { watchdogEnter, watchdogBeat, watchdogExit } from '../lib/watchdog'
import {
  setRealLatency,
  getRealLatency,
  subscribeRealLatency,
} from '../lib/latency'
import { keepScreenOn } from '../lib/wakelock'
// O singură cale vocală cloud: protocolul Kelion peste backend-ul OpenAI Realtime.
import {
  deschideVocalLive,
  vocalLiveDisponibila,
  type VocalLiveHandle,
  type VocalLiveState,
} from '../lib/vocalLive'
import MicBargraf, { type NivelIntrare } from './MicBargraf'
import {
  deschideCanalVoce,
  idTabVoce,
  judecaMesajVoce,
  inimaAMurit,
  emiteTakeover,
  INIMA_BATE_MS,
  type MesajVoce,
} from '../lib/voceUnica'
import { pornesteDansPeMuzica } from '../lib/dansMuzica'
import {
  contextAmbientalCurent,
  opresteAuzulAmbiental,
  pornesteAuzulAmbiental,
} from '../lib/auzAmbiental'
import { pushFacial } from '../lib/facialQueue'
import { isCarMode, setCarMode, subscribeCarMode } from '../lib/carMode'
import { useConectat } from '../lib/conexiune'
import {
  streamLocalRaspuns,
  elibereazaCreierLocal,
  pregatesteModelOffline,
  stareCreierLocal,
  sincronizeazaStareOffline,
} from '../lib/creierLocal'
import { contextPentruCreier } from '../lib/contextOffline'
import { opresteVoceLocal, voceLocalaVorbeste, vorbesteLocal } from '../lib/voceBrowser'
import { offlineKitComponentReady, refreshOfflineKit } from '../lib/kitOffline'
import {
  pregatesteUrecheaOffline,
  oprestePregatireaUrechiiOffline,
  urecheaOfflineGata,
  transcrieOffline,
  wavBase64LaFloat32,
} from '../lib/urecheaOffline'
import type { MicStreamHandle } from '../lib/micStream'
import {
  adaugaTureSync,
  adaugaIstoricLocal,
  citesteIstoricLocal,
  citesteAmanate,
  citesteTureRespinse,
  stergeAmanata,
  finalizeazaAmanataAmbigua,
  marcheazaAmanataNotificata,
  salveazaTureLocale,
  cerereNetAreEfect,
  necesitaNet,
  anuntAmanat,
} from '../lib/coadaOffline'
import { drainOfflineSync, offlineSyncScopeAuthenticated } from '../lib/offlineSync'
import { retryChatEsteNesigur } from '../lib/chatReplayPolicy'
import { anuntaPeTelefon } from '../lib/notificari'
import JarvisOrb from './JarvisOrb'
import { activeClientScope, scopedClientKey } from '../lib/clientState'
import { GESTURE_TO_CLIP } from '../../../backend/src/shared/gestures'
import { documentUploadMaxBytes } from '../../../backend/src/shared/documentUploadPolicy'
import { apiFetch } from '../lib/transport'
import { postTradingMessage } from '../lib/tradingBridge'

// have time settings or limits") — the scenario ends when it runs out of
// steps or when he says stop, not when an arbitrary timer expires.

// Camera + monitor-tab commands ("închide harta", "camera spate", "switch to
// the video") are interpreted on the SERVER now (backend services/commands.ts,

// answers them with a {device} control frame that handleControl executes; the
// ✕ on the monitor stays as the universal manual fallback.
// Admin typed control for the promo recorder. START arms the Rec button (the
// browser REQUIRES one real click to pick the screen); STOP ends the take.
// Kelion confirms both in chat.
// NB: no \b before "î" — JS word boundaries are ASCII-only, so \bî never
// matches and the spoken "înregistrează" would sail through to the brain.
const REC_STOP =
  /\b(opre[șs]te|opreste|stop|termin[ăa]|gata)\b.{0,12}([îi]nregistr|record|rec\b)/i
const REC_START =
  /([îi]nregistreaz[ăa]|porne[șs]te\s+[îi]nregistrarea|start\s+record\w*|record\s+(the\s+)?screen|filmeaz[ăa])/i
// During a promo TAKE only these typed words cut it (narrow on purpose).
const TAKE_STOP = /\b(stop|stai|opre[șs]te|opreste|t[ăa]iem|taie)\b/i
// "Reluăm" — redo the SAME approved take without re-asking for the script.
const RETAKE =
  /(relu[ăa]m\b|retake|reia (dubla|clipul|[îi]nregistrarea)|înc[ăa] o dubl[ăa]|inca o dubla|din nou (dubla|clipul))/i
// LOCATION intent in the typed message — only then is the real GPS read

// a French/German/Spanish user asking for weather or a route NEVER got a
// position read): weather, maps, position, routes.
const LOC_INTENT =
  /\b(vreme(a|me)?|meteo|prognoz\w*|weather|forecast|tiempo|clima|pron[óo]stico|m[ée]t[ée]o|pr[ée]visions|wetter(bericht)?|vorhersage|previsioni|tempo|previs[ãa]o|unde (sunt|m[ăa] aflu)|where am i|d[óo]nde estoy|o[ùu] suis[- ]je|wo bin ich|dove (sono|mi trovo)|onde estou|l[âa]ng[ăa] mine|near me|cerca de m[íi]|pr[èe]s de moi|in meiner n[äa]he|vicino a me|perto de mim|aproape de mine|[îi]n zon[ăa]|hart[ăa]|h[ăa]r[țt]i|maps?|mapas?|carte|plan\b|karte|mappa|traseu|rut[ăa]|ruta|rotas?|route|itin[ée]raire|percorso|drum(ul)? (spre|p[âa]n[ăa])|direc[țt]ii|directions|direcciones|wegbeschreibung|indicazioni|dire[çc][õo]es|navig\w*|loca[țt]ia (mea|curent[ăa])|locul meu|pozi[țt]ia mea|coordonate(le)? mele|mi ubicaci[óo]n|ma position|mein standort|la mia posizione|minha localiza[çc][ãa]o|gps)\b/i

type ChatAttachment = {
  id: string
  url: string
  name: string
  text?: string
  type?: string
}

interface RetryChatMedia {
  attachments: ChatAttachment[]
  audio?: string
  image?: string
}

interface RetryChatTurn {
  text: string
  spoken: boolean
  id: string
  media: RetryChatMedia
}

async function istoricOfflineLocal(): Promise<ChatMessage[]> {
  if (!activeClientScope()) return []
  const history = await citesteIstoricLocal()
  return history.slice(-100).map((turn) => ({
    role: turn.rol,
    content: turn.text,
    ts: turn.t,
  }))
}

function combinaIstoricLocal(current: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  if (local.length === 0) return current
  const existing = new Set(current.map((message) => `${message.role}\0${message.ts ?? 0}\0${message.content}`))
  const missing = local.filter((message) => !existing.has(`${message.role}\0${message.ts ?? 0}\0${message.content}`))
  return [...current, ...missing].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)).slice(-120)
}

export default function ChatPanel({
  lang,
  isAdmin,
  forceOffline,
}: {
  readonly lang: Lang
  readonly isAdmin: boolean
  readonly forceOffline: boolean
}) {
  const t = strings(lang)
  // Fix hydration: start with the deterministic UI lang, then resolve the browser locale on the client.
  const [speechLang, setSpeechLang] = useState<string>(lang)
  useEffect(() => {
    setSpeechLang(defaultSpeechLang(lang))
  }, [lang])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [localContextLoaded, setLocalContextLoaded] = useState(false)

  // on the page, without mumbling the last sentence"). The "permanent

  // open — and it defeated the newer mechanism below (restore ONLY on
  // release refresh). It was removed: memory stays ACTIVE on the server
  // (the brain gets the history every turn, the voice too), only the screen
  // starts clean. The full history stays in Admin → Istoric chat.
  const [chatImage, setChatImage] = useState<string | null>(null)

  // countdown applies a hard reset by itself — what you were typing must NOT
  // die with it. The draft lives in localStorage with the other UI preferences
  // and comes back into the composer on boot; an emptied composer
  // clears it.
  const [input, setInput] = useState(() => {
    try {
      const key = scopedClientKey('kelion.draft')
      return key ? (localStorage.getItem(key) ?? '') : ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      const key = scopedClientKey('kelion.draft')
      if (!key) return
      if (input) localStorage.setItem(key, input)
      else localStorage.removeItem(key)
    } catch {
      /* storage unavailable — the draft just doesn't survive */
    }
  }, [input])

  // de semnal să se reconecteze automat, să-și trimită tot pe server… iar cererile
  // neonorate să le rezolve și să anunțe civilizat"), (1) trimitem pe server tot ce
  // s-a întâmplat offline (SYNC), (2) rezolvăm cererile AMÂNATE și le anunțăm pe
  // monitor. Netezim trecerea: contextul chatului e deja împărtășit (messages).
  const online = useConectat() && !forceOffline
  const onlineRef = useRef(online)
  onlineRef.current = online
  const connectionGenerationRef = useRef(0)
  const revenireInFlightRef = useRef<Promise<void> | null>(null)
  const healthPollRef = useRef<number | null>(null)
  useEffect(() => {
    if (online) return
    if (healthPollRef.current !== null) {
      window.clearInterval(healthPollRef.current)
      healthPollRef.current = null
    }
  }, [online])
  useEffect(() => () => {
    if (healthPollRef.current !== null) window.clearInterval(healthPollRef.current)
    healthPollRef.current = null
  }, [])
  useEffect(() => {
    if (online) {
      setLocalContextLoaded(false)
      return
    }
    let active = true
    void istoricOfflineLocal().then((local) => {
      if (!active) return
      setLocalContextLoaded(local.length > 0)
      if (local.length > 0) setMessages((current) => combinaIstoricLocal(current, local))
    })
    return () => { active = false }
  }, [online])
  // ÎNCĂRCARE LA OFFLINE: cât ești ONLINE nu ținem modelul în GPU (economie de
  // baterie/GPU); când treci OFFLINE și modelul e în cache ('descarcat'), îl încărcăm
  // DIN CACHE (fără rețea) → 'gata', ca să răspundă când pierzi semnalul. Fără date.
  useEffect(() => {
    if (online) return
    let viu = true
    void refreshOfflineKit().then((snapshot) => sincronizeazaStareOffline(snapshot.components.brain)).then(() => {
      if (viu && stareCreierLocal().stare === 'descarcat')
        void pregatesteModelOffline()
    })
    return () => {
      viu = false
    }
  }, [online])

  useEffect(() => {
    if (!online || revenireInFlightRef.current) return
    const running = (async () => {
      const sync = await drainOfflineSync()
      if (!sync.complete) return
      const bucati: string[] = []
      if (sync.quarantined > 0) {
        const respinse = (await citesteTureRespinse()).slice(-sync.quarantined)
        for (const tura of respinse) {
          const fragment = tura.text.trim().slice(0, 160)
          bucati.push(lang === 'ro'
            ? `Mesajul offline „${fragment}” nu a fost acceptat la sincronizare (${tura.code}). A rămas în istoricul local.`
            : `The offline message “${fragment}” was not accepted during sync (${tura.code}). It remains in local history.`)
        }
      }
      const actiuniNotificate: string[] = []
      for (const c of await citesteAmanate()) {
        if (cerereNetAreEfect(c.intrebare)) {
          if (c.notifiedAt) continue
          bucati.push(
            lang === 'ro'
              ? `Acțiunea „${c.intrebare}” nu a fost executată automat. Confirm-o din nou în chat dacă încă o dorești.`
              : `The action “${c.intrebare}” was not executed automatically. Confirm it again in chat if you still want it.`,
          )
          actiuniNotificate.push(c.id)
          continue
        }
        try {
          let raspuns = ''
          const ac = new AbortController()
          // onControl = no-op → aruncă cadrele de audio/suprafață; luăm DOAR textul.
          for await (const buc of streamChat(
            [{ role: 'user', content: c.intrebare, ts: c.t }],
            undefined,
            undefined,
            () => {},
            undefined,
            ac.signal,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            c.id,
          )) {
            raspuns += buc
          }
          if (raspuns.trim())
            bucati.push(anuntAmanat(c.intrebare, raspuns, lang))
          await stergeAmanata(c.id)
        } catch (error) {
          const code = error instanceof Error ? error.message : 'error'
          if (await finalizeazaAmanataAmbigua(c.id, code)) {
            bucati.push(`${c.intrebare}\n\n⚠️ ${strings(lang).turnIndeterminate}`)
          }
          // Pre-execution failures stay queued under the same durable UUID.
        }
      }
      if (bucati.length) {
        openWorkspaceDoc(
          strings(lang).raspunsAmanat,
          bucati.join('\n\n───\n\n'),
        )
        // FAZA 4 — anunț pe telefon (best-effort; Android complet, iOS limitat), ca
        // omul să știe că i-am rezolvat cererea amânată chiar dacă app-ul e în fundal.
        void anuntaPeTelefon(strings(lang).raspunsAmanat, bucati[0])
        // Marcăm numai după publicarea vizibilă. Remount-urile nu repetă
        // avertismentul, iar acțiunea rămâne neexecutată până la o nouă confirmare.
        await Promise.all(actiuniNotificate.map((id) => marcheazaAmanataNotificata(id)))
      }
    })().finally(() => {
      if (revenireInFlightRef.current === running)
        revenireInFlightRef.current = null
    })
    revenireInFlightRef.current = running
    void running
  }, [online, lang])
  const [busy, setBusy] = useState(false)

  // foarte scurtă a ce transmit eu — triplat timpul de afișat pe interfață").
  // Banda 👤 cu textul meu dispărea în clipa în care sosea primul cuvânt al lui
  // Kelion (o sclipire sub o secundă cu creierul rapid). Acum textul meu rămâne
  // vizibil cel puțin USER_ECHO_HOLD_MS (~3× cât stătea), ca să pot să-l citesc.
  const [userEchoHold, setUserEchoHold] = useState(false)
  const userEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Microphone (input) — capture → server (STT) → brain. It is NOT "voice in front".
  const [listening, setListening] = useState(false)
  const [livePhase, setLivePhase] = useState<
    VocalLiveState | 'idle' | 'reconnecting'
  >('idle')
  const [liveEndpointVoice, setLiveEndpointVoice] = useState('')
  // Se schimbă când calea online/offline publică un NOU flux deja deschis;
  // analizoarele locale se recablează fără un al doilea getUserMedia.
  const [fluxMicVersiune, setFluxMicVersiune] = useState(0)

  const [voiceVol, setVoiceVolState] = useState(() => getVoiceVolume())
  // LIVE DICTATION: the current sentence, word by word, with a cinematic effect on

  const [liveVoice, setLiveVoice] = useState('')

  // to the brain on the current turn — it comes from the SERVER ({heard}), not a local echo.
  const [heard, setHeard] = useState('')

  // baleind mesajul la infinit" — orice re-montare a benzii repornea animația
  // one-shot, deci același text mătura ecranul iar și iar.) Ținem minte ts-ul
  // răspunsului deja baleiat: o trecere pe răspuns, apoi banda tace.
  const [tickerDoneTs, setTickerDoneTs] = useState<number | null>(null)

  // bubble — auto-scroll on every new message and on every streaming update.
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // screen"). The K band (the reply ticker) used to stay on screen FOREVER
  // after the reply. It still shows the flow live, but 12s after the turn ends
  // it lies down — the page breathes. Any new activity wakes it.
  const [idleBandHidden, setIdleBandHidden] = useState(false)
  // The sleep timer for the K band: runs only when a turn just ENDED (not busy,
  // last word is the assistant's). New work resets it and wakes the band.
  useEffect(() => {
    const last = messages.at(-1)
    if (busy || !last || last.role !== 'assistant') {
      setIdleBandHidden(false)
      return
    }
    const id = window.setTimeout(() => setIdleBandHidden(true), 12_000)
    return () => window.clearTimeout(id)
  }, [busy, messages])

  // afișează o analiză, că acoperă ce scrie"; alegerea lui: avatar în colț, mic).
  // Chatul (z-index 30) stă peste avatarul central; la un răspuns LUNG (o
  // analiză) se calcă. Semnalăm Stage-ul, care trece avatarul în colț (pip) doar
  // atât timp cât analiza e pe ecran; la un răspuns scurt / gol, revine central.
  useEffect(() => {
    const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
    const activ = (lastAssistant?.content?.trim().length ?? 0) > 320
    window.dispatchEvent(
      new CustomEvent('kelion:analiza-vizibila', { detail: { activ } }),
    )
  }, [messages])

  const tickerDur = (s: string): string =>
    `${Math.min(22, Math.max(3.5, s.length / 14))}s`

  const synthesize = (s: string, maxWords = 8): string => {
    const words = s.trim().split(/\s+/).filter(Boolean)
    return words.length <= maxWords
      ? s.trim()
      : `${words.slice(0, maxWords).join(' ')}…`
  }

  const voiceDownAckedRef = useRef(false)

  const voiceTurnRef = useRef<{ userTs: number; asstTs: number } | null>(null)

  const [queued, setQueued] = useState<string[]>([])

  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)

  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const composerInputRef = useRef<HTMLTextAreaElement>(null)

  const tastareActivaRef = useRef(false)
  const tastareDebounceRef = useRef<number | null>(null)

  useEffect(() => {
    const el = composerInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [input])

  const inputViuRef = useRef('')
  useEffect(() => {
    inputViuRef.current = input
  }, [input])
  useEffect(() => {
    const matura = (): void => {
      const el = composerInputRef.current
      if (el && el.value && !inputViuRef.current) el.value = ''
    }
    matura()
    const t1 = window.setTimeout(matura, 400)
    const t2 = window.setTimeout(matura, 2000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  // Admin promo-scenario recorder: type steps, hit Record, Kelion runs them while
  // the screen + voice are recorded, then it saves an MP4 to Downloads.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioRunning, setScenarioRunning] = useState(false)
  const scenarioRunningRef = useRef(false)
  scenarioRunningRef.current = scenarioRunning
  const scenarioRecRef = useRef<RecordingHandle | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => Promise<string | null>) | null>(null)

  const aSunatTuraRef = useRef(false)

  const turaAvutSemneRef = useRef(false)

  const vlRef = useRef<VocalLiveHandle | null>(null)

  const vlGeneratieRef = useRef(0)

  const micNivelRef = useRef<NivelIntrare>({
    nivel: 0,
    pic: 0,
    poarta: false,
    clip: false,
  })

  const [preampNivel, setPreampNivel] = useState<number>(() => {
    const v = Number(localStorage.getItem('kelion_preamp'))
    return Number.isFinite(v) && v > 0 ? Math.min(12, Math.max(0.5, v)) : 1
  })
  const busyRef = useRef(busy)
  busyRef.current = busy

  const abortRef = useRef<AbortController | null>(null)
  const localTurnRef = useRef<{
    controller: AbortController
    done: Promise<void>
    finish: () => void
  } | null>(null)

  const pendingAudioRef = useRef<string | null>(null)

  const inFlightRef = useRef(false)

  const pendingSendsRef = useRef<string[]>([])
  // Approved promo script + shot list waiting for the recording to start, and
  // the scheduled scene timers (cleared when the recording stops).
  const promoRef = useRef<{
    subject: string
    duration: number
    script: string
    lang?: string | null
    scenes?: { at: number; title: string; url?: string; close?: boolean }[]
  } | null>(null)
  const promoTimersRef = useRef<number[]>([])

  const takeActiveRef = useRef(false)
  const lastPromoRef = useRef<typeof promoRef.current>(null)

  const offlineRef = useRef(false)
  const retryTurnRef = useRef<RetryChatTurn | null>(null)

  const retryEroareTsRef = useRef<number | null>(null)
  const retryUserTsRef = useRef<number | null>(null)

  const transientRetryRef = useRef(false)
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang

  function handleControl(c: ChatControl): void {
    if (c.receipt) return

    if (c.heard === undefined && c.lang === undefined && c.ping === undefined)
      turaAvutSemneRef.current = true

    if (c.gest) {
      window.dispatchEvent(
        new CustomEvent('kelion-gesture', { detail: c.gest }),
      )
      return
    }

    if (c.gesture) {
      if (GESTURE_TO_CLIP[c.gesture]) {
        window.dispatchEvent(
          new CustomEvent('kelion-gesture', {
            detail: GESTURE_TO_CLIP[c.gesture],
          }),
        )
      } else {
        console.error(
          'gest necunoscut de la server (lipsește din GESTURE_TO_CLIP):',
          c.gesture,
        )
      }
      return
    }

    if (c.nav?.view) {
      window.dispatchEvent(
        new CustomEvent('kelion:navigate', { detail: c.nav }),
      )
      return
    }

    if (c.scenariu?.cale === 'openai' && c.scenariu.videoPrompt) {
      try {
        const key = scopedClientKey('kelion_scenariu')
        if (key)
          localStorage.setItem(
            key,
            JSON.stringify({ ...c.scenariu, la: Date.now() }),
          )
      } catch {
        /* stocarea plină nu rupe chatul */
      }
      window.dispatchEvent(
        new CustomEvent('kelion:scenariu', { detail: c.scenariu }),
      )
      return
    }

    if (c.apel) {
      window.dispatchEvent(
        new CustomEvent('kelion:apel-stare', { detail: c.apel }),
      )
      return
    }

    if (c.ignored) {
      const vt = voiceTurnRef.current
      voiceTurnRef.current = null
      stopVoice()
      if (vt)
        setMessages((prev) =>
          prev
            .filter((m) => m.ts !== vt.asstTs)
            .flatMap((m) => {
              if (m.ts !== vt.userTs) return [m]

              const confirmata = m.content.trim() && !m.content.startsWith('🎙')
              return confirmata ? [m] : []
            }),
        )
      return
    }

    if (c.heard !== undefined) {
      setHeard(c.heard)
      // VOCE: creierul a confirmat ce a auzit → umplem bula-substituent a userului
      // cu transcriptul PRECIS (din voce, nu dintr-un STT stâlcit).
      const vt = voiceTurnRef.current
      if (vt && c.heard) {
        const auzit = c.heard
        setMessages((prev) =>
          prev.map((m) => (m.ts === vt.userTs ? { ...m, content: auzit } : m)),
        )
      }
      return
    }

    if (c.audio) {
      const _focusOk = requestTtsFocus({ turaScrisa: true })
      // eslint-disable-next-line no-console
      console.log(`[audio] requestTtsFocus(turaScrisa): ${_focusOk}`)
      if (!_focusOk) return
      aSunatTuraRef.current = true
      playVoice(
        c.audio,
        // Cât redă audio-ul turei scrise, urechea Realtime tace (anti-ecou).
        () => {
          vlRef.current?.setRedareExterna(true)
        },
        () => {
          vlRef.current?.setRedareExterna(false)
          releaseTtsFocus()
        },
      )
      return
    }
    // A SERVER-interpreted device command (the camera/monitor regexes moved off
    // the browser): just execute it. Any spoken ack arrives as normal text.
    if (c.device) {
      const cam = c.device.camera
      if (cam === 'off') setCameraOn(false)
      else if (cam === 'back') requestCamera('environment')
      else if (cam === 'front') requestCamera('user')
      else if (cam === 'switch') {
        if (cameraOnRef.current) switchCamera()
        else requestCamera('environment')
      } else if (cam === 'on') requestCamera()
      const scr = c.device.screen
      if (scr?.op === 'closeAll') closeAllTasks()
      else if (scr?.op === 'close') closeWorkspace()
      else if (scr?.op === 'closeKind' && scr.kind) closeTasksByKind(scr.kind)
      else if (scr?.op === 'switchKind' && scr.kind) switchToKind(scr.kind)
      return
    }
    // The server committed a speech-language switch (detected + persisted
    // there): apply it to the recognizer and mirror it locally.
    if (c.lang) {
      applyLang(c.lang)
      return
    }
    if (c.paywall) {
      window.dispatchEvent(new Event('kelion:paywall'))
      return
    }

    if (c.promo?.script) armPromo(c.promo)
    if (c.image?.url) setChatImage(c.image.url)
    if (c.doc && c.doc.text.trim()) {
      openWorkspaceDoc(c.doc.title || t.monitorTitle, c.doc.text)
      return
    }

    if (c.app && c.app.html.trim()) {
      openWorkspaceApp(c.app.title || t.monitorTitle, c.app.html)
      return
    }

    if (c.executie) {
      const inainte = getStareExecutie()
      adaugaPasExecutie(
        c.executie.pas ?? '',
        c.executie.procent ?? 0,
        c.executie.gata === true,
      )
      if (!c.executie.gata && (inainte === null || inainte.gata))
        openWorkspaceExecutie(t.execTitle)
      return
    }
    // PANOUL CONSTRUCTORULUI (Etapa 4b): Kelion a preluat un ordin de build →
    // opens the live display on the monitor (Preluat→pas→Gata/Eșuat stages).
    if (c.build?.open) {
      openWorkspaceBuild(c.build.title || 'Constructor')
      return
    }
    if (c.card && c.card.items.length > 0) {
      openWorkspaceCard(c.card.title, c.card)
      return
    }
    if (c.golesteMonitor) {
      closeAllTasks()
      setChatImage(null)
      return
    }
    if (c.clickMonitor) {
      const { x, y } = c.clickMonitor
      const el = document.elementFromPoint(x, y)
      if (el) {
        ;(el as HTMLElement).click()
        el.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        )
        el.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        )
        el.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        )
      }
      return
    }
    if (c.zoomMonitor) {
      const { level, direction } = c.zoomMonitor
      const scale = direction === 'out' ? 1 / (level || 1.2) : level || 1.2
      const cadru =
        document.querySelector<HTMLIFrameElement>('iframe.workspace-frame') ||
        document.body
      if (cadru) {
        const currentStyle = cadru.style.transform || 'scale(1)'
        const match = currentStyle.match(/scale\(([^)]+)\)/)
        let currentScale = 1
        if (match) {
          currentScale = parseFloat(match[1])
        }
        const newScale = currentScale * scale
        cadru.style.transform = `scale(${newScale})`
        cadru.style.transformOrigin = 'top left'
      }
      return
    }

    if (c.niveluri) {
      postTradingMessage(
        { kelion: 'niveluri', date: c.niveluri },
        window.location.origin,
      )
    }

    if (c.semne) {
      postTradingMessage(
        { kelion: 'semne', date: c.semne },
        window.location.origin,
      )
    }
    if (!c.monitor) return
    if (c.monitor.url)
      openWorkspace(c.monitor.title || t.monitorTitle, c.monitor.url)
    else closeWorkspace()
  }

  function ack(text: string): void {
    setMessages((cur) => [
      ...cur,
      { role: 'assistant', content: text, ts: Date.now() },
    ])
    suggestFacial(text)
  }

  function suggestFacial(text: string): void {
    const s = text.trim()
    if (!s) return

    if (
      /\b(mul[țt]umesc|[îi][țt]i mul[țt]umesc|thank you|apreciez|bravo|felicit)\b/i.test(
        s,
      )
    )
      return pushFacial('warmth')
    // Genuine regret/empathy → a soft expression.
    if (
      /\b([îi]mi pare r[ăa]u|regret|condolean|din p[ăa]cate|sympath|my condolences)\b/i.test(
        s,
      )
    )
      return pushFacial('empathy')
    // Otherwise: NO expression — a composed, neutral, dignified face. (Body gestures
    // and broader expressions come ONLY on the brain's command via [GEST], rarely.)
  }

  // The conversation SURVIVES a RELEASE refresh — and ONLY that. The release
  // auto-reload (and the update bar) set a one-shot sessionStorage flag right
  // before reloading; when we mount WITH the flag we restore the saved history
  // so mid-conversation releases stay seamless. Any other arrival — login, new
  // tab, manual refresh — starts with a CLEAN page: Kelion still remembers
  // everything server-side, but old messages never litter a fresh session.
  useEffect(() => {
    if (!online) return
    if (sessionStorage.getItem('kelion_restore_chat') !== '1') return
    sessionStorage.removeItem('kelion_restore_chat')
    void apiFetch('/api/chat/history', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((j: { history?: { role?: string; content?: string }[] }) => {
        const h = (j.history ?? [])
          .filter(
            (m): m is { role: 'user' | 'assistant'; content: string } =>
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string' &&
              m.content.trim() !== '',
          )
          // Cadrele brute de transport nu sunt mesaje de conversație.
          .filter((m) => !/^(id:\s*\d+|data:)\s/m.test(m.content))
          .map((m) => ({ role: m.role, content: m.content }))
          // Collapse repeated error echoes (the same technical-problem line
          // stacked 3× while the chat was down) — one is enough.
          .filter((m, i, a) => i === 0 || m.content !== a[i - 1].content)
        if (h.length > 0) setMessages((cur) => (cur.length === 0 ? h : cur))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Arm the recorder for an approved promo take (also used by "reluăm" to redo
  // the same take): remember the script + scenes and light up the Rec button
  // with a suggestive clip name.
  function armPromo(p: NonNullable<typeof promoRef.current>): void {
    promoRef.current = p
    const slug = p.subject
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    window.dispatchEvent(
      new CustomEvent('kelion:rec', {
        detail: {
          action: 'arm',
          name: `kelionai-${slug || 'promo'}-${p.duration}s-${date}`,
        },
      }),
    )
  }

  useEffect(() => {
    const onStarted = (): void => {
      const p = promoRef.current
      if (!p) return
      promoRef.current = null
      lastPromoRef.current = p
      takeActiveRef.current = true
      closeAllTasks()

      void (async () => {
        let cap: number | null = null
        try {
          const s = await apiFetch('/api/tts/status', { cache: 'no-store' })
          if (s.ok) {
            const j = (await s.json()) as {
              available?: boolean
              engine?: 'openai' | 'local' | null
              maxChars?: number
            }
            if (
              j.available === true &&
              (j.engine === 'openai' || j.engine === 'local') &&
              typeof j.maxChars === 'number' &&
              Number.isSafeInteger(j.maxChars) &&
              j.maxChars > 0
            ) {
              cap = j.maxChars
            }
          }
        } catch {
          /* status indisponibil */
        }
        if (cap === null) {
          ack(t.promoVoiceLost)
          return
        }
        const chunks: string[] = []
        let cur = ''
        for (const sentence of p.script.split(/(?<=[.!?…])\s+/)) {
          if (cur && cur.length + sentence.length + 1 > cap) {
            chunks.push(cur)
            cur = sentence
          } else {
            cur = cur ? `${cur} ${sentence}` : sentence
          }
        }
        if (cur) chunks.push(cur)
        // A single monster sentence longer than the cap would have been sent
        // whole and truncated server-side mid-word — hard-split it instead.
        const bounded = chunks.flatMap((c) => {
          const parts: string[] = []
          for (let i = 0; i < c.length; i += cap)
            parts.push(c.slice(i, i + cap))
          return parts
        })
        let lost = 0
        for (const chunk of bounded) {
          let spoken = false
          for (let attempt = 0; attempt < 2 && !spoken; attempt++) {
            try {
              const r = await apiFetch('/api/tts', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // The language is the SCRIPT's; without one, the CURRENT speech
                // language — never a hardcoded locale (the old 'ro-RO' fallback
                // narrated an English script with the Romanian voice).
                body: JSON.stringify({
                  text: chunk,
                  lang: p.lang ?? speechLangRef.current,
                }),
              })
              if (!r.ok) continue
              const buf = await r.arrayBuffer()
              let bin = ''
              const bytes = new Uint8Array(buf)
              for (let i = 0; i < bytes.length; i += 0x8000)
                bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
              playVoice(btoa(bin))
              spoken = true
            } catch {
              /* retried once above; counted honestly below */
            }
          }
          if (!spoken) lost++
        }

        if (lost > 0) ack(t.promoVoiceLost)
      })()
      for (const s of p.scenes ?? []) {
        promoTimersRef.current.push(
          window.setTimeout(
            () => {
              if (s.close || !s.url) closeAllTasks()
              else openWorkspace(s.title, s.url)
            },
            900 + s.at * 1000,
          ),
        )
      }
    }
    // Recording stopped (typed cut, Chrome's stop bar, or natural end): kill the
    // pending scenes, clear the stage, and offer the retake.
    const onStopped = (): void => {
      const wasTake = takeActiveRef.current
      takeActiveRef.current = false
      for (const id of promoTimersRef.current) window.clearTimeout(id)
      promoTimersRef.current = []
      if (wasTake) {
        closeAllTasks()
        window.setTimeout(() => ack(t.promoTakeSaved), 600)
      }
    }
    window.addEventListener('kelion:rec-started', onStarted)
    window.addEventListener('kelion:rec-stopped', onStopped)
    return () => {
      window.removeEventListener('kelion:rec-started', onStarted)
      window.removeEventListener('kelion:rec-stopped', onStopped)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── File attachment (ChatGPT-style) ──
  function openFilePicker(): void {
    setMenuOpen(false)
    fileInputRef.current?.click()
  }
  function addImageFiles(files: File[]): void {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () =>
        setAttachments((cur) => [
          ...cur,
          {
            id: `${Date.now()}-${file.name || 'pasted'}-${cur.length}`,
            url: String(reader.result),
            name: file.name || 'pasted-image.png',
          },
        ])
      reader.readAsDataURL(file)
    }
  }

  async function addDocFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (file.type.startsWith('image/')) continue
      const name = file.name || 'document'
      try {
        const maxBytes = documentUploadMaxBytes(name)
        if (maxBytes === null) {
          ack(t.docAttachFailed.replace('{name}', name))
          continue
        }
        if (file.size > maxBytes) {
          ack(t.docTooLarge.replace('{name}', name))
          continue
        }
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error('read'))
          r.readAsDataURL(file)
        })
        const separator = data.indexOf(',')
        const canonicalBase64 = separator >= 0 ? data.slice(separator + 1) : data
        let markdown = ''
        try {
          const resp = await apiFetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ filename: file.name, data: canonicalBase64 }),
          })
          if (resp.ok)
            markdown =
              ((await resp.json()) as { markdown?: string }).markdown ?? ''
        } catch {
          /* conversion unreachable — reported honestly below */
        }
        if (markdown.trim()) {
          setAttachments((cur) => [
            ...cur,
            {
              id: `${Date.now()}-${file.name}-doc`,
              url: '',
              name,
              text: markdown,
            },
          ])
        } else {
          ack(t.docAttachFailed.replace('{name}', name))
        }
      } catch {
        // The file couldn't even be read from disk — same honest line.
        ack(t.docAttachFailed.replace('{name}', name))
      }
    }
  }
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    addImageFiles(files.filter((f) => f.type.startsWith('image/')))
    void addDocFiles(files.filter((f) => !f.type.startsWith('image/')))
  }

  function onPasteFiles(e: ReactClipboardEvent): void {
    if (!online) return
    const seen = new Set<string>()
    const collected: File[] = []
    for (const f of e.clipboardData.files) {
      const key = `${f.name}:${f.size}`
      if (!seen.has(key)) {
        seen.add(key)
        collected.push(f)
      }
    }
    for (const it of e.clipboardData.items) {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) {
          const key = `${f.name}:${f.size}`
          if (!seen.has(key)) {
            seen.add(key)
            collected.push(f)
          }
        }
      }
    }
    const imgs = collected.filter((f) => f.type.startsWith('image/'))
    const docs = collected.filter((f) => !f.type.startsWith('image/'))
    if (imgs.length > 0 || docs.length > 0) {
      e.preventDefault()
      if (imgs.length > 0) addImageFiles(imgs)
      if (docs.length > 0) void addDocFiles(docs)
    }
  }
  function onDropFiles(e: ReactDragEvent): void {
    if (!online) {
      e.preventDefault()
      return
    }
    const all = [...e.dataTransfer.files]
    if (all.length > 0) {
      e.preventDefault()
      addImageFiles(all.filter((f) => f.type.startsWith('image/')))
      void addDocFiles(all.filter((f) => !f.type.startsWith('image/')))
    }
  }
  function removeAttachment(id: string): void {
    setAttachments((cur) => cur.filter((a) => a.id !== id))
  }

  // ── Admin promo-scenario recorder ──
  // Records the screen + voice and AUTO-RUNS the typed scenario (one step per
  // line) through Kelion, then saves the clip. The click is the gesture
  // getDisplayMedia needs.
  async function runScenario(): Promise<void> {
    const steps = scenarioText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (steps.length === 0 || scenarioRunningRef.current) return
    const handle = await startRecording(
      () => {
        scenarioRunningRef.current = false
        setScenarioRunning(false)
        scenarioRecRef.current = null
      },
      () => {
        scenarioRunningRef.current = false
        setScenarioRunning(false)
      },
    )
    if (!handle) return
    scenarioRecRef.current = handle
    scenarioRunningRef.current = true
    setScenarioRunning(true)
    setScenarioOpen(false)
    for (const step of steps) {
      if (!scenarioRunningRef.current) break
      await sendRef.current(step) // waits for Kelion's full reply to stream in
    }
    // Let the final sentence finish speaking, then stop + save.

    handle.stop()
  }
  function stopScenario(): void {
    scenarioRunningRef.current = false
    scenarioRecRef.current?.stop()
    scenarioRecRef.current = null
    setScenarioRunning(false)
  }

  async function send(
    text: string,
    spokenTurn = false,
    durableRequestId: string = crypto.randomUUID(),
    retryMedia?: RetryChatMedia,
  ): Promise<void> {
    const msg = text.trim()

    let atts = retryMedia?.attachments ?? attachments
    if (!online && atts.some((a) => a.url.startsWith('data:image'))) {
      ack(
        t.offlineNoVision ??
          strings('en').offlineNoVision ??
          'Offline: images cannot be analysed right now.',
      )
      atts = atts.filter((a) => !a.url.startsWith('data:image'))
      setAttachments(atts)
      if (!msg && atts.length === 0 && !pendingAudioRef.current) return
    }

    if (!msg && atts.length === 0 && !pendingAudioRef.current) return

    if (msg && isAdmin) {
      if (takeActiveRef.current && TAKE_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        setInput('')
        return
      }
      // "Reluăm" — same approved script + scenes, new take, no re-approval.
      if (RETAKE.test(msg) && lastPromoRef.current) {
        const saved = lastPromoRef.current
        const savedLang = (saved.lang || '').slice(0, 2).toLowerCase()
        const setLang = speechLangRef.current.slice(0, 2).toLowerCase()
        // Guard: a saved script in a DIFFERENT language than the one now set is
        // stale — never re-narrate it (that's how it "went Spanish"). Drop it and
        // ask for a fresh take so Kelion regenerates it in the current language.
        if (savedLang && setLang && savedLang !== setLang) {
          lastPromoRef.current = null
          ack(t.promoWrongLang.replace('{subject}', saved.subject))
          setInput('')
          return
        }
        armPromo(saved)
        ack(t.promoRetake)
        setInput('')
        return
      }
      if (REC_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        ack(t.promoRecStopped)
        setInput('')
        return
      }
      if (REC_START.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'arm' }))
        ack(t.promoRecReady)
        setInput('')
        return
      }
    }

    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (msg && STOP_CMD.test(msg)) {
      interruptAll('stop-command')
      opresteVoceLocal()
      abortRef.current?.abort()
      pendingSendsRef.current = [] // stop means stop — empty the queue
      setQueued([])
      inFlightRef.current = false
      setBusy(false)
      setLiveVoice('')
      setInput('')
      // Closes the request/loop on the server (the backend's stop handler).
      if (online)
        void apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            messages: [{ role: 'user', content: msg }],
            now: new Date().toISOString(),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        }).catch(() => {})
      ack(t.stopAck)
      return
    }

    if (busyRef.current || inFlightRef.current) {
      if (!msg && !pendingAudioRef.current && atts.length === 0) return
      interruptAll('barge-in-text')
      opresteVoceLocal()
      abortRef.current?.abort()
      // NO return — we fall through below and start the new turn right now.
    } else {
      interruptAll('tura-noua-peste-live')
    }

    inFlightRef.current = true
    setInput('')

    setHeard('')
    setAttachments([])
    // Multi-tasking: whatever is on the monitor (a map, a route, a video) STAYS
    // open while you keep chatting — it's only replaced when Kelion shows
    // something new, or closed when you (or Kelion) close it. So the map keeps
    // running in parallel with the conversation until you say to close it.
    // The user's ESTABLISHED language. Detection + the two-in-a-row commit rule
    // run on the SERVER now; a committed switch comes back as a {lang} frame.
    const replyLang = speechLangRef.current
    // Camera produce un singur instantaneu numai când textul cere explicit
    // vederea. Simplul fapt că previzualizarea este deschisă nu capturează tura.
    const attached = atts.find((a) => a.url.startsWith('data:image'))?.url
    const cameraImage =
      cameraOnRef.current && cameraImageRequested(msg)
        ? ((await captureRef.current?.()) ?? undefined)
        : undefined
    const image = retryMedia?.image ?? attached ?? cameraImage

    const docs = atts.filter((a) => a.text)
    const docBlock = docs
      .map((d) => `[Document: ${d.name}]\n${d.text}`)
      .join('\n\n')

    const retryAudio = retryMedia?.audio
    const isVoiceTurn = !!(retryAudio ?? pendingAudioRef.current) && !msg
    const base = isVoiceTurn
      ? ''
      : msg ||
        (docBlock ? t.docPrompt : attached ? t.imagePrompt : t.greetPrompt)
    const outgoing = docBlock && !isVoiceTurn ? `${docBlock}\n\n${base}` : base
    // Vocea brută a acestei ture (DOAR pe o tură vocală). Pe o tură SCRISĂ nu
    // cărăm un audio rătăcit — l-ar auzi creierul peste textul tastat.
    const nativeAudio = isVoiceTurn
      ? (retryAudio ?? pendingAudioRef.current ?? undefined)
      : undefined
    pendingAudioRef.current = null
    const userTs = Date.now()
    // Creierul primește textul GOL pe voce (aude audio-ul); `next` e payload-ul.
    const conversationBase = online
      ? messages
      : combinaIstoricLocal(messages, await istoricOfflineLocal())
    const next: ChatMessage[] = [
      ...conversationBase,
      { role: 'user', content: outgoing, ts: userTs },
    ]
    // STABLE ts for THIS turn's in-progress reply — the functional updater
    // below recognizes and replaces it, without deleting the messages
    // (e.g. voice transcripts) that arrived meanwhile.
    const turnTs = Math.max(Date.now(), userTs + 1)
    // UI: pe voce arătăm o bulă-substituent „🎙️…" până creierul confirmă ce a auzit
    // ({heard} o umple) sau decide că nu i se vorbea ({ignored} o șterge).
    const uiUser: ChatMessage = {
      role: 'user',
      content: isVoiceTurn ? '🎙️…' : outgoing,
      ts: userTs,
    }
    voiceTurnRef.current = isVoiceTurn ? { userTs, asstTs: turnTs } : null
    setMessages([
      ...conversationBase,
      uiUser,
      { role: 'assistant', content: '', ts: turnTs },
    ])
    setChatImage(null)

    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)

    const USER_ECHO_HOLD_MS = 2600
    if (userEchoTimerRef.current) clearTimeout(userEchoTimerRef.current)
    setUserEchoHold(true)
    userEchoTimerRef.current = setTimeout(
      () => setUserEchoHold(false),
      USER_ECHO_HOLD_MS,
    )
    let acc = ''
    // NOUĂ TURĂ: încă n-a rostit nimeni nimic; tăiem orice gură de siguranță rămasă.
    aSunatTuraRef.current = false
    turaAvutSemneRef.current = false
    opresteVoceLocal()
    const cleanForSpeech = (s: string): string =>
      s
        .replace(/<[a-zA-Z0-9_-]+[\s\S]*?<\/[a-zA-Z0-9_-]+>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[[a-zA-Z0-9_-]+\][\s\S]*?\[\/[a-zA-Z0-9_-]+\]/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images — nothing to say
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their label
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_`#>~]/g, '') // markdown ornaments are not words
        .replace(/\s+/g, ' ')
        .trim()
    // REAL RESPONSE TIME (measured here, in the browser — what the user feels): from
    // send → first visible word → complete reply. Shown on the counter.
    const t0 = performance.now()
    let firstAt = 0
    try {
      const wsNow = getWorkspace()
      const screen = wsNow.open
        ? wsNow.tasks.map((tk) => ({
            kind: tk.kind,
            title: tk.title,
            active: tk.id === wsNow.activeId,
          }))
        : undefined
      // GPS ONLY WHEN NEEDED: we read the REAL position right now, just once,
      // ONLY if the message really asks for the location (weather/maps/"where am I"/route).
      // Otherwise we do not ask for or retain a location.
      const locTurn = LOC_INTENT.test(msg)
      const turnCoords = locTurn ? await getFreshCoords() : null

      // chat"): watchdog-ul măsoară cauza (fir principal vs. server); re-randăm
      // la cel mult ~12/s (nu la fiecare token) și cedăm periodic firul ca browserul să respire.
      watchdogEnter('creier')
      let ultimulFlush = 0
      let ultimulYield = performance.now()
      const flushMesaje = (): void => {
        setMessages((cur) => {
          // Compară pe (rol, ts), NU pe identitatea obiectului (agentul lotului C):
          // {heard} umple bula userului IN-PLACE (obiect NOU, același ts) — pe
          // identitate, comparația pica fix pe poziția aia, „base" cădea pe next
          // și flush-ul REVERTEA transcriptul confirmat la substituentul gol
          // (C5 murea la milisecunde după ce se năștea). Când base = cur, prefixul
          // păstrat e AL LUI cur (cu editările in-place), nu al lui next.
          const aceeasi = (
            a: { role: string; ts?: number },
            b: { role: string; ts?: number },
          ): boolean => a.role === b.role && a.ts === b.ts
          const base =
            cur.length >= next.length &&
            cur.slice(0, next.length).every((m, i) => aceeasi(m, next[i]))
              ? cur
              : next
          const rest = base
            .slice(next.length)
            .filter((m) => !(m.role === 'assistant' && m.ts === turnTs))
          return [
            ...base.slice(0, next.length),
            ...rest,
            { role: 'assistant', content: acc, ts: turnTs },
          ]
        })
      }
      let transcriptConfirmat = ''
      const handleTurnControl = (control: ChatControl): void => {
        if (control.replayRestarted) {
          acc = ''
          firstAt = 0
          flushMesaje()
          return
        }
        if (typeof control.heard === 'string' && control.heard.trim()) {
          transcriptConfirmat = control.heard.trim()
        }
        if (control.ignored) transcriptConfirmat = ''
        handleControl(control)
      }
      // În modul avion, modelul browser existent păstrează funcția companion.
      // Este izolat de providerul cloud și rulează numai când asseturile sunt gata.
      const offlineNow = !online
      let utilizatorOfflineSalvat = true
      if (offlineNow && (outgoing.trim() || (msg && necesitaNet(msg)))) {
        utilizatorOfflineSalvat = Boolean(await salveazaTureLocale(
          outgoing.trim()
            ? [{ rol: 'user', text: outgoing, t: userTs }]
            : [],
          {
            sincronizeaza: true,
            amanata: msg && necesitaNet(msg) ? { intrebare: msg, t: userTs } : null,
          },
        ))
      }
      if (offlineNow && stareCreierLocal().stare !== 'gata') {
        const snapshot = await refreshOfflineKit()
        await sincronizeazaStareOffline(snapshot.components.brain)
        if (stareCreierLocal().stare === 'descarcat')
          await pregatesteModelOffline()
      }
      const eTuraOffline = offlineNow && stareCreierLocal().stare === 'gata'
      if (offlineNow && !eTuraOffline) {
        acc = `${strings(lang).offlineModelNepregatit} ${utilizatorOfflineSalvat
          ? (lang === 'ro' ? 'Mesajul a rămas în coada locală și nu a fost trimis în rețea.' : 'The message remains in the local queue and was not sent over the network.')
          : (lang === 'ro' ? 'Stocarea locală este plină sau indisponibilă; mesajul nu a putut fi salvat.' : 'Local storage is full or unavailable; the message could not be saved.')}`
        flushMesaje()
        return
      }
      const sursaFlux = eTuraOffline
        ? streamLocalRaspuns(
            next,
            lang,
            ac.signal,
            contextPentruCreier({
              lat: turnCoords?.lat,
              lon: turnCoords?.lon,
              sunetAmbiental: contextAmbientalCurent(),
            }),
          )
        : streamChat(
            next,
            image ?? undefined,
            turnCoords ?? undefined,
            handleTurnControl,
            screen,
            ac.signal,
            Boolean(attached), // explicitly pasted/uploaded picture — unconditional analysis

            spokenTurn || undefined,

            nativeAudio,

            isVoiceTurn || undefined,

            isCarMode() || undefined,

            durableRequestId,
          )
      if (eTuraOffline) {
        let settled = false
        let resolveDone: (() => void) | null = null
        const done = new Promise<void>((resolve) => { resolveDone = resolve })
        localTurnRef.current = {
          controller: ac,
          done,
          finish: () => {
            if (settled) return
            settled = true
            resolveDone?.()
          },
        }
      }
      for await (const chunk of sursaFlux) {
        if (!firstAt && chunk && chunk.trim()) firstAt = performance.now()
        acc += chunk
        watchdogBeat('creier')

        const acum = performance.now()
        if (acum - ultimulFlush >= 80) {
          ultimulFlush = acum
          flushMesaje()
        }
        if (acum - ultimulYield >= 60) {
          ultimulYield = acum
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      // FLUSH FINAL — garantează conținutul complet al răspunsului. DOAR dacă a
      // curs text: pe o tură {ignored}/goală n-are ce garanta, iar rescrierea
      // ar RESUSCITA bulele șterse de {ignored} (bula păstrată de C5 trăia doar
      // până aici — constatarea agentului lotului C).
      if (acc.trim()) flushMesaje()
      // Publishes the REAL time on the counter (only if visible text arrived).
      if (firstAt) {
        setRealLatency({
          firstMs: firstAt - t0,
          totalMs: performance.now() - t0,
          at: Date.now(),
        })
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      // Dar TĂCEREA TOTALĂ e altceva (registrul, lot C): text gol + niciun cadru
      // de control + niciun sunet = tura a murit fără nicio urmă — omul rămânea
      // cu întrebarea în aer, fără să știe dacă a fost măcar primită. Rând onest.
      if (!acc.trim()) {
        // Elimină doar tura assistant goală, fără a suprascrie actualizări concurente.
        const faraAsistentGol = (cur: typeof next): typeof next =>
          cur.filter(
            (mm) =>
              !(
                mm.role === 'assistant' &&
                mm.ts === turnTs &&
                !mm.content.trim()
              ),
          )
        if (
          !eTuraOffline &&
          !turaAvutSemneRef.current &&
          !aSunatTuraRef.current
        ) {
          setMessages((cur) => [
            ...faraAsistentGol(cur),
            {
              role: 'assistant',
              content: `⚠️ ${strings(lang).turnEmpty}`,
              ts: Date.now(),
            },
          ])
        } else setMessages((cur) => faraAsistentGol(cur))
      } else suggestFacial(acc)

      if (eTuraOffline) {
        // Mesajul userului a fost comis înainte de inferență. Răspunsul este
        // o a doua tranzacție, astfel încât un crash nu pierde întrebarea.
        const assistantSaved = !acc.trim() || Boolean(await adaugaTureSync([
          { rol: 'assistant', text: acc, t: turnTs },
        ]))
        const persisted = utilizatorOfflineSalvat && assistantSaved
        if (!persisted) {
          setMessages((current) => [...current, {
            role: 'assistant',
            content: lang === 'ro'
              ? '⚠️ Stocarea locală este plină sau indisponibilă; această tură nu este păstrată pentru sincronizare.'
              : '⚠️ Local storage is full or unavailable; this turn is not retained for sync.',
            ts: Date.now(),
          }])
        }
      } else {
        const textUtilizator = (transcriptConfirmat || outgoing).trim()
        const istoricNou = [
          ...(textUtilizator ? [{ rol: 'user' as const, text: textUtilizator, t: userTs }] : []),
          ...(acc.trim() ? [{ rol: 'assistant' as const, text: acc, t: turnTs }] : []),
        ]
        if (istoricNou.length > 0) await adaugaIstoricLocal(istoricNou)
      }

      if (
        eTuraOffline &&
        !isVoiceTurn &&
        acc.trim() &&
        !muzicaActivaRef.current
      ) {
        const deRostit = cleanForSpeech(acc)
        if (deRostit) {
          window.setTimeout(() => {
            if (
              !aSunatTuraRef.current &&
              !ac.signal.aborted &&
              !isVoicePlaying() &&
              !muzicaActivaRef.current
            ) {
              vorbesteLocal(deRostit, lang, {
                onStart: () => urecheaLocalaRef.current?.setMuted(true),
                onEnd: () => urecheaLocalaRef.current?.setMuted(false),
              })
            }
          }, 2200)
        }
      }
    } catch (err) {
      const codErr = err instanceof Error ? err.message : 'error'
      const inlocuita = abortRef.current !== ac
      if (ac.signal.aborted || codErr === 'aborted' || inlocuita) {
        // Stopped by the user or replaced by the new question — no error
        // message, no writing over what's on the screen right now.
      } else {
        if (!acc.trim()) interruptAll('chat-error')
        const code = codErr
        const spoken = strings(resolveLang(replyLang))

        if (code === 'transient' && !acc.trim() && !transientRetryRef.current) {
          transientRetryRef.current = true
          window.setTimeout(() => {
            transientRetryRef.current = false
          }, 30_000)
          console.info(
            '[CONEXIUNE] cerere ruptă cu net+server OK — reîncerc tăcut o dată',
          )
          // Voice turns stash audio in pendingAudioRef before send clears it.
          // Restore it so the silent retry is still a real voice turn (HTTP 200 path),
          // not an empty typed message that the guard drops.
          setMessages((cur) => cur.filter(
            (mm) => !(mm.role === 'user' && mm.ts === userTs)
              && !(mm.role === 'assistant' && mm.ts === turnTs),
          ))
          window.setTimeout(
            () => void sendRef.current(msg, spokenTurn, durableRequestId, {
              attachments: atts,
              audio: nativeAudio,
              image,
            }),
            400,
          )
        } else {
          const m =
            code === 'brain_not_configured'
              ? t.brainNotActive
              : code === 'offline'
                ? spoken.offline
                : code === 'server_down'
                  ? spoken.serverDown
                  : code === 'transient'
                    ? spoken.requestLost
                    : retryChatEsteNesigur(code)
                      ? t.turnIndeterminate
                    : code === 'unauthorized'
                      ? // VERDICTE ONESTE (registrul, lot C): sesiunea expirată NU e
                        // „am pierdut netul", paywall-ul NU e „eroare la creier",
                        // prea-multe-cereri NU e „cererea s-a rupt pe drum" — trei
                        // minciuni de cod HTTP, fiecare cu vorba EI acum.
                        spoken.sessionExpired
                      : code === 'paywall'
                        ? spoken.paywallRow
                        : code === 'rate_limited'
                          ? spoken.rateLimited
                          : t.brainError
          if (code === 'paywall') {
            window.dispatchEvent(new Event('kelion:paywall'))
          }
          // KEEP the text already received (don't drop it) — just add a discreet note,
          // so the text stays complete versus what was heard.
          // FUNCTIONAL updater, not a snapshot — the same lesson as in the streaming
          // loop (line ~912): a message arriving meanwhile (voice transcript,
          // a new question) must not disappear because this turn failed.
          const tsEroare = Date.now()
          setMessages((cur) => {
            const baza =
              cur.length >= next.length &&
              cur.slice(0, next.length).every((mm, i) => mm === next[i])
                ? cur
                : next
            const rest = baza
              .slice(next.length)
              .filter((mm) => !(mm.role === 'assistant' && mm.ts === turnTs))
            return [
              ...next,
              ...rest,
              {
                role: 'assistant',
                content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`,
                ts: tsEroare,
              },
            ]
          })
          if (code === 'offline') {
            offlineRef.current = true
            retryTurnRef.current = {
              text: msg,
              spoken: spokenTurn,
              id: durableRequestId,
              media: { attachments: atts, audio: nativeAudio, image },
            }
            retryEroareTsRef.current = tsEroare // ștergerea ȚINTITĂ la revenire (nu slice orb)
            retryUserTsRef.current = userTs // bula user se șterge pe TS (conținutul poate diferi — ex. turele cu documente)
          }
          if (code === 'server_down') {
            // Aceeași pereche de ts-uri și aici (agentul lotului C, marginea 2):
            // altfel secvența offline→server_down lăsa ts-ul VECHI de eroare și
            // revenirea ștergea bula de eroare veche + bula user a textului nou.
            retryEroareTsRef.current = tsEroare
            retryUserTsRef.current = userTs
            // The 'online' browser event will never fire — the net was never
            // down. We poll OUR server's health (5s, max 2 min — a deploy takes
            // ~30-60s) and resume the SAME message the moment it answers.
            retryTurnRef.current = {
              text: msg,
              spoken: spokenTurn,
              id: durableRequestId,
              media: { attachments: atts, audio: nativeAudio, image },
            }
            if (healthPollRef.current)
              window.clearInterval(healthPollRef.current)
            let incercari = 0
            healthPollRef.current = ceas(
              'sondă sănătate voce',
              () => {
                if (!onlineRef.current) {
                  if (healthPollRef.current !== null) window.clearInterval(healthPollRef.current)
                  healthPollRef.current = null
                  return
                }
                incercari++
                if (incercari > 24) {
                  window.clearInterval(healthPollRef.current!)
                  healthPollRef.current = null
                  return
                }
                void apiFetch('/api/health', {
                  cache: 'no-store',
                  signal: AbortSignal.timeout(3000),
                })
                  .then((r) => {
                    if (!r.ok) return
                    window.clearInterval(healthPollRef.current!)
                    healthPollRef.current = null
                    const retry = retryTurnRef.current
                    retryTurnRef.current = null
                    const tsEroare = retryEroareTsRef.current
                    retryEroareTsRef.current = null
                    const tsUser = retryUserTsRef.current
                    retryUserTsRef.current = null
                    console.info(
                      '[CONEXIUNE] serverul a revenit — reiau mesajul singur',
                    )
                    if (retry) {
                      setMessages((cur) => cur.filter(
                        (mm) => !(mm.role === 'assistant' && tsEroare !== null && mm.ts === tsEroare)
                          && !(mm.role === 'user' && tsUser !== null && mm.ts === tsUser),
                      ))
                      window.setTimeout(() => void sendRef.current(
                        retry.text,
                        retry.spoken,
                        retry.id,
                        retry.media,
                      ), 100)
                    }
                  })
                  .catch(() => {})
              },
              5000,
            )
          }
        }
      }
    } finally {
      if (localTurnRef.current?.controller === ac) {
        localTurnRef.current.finish()
        localTurnRef.current = null
      }
      watchdogExit('creier') // verdictul turei (fir principal vs. server) în consolă
      // BARGE-IN (full-duplex): if this turn was REPLACED by a new one,
      // `abortRef` already points at the new turn — do NOT reset its "working"
      // flags (that would clobber them). Only the STILL-current turn cleans itself up.
      const stillCurrent = abortRef.current === ac
      if (stillCurrent) {
        abortRef.current = null
        inFlightRef.current = false
        setBusy(false)
      }
      // Compat: if something is left in an old queue (it no longer fills up
      // normally — full-duplex sends directly), we send it, but only if we weren't
      // just replaced by a new turn.
      if (stillCurrent && pendingSendsRef.current.length > 0) {
        const combined = pendingSendsRef.current.join('\n')
        pendingSendsRef.current = []
        setQueued([])
        window.setTimeout(() => void sendRef.current(combined), 50)
      }
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send

  useEffect(() => {
    const onComanda = (e: Event): void => {
      const text = String((e as CustomEvent<string>).detail ?? '').trim()
      if (text) void sendRef.current(text)
    }
    window.addEventListener('kelion:comanda', onComanda)
    return () => window.removeEventListener('kelion:comanda', onComanda)
  }, [])

  const micManualOffRef = useRef(true)
  const micDoritaInainteApelRef = useRef(false)
  const apelActivRef = useRef(false)
  const micStartingRef = useRef(false)
  const micRetryRef = useRef<number | null>(null)
  const micBackoffRef = useRef(1000)

  const urecheaLocalaRef = useRef<MicStreamHandle | null>(null)

  const [urecheaLocalaGata, setUrecheaLocalaGata] = useState(false)

  useEffect(() => {
    const el = composerInputRef.current
    if (!el) return
    const aplicaPauzaTastare = (pauza: boolean): void => {
      if (tastareActivaRef.current === pauza) return
      tastareActivaRef.current = pauza
      // Mută sesiunea OpenAI Realtime și urechea senzorială locală.
      vlRef.current?.setMuted(pauza)
      // Urechea locală (offline) — și ea produce fraze din zgomot de tastatură
      urecheaLocalaRef.current?.setMuted(pauza)
    }
    const onKeyDown = (): void => {
      // Prima tastă → mută microfonul
      if (!tastareActivaRef.current) aplicaPauzaTastare(true)
      // Reset debounce — 1.5s fără tastă = terminat de scris
      if (tastareDebounceRef.current)
        window.clearTimeout(tastareDebounceRef.current)
      tastareDebounceRef.current = window.setTimeout(() => {
        aplicaPauzaTastare(false)
        tastareDebounceRef.current = null
      }, 1500)
    }
    const onBlur = (): void => {
      if (tastareDebounceRef.current) {
        window.clearTimeout(tastareDebounceRef.current)
        tastareDebounceRef.current = null
      }
      aplicaPauzaTastare(false)
    }
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('blur', onBlur)
      if (tastareDebounceRef.current)
        window.clearTimeout(tastareDebounceRef.current)
    }
  }, [])
  const pornesteUrecheaLocala = async (): Promise<void> => {
    if (online || micManualOffRef.current || urecheaLocalaRef.current)
      return
    const indisponibila = (): void => {
      setUrecheaLocalaGata(false)
      setListening(false)
      setLivePhase('idle')
    }
    setLivePhase('connecting')
    try {
      if (
        !offlineKitComponentReady('hearing') &&
        !(await refreshOfflineKit()).components.hearing
      ) {
        indisponibila()
        return
      }
      const gata = await pregatesteUrecheaOffline({ allowNetwork: false })
      if (!gata) {
        indisponibila()
        return
      }
      setUrecheaLocalaGata(true)
      if (online || micManualOffRef.current || urecheaLocalaRef.current) {
        setLivePhase('idle')
        return
      }
      const { startMicStream } = await import('../lib/micStream')
      const ureche = await startMicStream({
        onLive: () => {},
        onBargeIn: () => {
          opresteVoceLocal()
          urecheaLocalaRef.current?.setMuted(false)
        },
        onPhrase: (_text, audio) => {
          if (!audio || !urecheaOfflineGata()) return
          if (voceLocalaVorbeste() || isVoicePlaying()) return
          const generation = connectionGenerationRef.current
          try {
            const pcm = wavBase64LaFloat32(audio)
            void transcrieOffline(pcm, speechLangRef.current).then((text) => {
              if (text && !onlineRef.current && generation === connectionGenerationRef.current) {
                void sendRef.current(text)
              }
            })
          } catch {
            // Un container audio incomplet este abandonat local, fără retry de
            // rețea și fără a bloca următoarea frază.
          }
        },
        onError: indisponibila,
        getLang: () => speechLangRef.current,
      })
      if (!ureche) {
        indisponibila()
        return
      }
      if (online || micManualOffRef.current) {
        ureche.stop()
        setLivePhase('idle')
        return
      }
      urecheaLocalaRef.current = ureche
      setListening(true)
      setLivePhase('listening')
      setFluxMicVersiune((v) => v + 1)
    } catch {
      indisponibila()
    }
  }
  const pornesteUrecheaLocalaRef = useRef(pornesteUrecheaLocala)
  pornesteUrecheaLocalaRef.current = pornesteUrecheaLocala
  useEffect(() => {
    const generation = ++connectionGenerationRef.current
    if (online) {
      // Revenirea oprește urechea locală și rearmează sesiunea online. Kitul
      // nu descarcă nimic în fundal; instalarea rămâne o acțiune din Setări.
      urecheaLocalaRef.current?.stop()
      urecheaLocalaRef.current = null
      oprestePregatireaUrechiiOffline()
      setUrecheaLocalaGata(false)
      opresteVoceLocal()
      const localTurn = localTurnRef.current
      localTurn?.controller.abort()
      void (async () => {
        await localTurn?.done.catch(() => {})
        await elibereazaCreierLocal()
        if (
          onlineRef.current &&
          connectionGenerationRef.current === generation &&
          !micManualOffRef.current
        ) void ensureMicRef.current()
      })()
      return
    }
    setMenuOpen(false) // meniul „+" e demontat offline — să nu sară deschis la revenire
    vlGeneratieRef.current++ // omoară reluările/sondele programate ale sesiunii live
    unregisterLiveFocus()
    vlRef.current?.inchide()
    vlRef.current = null
    micStartingRef.current = false
    setListening(false)
    setLivePhase(micManualOffRef.current ? 'idle' : 'connecting')
    // Audio deja primit poate termina redarea fără rețea. Urechea locală se
    // încarcă numai dacă instalatorul a confirmat integral revizia din cache.
    void refreshOfflineKit()
      .then((snapshot) => {
        if (!snapshot.components.hearing) return false
        return pregatesteUrecheaOffline({ allowNetwork: false })
      })
      .then((gata) => {
        if (!gata) {
          setUrecheaLocalaGata(false)
          setLivePhase('idle')
          return
        }
        setUrecheaLocalaGata(true)
        if (!micManualOffRef.current) void pornesteUrecheaLocalaRef.current()
      })
      .catch(() => {
        setUrecheaLocalaGata(false)
        setLivePhase('idle')
      })
    return () => {
      urecheaLocalaRef.current?.stop()
      urecheaLocalaRef.current = null
    }
  }, [online])

  const tabVoceIdRef = useRef(idTabVoce())
  const voceAiureaRef = useRef(false)
  const ultimaInimaRef = useRef(0)
  const canalVoceRef = useRef<BroadcastChannel | null>(null)

  const muzicaActivaRef = useRef(false)
  const dansLiberRef = useRef(true)
  const dansIdxRef = useRef(0)

  const micTerminalAckedRef = useRef(false)

  const reprogrameazaMic = (): void => {
    if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
    setLivePhase('reconnecting')
    micRetryRef.current = window.setTimeout(
      () => void ensureMicRef.current(),
      micBackoffRef.current,
    )
    micBackoffRef.current = Math.min(micBackoffRef.current * 2, 15_000)
  }
  async function ensureMic(): Promise<void> {
    if (
      voceAiureaRef.current ||
      !online ||
      vlRef.current ||
      micStartingRef.current ||
      micManualOffRef.current ||
      micTerminalAckedRef.current
    )
      return

    if (micRetryRef.current) {
      window.clearTimeout(micRetryRef.current)
      micRetryRef.current = null
    }
    micStartingRef.current = true
    setLivePhase('connecting')

    try {
      const cap = await vocalLiveDisponibila()
      if (micManualOffRef.current || voceAiureaRef.current || !online)
        return
      if (!cap?.disponibil) {
        if (!voiceDownAckedRef.current) {
          voiceDownAckedRef.current = true
          ack(t.voiceDownTemp)
        }
        reprogrameazaMic()
        return
      }

      const generatie = ++vlGeneratieRef.current
      let auzit = ''
      let spus = ''
      const arataBanda = (canal: 'auzit' | 'spus'): void => {
        const activ = canal === 'auzit' ? auzit : spus
        const celalalt = canal === 'auzit' ? spus : auzit
        const semn = canal === 'auzit' ? '🎙 ' : '⚡ '
        const semnCelalalt = canal === 'auzit' ? '⚡ ' : '🎙 '
        setLiveVoice(
          activ ? semn + activ : celalalt ? semnCelalalt + celalalt : '',
        )
      }
      const opresteDupaEroare = (motiv: string): void => {
        if (generatie !== vlGeneratieRef.current) return
        console.warn(`[vocalLive] ${motiv}`)
        vlGeneratieRef.current++
        unregisterLiveFocus()
        const sesiune = vlRef.current
        vlRef.current = null
        sesiune?.inchide()
        setListening(false)
        setLiveVoice('')

        if (motiv.includes('browserul nu dă acces')) {
          setLivePhase('error')
          micTerminalAckedRef.current = true
          ack(t.micUnsupported)
          return
        }
        if (motiv.includes('microfonul nu a fost permis')) {
          setLivePhase('error')
          micTerminalAckedRef.current = true
          ack(t.micBlocked)
          return
        }
        if (
          motiv.includes('credit epuizat') ||
          motiv.includes('nu ești autentificat')
        ) {
          setLivePhase('error')
          if (!voiceDownAckedRef.current) {
            voiceDownAckedRef.current = true
            ack(
              motiv.includes('credit epuizat')
                ? t.voiceNeedCredit
                : t.voiceNeedLogin,
            )
          }
          return
        }
        if (!voiceDownAckedRef.current) {
          voiceDownAckedRef.current = true
          ack(t.voiceDownTemp)
        }
        reprogrameazaMic()
      }

      const vl = await deschideVocalLive({
        onState: setLivePhase,
        onGata: () => {
          if (generatie !== vlGeneratieRef.current) return
          auzit = ''
          spus = ''
          setLiveVoice('')
          setListening(true)
          setLiveEndpointVoice(cap.voce)
          micBackoffRef.current = 1000
          voiceDownAckedRef.current = false
        },
        onUser: (text, final) => {
          if (generatie !== vlGeneratieRef.current) return
          auzit = final ? '' : auzit + text
          arataBanda('auzit')
        },
        onKelion: (text, final) => {
          if (generatie !== vlGeneratieRef.current) return
          spus = final ? '' : spus + text
          arataBanda('spus')
        },
        onTuraInchisa: () => {
          if (generatie !== vlGeneratieRef.current) return
          auzit = ''
          spus = ''
          setLiveVoice('')
        },
        onStatus: (code, reason) => {
          if (generatie !== vlGeneratieRef.current || code !== 'response_suppressed') return
          const mesaj = reason === 'language_guard'
            ? 'Răspunsul vocal a fost suprimat: limba nu corespunde sesiunii.'
            : 'Răspunsul vocal a fost suprimat: nu a fost detectată adresarea către Kelion.'
          setLiveVoice(`⚠ ${mesaj}`)
          ack(mesaj)
        },
        onNivelIntrare: (nivel) => {
          if (generatie === vlGeneratieRef.current) micNivelRef.current = nivel
        },
        preampInitial: preampNivel,
        onControl: (frame) => {
          if (generatie === vlGeneratieRef.current)
            handleControl(frame as ChatControl)
        },
        instantaneeLaCerere: async () => {
          if (!cameraOnRef.current) return []
          const proaspat = await captureRef.current?.()
          return proaspat ? [proaspat] : []
        },
        monitor: () => getMonitorContent(),
        tranzactii: () => getStareTranzactii(),
        onEroare: opresteDupaEroare,
      })

      if (
        !vl ||
        generatie !== vlGeneratieRef.current ||
        micManualOffRef.current
      ) {
        vl?.inchide()
        return
      }

      vlRef.current = vl
      setFluxMicVersiune((v) => v + 1)
      registerLiveFocus({
        onInterrupt: () => {
          stopVoice()
          vl.intrerupeRedarea()
        },
      })
      if (isVoicePlaying()) vl.setRedareExterna(true)
      setListening(true)
      setLivePhase('listening')
      emiteTakeover(canalVoceRef.current, tabVoceIdRef.current)
      setForeignVoiceLock(false)
      console.info(
        `[vocalLive] OpenAI Realtime activ: ${cap.model}, voce ${cap.voce}`,
      )
    } catch (eroare) {
      setLivePhase('error')
      console.error('[vocalLive] pornirea OpenAI Realtime a eșuat', eroare)
      if (!voiceDownAckedRef.current) {
        voiceDownAckedRef.current = true
        ack(t.voiceDownTemp)
      }
      reprogrameazaMic()
    } finally {
      micStartingRef.current = false
    }
  }
  const ensureMicRef = useRef(ensureMic)
  ensureMicRef.current = ensureMic

  function toggleMic(): void {
    if (!online) {
      if (urecheaLocalaRef.current) {
        micManualOffRef.current = true
        urecheaLocalaRef.current.stop()
        urecheaLocalaRef.current = null
        setListening(false)
        setLivePhase('idle')
      } else {
        micManualOffRef.current = false
        void pornesteUrecheaLocalaRef.current()
      }
      return
    }
    // O atingere oprește inclusiv o pornire aflată în zbor; următoarea pornește
    // exclusiv clientul OpenAI Realtime.
    if (micStartingRef.current || vlRef.current) {
      micManualOffRef.current = true
      vlGeneratieRef.current++
      micStartingRef.current = false
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      setListening(false)
      setLiveVoice('')
      setLivePhase('idle')
      setLiveEndpointVoice('')
      return
    }
    micManualOffRef.current = false
    micTerminalAckedRef.current = false
    voceAiureaRef.current = false
    void ensureMicRef.current()
  }

  // Reconnect only after an explicit start. Visibility changes must never turn a
  // previously-off microphone on by themselves.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !micManualOffRef.current) {
        void ensureMicRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    const cleanupLive = (): void => {
      if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
      vlGeneratieRef.current++
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      stopVoice()
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      cleanupLive()
    }
  }, [])

  // MESSENGER — VOCEA CU KELION SE SUSPENDĂ CÂT VORBEȘTI CU OMUL (Faza 2). Când
  // un apel se CONECTEАZĂ, oprim microfonul/sesiunea Kelion (altfel două microfoane
  // s-ar bate, iar Kelion ar „auzi" conversația și ar răspunde). Captura apelului
  // (lib/apelMic) preia microfonul. La ÎNCHIDEREA apelului, revenim la vocea Kelion.
  useEffect(() => {
    const laApel = (e: Event): void => {
      const d = (e as CustomEvent).detail as { stare?: string }
      if (d?.stare === 'conectat') {
        if (apelActivRef.current) return
        apelActivRef.current = true
        micDoritaInainteApelRef.current = !micManualOffRef.current
        micManualOffRef.current = true // blochează re-armarea automată a urechii Kelion
        vlGeneratieRef.current++
        unregisterLiveFocus()
        vlRef.current?.inchide()
        vlRef.current = null
        setListening(false)
        stopVoice()
      } else if (d?.stare === 'inchis' || d?.stare === 'refuzat') {
        if (!apelActivRef.current) return
        apelActivRef.current = false
        const reporneste = micDoritaInainteApelRef.current
        micDoritaInainteApelRef.current = false
        micManualOffRef.current = !reporneste
        if (reporneste) {
          if (onlineRef.current) void ensureMicRef.current()
          else void pornesteUrecheaLocalaRef.current()
        }
      }
    }
    window.addEventListener('kelion:apel-stare', laApel)
    return () => window.removeEventListener('kelion:apel-stare', laApel)
  }, [])

  const DANSURI = [
    'dans',
    'dans-2',
    'dans-3',
    'dans-4',
    'dans-5',
    'dans-6',
    'dans-7',
    'dans-8',
    'dans-9',
    'dans-10',
  ]
  useEffect(() => {
    if (!listening) return
    const stream =
      vlRef.current?.fluxMicrofon() ??
      urecheaLocalaRef.current?.fluxMicrofon() ??
      null
    if (!stream) return
    const peDansGata = (): void => {
      dansLiberRef.current = true
    }
    window.addEventListener('kelion-gesture-done', peDansGata)
    void pornesteAuzulAmbiental(stream)
    const opreste = pornesteDansPeMuzica(stream, {
      peBit: () => {
        // O mișcare nouă pornește DOAR pe un bit și doar dacă avatarul e
        // liber (mișcarea precedentă s-a terminat) — așa dansul e sincron.
        if (!muzicaActivaRef.current || !dansLiberRef.current) return
        dansLiberRef.current = false
        dansIdxRef.current = (dansIdxRef.current + 1) % DANSURI.length
        window.dispatchEvent(
          new CustomEvent('kelion-gesture', {
            detail: DANSURI[dansIdxRef.current],
          }),
        )
      },
      muzicaOn: () => {
        muzicaActivaRef.current = true
        interruptAll('music-start')
        if (dansLiberRef.current) {
          dansLiberRef.current = false
          window.dispatchEvent(
            new CustomEvent('kelion-gesture', {
              detail: DANSURI[dansIdxRef.current],
            }),
          )
        }
      },
      muzicaOff: () => {
        muzicaActivaRef.current = false
        dansLiberRef.current = true
      },
    })
    return () => {
      window.removeEventListener('kelion-gesture-done', peDansGata)
      opreste()
      opresteAuzulAmbiental()
      muzicaActivaRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, fluxMicVersiune])

  useEffect(() => {
    const bc = deschideCanalVoce()
    canalVoceRef.current = bc
    if (!bc) return
    const opresteLocal = (): void => {
      if (micRetryRef.current) {
        window.clearTimeout(micRetryRef.current)
        micRetryRef.current = null
      }
      vlGeneratieRef.current++
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      setListening(false)
      setLiveVoice('')
    }
    const onMesaj = (ev: MessageEvent): void => {
      const ce = judecaMesajVoce(
        ev.data as MesajVoce | null,
        tabVoceIdRef.current,
        voceAiureaRef.current,
      )
      if (ce === 'zavoraste') {
        voceAiureaRef.current = true
        ultimaInimaRef.current = Date.now()
        opresteLocal()

        setForeignVoiceLock(true)
      } else if (ce === 'inima') {
        ultimaInimaRef.current = Date.now()
      } else if (ce === 'reia') {
        voceAiureaRef.current = false
        setForeignVoiceLock(false)
        void ensureMicRef.current()
      }
    }
    bc.addEventListener('message', onMesaj)
    const puls = ceas(
      'puls interfață',
      () => {
        if (vlRef.current) bc.postMessage({ inima: tabVoceIdRef.current })
        else if (
          voceAiureaRef.current &&
          inimaAMurit(ultimaInimaRef.current, Date.now())
        ) {
          // Tabul care ținea vocea a murit fără rămas-bun → vocea revine AICI.
          voceAiureaRef.current = false
          void ensureMicRef.current()
        }
      },
      INIMA_BATE_MS,
    )
    const laPlecare = (): void => {
      if (vlRef.current) bc.postMessage({ ramasBun: tabVoceIdRef.current })
    }
    window.addEventListener('pagehide', laPlecare)
    return () => {
      window.removeEventListener('pagehide', laPlecare)
      window.clearInterval(puls)
      bc.removeEventListener('message', onMesaj)
      laPlecare()
      bc.close()
      canalVoceRef.current = null
    }
  }, [])

  // While it listens, the screen doesn't fall asleep — a phone with the screen off cuts its
  // microphone, and "permanent on" would die at the first screen-off.
  useEffect(() => {
    keepScreenOn(listening)
    return () => keepScreenOn(false)
  }, [listening])

  // Apply a language the SERVER decided (it already persisted the pref) —
  // update the recognizer + the local mirror. No-op if already active.
  function applyLang(code: string): void {
    if (code === speechLangRef.current) return
    speechLangRef.current = code
    setSpeechLang(code)
    mirrorLang(code)
  }

  // Retry only after the server ping and the opaque account scope are both
  // revalidated. The durable UUID is reused; a raw browser `online` event is not
  // proof that the server/session is reachable.
  useEffect(() => {
    if (!online || !offlineRef.current) return
    let active = true
    void offlineSyncScopeAuthenticated().then((authenticated) => {
      if (!active || !authenticated || !online || !offlineRef.current) return
      offlineRef.current = false
      const retry = retryTurnRef.current
      retryTurnRef.current = null
      const tsEroare = retryEroareTsRef.current
      retryEroareTsRef.current = null
      const tsUser = retryUserTsRef.current
      retryUserTsRef.current = null
      if (retry) {
        // Resume from where we were cut off: drop EXACT the failed turn's error
        // bubble + its user bubble (both by their recorded ts), then re-send.
        // NOT slice(0,-2): bubbles that arrived between the failure and the
        // recovery (voice transcript, another question) must survive; and the
        // user bubble goes by TS, not content (document turns differ).
        setMessages((cur) =>
          cur.filter(
            (mm) =>
              !(
                mm.role === 'assistant' &&
                tsEroare !== null &&
                mm.ts === tsEroare
              ) && !(mm.role === 'user' && tsUser !== null && mm.ts === tsUser),
          ),
        )
        void sendRef.current(
              retry.text,
              retry.spoken,
              retry.id,
              retry.media,
            )
      }
    })
    return () => { active = false }
  }, [online])

  // Load the user's persisted speech language (localStorage instantly, then the
  // server which follows the user across devices). Auto-detection still refines
  // it from what's actually spoken/typed.
  useEffect(() => {
    const apply = (code: string | null): void => {
      if (!code || code === speechLangRef.current) return
      speechLangRef.current = code
      setSpeechLang(code)
    }
    const local = loadLocalLang()
    apply(local)
    if (!online) return
    void loadServerPrefs().then((serverPrefs) => {
      if (!serverPrefs) return
      apply(serverPrefs.speechLang)
      // Server is the cross-device source of truth: if the local mirror is stale
      // (e.g. left over from an earlier mis-detection), correct it.
      if (serverPrefs.speechLang && serverPrefs.speechLang !== local)
        mirrorLang(serverPrefs.speechLang)
    })
  }, [online])

  // Locația se cere numai pentru o tură care o solicită explicit și nu este
  // păstrată după construirea acelei cereri.
  const getFreshCoords = (): Promise<Coords | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
      )
    })

  // Close the functions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  function toggleCamera(): void {
    if (cameraOn) {
      setCameraOn(false)
      return
    }
    requestCamera()
  }
  function requestCamera(nextFacing?: Facing): void {
    if (!cameraSupported()) return
    if (
      !cameraActivationAllowed(cameraOnRef.current, () =>
        window.confirm(t.cameraConsentPrompt),
      )
    )
      return
    if (nextFacing) setFacing(nextFacing)
    setCameraOn(true)
  }
  function switchCamera(): void {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'))
  }

  const onCameraError = useCallback((): void => {
    setCameraOn(false)
  }, [])

  const wsOpen = useSyncExternalStore(subscribeWorkspace, getWorkspace).open

  const monitorBusy = useSyncExternalStore(subscribeWorkspace, isMonitorWorking)

  const realLatency = useSyncExternalStore(subscribeRealLatency, getRealLatency)

  const carOn = useSyncExternalStore(subscribeCarMode, isCarMode)
  const monitorMode = wsOpen || monitorBusy

  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)

  const cleanMsg = (s: string): string => {
    if (!s) return ''

    let cleaned = s

    const tags = [
      'thought',
      'thinking',
      'thought_signature',
      'thoughtSignature',
      'gand',
      'gandire',
      'creier',
      'system',
      'tool_call',
      'tool_response',
      'tool',
      'context',
      'prompt',
      'instructiune',
      'call',
      'response',
      'error',
      'info',
      'warning',
    ]
    for (const tag of tags) {
      const closedRegex = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi')
      cleaned = cleaned.replace(closedRegex, ' ')
      const unclosedRegex = new RegExp(`<${tag}>[\\s\\S]*?$`, 'gi')
      cleaned = cleaned.replace(unclosedRegex, '')
    }

    // Remove special tokens
    cleaned = cleaned
      .replace(/<\|?tool_call\|?>[\s\S]*?(<\|?\/?tool_call\|?>|$)/g, ' ')
      .replace(/<\/?tool_call>[\s\S]*?(<\/tool_call>|$)/g, ' ')
      .replace(/<\|im_(?:start|end)\|>[^\n]*\n?/g, ' ')

    // 2. Remove bracketed system/thought tags
    const bracketTags = [
      'thought',
      'thinking',
      'gand',
      'gandire',
      'creier',
      'system',
      'tool',
      'context',
      'prompt',
      'error',
      'info',
      'warning',
      'CREIER',
      'THOUGHT',
      'GANDIRE',
      'SYSTEM',
      'TOOL',
    ]
    for (const bTag of bracketTags) {
      const closedB = new RegExp(
        `\\[${bTag}\\][\\s\\S]*?\\[\\/${bTag}\\]`,
        'gi',
      )
      cleaned = cleaned.replace(closedB, ' ')
      const unclosedB = new RegExp(`\\[${bTag}\\][\\s\\S]*?$`, 'gi')
      cleaned = cleaned.replace(unclosedB, '')
      const lineB = new RegExp(`^\\[${bTag}\\][\\s\\S]*?$`, 'gm')
      cleaned = cleaned.replace(lineB, '')
    }

    cleaned = cleaned.trim()

    // 3. Handle JSON structure
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleaned)
        const targetLang = (lang || 'ro').toLowerCase()
        if (targetLang.startsWith('ro') && parsed.ro) {
          cleaned = parsed.ro
        } else if (targetLang.startsWith('en') && parsed.en) {
          cleaned = parsed.en
        } else if (parsed[targetLang]) {
          cleaned = parsed[targetLang]
        } else {
          const otherLang = targetLang.startsWith('ro') ? 'en' : 'ro'
          if (parsed[otherLang]) {
            cleaned = parsed[otherLang]
          } else if (parsed.text) {
            cleaned = parsed.text
          } else if (parsed.message) {
            cleaned = parsed.message
          }
        }
      } catch {
        // Not valid JSON or failed to parse, continue
      }
    }

    // 4. Handle language markers
    const targetLang = (lang || 'ro').toLowerCase()

    // Check bracketed language markers like [RO] / [EN] / [RO-RO] / [EN-US]
    const hasRoBracket = /\[ro(?:-ro)?\]/i.test(cleaned)
    const hasEnBracket = /\[en(?:-us)?\]/i.test(cleaned)
    if (hasRoBracket || hasEnBracket) {
      if (targetLang.startsWith('ro')) {
        const match = cleaned.match(
          /\[ro(?:-ro)?\]\s*([\s\S]*?)(?:\s*\[[a-z]{2,}(?:-[a-z]{2,})?\]|$)/i,
        )
        if (match && match[1].trim()) cleaned = match[1].trim()
      } else {
        const match = cleaned.match(
          /\[en(?:-us)?\]\s*([\s\S]*?)(?:\s*\[[a-z]{2,}(?:-[a-z]{2,})?\]|$)/i,
        )
        if (match && match[1].trim()) cleaned = match[1].trim()
      }
    }

    // Check prefixed language markers like "RO: ..." / "EN: ..." / "ROMANA: ..." / "ENGLISH: ..." / "RO-RO: ..."
    const hasRoPrefix = /\b(?:ro|romana|română|ro-ro):\s*/i.test(cleaned)
    const hasEnPrefix = /\b(?:en|english|en-us):\s*/i.test(cleaned)
    if (hasRoPrefix || hasEnPrefix) {
      if (targetLang.startsWith('ro')) {
        const match = cleaned.match(
          /\b(?:ro|romana|română|ro-ro):\s*([\s\S]*?)(?:\b(?:en|english|en-us|fr|de|it|es|ru):\s*|$)/i,
        )
        if (match && match[1].trim()) cleaned = match[1].trim()
      } else {
        const match = cleaned.match(
          /\b(?:en|english|en-us):\s*([\s\S]*?)(?:\b(?:ro|romana|română|ro-ro|fr|de|it|es|ru):\s*|$)/i,
        )
        if (match && match[1].trim()) cleaned = match[1].trim()
      }
    }

    // Clean any remaining leading language prefixes or bracketed tags
    cleaned = cleaned
      .replace(/^\[(?:ro|en|ro-ro|en-us)\]\s*/i, '')
      .replace(/^(?:ro|romana|română|ro-ro|en|english|en-us):\s*/i, '')

    // 5. Clean markdown noise (bold, italic, headers, backticks, bullet points)
    cleaned = cleaned
      .replace(/\*\*\*([\s\S]*?)\*\*\*/g, '$1')
      .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
      .replace(/\*([\s\S]*?)\*/g, '$1')
      .replace(/___([\s\S]*?)___/g, '$1')
      .replace(/__([\s\S]*?)__/g, '$1')
      .replace(/_([\s\S]*?)_/g, '$1')
      .replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1')
      .replace(/^#{1,6}\s+/gm, '') // remove header markers
      .replace(/^[-*+]\s+/gm, '') // remove simple bullet list symbols at the start of lines

    // 6. Clean whitespace noise and fix merged sentences
    cleaned = cleaned
      .replace(/\r\n/g, '\n')
      .replace(/([.!?])([A-ZĂÎÂȘȚ])/g, '$1 $2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return cleaned
  }

  const micButton = (cls: string) =>
    !online && !urecheaLocalaGata ? null : (
      <button
        type="button"
        className={`${cls} ${listening ? 'live' : ''}`}
        onClick={toggleMic}
        aria-label={listening ? t.micStop : t.micTalk}
        title={listening ? t.micStop : t.micTalk}
      >
        {listening ? '●' : '🎤'}
      </button>
    )
  const hint = t.chatHint
  const liveStatusLabel =
    livePhase === 'idle'
      ? null
      : livePhase === 'connecting'
        ? lang === 'ro'
          ? 'se conectează'
          : 'connecting'
        : livePhase === 'reconnecting'
          ? lang === 'ro'
            ? 'se reconectează'
            : 'reconnecting'
          : livePhase === 'listening'
            ? lang === 'ro'
              ? 'ascultă'
              : 'listening'
            : livePhase === 'thinking'
              ? lang === 'ro'
                ? 'gândește'
                : 'thinking'
              : livePhase === 'speaking'
                ? lang === 'ro'
                  ? 'vorbește'
                  : 'speaking'
                : livePhase === 'interrupted'
                  ? lang === 'ro'
                    ? 'întrerupt de vocea ta'
                    : 'interrupted by your voice'
                  : lang === 'ro'
                    ? 'eroare de conexiune'
                    : 'connection error'

  const hasDraft = input.trim().length > 0 || attachments.length > 0
  const queueing = busy && hasDraft

  return (
    <div className="chat">
      {liveStatusLabel && (
        <div
          className={`voice-connection-status phase-${livePhase}`}
          role="status"
          aria-live="polite"
          data-testid="voice-connection-status"
          data-phase={livePhase}
        >
          <span className="voice-connection-dot" aria-hidden="true" />
          {online
            ? 'OpenAI Live'
            : lang === 'ro'
              ? 'Voce locală offline'
              : 'Local offline voice'}
          {' · '}
          {liveStatusLabel}
          {liveEndpointVoice && online ? ` · ${liveEndpointVoice}` : ''}
          {speechLang ? ` · ${speechLang}` : ''}
        </div>
      )}
      <CameraView
        active={cameraOn}
        facing={facing}
        onError={onCameraError}
        captureRef={captureRef}
      />
      {cameraOn && (
        <div
          className="camera-privacy-indicator"
          role="status"
          aria-live="polite"
        >
          <span>
            ●{' '}
            {lang === 'ro'
              ? 'Cameră: instantanee la cerere'
              : 'Camera: on-demand snapshots'}
          </span>
          <button
            type="button"
            className="camera-privacy-stop"
            onClick={() => setCameraOn(false)}
          >
            {lang === 'ro' ? 'Oprește camera' : 'Stop camera'}
          </button>
        </div>
      )}

      {carOn &&
        createPortal(
          <div className="car-mode" role="dialog" aria-label={t.carMode}>
            <JarvisOrb />
            <button
              type="button"
              className="car-exit"
              onClick={() => setCarMode(false)}
              aria-label={t.carExit}
              title={t.carExit}
            >
              ✕
            </button>
            <div className="car-talk">
              {listening && (heard || lastUser?.content) ? (
                <p className="car-heard">
                  {(heard || lastUser?.content || '').slice(0, 200)}
                </p>
              ) : null}
              <p className="car-reply">
                {cleanMsg(lastAssistant?.content ?? '') || t.carHint}
              </p>
            </div>

            {online && (
              <div className="car-mic-wrap">
                <button
                  type="button"
                  className={`car-mic ${listening ? 'live' : ''}`}
                  onClick={toggleMic}
                  aria-pressed={listening}
                  aria-label={listening ? t.carVoiceOff : t.carVoiceOn}
                  title={listening ? t.carVoiceOff : t.carVoiceOn}
                >
                  🎙️
                </button>
                <span className="car-mic-label">
                  {listening ? t.carListening : t.carVoiceOn}
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}

      {!monitorMode && (
        <div className="chat-log" ref={chatLogRef}>
          {!online && localContextLoaded && (
            <p className="chat-hint" role="status">
              {lang === 'ro'
                ? 'Context local restaurat pentru acest cont; se sincronizează numai după reconectare și revalidare.'
                : 'Local context restored for this account; it syncs only after reconnect and revalidation.'}
            </p>
          )}
          {messages.length === 0 && <p className="chat-hint">{hint}</p>}
          {[lastUser].map((m, i) =>
            m && cleanMsg(m.content) ? (
              <div
                key={`${m.ts ?? 0}-${i}`}
                className={`chat-msg ${m.role === 'user' ? 'me' : 'kelion'}`}
              >
                <span className="chat-msg-text">{cleanMsg(m.content)}</span>
              </div>
            ) : null,
          )}
          {chatImage && (
            <img
              className="chat-image"
              src={chatImage}
              alt="Kelion generated"
            />
          )}
        </div>
      )}
      {scenarioRunning && (
        <p className="scenario-live">● {t.scenarioRecording}</p>
      )}

      {realLatency && Date.now() - realLatency.at < 120_000 && (
        <span className="latency-chip" title={uiStrings().latencyChip}>
          ⚡ {(realLatency.firstMs / 1000).toFixed(1)}s ·{' '}
          {(realLatency.totalMs / 1000).toFixed(1)}s
        </span>
      )}

      <WorkClock busy={busy} title={t.workClockTitle} />

      {isAdmin && scenarioOpen && (
        <div className="scenario-panel">
          <div className="scenario-head">
            <span>{t.scenarioTitle}</span>
            <button
              type="button"
              className="ghost"
              onClick={() => setScenarioOpen(false)}
            >
              ✕
            </button>
          </div>
          <textarea
            className="scenario-text"
            value={scenarioText}
            onChange={(e) => setScenarioText(e.target.value)}
            placeholder={t.scenarioHint}
            rows={4}
          />
          <div className="scenario-actions">
            <button
              type="button"
              className="composer-send scenario-rec"
              onClick={() => void runScenario()}
              disabled={!scenarioText.trim()}
            >
              ● {t.scenarioRecord}
            </button>
          </div>
        </div>
      )}
      {scenarioRunning && (
        <button type="button" className="scenario-stop" onClick={stopScenario}>
          ■ {t.scenarioStop}
        </button>
      )}
      <div className={`composer ${busy ? 'working' : ''}`}>
        {liveVoice && (
          <div className="voice-live" aria-live="polite">
            <span className="voice-live-dot" />

            <span className="speech-tail">
              <span className="speech-tail-text">{liveVoice}</span>
            </span>
            <span className="voice-live-caret" />
          </div>
        )}

        {listening && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <MicBargraf nivelRef={micNivelRef} activ={listening} />

            <label
              title="Preamp microfon (min→max): ridică nivelul dacă e prea surd (peste amplificarea automată)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: '#c9ccd1',
              }}
            >
              <span style={{ opacity: 0.8 }}>preamp</span>
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={preampNivel}
                onChange={(e) => {
                  const g = Number(e.target.value)
                  setPreampNivel(g)
                  vlRef.current?.setPreamp(g)
                  try {
                    localStorage.setItem('kelion_preamp', String(g))
                  } catch {
                    /* ignore */
                  }
                }}
                style={{ width: 96 }}
              />
              <span
                style={{
                  minWidth: 30,
                  opacity: 0.85,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ×{preampNivel.toFixed(1)}
              </span>
            </label>
          </div>
        )}

        {(heard || lastUser?.content) &&
        (userEchoHold || (busy && !lastAssistant?.content)) ? (
          <div className="heard-band user-band" aria-live="polite">
            <span
              className="heard-band-label"
              title={uiStrings().heardYouTitle}
            >
              👤
            </span>
            <span className="speech-tail">
              <span className="speech-tail-text">
                {(heard || lastUser?.content || '').slice(0, 400)}
              </span>
            </span>
          </div>
        ) : busy && !lastAssistant?.content ? (
          <div className="heard-band" aria-live="polite">
            <span
              className="heard-band-label"
              title={uiStrings().heardBrainTitle}
            >
              🧠
            </span>
            <span className="speech-tail">
              <span className="speech-tail-text">…</span>
            </span>
          </div>
        ) : ((lastAssistant?.content && !idleBandHidden) || busy) &&
          lastAssistant?.ts !== tickerDoneTs ? (
          <div className="heard-band kelion-band" aria-live="polite">
            <span
              className="heard-band-label kelion-k"
              title={t.heardKelionTitle}
            >
              K
            </span>
            {busy ? (
              <span className="speech-tail">
                <span className="speech-tail-text">
                  {cleanMsg(lastAssistant?.content ?? '') ||
                    (heard ? synthesize(heard) : '…')}
                </span>
              </span>
            ) : (
              <span className="ticker">
                <span
                  className="ticker-text"
                  key={lastAssistant?.ts ?? 'empty'}
                  style={
                    {
                      '--ticker-dur': tickerDur(
                        cleanMsg(lastAssistant?.content ?? ''),
                      ),
                    } as CSSProperties
                  }
                  onAnimationEnd={() =>
                    setTickerDoneTs(lastAssistant?.ts ?? null)
                  }
                >
                  {cleanMsg(lastAssistant?.content ?? '')}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {attachments.length > 0 && (
          <div className="composer-atts">
            {attachments.map((a) => (
              <div className="att-chip" key={a.id}>
                {a.url ? (
                  <img src={a.url} alt={a.name} />
                ) : (
                  <span className="att-doc-name">📄 {a.name}</span>
                )}
                <button
                  type="button"
                  className="att-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={t.attRemove}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {queued.length > 0 && (
          <div className="queued-band" aria-live="polite">
            <span className="queued-dot" />
            <span className="ticker">
              <span
                className="ticker-text"
                key={queued.join('|')}
                style={
                  {
                    '--ticker-dur': tickerDur(queued.join(' · ')),
                  } as CSSProperties
                }
              >
                {queued.map((q, i) => (
                  <span key={i} className="queued-chip">
                    {q.slice(0, 80)}
                    {i < queued.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </span>
            </span>
          </div>
        )}
        <div
          className="composer-row"
          onMouseDown={(e) => {
            // A click anywhere in the bar (outside the buttons and the input itself)
            // focuses the typing field ON THE FIRST TRY — no more multiple clicks.
            const el = e.target as HTMLElement
            if (
              el.closest('button') ||
              el.tagName === 'INPUT' ||
              el.tagName === 'TEXTAREA'
            )
              return
            composerInputRef.current?.focus()
          }}
        >
          {online && (
            <div className="fn-wrap" ref={menuRef}>
              <button
                type="button"
                className={`composer-icon ${menuOpen ? 'live' : ''}`}
                onClick={() => setMenuOpen((o) => !o)}
                title={t.functionsTitle}
                aria-label={t.functionsTitle}
                aria-expanded={menuOpen}
              >
                +
              </button>
              {menuOpen && (
                <div className="fn-menu">
                  <button
                    type="button"
                    className="fn-item"
                    onClick={openFilePicker}
                  >
                    <span className="ico">📎</span>
                    {t.attachTitle}
                  </button>
                  {cameraSupported() && (
                    <button
                      type="button"
                      className="fn-item"
                      onClick={toggleCamera}
                    >
                      <span className="ico">{cameraOn ? '🔌' : '📷'}</span>
                      {cameraOn ? t.disconnectCamTitle : t.connectCamTitle}
                      {cameraOn && <span className="dot" />}
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      className="fn-item"
                      onClick={() => {
                        setMenuOpen(false)
                        setScenarioOpen(true)
                      }}
                    >
                      <span className="ico">🎬</span>
                      {t.scenarioTitle}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <textarea
            ref={composerInputRef}
            className="composer-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteFiles}
            onDrop={onDropFiles}
            onDragOver={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()

                void send(input)
              }
            }}
            placeholder={t.chatPlaceholder}
            autoComplete="off"
          />
          {micButton('composer-mic')}

          <input
            type="range"
            className="composer-volume"
            hidden
            min={0}
            max={100}
            value={Math.round(voiceVol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setVoiceVolState(v)
              setVoiceVolume(v)
            }}
            aria-label={t.voiceVolume}
            title={`${t.voiceVolume}: ${Math.round(voiceVol * 100)}%`}
          />
          <button
            type="button"
            className={`composer-send ${queueing ? 'queueing' : ''}`}
            onClick={() => {
              void send(input)
            }}
            disabled={!hasDraft}
            aria-label={queueing ? t.sendInterrupts : t.send}
            title={queueing ? t.sendInterrupts : t.send}
          >
            {queueing ? '■' : '↑'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
