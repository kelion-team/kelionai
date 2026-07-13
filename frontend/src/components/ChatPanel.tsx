import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from 'react'
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { strings, resolveLang, type Lang } from '../lib/i18n'
import CameraView from './CameraView'
import { cameraSupported, type Facing } from '../lib/camera'
import { defaultSpeechLang } from '../lib/languages'
import { loadLocalLang, loadServerPrefs, mirrorLang } from '../lib/prefs'
import {
  openWorkspace,
  openWorkspaceCard,
  openWorkspaceDoc,
  closeWorkspace,
  closeTasksByKind,
  closeAllTasks,
  switchToKind,
  getWorkspace,
  subscribeWorkspace,
  isMonitorWorking,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  startMic,
  playVoice,
  stopVoice,
  isVoicePlaying,
  calibrateVoiceprint,
  hasVoiceprint,
  clearVoiceprint,
  getPendingVoiceFeatures,
  clearPendingVoiceFeatures,
  type MicHandle,
} from '../lib/audioIO'
import { keepScreenOn } from '../lib/wakelock'
import { startMicStream } from '../lib/micStream'
import { createUtteranceCoalescer, type UtteranceCoalescer } from '../lib/utteranceCoalescer'
import { pushFacial } from '../lib/facialQueue'

// Gesturile-tool ale serverului (play_avatar_gesture, release-ul „v2.3" al
// constructorului) traduse în clipurile REALE din biblioteca RPM — scheletul
// se mișcă doar din clipuri (regula #125), deci eticheta devine numele
// clipului echivalent și pleacă pe același canal 'kelion-gesture'.
const GESTURE_TO_CLIP: Record<string, string> = {
  // Vocabular semantic (Adrian, 13 iul) — creierul cere gestul pe ÎNȚELES, aici
  // se traduce în clipul RPM. Fiecare e legat de un sentiment/context.
  salut: 'expresie-1', // salut / rămas-bun
  'arata-inainte': 'expresie-2', // arată înainte
  uimire: 'expresie-3', // uimire
  dezamagire: 'expresie-4', // dezamăgire ușoară
  nedumerire: 'expresie-5', // nedumerire
  victorie: 'expresie-6', // victorie
  multumire: 'expresie-7', // mulțumire
  surpriza: 'expresie-8', // surpriză
  'stai-putin': 'expresie-9', // stai puțin
  ganditor: 'expresie-10', // gânditor
  aprobare: 'expresie-11', // aprobare
  entuziasm: 'expresie-12', // entuziasm
  'acord-discret': 'expresie-13', // acord discret
  plecaciune: 'expresie-14', // plecăciune teatrală
  dans: 'dans', // dans (doar la cerere)
  // Legacy — comenzile vocale deterministe din backend încă emit astea.
  salute: 'expresie-1',
  raiseRightHand: 'expresie-13',
  pointMonitor: 'expresie-2',
}

// FĂRĂ plafon de durată la înregistrări (Adrian, 11 iul seara: „nu trebuie să
// aibă setări de timp sau limitări") — scenariul se termină când i se termină
// pașii sau când spune el stop, nu când expiră un cronometru arbitrar.

// Camera + monitor-tab commands ("închide harta", "camera spate", "switch to
// the video") are interpreted on the SERVER now (backend services/commands.ts,
// owner's order: as much of the app as possible on the server). The server
// answers them with a {device} control frame that handleControl executes; the
// ✕ on the monitor stays as the universal manual fallback.
// Admin typed control for the promo recorder. START arms the Rec button (the
// browser REQUIRES one real click to pick the screen); STOP ends the take.
// Kelion confirms both in chat.
// NB: no \b before "î" — JS word boundaries are ASCII-only, so \bî never
// matches and the spoken "înregistrează" would sail through to Claude.
const REC_STOP =
  /\b(opre[șs]te|opreste|stop|termin[ăa]|gata)\b.{0,12}([îi]nregistr|record|rec\b)/i
const REC_START =
  /([îi]nregistreaz[ăa]|porne[șs]te\s+[îi]nregistrarea|start\s+record\w*|record\s+(the\s+)?screen|filmeaz[ăa])/i
// During a promo TAKE only these typed words cut it (narrow on purpose).
const TAKE_STOP = /\b(stop|stai|opre[șs]te|opreste|t[ăa]iem|taie)\b/i
// "Reluăm" — redo the SAME approved take without re-asking for the script.
const RETAKE =
  /(relu[ăa]m\b|retake|reia (dubla|clipul|[îi]nregistrarea)|înc[ăa] o dubl[ăa]|inca o dubla|din nou (dubla|clipul))/i
function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export default function ChatPanel({
  lang,
  isAdmin,
  isDemo = false,
}: {
  readonly lang: Lang
  readonly isAdmin: boolean
  readonly isDemo?: boolean
}) {
  const t = strings(lang)
  // The user's established conversation language. Defaults to the browser
  // locale; refined from what they actually type and persisted per user.
  const [speechLang, setSpeechLang] = useState(() => defaultSpeechLang(lang))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatImage, setChatImage] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Microfonul (intrare) — captează → server (STT) → creier. NU e „voce în front".
  const [listening, setListening] = useState(false)
  // DICTARE LIVE: fraza curentă, cuvânt cu cuvânt, cu efect cinematografic pe
  // bandă cât vorbește Adrian; se golește când fraza pleacă la creier.
  const [liveVoice, setLiveVoice] = useState('')
  // BARGRAF LA INTRAREA ÎN CREIER (Adrian, 10 iul): textul EXACT predat
  // creierului la tura curentă — vine de pe SERVER ({heard}), nu e ecou local.
  const [heard, setHeard] = useState('')
  // TICKER (regulă fixă, 10 iul): durata derulării scalează cu lungimea
  // textului, ca să rămână lizibil — nici prea repede, nici o veșnicie.
  const tickerDur = (s: string): string => `${Math.min(22, Math.max(3.5, s.length / 14))}s`
  // SINTEZĂ RAPIDĂ (Adrian, 10 iul: „dacă pauza e mai mare de gândire, să nu
  // rămână gol în dreptul creierului — sinteză de câteva cuvinte, ține-o până
  // la următorul"). Extrasă INSTANT din {heard} (cererea deja confirmată de
  // server ca predată creierului) — zero latență, nu așteaptă modelul.
  const synthesize = (s: string, maxWords = 8): string => {
    const words = s.trim().split(/\s+/).filter(Boolean)
    return words.length <= maxWords ? s.trim() : `${words.slice(0, maxWords).join(' ')}…`
  }
  // Modul microfon: true = dictare live (streaming WS); cade pe batch dovedit
  // dacă WS-ul pică sau rămâne mut, ca vocea să nu se rupă niciodată.
  const streamModeRef = useRef(true)
  const micRef = useRef<MicHandle | null>(null)
  // Unește bucățile de VOX tăiate la o pauză de gândire (nu de final-de-frază)
  // într-un singur gând, înainte de a-l trimite creierului. Refăcut la fiecare
  // (re)pornire a microfonului — vezi ensureMic mai jos.
  const coalescerRef = useRef<UtteranceCoalescer | null>(null)
  // Amprenta vocală (voiceprint) — restrânge microfonul permanent la vocea lui
  // Adrian. Fără punct de UI, hasVoiceprint() rămâne mereu false: butonul de
  // mai jos e singurul loc din care se poate înrola/reseta profilul.
  const [voiceCalState, setVoiceCalState] = useState<'idle' | 'listening' | 'ok' | 'fail'>('idle')
  const [hasVoicePrint, setHasVoicePrint] = useState(() => hasVoiceprint())
  // Delivery receipt for the CURRENT turn: the server's first stream frame
  // ({turn}) sets it, so a small ✓ shows the message actually arrived.
  const [delivered, setDelivered] = useState(false)
  // Mesaje scrise în timpul unei ture active — vizibile, nu pierdute în coadă.
  const [queued, setQueued] = useState<string[]>([])
  // Adrian, 11 iul: „camera nu a pornit [după restart] — e greșit" → camera
  // pornește IMPLICIT la fiecare încărcare; butonul rămâne pentru oprire.
  const [cameraOn, setCameraOn] = useState(true)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)
  // Attached images (ChatGPT-style composer). Sent to Claude's vision on send.
  // Attachments are images (url = data URL, used for vision), documents
  // (text = the Markdown extracted by MarkItDown, prepended to the message),
  // or — for the ADMIN — ANY raw file (url = data URL, type set): photos,
  // texts, archives, video, everything rides the bridge to Claude.
  const [attachments, setAttachments] = useState<
    { id: string; url: string; name: string; text?: string; type?: string }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Câmpul de scris: un singur click oriunde în bară îl focalizează (zona reală a
  // inputului e îngustă, iar un click „lângă" text nu prindea focus — trebuiau
  // mai multe click-uri). Ref-ul e țintit de handlerul de pe rândul composer.
  const composerInputRef = useRef<HTMLInputElement>(null)
  // Admin promo-scenario recorder: type steps, hit Record, Kelion runs them while
  // the screen + voice are recorded, then it saves an MP4 to Downloads.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioRunning, setScenarioRunning] = useState(false)
  const scenarioRunningRef = useRef(false)
  scenarioRunningRef.current = scenarioRunning
  const scenarioRecRef = useRef<RecordingHandle | null>(null)

  // Bibliotecă de scenarii presetate, apelabilă direct din soft. Selectarea
  // unuia populează textarea cu pașii; apoi înregistrare + rulare ca înainte.
  type ScenarioPreset = { name: string; steps: string }
  const SCENARIO_LIBRARY: ScenarioPreset[] = [
    {
      name: 'Quick greet',
      steps: 'Spune "Bună, sunt Kelion!"\nSpune "Cu ce te pot ajuta azi?"',
    },
    {
      name: 'Product demo',
      steps: 'Spune "Iată cum funcționează Kelionai."\nArată monitorul\nSpune "Pot vorbi, vedea și crea pentru tine."',
    },
    {
      name: 'FAQ',
      steps: 'Spune "Cele mai comune întrebări:"\nSpune "Cât costă?"\nSpune "Cum mă înscriu?"',
    },
  ]
  const [selectedScenario, setSelectedScenario] = useState('')

  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const latestFrameRef = useRef<string | null>(null)
  // Ultimele 4 cadre (Adrian, 11 iul: „camera nu captează 4 cadre pe secundă"
  // + auditul lui Kelion: „trimite un singur cadru în loc de patru — vederea
  // nu e continuă"). Tampon circular; la fiecare tură pleacă TOATE 4.
  const frameBufRef = useRef<string[]>([])
  const coordsRef = useRef<Coords | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Controlerul de abandon al turei în curs — „stop" îl abortează pe loc.
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous guard against overlapping turns. `busy` state lags a render, so
  // two voice utterances firing in the same tick could both start a stream and
  // fragment the reply ("chat starts from several parts"). This ref locks now.
  const inFlightRef = useRef(false)
  // Messages typed WHILE a turn is still streaming. They are queued here
  // instead of being dropped by the in-flight guard (that silent drop is how
  // written messages "never arrived"), and sent as one turn when it finishes.
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
  // A promo TAKE in progress: the owner can cut it mid-take by typing a
  // TAKE_STOP word. lastPromoRef keeps the approved take so "reluăm" re-arms
  // the SAME script + scenes without redoing the approval.
  const takeActiveRef = useRef(false)
  const lastPromoRef = useRef<typeof promoRef.current>(null)
  // True after a turn failed because the connection dropped — used to resume once
  // the browser regains connectivity. retryTextRef holds the message to re-send.
  const offlineRef = useRef(false)
  const retryTextRef = useRef<string | null>(null)
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang

  // Kelion drives the monitor himself (no manual button): a control frame from
  // the stream opens/clears the workspace surface behind the avatar.
  function handleControl(c: ChatControl): void {
    // Delivery receipt: the server's first frame arrived — the message got there.
    if (c.receipt) {
      setDelivered(true)
      return
    }
    // GEST LA COMANDĂ (Adrian, 11 iul: „mișcări comandate la tot ce vreau să
    // facă"): creierul a pus [GEST nume] în răspuns → serverul l-a transformat
    // în cadrul {gest} → regia de mișcare (AvatarModel) execută clipul o dată.
    if (c.gest) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: c.gest }))
      return
    }
    // Cadrul {gesture} al tool-ului server-side — tradus în clipul echivalent.
    if (c.gesture && GESTURE_TO_CLIP[c.gesture]) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: GESTURE_TO_CLIP[c.gesture] }))
      return
    }
    // Bargraf-ul intrării în creier: serverul spune EXACT ce text predă
    // creierului — se afișează pe banda dedicată până la tura următoare.
    if (c.heard !== undefined) {
      setHeard(c.heard)
      return
    }
    // VOCEA CREIERULUI: MP3 gata sintetizat pe server (Chirp 3) — DOAR îl redăm.
    // Cât vorbește, microfonul nu trimite (anti-ecou), dar rămâne de veghe:
    // vocea lui Adrian taie redarea pe loc (barge-in, vezi ensureMic).
    if (c.audio) {
      playVoice(
        c.audio,
        () => micRef.current?.setMuted(true),
        () => micRef.current?.setMuted(false),
      )
      return
    }
    // A SERVER-interpreted device command (the camera/monitor regexes moved off
    // the browser): just execute it. Any spoken ack arrives as normal text.
    if (c.device) {
      const cam = c.device.camera
      if (cam === 'off') setCameraOn(false)
      else if (cam === 'back') {
        setFacing('environment')
        setCameraOn(true)
      } else if (cam === 'front') {
        setFacing('user')
        setCameraOn(true)
      } else if (cam === 'switch') switchCamera()
      else if (cam === 'on') setCameraOn(true)
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
    // Promo pipeline: the APPROVED script arrived — remember it and arm the Rec
    // button with a suggestive file name; the script is performed (spoken) the
    // moment the recording actually starts (see the rec-started listener).
    if (c.promo?.script) armPromo(c.promo)
    if (c.image?.url) setChatImage(c.image.url)
    if (c.doc && c.doc.text.trim()) {
      openWorkspaceDoc(c.doc.title || t.monitorTitle, c.doc.text)
      return
    }
    if (c.card && c.card.items.length > 0) {
      openWorkspaceCard(c.card.title, c.card)
      return
    }
    if (!c.monitor) return
    if (c.monitor.url) openWorkspace(c.monitor.title || t.monitorTitle, c.monitor.url)
    else closeWorkspace()
  }

  // Short on-screen acknowledgement for a local command (camera, etc.).
  function ack(text: string): void {
    setMessages((cur) => [...cur, { role: 'assistant', content: text, ts: Date.now() }])
    suggestFacial(text)
  }

  // Micro-expresia feței, în stil GENTLEMAN (Adrian, 12 iul: „mimică de golan,
  // nu gentleman"). Un domn e COMPUS: fața rămâne neutră IMPLICIT; o expresie
  // apare RAR și DOAR la un sentiment real și clar — niciodată reactiv la
  // fiecare semn de punctuație (mirare la fiecare „!", sprânceană la fiecare
  // „?" — asta arăta agitat). Fără expresie implicită: tăcerea feței e demnă.
  function suggestFacial(text: string): void {
    const s = text.trim()
    if (!s) return
    // Recunoștință caldă, sinceră → un zâmbet reținut.
    if (/\b(mul[țt]umesc|[îi][țt]i mul[țt]umesc|thank you|apreciez|bravo|felicit)\b/i.test(s))
      return pushFacial('warmth')
    // Regret/empatie autentică → expresie blândă.
    if (/\b([îi]mi pare r[ăa]u|regret|condolean|din p[ăa]cate|sympath|my condolences)\b/i.test(s))
      return pushFacial('empathy')
    // Altfel: NICIO expresie — fața compusă, neutră, demnă. (Gesturile de corp
    // și expresiile mai ample vin DOAR la comanda creierului prin [GEST], rar.)
  }

  // The conversation SURVIVES a RELEASE refresh — and ONLY that. The release
  // auto-reload (and the update bar) set a one-shot sessionStorage flag right
  // before reloading; when we mount WITH the flag we restore the saved history
  // so mid-conversation releases stay seamless. Any other arrival — login, new
  // tab, manual refresh — starts with a CLEAN page: Kelion still remembers
  // everything server-side, but old messages never litter a fresh session.
  useEffect(() => {
    if (sessionStorage.getItem('kelion_restore_chat') !== '1') return
    sessionStorage.removeItem('kelion_restore_chat')
    void fetch('/api/chat/history', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((j: { history?: { role?: string; content?: string }[] }) => {
        const h = (j.history ?? [])
          .filter(
            (m): m is { role: 'user' | 'assistant'; content: string } =>
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string' &&
              m.content.trim() !== '',
          )
          .map((m) => ({ role: m.role, content: m.content }))
        if (h.length > 0) setMessages((cur) => (cur.length === 0 ? h : cur))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Claude can WALK IN first (admin only): messages Claude leaves through the
  // bridge are picked up here and shown in chat — already persisted to history
  // by the server. The owner's rule: "când intri, mă strigi" — Claude calls
  // him, not only answers.
  useEffect(() => {
    if (!isAdmin) return
    const id = window.setInterval(() => {
      void fetch('/api/chat/incoming', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((j: { messages?: string[] }) => {
          const arr = j.messages ?? []
          if (arr.length === 0) return
          for (const m of arr) ack(m)
        })
        .catch(() => {})
    }, 8_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

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
        detail: { action: 'arm', name: `kelionai-${slug || 'promo'}-${p.duration}s-${date}` },
      }),
    )
  }

  // The recording actually started (the owner clicked and picked the screen):
  // PERFORM the clip. The script panel closes (the clip never shows the text)
  // and the shot-list scenes appear on the monitor at their times.
  useEffect(() => {
    const onStarted = (): void => {
      const p = promoRef.current
      if (!p) return
      promoRef.current = null
      lastPromoRef.current = p // kept so "reluăm" can redo this exact take
      takeActiveRef.current = true
      closeAllTasks() // the script panel is done — clean frame for the clip
      for (const s of p.scenes ?? []) {
        promoTimersRef.current.push(
          window.setTimeout(() => {
            if (s.close || !s.url) closeAllTasks()
            else openWorkspace(s.title, s.url)
          }, 900 + s.at * 1000),
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
        const ro = speechLangRef.current.toLowerCase().startsWith('ro')
        window.setTimeout(
          () =>
            ack(
              ro
                ? 'Dubla s-a oprit și clipul s-a salvat. Spune „reluăm" pentru încă o dublă cu același scenariu.'
                : 'Take stopped and the clip was saved. Say "retake" to do the same take again.',
            ),
          600,
        )
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

  // A potential customer entering the free trial is welcomed: Kelion greets
  // FIRST, politely, matching the visitor's time of day — spoken and shown.
  // English (the demo's default); he switches the moment the visitor speaks
  // their own language. Deterministic (no AI round-trip): instant and safe.
  useEffect(() => {
    if (!isDemo) return
    const h = new Date().getHours()
    const daypart = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening'
    const id = window.setTimeout(() => {
      ack(
        `${daypart}, and welcome — I'm Kelion, your personal assistant. ` +
          `You have three free minutes with me: ask me anything, in any language.`,
      )
    }, 1500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo])

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
  // Documents (PDF / Word / Excel / PowerPoint / …) are converted to Markdown by
  // the backend (MarkItDown) and attached as text so Kelion can read them. For
  // the ADMIN, a file that can't be converted (archive, video, audio, anything)
  // is kept RAW — it rides the bridge to Claude as-is.
  // The REAL pipe maximum: Cloudflare hard-caps a request at 100MB — one file
  // may fill nearly the whole pipe (~70MB real content as base64).
  const MAX_RAW_FILE = 90_000_000
  async function addDocFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (file.type.startsWith('image/')) continue
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error('read'))
          r.readAsDataURL(file)
        })
        let markdown = ''
        try {
          const resp = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ filename: file.name, data }),
          })
          if (resp.ok) markdown = ((await resp.json()) as { markdown?: string }).markdown ?? ''
        } catch {
          /* conversion unavailable — fall through to raw for admin */
        }
        if (markdown.trim()) {
          setAttachments((cur) => [
            ...cur,
            { id: `${Date.now()}-${file.name}-doc`, url: '', name: file.name || 'document', text: markdown },
          ])
        } else if (isAdmin && data.length <= MAX_RAW_FILE) {
          setAttachments((cur) => [
            ...cur,
            {
              id: `${Date.now()}-${file.name}-raw`,
              url: data,
              name: file.name || 'fisier',
              type: file.type || 'application/octet-stream',
            },
          ])
        }
      } catch {
        /* skip a file that couldn't be read */
      }
    }
  }
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // let the same file be picked again later
    addImageFiles(files.filter((f) => f.type.startsWith('image/')))
    void addDocFiles(files.filter((f) => !f.type.startsWith('image/')))
  }
  // Paste an image straight into the chat (Ctrl+V) or drag-and-drop a file.
  function onPasteFiles(e: ReactClipboardEvent): void {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (imgs.length > 0) {
      e.preventDefault()
      addImageFiles(imgs)
    }
  }
  function onDropFiles(e: ReactDragEvent): void {
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
      await new Promise((r) => globalThis.setTimeout(r, 1200))
    }
    // Let the final sentence finish speaking, then stop + save.
    await new Promise((r) => globalThis.setTimeout(r, 2500))
    handle.stop()
  }
  function stopScenario(): void {
    scenarioRunningRef.current = false
    scenarioRecRef.current?.stop()
    scenarioRecRef.current = null
    setScenarioRunning(false)
  }

  async function send(text: string): Promise<void> {
    const msg = text.trim()
    const atts = attachments
    if (!msg && atts.length === 0) return
    // Admin recorder commands — handled locally, never sent to Claude.
    if (msg && isAdmin) {
      const ro = speechLangRef.current.toLowerCase().startsWith('ro')
      // Mid-take cut: something changed — stop everything; the rec-stopped
      // handler cleans up and offers the retake.
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
          ack(
            ro
              ? `Scenariul salvat era în altă limbă. Spune-mi din nou „fă un clip despre ${saved.subject}" și îl refac în limba curentă.`
              : `The saved script was in another language. Say "make a clip about ${saved.subject}" again and I'll redo it in your language.`,
          )
          setInput('')
          return
        }
        armPromo(saved)
        ack(
          ro
            ? 'Reluăm aceeași dublă — apasă butonul roșu care pulsează și alege ecranul.'
            : 'Same take again — press the pulsing red button and pick the screen.',
        )
        setInput('')
        return
      }
      if (REC_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        ack(
          ro
            ? 'Am oprit înregistrarea — clipul se salvează în Descărcări.'
            : 'Recording stopped — the clip is saving to Downloads.',
        )
        setInput('')
        return
      }
      if (REC_START.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'arm' }))
        ack(
          ro
            ? 'Pregătit de înregistrare. Apasă butonul roșu care pulsează, sus, și alege ecranul.'
            : 'Ready to record. Press the pulsing red button at the top and pick the screen.',
        )
        setInput('')
        return
      }
    }
    // OPRIRE IMEDIATĂ (Adrian, 10 iul: „îi spun stop și mă ignoră, nu primește
    // imediat comanda"). „stop" scris sau vorbit NU se pune în coadă — taie vocea
    // și tura curentă PE LOC, golește coada și închide cererea pe server. Softul
    // NU se rupe: backendul își termină singur tura în fundal; eu doar nu mai
    // aștept și nu mai vorbesc. Se verifică ÎNAINTE de garda „ocupat".
    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (msg && STOP_CMD.test(msg)) {
      stopVoice()
      abortRef.current?.abort()
      pendingSendsRef.current = [] // stop înseamnă stop — golește coada
      setQueued([])
      inFlightRef.current = false
      setBusy(false)
      setLiveVoice('')
      setInput('')
      // Închide cererea/bucla pe server (handlerul de stop din backend).
      void fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }],
          now: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }).catch(() => {})
      ack(speechLangRef.current.toLowerCase().startsWith('ro') ? 'Am oprit.' : 'Stopped.')
      return
    }
    // Camera + monitor commands are interpreted by the SERVER (it sees the open
    // tabs on every turn and answers instantly with a {device} frame, no model
    // call) — nothing to intercept here anymore.
    if (busyRef.current || inFlightRef.current) {
      // A turn is already streaming (it can take minutes). NEVER drop the text
      // silently — queue it; the finally block sends everything queued as the
      // next turn the moment this one ends. Attachment-only sends still wait.
      if (msg) {
        pendingSendsRef.current.push(msg)
        setQueued((cur) => [...cur, msg])
        setInput('')
      }
      return
    }
    inFlightRef.current = true
    setInput('')
    setDelivered(false) // new turn — the ✓ lights only once the server answers
    setAttachments([])
    // Multi-tasking: whatever is on the monitor (a map, a route, a video) STAYS
    // open while you keep chatting — it's only replaced when Kelion shows
    // something new, or closed when you (or Kelion) close it. So the map keeps
    // running in parallel with the conversation until you say to close it.
    // The user's ESTABLISHED language. Detection + the two-in-a-row commit rule
    // run on the SERVER now; a committed switch comes back as a {lang} frame.
    const replyLang = speechLangRef.current
    // An attached image takes priority over the live camera frame for this turn.
    const attached = atts.find((a) => a.url.startsWith('data:image'))?.url
    const image =
      attached ??
      (cameraOnRef.current
        ? (latestFrameRef.current ?? captureRef.current?.() ?? undefined)
        : undefined)
    // Prepend any attached documents (already converted to Markdown) so Kelion
    // reads them as part of this turn.
    const docs = atts.filter((a) => a.text)
    const docBlock = docs.map((d) => `[Document: ${d.name}]\n${d.text}`).join('\n\n')
    const base = msg || (docBlock ? 'Am atașat un document — citește-l și spune-mi ce conține.' : t.imagePrompt)
    const outgoing = docBlock ? `${docBlock}\n\n${base}` : base
    // ADMIN: every raw attachment (photo, arhivă, video, orice) rides the
    // bridge to Claude alongside the text.
    // + VEDEREA CONTINUĂ (Adrian, 11 iul): cu camera pornită, pleacă ULTIMELE
    // 4 CADRE (≈ultima secundă la 4 fps), nu unul singur — Kelion vede
    // mișcarea, nu o clipă înghețată. Pentru TOȚI userii (regula nr. 9):
    // adminului îi merg pe punte ca files, publicului ca `images` (serverul
    // le face fișiere de job în cutia publică).
    const camFrames = cameraOnRef.current && !attached ? frameBufRef.current.slice(-4) : []
    const adminFiles = isAdmin
      ? [
          ...atts
            .filter((a) => a.url.startsWith('data:'))
            .map((a) => ({ name: a.name, type: a.type ?? 'image/png', data: a.url })),
          ...camFrames.map((url, i) => ({ name: `cadru-${i + 1}.jpg`, type: 'image/jpeg', data: url })),
        ]
      : []
    const bridgeFiles = adminFiles.length > 0 ? adminFiles : undefined

    // Features vocale colectate de la ultima frază vorbită (dictare live sau batch).
    const voiceFeatures = getPendingVoiceFeatures() ?? undefined
    clearPendingVoiceFeatures()

    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing, ts: Date.now() }]
    setMessages([...next, { role: 'assistant', content: '', ts: Date.now() }])
    setChatImage(null) // a new turn clears any previously shown image
    // Controlerul de abandon al ACESTEI ture — „stop" îl abortează pe loc.
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    let acc = ''
    try {
      const wsNow = getWorkspace()
      const screen = wsNow.open
        ? wsNow.tasks.map((tk) => ({ kind: tk.kind, title: tk.title, active: tk.id === wsNow.activeId }))
        : undefined
      for await (const chunk of streamChat(
        next,
        image ?? undefined,
        coordsRef.current ?? undefined,
        handleControl,
        screen,
        bridgeFiles,
        ac.signal,
        Boolean(attached), // poză lipită/încărcată explicit — analiză fără condiție
        // Vederea continuă pentru TOȚI userii (regula nr. 9): ultimele 4 cadre.
        // Adminul le trimite deja ca files pe punte — nu le dublăm în corp.
        !isAdmin && camFrames.length > 0 ? camFrames : undefined,
        voiceFeatures,
      )) {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc, ts: Date.now() }])
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
      else suggestFacial(acc) // fața însoțește tonul replicii încheiate
    } catch (err) {
      if (ac.signal.aborted) {
        // OPRIT de Adrian — fără mesaj de eroare; textul deja afișat rămâne așa.
      } else {
        // Nu lăsa vocea să spună mai mult decât s-a scris (bug 10 iul: scrisul
        // dispărea la eroare, dar audio-ul continua).
        stopVoice()
        const code = err instanceof Error ? err.message : 'error'
        const spoken = strings(resolveLang(replyLang))
        const m =
          code === 'brain_not_configured'
            ? t.brainNotActive
            : code === 'offline'
              ? spoken.offline
              : t.brainError
        // PĂSTREAZĂ textul deja primit (nu-l arunca) — doar adaugă o notă discretă,
        // ca scrisul să rămână complet față de ce s-a auzit.
        setMessages([
          ...next,
          { role: 'assistant', content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`, ts: Date.now() },
        ])
        if (code === 'offline') {
          offlineRef.current = true
          retryTextRef.current = msg // resume THIS message when the signal returns
        }
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      inFlightRef.current = false
      setBusy(false)
      // Anything written during this turn was queued, not lost — combine it and
      // start the next turn with it (a beat later, so this one fully unwinds).
      if (pendingSendsRef.current.length > 0) {
        const combined = pendingSendsRef.current.join('\n')
        pendingSendsRef.current = []
        setQueued([])
        window.setTimeout(() => void sendRef.current(combined), 50)
      }
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send

  // Microfonul e PERMANENT ON: pornește singur la intrare și se redeschide
  // singur când pista moare (apel telefonic, căști Bluetooth scoase, alt app ia
  // microfonul) sau când tabul redevine vizibil. Butonul rămâne doar ca pauză
  // manuală — singurul caz în care microfonul stă oprit intenționat.
  const micManualOffRef = useRef(false)
  const micStartingRef = useRef(false)
  const micRetryRef = useRef<number | null>(null)
  const micBackoffRef = useRef(1000)

  const onMicErr = (reason: string): void => {
    micRef.current = null
    coalescerRef.current?.cancel()
    setListening(false)
    setLiveVoice('')
    if (reason === 'not-allowed' || reason === 'unsupported') return
    micRetryRef.current = window.setTimeout(() => void ensureMicRef.current(), micBackoffRef.current)
    micBackoffRef.current = Math.min(micBackoffRef.current * 2, 15_000)
  }

  async function ensureMic(): Promise<void> {
    if (micRef.current || micStartingRef.current || micManualOffRef.current) return
    if (micRetryRef.current) {
      window.clearTimeout(micRetryRef.current)
      micRetryRef.current = null
    }
    micStartingRef.current = true

    // Adrian, 11 iul: „la restart butonul microfon se blochează / se
    // dezactivează". Cauza: dacă pornirea arunca o excepție, flagul „pornesc
    // acum" rămânea agățat pe true pentru totdeauna → fiecare apăsare cădea pe
    // ramura de OPRIRE (nimic de oprit) și butonul părea mort. try/finally
    // garantează eliberarea flagului pe ORICE drum de ieșire.
    try {
      // ── DICTARE LIVE (streaming): fiecare cuvânt apare pe bandă instant, se
      // validează când e confirmat, iar la o PAUZĂ > 3s fraza pleacă la creier
      // (ordinul lui Adrian, 10 iul). Dacă WS-ul pică sau rămâne mut, cădem O DATĂ
      // pe calea batch dovedită — vocea nu se rupe niciodată.
      if (streamModeRef.current) {
        const sh = await startMicStream({
          onLive: (t) => setLiveVoice(t),
          onPhrase: (t) => {
            setLiveVoice('')
            void sendRef.current(t)
          },
          onError: (reason) => {
            if (reason === 'ws' || reason === 'failed' || reason === 'silent' || reason === 'unsupported') {
              // streamingul nu merge → treci pe batch pentru restul sesiunii
              streamModeRef.current = false
              micRef.current?.stop()
              micRef.current = null
              setListening(false)
              setLiveVoice('')
              micStartingRef.current = false
              void ensureMicRef.current()
              return
            }
            onMicErr(reason)
          },
          getLang: () => speechLangRef.current,
          onBargeIn: () => {
            stopVoice()
            micRef.current?.setMuted(false)
          },
        })
        if (sh) {
          // Apăsat OPRIT cât porneam, sau altă pornire a instalat deja un
          // microfon — respectă starea existentă, nu instala peste ea.
          if (micManualOffRef.current || micRef.current) {
            sh.stop()
            return
          }
          micRef.current = sh
          micBackoffRef.current = 1000
          setListening(true)
          if (isVoicePlaying()) sh.setMuted(true)
        }
        return
      }

      // ── BATCH (dovedit): înregistrează fraza, o transcrie la /api/asr. ──
      coalescerRef.current = createUtteranceCoalescer((text) => void sendRef.current(text))
      const h = await startMic(
        (text) => coalescerRef.current?.push(text),
        onMicErr,
        () => speechLangRef.current,
        // BARGE-IN (ordinul lui Adrian): când i se aude vocea peste Kelion,
        // vocea lui Kelion se taie PE LOC și microfonul revine să-l asculte.
        () => {
          stopVoice()
          micRef.current?.setMuted(false)
        },
        // „doar vocea mea sau scrisul meu, nu se acceptă alta" — adminul e singurul
        // rol restrâns la vocea proprie calibrată; demo (vizitatori) rămâne neschimbat.
        isAdmin,
      )
      if (h) {
        // Apăsat OPRIT cât porneam, sau altă pornire a instalat deja un
        // microfon — respectă starea existentă, nu instala peste ea.
        if (micManualOffRef.current || micRef.current) {
          h.stop()
          return
        }
        micRef.current = h
        micBackoffRef.current = 1000
        setListening(true)
        // Repornit cât încă vorbește creierul: pornește mut (anti-ecou); revine
        // singur la finalul redării, ca la orice replică.
        if (isVoicePlaying()) h.setMuted(true)
      }
    } finally {
      micStartingRef.current = false
    }
  }
  const ensureMicRef = useRef(ensureMic)
  ensureMicRef.current = ensureMic

  function toggleMic(): void {
    // Adrian, 11 iul: „butonul microfon nu funcționează corect". Cauza: pornirea
    // e asincronă (~0,5–2s); o apăsare în fereastra aia nu găsea încă micRef
    // și cădea pe ramura de PORNIRE — adică oprirea era imposibil de exprimat
    // cât timp boot-ul era în zbor, iar dublu-click lăsa microfonul mereu
    // aprins. Acum: apăsat în timpul pornirii = OPRIRE (manualOff), iar
    // ensureMic verifică manualOff după fiecare await înainte să instaleze.
    if (micRef.current || micStartingRef.current) {
      micManualOffRef.current = true
      // Eliberează și flagul de pornire: dacă boot-ul chiar e în zbor, vede
      // manualOff la final și se oprește singur; dacă flagul era agățat dintr-o
      // eroare veche, butonul se vindecă aici în loc să rămână mort.
      micStartingRef.current = false
      micRef.current?.stop()
      micRef.current = null
      // oprire intenționată: un fragment agățat NU trebuie trimis după teardown
      coalescerRef.current?.cancel()
      setListening(false)
      return
    }
    micManualOffRef.current = false
    void ensureMicRef.current()
  }

  // Permanent hearing: pornește la montare, revine când tabul redevine vizibil
  // (browserele opresc captarea în fundal), curăță tot la demontare.
  useEffect(() => {
    void ensureMicRef.current()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void ensureMicRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
      micRef.current?.stop()
      micRef.current = null
      coalescerRef.current?.cancel()
      stopVoice()
    }
  }, [])

  // Cât ascultă, ecranul nu adoarme — un telefon cu ecranul stins își taie
  // microfonul, iar „permanent on" ar muri la primul screen-off.
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

  // Connectivity recovery: after a turn failed offline, resume the moment the
  // browser regains a connection. Each request is independent, so the next
  // message just works.
  useEffect(() => {
    const onOnline = (): void => {
      if (!offlineRef.current) return
      offlineRef.current = false
      const retry = retryTextRef.current
      retryTextRef.current = null
      if (retry) {
        // Resume from where we were cut off: drop the failed user+error bubbles
        // and re-send, so Kelion answers the message that got interrupted.
        setMessages((cur) => cur.slice(0, -2))
        window.setTimeout(() => void sendRef.current(retry), 400)
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Load the user's persisted speech language (localStorage instantly, then the
  // server which follows the user across devices). Auto-detection still refines
  // it from what's actually spoken/typed.
  // A free-trial (demo) visitor is a STRANGER: never inherit a language another
  // person left on this browser — the demo always starts in English (the app's
  // base language) and only switches when THIS visitor clearly uses another.
  useEffect(() => {
    if (isDemo) return
    const apply = (code: string | null): void => {
      if (!code || code === speechLangRef.current) return
      speechLangRef.current = code
      setSpeechLang(code)
    }
    const local = loadLocalLang()
    apply(local)
    void loadServerPrefs().then((serverPrefs) => {
      if (!serverPrefs) return
      apply(serverPrefs.speechLang)
      // Server is the cross-device source of truth: if the local mirror is stale
      // (e.g. left over from an earlier mis-detection), correct it.
      if (serverPrefs.speechLang && serverPrefs.speechLang !== local) mirrorLang(serverPrefs.speechLang)
    })
  }, [isDemo])

  // Permanent vision — camera ON by default. The camera is switched by voice/
  // text command (no button), so no need to probe for a second camera here.
  useEffect(() => {
    if (cameraSupported()) setCameraOn(true)
  }, [])

  // Permanent device GPS for the location-aware skills. Runs independently of the
  // camera so "weather/where am I/near me" works even with the camera off. The
  // latest fix is sent with each chat turn; the backend resolves the place name.
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Captură la 4 cadre/s PERMANENT (Adrian, 11 iul — vechiul ritm de 1 fps pe
  // loc lăsa vederea discontinuă; GPS-ul în casă nu detectează mișcare, deci
  // rămânea veșnic pe 1). În mișcare urcă până la 8 fps. Cadrele se strâng în
  // tamponul circular (ultimele 4); pleacă la creier doar la o tură — trimiterea
  // continuă rămâne interzisă de cost.
  useEffect(() => {
    if (!cameraOn) return
    let timer: number | null = null
    let watchId: number | null = null
    let fps = 4
    let last: { lat: number; lon: number; t: number } | null = null

    const tick = (): void => {
      const f = captureRef.current?.()
      if (f) {
        latestFrameRef.current = f
        const b = frameBufRef.current
        b.push(f)
        if (b.length > 4) b.shift()
      }
    }
    const arm = (): void => {
      if (timer) globalThis.clearInterval(timer)
      timer = globalThis.setInterval(tick, Math.round(1000 / fps))
    }
    arm()

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, speed } = pos.coords
          let mps = typeof speed === 'number' && speed >= 0 ? speed : 0
          if (!mps && last) {
            const dt = (pos.timestamp - last.t) / 1000
            if (dt > 0) mps = metersBetween(last.lat, last.lon, latitude, longitude) / dt
          }
          last = { lat: latitude, lon: longitude, t: pos.timestamp }
          const next = mps < 0.5 ? 4 : Math.min(8, 4 + Math.floor(mps / 2))
          if (next !== fps) {
            fps = next
            arm()
          }
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
      )
    }

    return () => {
      if (timer) globalThis.clearInterval(timer)
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId)
      // Cameră oprită → tamponul se golește (cadre vechi nu au voie să apară
      // într-o tură de mai târziu, după repornire).
      frameBufRef.current = []
    }
  }, [cameraOn])

  // Close the functions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  function toggleCamera(): void {
    setCameraOn((v) => !v)
  }
  function switchCamera(): void {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'))
  }
  function onCameraError(): void {
    setCameraOn(false)
  }

  // Calibrare voiceprint: 3s de captat vocea lui Adrian, apoi profilul se
  // salvează local (audioIO.ts) și microfonul permanent începe să-l filtreze.
  async function calibrateVoice(): Promise<void> {
    if (voiceCalState === 'listening') return
    setVoiceCalState('listening')
    const ok = await calibrateVoiceprint(3000)
    setHasVoicePrint(hasVoiceprint())
    setVoiceCalState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setVoiceCalState('idle'), 2000)
  }
  function resetVoicePrint(): void {
    clearVoiceprint()
    setHasVoicePrint(false)
  }
  // AUTOMAT (Adrian, 12 iul: „ăla cu butonul se face automat"): recunoașterea
  // vocii nu mai cere click. Când adminul intră și n-are încă amprentă, o
  // calibrăm SINGURI (din primele secunde de vorbire); dacă nu prinde (liniște),
  // reîncearcă până reușește. Butonul manual a fost scos.
  useEffect(() => {
    if (!isAdmin || hasVoicePrint || voiceCalState !== 'idle') return
    const id = window.setTimeout(() => void calibrateVoice(), 1500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, hasVoicePrint, voiceCalState])

  // When the MONITOR shows content, the centre chat bubbles would cover it —
  // so Kelion's words move to a slim black bar just above the composer instead.
  const wsOpen = useSyncExternalStore(subscribeWorkspace, getWorkspace).open
  // Monitor mode = a surface is open OR the brain is executing live. In EITHER
  // case the chat collapses to the slim black bar above the composer so nothing
  // covers the monitor (Adrian's rule). `working` follows the live-work console.
  const monitorBusy = useSyncExternalStore(subscribeWorkspace, isMonitorWorking)
  const monitorMode = wsOpen || monitorBusy
  // Show the CURRENT exchange in writing: the user's request (so he sees it
  // arrived correctly the instant he types) AND Kelion's reply, which updates
  // live as it streams — not just one sentence.
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
  const hint = t.chatHint
  // Butonul din dreapta ține DOAR de chatul SCRIS. Ai ceva de trimis (text sau
  // fișier atașat) → e activ. Câmpul gol → chatul e AUDIO (microfonul e mereu
  // pornit, vocea intră singură), deci butonul rămâne o săgeată neutră, NU un
  // pătrat-stop mort. Pătratul ■ apare NUMAI când chiar ai text de stivuit peste
  // o tură în curs (atunci click = îl pui în coadă, nu întrerupe nimic).
  const hasDraft = input.trim().length > 0 || attachments.length > 0
  const queueing = busy && hasDraft

  return (
    <div className="chat">
      <CameraView
        active={cameraOn}
        facing={facing}
        onError={onCameraError}
        captureRef={captureRef}
      />
      {/* FĂRĂ BULE ÎN CENTRU (Adrian, 11 iul: „tot ce e chat trebuie să fie în
          spațiul unde apare semnul de creier... nu se mai afișează în afara
          spațiului de acolo răspunsurile de chat"). Bulele care pluteau peste
          monitor au fost SCOASE — schimbul de replici trăiește exclusiv în
          benzile de lângă composer (👤 tu / K Kelion, teletext). În centru
          rămân doar îndemnul de start și imaginile generate. */}
      {!monitorMode && (
        <div className="chat-log">
          {messages.length === 0 && <p className="chat-hint">{hint}</p>}
          {chatImage && (
            <img className="chat-image" src={chatImage} alt="Kelion generated" />
          )}
        </div>
      )}
      {scenarioRunning && <p className="scenario-live">● {t.scenarioRecording}</p>}
      {isAdmin && scenarioOpen && (
        <div className="scenario-panel">
          <div className="scenario-head">
            <span>{t.scenarioTitle}</span>
            <button type="button" className="ghost" onClick={() => setScenarioOpen(false)}>
              ✕
            </button>
          </div>
          <select
            className="scenario-select"
            value={selectedScenario}
            onChange={(e) => {
              const name = e.target.value
              setSelectedScenario(name)
              const preset = SCENARIO_LIBRARY.find((s) => s.name === name)
              if (preset) setScenarioText(preset.steps)
            }}
          >
            <option value="">{t.scenarioPick}</option>
            {SCENARIO_LIBRARY.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <textarea
            className="scenario-text"
            value={scenarioText}
            onChange={(e) => {
              setScenarioText(e.target.value)
              if (selectedScenario) setSelectedScenario('')
            }}
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
        {/* DICTARE LIVE cu efect cinematografic (ca în filmele cu AI): pe măsură
            ce Adrian vorbește, fraza apare cuvânt cu cuvânt, cu cursor care
            clipește; la pauză > 3s pleacă la creier și banda se golește. */}
        {/* REGULĂ FIXĂ (Adrian, 10 iul: „nu vreau să văd pe interfață ceva ce
            acoperă pagina — textul curge ca teletextul, pe o singură linie"):
            ORICE bandă live e o linie fixă, text pe o singură linie, care
            derulează (teletext) dacă nu încape — NICIODATĂ nu crește pe
            verticală, niciodată nu acoperă pagina. */}
        {liveVoice && (
          <div className="voice-live" aria-live="polite">
            <span className="voice-live-dot" />
            <span className="ticker">
              <span
                className="ticker-text"
                key={liveVoice}
                style={{ '--ticker-dur': tickerDur(liveVoice) } as CSSProperties}
              >
                {liveVoice}
              </span>
            </span>
            <span className="voice-live-caret" />
          </div>
        )}
        {/* O SINGURĂ BANDĂ, AMBELE SENSURI (Adrian, 11 iul seara: „aici
            trebuiesc baleiate dinspre creier și înspre creier — în afară de
            asta nu se mai afișează chat scris"). Aceeași bandă de la creier
            își schimbă semnul după faza turei: 👤 = mesajul tău pleacă
            ÎNSPRE creier (dispare la preluare — „după ce ai baleiat ce am
            scris, nu se mai afișează"); 🧠 = creierul l-a primit și gândește
            (arată ce a auzit efectiv — confirmat de server, nu ecou local);
            K = răspunsul curge DINSPRE creier (coada textului cât streamează,
            teletext când e terminat). Un rând, mereu, nimic în afara ei. */}
        {busy && !delivered && lastUser?.content ? (
          <div className="heard-band user-band" aria-live="polite">
            <span className="heard-band-label" title="Tu — înspre creier">👤</span>
            <span className="ticker">
              <span
                className="ticker-text"
                key={lastUser.content}
                style={{ '--ticker-dur': tickerDur(lastUser.content) } as CSSProperties}
              >
                {lastUser.content.slice(0, 400)}
              </span>
            </span>
          </div>
        ) : busy && !lastAssistant?.content ? (
          <div className="heard-band" aria-live="polite">
            <span className="heard-band-label" title="Creierul a primit și gândește">🧠</span>
            <span className="ticker">
              <span
                className="ticker-text"
                key={heard || '…'}
                style={{ '--ticker-dur': tickerDur(heard || '…') } as CSSProperties}
              >
                {heard ? `„${heard}"` : '…'}
              </span>
            </span>
          </div>
        ) : lastAssistant?.content || busy ? (
          <div className="heard-band kelion-band" aria-live="polite">
            <span className="heard-band-label kelion-k" title="Kelion — dinspre creier">K</span>
            {busy ? (
              <span className="speech-tail">
                <span className="speech-tail-text">
                  {lastAssistant?.content || (heard ? synthesize(heard) : '…')}
                </span>
              </span>
            ) : (
              <span className="ticker">
                <span
                  className="ticker-text"
                  key={lastAssistant?.content ?? ''}
                  style={{ '--ticker-dur': tickerDur(lastAssistant?.content ?? '') } as CSSProperties}
                >
                  {lastAssistant?.content}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {/* SCOS (ordin Adrian, 10 iul: „scoate chestia aia microphone is muted,
            că e greșită" + „microfon cu autovox, instant"): microfonul nu mai
            stă mut până la calibrare — amprenta se învață AUTOMAT din primele
            fraze (audioIO.ts, auto-înrolare), deci indiciul era fals. */}
        {attachments.length > 0 && (
          <div className="composer-atts">
            {attachments.map((a) => (
              <div className="att-chip" key={a.id}>
                <img src={a.url} alt={a.name} />
                <button
                  type="button"
                  className="att-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Remove"
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
              <span className="ticker-text" key={queued.join('|')} style={{ '--ticker-dur': tickerDur(queued.join(' · ')) } as CSSProperties}>
                {queued.map((q, i) => (
                  <span key={i} className="queued-chip">{q.slice(0, 80)}{i < queued.length - 1 ? ' · ' : ''}</span>
                ))}
              </span>
            </span>
          </div>
        )}
        <div
          className="composer-row"
          onMouseDown={(e) => {
            // Un click oriunde în bară (în afara butoanelor și a inputului însuși)
            // focalizează câmpul de scris DIN PRIMA — gata cu clickurile multiple.
            const el = e.target as HTMLElement
            if (el.closest('button') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
            composerInputRef.current?.focus()
          }}
        >
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
                <button type="button" className="fn-item" onClick={openFilePicker}>
                  <span className="ico">📎</span>
                  {t.attachTitle}
                </button>
                {cameraSupported() && (
                  <button type="button" className="fn-item" onClick={toggleCamera}>
                    <span className="ico">{cameraOn ? '🔌' : '📷'}</span>
                    {cameraOn ? t.disconnectCamTitle : t.connectCamTitle}
                    {cameraOn && <span className="dot" />}
                  </button>
                )}
                {/* No monitor or camera-switch buttons: Kelion opens the monitor on
                    his own (show_on_screen), and the camera is switched by text
                    command ("switch camera", "comută camera", "camera spate"). */}
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
                {/* Butonul „Recunoaște-mi vocea" a fost SCOS (Adrian, 12 iul):
                    calibrarea e acum automată (vezi useEffect de mai sus). */}
                {isAdmin && hasVoicePrint && voiceCalState === 'idle' && (
                  <button type="button" className="fn-item" onClick={resetVoicePrint}>
                    <span className="ico">♻️</span>
                    {t.calibrateVoiceReset}
                  </button>
                )}
              </div>
            )}
          </div>
          <input
            ref={composerInputRef}
            className="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteFiles}
            onDrop={onDropFiles}
            onDragOver={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Textul scris are PRIORITATE peste vocea in asteptare (Adrian,
                // 11 iul: mesaje scrise pierdute — nu lasa un fragment de voce
                // sa sara inaintea textului). Coalescerul se anuleaza, nu flush.
                coalescerRef.current?.cancel()
                void send(input)
              }
            }}
            placeholder={t.chatPlaceholder}
          />
          <button
            type="button"
            className={`composer-mic ${listening ? 'live' : ''}`}
            onClick={toggleMic}
            aria-label="Microfon"
            title={listening ? 'Oprește microfonul' : 'Vorbește (microfon)'}
          >
            {listening ? '●' : '🎤'}
          </button>
          <button
            type="button"
            className={`composer-send ${queueing ? 'queueing' : ''}`}
            onClick={() => {
              // Textul scris are PRIORITATE: anulăm vocea în așteptare,
              // nu o trimitem înaintea textului (bug mesaje scrise pierdute).
              coalescerRef.current?.cancel()
              void send(input)
            }}
            // Activ cât ai ceva SCRIS de trimis. Câmpul gol (chat audio) → rămâne
            // săgeată neutră, dezactivată — nu un pătrat-stop mort. Un text trimis
            // în timp ce Kelion răspunde NU întrerupe tura: se pune în coadă
            // (send() îl stivuiește) și pleacă imediat ce tura se termină.
            disabled={!hasDraft}
            aria-label={queueing ? 'Pune în coadă' : t.send}
            title={
              queueing
                ? 'Se procesează — mesajul tău se pune în coadă, nu întrerupe'
                : t.send
            }
          >
            {queueing ? '■' : '↑'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.html,.htm,.json,.xml,.rtf,.epub"
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
