import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { strings, resolveLang, type Lang } from '../lib/i18n'
import {
  enqueueSpeech,
  stopSpeaking,
  isSpeaking,
  startContinuous,
  speechSupported,
  setOnSpeakingChange,
  type ContinuousHandle,
} from '../lib/voice'
import CameraView from './CameraView'
import MicMeter from './MicMeter'
import { cameraSupported, type Facing } from '../lib/camera'
import { defaultSpeechLang, detectLangFromText } from '../lib/languages'
import { detectLanguageFromMic } from '../lib/langDetect'
import { startFullDuplex, type FullDuplexHandle, type VoiceStatus } from '../lib/fullDuplexVoice'
import { loadLocalLang, loadServerLang, saveLang } from '../lib/prefs'
import { correctTranscript } from '../lib/correct'
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

// Promo scenario recording: hard cap so a clip never runs away (a short clip is
// ~15s; a full landing demo can use the whole window).
const SCENARIO_MAX_MS = 60_000

// "Hey Kelion" wake word (interim — Web Speech transcript match; the spec's
// low-power engine is Picovoice Porcupine). Accepts the documented variants.
const WAKE = /\b(hey\s+|hei\s+)?(kelion|kelian|kelyon|hey\s*k(ey)?)\b/i
// Spoken interrupt while Kelion is talking (barge-in).
const STOP = /\b(stop|stai|opre[sș]te|opreste|gata|taci|destul)\b/i
// "Close the monitor" — a map/route/video stays open across turns (multi-tasking),
// so closing it must be instant and language-agnostic, never dependent on the
// model calling a tool. The ✕ on the monitor is the universal fallback; this
// catches the spoken/typed command in the languages the user actually uses.
// NB: Unicode lookbehind, not \b — JS \b is ASCII-only and never matches before
// "î", so the spoken "închide" (real diacritics from Chirp STT) was dead.
const CLOSE_VERB =
  /(?<![\p{L}\p{N}])(închide|inchide|închid|ascunde|opre[șs]t[eiî]|close|hide|dismiss|cierra|cerrar|ferme|fermer|schlie[sß]|закро)\w*/iu
const SCREEN_NOUN =
  /\b(harta|hart[ăa]|ecran\w*|monitor\w*|map|screen|video|imagin\w*|image|fereastr\w*|window|pagin\w*|page|asta|aceasta|acesta|it|that|tot)\b/i
// "Switch to <task>" — jump between already-open monitor tabs (map ⇄ youtube ⇄
// weather…) with one voice. Narrow verbs only, so "arată-mi harta Romei" (new
// content) still reaches Kelion; a bare switch just changes the active surface.
const SWITCH_VERB =
  /(?<![\p{L}\p{N}])(comut[ăa]?|treci|revino|switch|schimb[ăa]\s+la|mergi\s+la|back\s+to|înapoi\s+la|inapoi\s+la)(?![\p{L}])/iu
const CLOSE_ALL = /\b(tot|totul|toate|everything|all)\b/i
// Admin voice control for the promo recorder. START arms the Rec button (the
// browser REQUIRES one real click to pick the screen — no voice can skip that);
// STOP is fully hands-free. Kelion confirms both out loud.
// NB: no \b before "î" — JS word boundaries are ASCII-only, so \bî never
// matches and the spoken "înregistrează" would sail through to Claude.
const REC_STOP =
  /\b(opre[șs]te|opreste|stop|termin[ăa]|gata)\b.{0,12}([îi]nregistr|record|rec\b)/i
const REC_START =
  /([îi]nregistreaz[ăa]|porne[șs]te\s+[îi]nregistrarea|start\s+record\w*|record\s+(the\s+)?screen|filmeaz[ăa])/i
// During a promo TAKE the mic stays open ONLY for these (narrow on purpose —
// "gata"/"destul" could appear inside a promo script; these can't).
const TAKE_STOP = /\b(stop|stai|opre[șs]te|opreste|t[ăa]iem|taie)\b/i
// "Reluăm" — redo the SAME approved take without re-asking for the script.
const RETAKE =
  /(relu[ăa]m\b|retake|reia (dubla|clipul|[îi]nregistrarea)|înc[ăa] o dubl[ăa]|inca o dubla|din nou (dubla|clipul))/i
// Map words the user says to a monitor task kind (the tab to switch/close).
function taskKindFromText(msg: string): string | null {
  if (/\b(hart[ăa]|harta|map|rut[ăa]|ruta|traseu\w*|route|directions|navigat\w*)\b/i.test(msg))
    return 'map'
  if (/\b(youtube|video\w*|clip\w*|film\w*|melodi\w*|pies[ăa]|muzic\w*|song)\b/i.test(msg))
    return 'youtube'
  if (/\b(meteo|vreme\w*|vremea|weather|windy)\b/i.test(msg)) return 'weather'
  if (/\b(imagin\w*|poz[ăa]\w*|poza|image|picture)\b/i.test(msg)) return 'image'
  if (/\b(pagin\w*|pagina|site\w*|web|articol\w*|page)\b/i.test(msg)) return 'web'
  if (/\b(document\w*|documentul|text\w*|textul|email\w*|emailul|scrisoare\w*|nota|notă)\b/i.test(msg))
    return 'doc'
  return null
}
const IDLE_MS = 60_000 // back to standby after this much silence (spec: ~1 min)
// Below this recognizer confidence, clean the transcript with Gemini before it
// reaches Claude (the spec's transcript-validation layer). Above it, pass
// straight through to keep latency low.
const CONF_MIN = 0.85

function lastSentenceEnd(s: string): number {
  const re = /[.!?…]["'”’)\]]?\s/g
  let end = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) end = m.index + m[0].length
  return end
}

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
  // Speech language (recognition + Kelion's voice). Defaults to the browser
  // locale; the user can switch to any supported language in the ⊕ menu.
  const [speechLang, setSpeechLang] = useState(() => defaultSpeechLang(lang))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatImage, setChatImage] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Delivery receipt for the CURRENT turn: the server's first stream frame
  // ({turn}) sets it, so a small ✓ shows the message actually arrived.
  const [delivered, setDelivered] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  // Autoplay-blocked banner: after a release auto-refresh the browser mutes
  // audio until the first gesture — this tells Adrian ONE touch brings it back.
  const [audioLocked, setAudioLocked] = useState(false)
  const [awake, setAwake] = useState(false) // post wake-word active conversation
  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  // Voice capture status — drives the "Recording" indicator shown while the
  // signal is down and we're holding the user's speech locally (GSM loss).
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('online')
  // Attached images (ChatGPT-style composer). Sent to Claude's vision on send.
  // Attachments are images (url = data URL, used for vision), documents
  // (text = the Markdown extracted by MarkItDown, prepended to the message),
  // or — for the ADMIN — ANY raw file (url = data URL, type set): photos,
  // texts, archives, video, everything rides the bridge to Claude.
  const [attachments, setAttachments] = useState<
    { id: string; url: string; name: string; text?: string; type?: string }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Admin promo-scenario recorder: type steps, hit Record, Kelion runs them while
  // the screen + voice are recorded, then it saves an MP4 to Downloads.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioRunning, setScenarioRunning] = useState(false)
  const scenarioRunningRef = useRef(false)
  scenarioRunningRef.current = scenarioRunning
  const scenarioRecRef = useRef<RecordingHandle | null>(null)

  const contRef = useRef<ContinuousHandle | null>(null)
  const fdRef = useRef<FullDuplexHandle | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const latestFrameRef = useRef<string | null>(null)
  const coordsRef = useRef<Coords | null>(null)
  const idleRef = useRef<number | null>(null)
  // Refs mirror state for the always-on voice callback (registered once).
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut
  const awakeRef = useRef(awake)
  awakeRef.current = awake
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Synchronous guard against overlapping turns. `busy` state lags a render, so
  // two voice utterances firing in the same tick could both start a stream and
  // fragment the reply ("chat starts from several parts"). This ref locks now.
  const inFlightRef = useRef(false)
  // Messages typed/spoken WHILE a turn is still streaming. They are queued here
  // instead of being dropped by the in-flight guard (that silent drop is how
  // written messages "never arrived"), and sent as one turn when it finishes.
  const pendingSendsRef = useRef<string[]>([])
  // Invisible speech accumulation: rapid utterances (you speaking fast, or the mic
  // splitting one sentence into pieces on a short pause) are buffered here and
  // handed to Kelion as ONE coherent message after a brief gap — so he never
  // answers fragments and nothing is lost. Entirely behind the scenes.
  const heardBufRef = useRef<string[]>([])
  const heardTimerRef = useRef<number>(0)
  const HEARD_GAP_MS = 700
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
  // A promo TAKE in progress: the mic stays OPEN through the narration so the
  // owner can cut it mid-take ("stop"/"tăiem") — only TAKE_STOP words are
  // honoured, everything else heard during a take is discarded, so Kelion's own
  // narration can never become a turn. lastPromoRef keeps the approved take so
  // "reluăm" re-arms the SAME script + scenes without redoing the approval.
  const takeActiveRef = useRef(false)
  const lastPromoRef = useRef<typeof promoRef.current>(null)
  // A turn is "active" from the moment Kelion starts producing a reply until the
  // reply is fully spoken. The mic is muted for that whole window (see syncMic) —
  // this is the single, structural anti-echo: the mic captures nothing while
  // Kelion thinks or talks, so his own voice can never become a second turn.
  const turnActiveRef = useRef(false)
  // True after a turn failed because the connection dropped — used to resume once
  // the browser regains connectivity. retryTextRef holds the message to re-send.
  const offlineRef = useRef(false)
  const retryTextRef = useRef<string | null>(null)
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  // Once the user has an established language (stored pref, or one actively
  // detected/chosen), the noisy startup mic auto-detect must NOT override it —
  // the spec requires the detected language to persist, not flip every load.
  const langPinnedRef = useRef(false)
  // A language switch is committed/persisted only after the SAME new language is
  // seen on two messages in a row — franc mis-reads diacritic-less Romanian as
  // Spanish/Italian, so a one-off detection must never flip the remembered voice.
  const pendingLangRef = useRef<string | null>(null)
  const pendingCountRef = useRef(0)

  // Single source of truth for the mic's mute state (both the full-duplex and the
  // Web-Speech channels). The mic is muted whenever a reply is in progress OR
  // Kelion is speaking — i.e. the whole turn — and open only while waiting for the
  // user. Called whenever either of those two facts changes.
  function syncMic(): void {
    // During a promo take the mic STAYS OPEN even while Kelion narrates, so the
    // owner can cut the take by voice; the heard handlers discard everything
    // except the stop words, so the narration echo can't start a turn.
    const mute = !takeActiveRef.current && (turnActiveRef.current || isSpeaking())
    fdRef.current?.setMuted(mute)
    contRef.current?.setMuted(mute)
  }

  // Audio ducking: while Kelion speaks, drop a playing YouTube clip's volume so
  // his voice is in the foreground (car-radio style — music dips when the nav
  // talks), then bring it back. Uses the YouTube IFrame API (enablejsapi=1).
  function duckMedia(duck: boolean): void {
    const win = (document.querySelector('.workspace-frame') as HTMLIFrameElement | null)
      ?.contentWindow
    if (!win) return
    try {
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'setVolume', args: [duck ? 12 : 100] }),
        '*',
      )
    } catch {
      /* cross-origin / player not ready — ignore */
    }
  }

  // Kelion drives the monitor himself (no manual button): a control frame from
  // the stream opens/clears the workspace surface behind the avatar.
  function handleControl(c: ChatControl): void {
    // Delivery receipt: the server's first frame arrived — the message got there.
    if (c.receipt) {
      setDelivered(true)
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

  // Short spoken + on-screen acknowledgement for a local command (camera, etc.).
  function ack(text: string): void {
    setMessages((cur) => [...cur, { role: 'assistant', content: text, ts: Date.now() }])
    if (voiceOutRef.current) enqueueSpeech(text, speechLangRef.current)
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

  // Audio gesture-lock (autoplay policy after a release auto-refresh): voice.ts
  // parks the blocked lines and fires these events; one touch replays them.
  useEffect(() => {
    const onBlocked = (): void => setAudioLocked(true)
    const onUnblocked = (): void => setAudioLocked(false)
    window.addEventListener('kelion:audio-blocked', onBlocked)
    window.addEventListener('kelion:audio-unblocked', onUnblocked)
    return () => {
      window.removeEventListener('kelion:audio-blocked', onBlocked)
      window.removeEventListener('kelion:audio-unblocked', onUnblocked)
    }
  }, [])

  // Claude can WALK IN first (admin only): messages Claude leaves through the
  // bridge are picked up here and Kelion says them — written in chat, spoken
  // aloud, already persisted to history by the server. The owner's rule:
  // "când intri, mă strigi" — Claude calls him, not only answers.
  useEffect(() => {
    if (!isAdmin) return
    const id = window.setInterval(() => {
      void fetch('/api/chat/incoming', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((j: { messages?: string[] }) => {
          const arr = j.messages ?? []
          if (arr.length === 0) return
          // ONE mouth, never two voices: when Claude cuts in, whatever is
          // being spoken right now is CUT OFF, and Claude's words come out
          // through Kelion's own voice.
          stopSpeaking()
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
  // PERFORM the clip. The script panel closes (the clip never shows the text),
  // Kelion SPEAKS the approved script verbatim — voice only, no chat bubble —
  // and the shot-list scenes appear on the monitor at their times.
  useEffect(() => {
    const onStarted = (): void => {
      const p = promoRef.current
      if (!p) return
      promoRef.current = null
      lastPromoRef.current = p // kept so "reluăm" can redo this exact take
      takeActiveRef.current = true
      syncMic() // take mode: the ear stays open for "stop"/"tăiem"
      closeAllTasks() // the script panel is done — clean frame for the clip
      // Narrate the clip in the SCRIPT's own language so the voice always matches
      // the text (a mismatch is what silenced the voice on a recalled scenario).
      const takeLang = p.lang || speechLangRef.current
      window.setTimeout(() => enqueueSpeech(p.script, takeLang), 900)
      for (const s of p.scenes ?? []) {
        promoTimersRef.current.push(
          window.setTimeout(() => {
            if (s.close || !s.url) closeAllTasks()
            else openWorkspace(s.title, s.url)
          }, 900 + s.at * 1000),
        )
      }
    }
    // Recording stopped (voice cut, Chrome's stop bar, or natural end): kill the
    // narration + pending scenes, clear the stage, and offer the retake.
    const onStopped = (): void => {
      const wasTake = takeActiveRef.current
      takeActiveRef.current = false
      for (const id of promoTimersRef.current) window.clearTimeout(id)
      promoTimersRef.current = []
      if (wasTake) {
        stopSpeaking()
        closeAllTasks()
        syncMic()
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

  // Camera is controlled by voice/text command (no switch button). Returns true
  // when the message was a camera command and was handled locally (not sent to
  // Claude). Requires both the word "camera" and an action verb so normal
  // questions like "ce vezi pe cameră?" still reach Claude.
  function tryCameraCommand(msg: string): boolean {
    const m = msg.toLowerCase()
    if (!/\bcamer/.test(m) && !/\bwebcam/.test(m)) return false
    if (/\b(închide|inchide|opre[sșț]te|opreste|stinge|dezactiv|close|turn off|disconnect)\b/.test(m)) {
      setCameraOn(false)
      ack(t.camOffMsg)
      return true
    }
    if (/\b(spate|exterior|back|rear|environment)\b/.test(m)) {
      setFacing('environment')
      setCameraOn(true)
      ack(t.camBackMsg)
      return true
    }
    if (/\b(fa[țt][ăa]|frontal|front|selfie|user)\b/.test(m)) {
      setFacing('user')
      setCameraOn(true)
      ack(t.camFrontMsg)
      return true
    }
    if (/\b(comut|schimb|switch|flip|toggle|întoarce|intoarce)\b/.test(m)) {
      switchCamera()
      ack(t.camSwitchMsg)
      return true
    }
    if (/\b(deschide|porne[sș]te|porneste|activ|open|turn on|connect|start)\b/.test(m)) {
      setCameraOn(true)
      ack(t.camOnMsg)
      return true
    }
    return false
  }

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
    const hardStop = globalThis.setTimeout(() => handle.stop(), SCENARIO_MAX_MS)
    for (const step of steps) {
      if (!scenarioRunningRef.current) break
      await sendRef.current(step) // waits for Kelion's full reply to stream in
      await new Promise((r) => globalThis.setTimeout(r, 1200))
    }
    // Let the final sentence finish speaking, then stop + save.
    await new Promise((r) => globalThis.setTimeout(r, 2500))
    globalThis.clearTimeout(hardStop)
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
    // Admin recorder commands — BEFORE the speech interrupt, so "oprește
    // înregistrarea" stops the RECORDING, not just Kelion's sentence.
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
    // Typed interrupt: while Kelion is speaking, "stop/stai/oprește" just halts
    // him (it's a command, not a question — don't send it to Claude).
    if (msg && isSpeaking() && STOP.test(msg) && msg.split(/\s+/).length <= 2) {
      stopSpeaking()
      setInput('')
      return
    }
    // Local camera commands (verbal or typed) — handled without a round-trip.
    if (msg && tryCameraCommand(msg)) {
      setInput('')
      return
    }
    // Local monitor commands — instant, no round-trip, so switching/closing tasks
    // always obeys the moment the user asks, in any language, with one voice.
    if (msg && getWorkspace().open) {
      // "switch to <task>" — jump to an already-open tab (map ⇄ youtube ⇄ …).
      // If that task isn't open, fall through so Kelion can open it.
      if (SWITCH_VERB.test(msg)) {
        const kind = taskKindFromText(msg)
        if (kind && switchToKind(kind)) {
          setInput('')
          return
        }
      }
      // "close <task>" / "close everything" / bare "close" (the active task).
      if (CLOSE_VERB.test(msg)) {
        if (CLOSE_ALL.test(msg)) {
          closeAllTasks()
          setInput('')
          return
        }
        const kind = taskKindFromText(msg)
        if (kind && closeTasksByKind(kind)) {
          setInput('')
          return
        }
        if (SCREEN_NOUN.test(msg) || msg.split(/\s+/).length <= 4) {
          closeWorkspace()
          setInput('')
          return
        }
      }
    }
    if (busyRef.current || inFlightRef.current) {
      // A turn is already streaming (it can take minutes). NEVER drop the text
      // silently — queue it; the finally block sends everything queued as the
      // next turn the moment this one ends. Attachment-only sends still wait.
      if (msg) {
        pendingSendsRef.current.push(msg)
        setInput('')
      }
      return
    }
    inFlightRef.current = true
    turnActiveRef.current = true
    syncMic() // mute the mic for the whole turn (structural anti-echo)
    setInput('')
    setDelivered(false) // new turn — the ✓ lights only once the server answers
    setAttachments([])
    stopSpeaking()
    // Multi-tasking: whatever is on the monitor (a map, a route, a video) STAYS
    // open while you keep chatting — it's only replaced when Kelion shows
    // something new, or closed when you (or Kelion) close it. So the map keeps
    // running in parallel with the conversation until you say to close it.
    const speak = voiceOutRef.current
    // The voice follows the LANGUAGE OF THIS REPLY (Kelion mirrors the user's
    // language), not a drifting global setting — so a Romanian reply is never
    // read by an English voice (the "defective ro"). Seed from the user's
    // message, then refine from the reply once enough text has streamed.
    // The spoken voice ALWAYS uses the USER's language (their account, or how they
    // speak/type) — NEVER a language detected from Kelion's REPLY text. That reply
    // drift is exactly what made "the voice go French". Adopt the user's language
    // only from THEIR message, never from Kelion's output.
    // The spoken voice uses the user's ESTABLISHED language (stable) — never a
    // single message's guess, because franc mis-reads diacritic-less Romanian as
    // Spanish/Italian. A switch is committed + persisted only after the SAME new
    // base language is seen on TWO messages in a row: that corrects a stale/wrong
    // stored language without ever flipping on a one-off mis-detection.
    const seedLang = detectLangFromText(msg)
    if (seedLang) {
      langPinnedRef.current = true
      const base = (c: string): string => c.toLowerCase().split('-')[0]
      if (base(seedLang) !== base(speechLangRef.current)) {
        if (pendingLangRef.current && base(pendingLangRef.current) === base(seedLang)) {
          if (++pendingCountRef.current >= 2) {
            changeSpeechLang(seedLang) // confirmed twice → adopt + persist
            pendingLangRef.current = null
            pendingCountRef.current = 0
          }
        } else {
          pendingLangRef.current = seedLang
          pendingCountRef.current = 1
        }
      } else {
        pendingLangRef.current = null // matches the current language — no switch
        pendingCountRef.current = 0
      }
    }
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
    const bridgeFiles = isAdmin
      ? atts
          .filter((a) => a.url.startsWith('data:'))
          .map((a) => ({ name: a.name, type: a.type ?? 'image/png', data: a.url }))
      : undefined

    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing, ts: Date.now() }]
    setMessages([...next, { role: 'assistant', content: '', ts: Date.now() }])
    setChatImage(null) // a new turn clears any previously shown image
    setBusy(true)
    try {
      let acc = ''
      let spoken = 0
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
      )) {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc, ts: Date.now() }])
        if (speak) {
          const end = lastSentenceEnd(acc)
          if (end > spoken) {
            enqueueSpeech(acc.slice(spoken, end), replyLang)
            spoken = end
          }
        }
      }
      if (speak) {
        if (acc.length > spoken) enqueueSpeech(acc.slice(spoken), replyLang)
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'error'
      // Offline text follows the language the user actually speaks (so a driver
      // hears it in their language), not the account-UI locale.
      const spoken = strings(resolveLang(replyLang))
      const m =
        code === 'brain_not_configured'
          ? t.brainNotActive
          : code === 'offline'
            ? spoken.offline
            : t.brainError
      setMessages([...next, { role: 'assistant', content: `⚠️ ${m}`, ts: Date.now() }])
      // Lost signal (e.g. a tunnel while driving): SAY it so the driver hears it
      // without looking, and remember so we can announce when we're back online.
      if (code === 'offline') {
        offlineRef.current = true
        retryTextRef.current = msg // resume THIS message when the signal returns
        if (speak) enqueueSpeech(spoken.offline, replyLang)
      }
    } finally {
      inFlightRef.current = false
      setBusy(false)
      // The reply is done streaming. The mic reopens only once Kelion also finishes
      // speaking — syncMic re-checks isSpeaking(), and onSpeaking→syncMic reopens it
      // at the very end. A turn with no speech reopens it right here.
      turnActiveRef.current = false
      syncMic()
      // Anything written during this turn was queued, not lost — combine it and
      // start the next turn with it (a beat later, so this one fully unwinds).
      if (pendingSendsRef.current.length > 0) {
        const combined = pendingSendsRef.current.join('\n')
        pendingSendsRef.current = []
        window.setTimeout(() => void sendRef.current(combined), 50)
      }
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send

  function armIdle(): void {
    if (idleRef.current) globalThis.clearTimeout(idleRef.current)
    idleRef.current = globalThis.setTimeout(() => {
      // Don't drop to standby while the mic channel is explicitly ON.
      if (!listeningRef.current) setAwake(false)
    }, IDLE_MS)
  }

  // Invisible accumulation: buffer utterances that arrive close together and hand
  // them to Kelion as ONE coherent message after a brief silence — so speaking
  // fast (or the mic splitting a sentence) never fragments into separate turns and
  // nothing is dropped. All behind the scenes; the user just talks naturally.
  function accumulateHeard(text: string): void {
    const t = text.trim()
    if (!t) return
    heardBufRef.current.push(t)
    if (heardTimerRef.current) globalThis.clearTimeout(heardTimerRef.current)
    heardTimerRef.current = globalThis.setTimeout(() => {
      const combined = heardBufRef.current.join(' ').replace(/\s+/g, ' ').trim()
      heardBufRef.current = []
      if (combined) void sendRef.current(combined)
    }, HEARD_GAP_MS)
  }

  // Send a heard utterance to Kelion, cleaning it first only when the recognizer
  // wasn't confident (the spec's transcript-validation step — Google/Gemini).
  async function dispatchHeard(text: string, confidence: number): Promise<void> {
    let toSend = text
    if (confidence > 0 && confidence < CONF_MIN) {
      const context = messagesRef.current
        .slice(-2)
        .map((m) => m.content)
        .join('\n')
      toSend = await correctTranscript(text, context, speechLangRef.current)
    }
    accumulateHeard(toSend)
  }

  // Heard a final utterance from the permanent mic.
  function onHeard(raw: string, confidence: number): void {
    const text = raw.trim()
    if (!text) return
    // A take is rolling: ONLY the cut words act — everything else (including
    // Kelion's own narration echo) is discarded.
    if (takeActiveRef.current) {
      if (TAKE_STOP.test(text)) window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
      return
    }
    // Defensive stop-word guard; the mic is muted for the whole turn upstream.
    if (isSpeaking()) {
      if (STOP.test(text)) stopSpeaking()
      return
    }
    // Asleep: wait for the wake word, then send anything said after it.
    if (!awakeRef.current) {
      if (!WAKE.test(text)) return
      setAwake(true)
      armIdle()
      const rest = text.replace(WAKE, '').trim()
      if (rest.length > 1) void dispatchHeard(rest, confidence)
      return
    }
    // Awake: send the utterance (validated if low-confidence).
    armIdle()
    void dispatchHeard(text, confidence)
  }

  // Heard a full utterance from the full-duplex (AEC + Chirp) channel. Chirp
  // gives an accurate transcript; we send it straight to Claude. The reply's
  // voice language is detected from the reply text (see send), so we no longer
  // flip a global language per utterance.
  function onHeardFull(text: string): void {
    const clean = text.trim()
    if (!clean) return
    // A take is rolling: ONLY the cut words act — everything else (including
    // Kelion's own narration echo) is discarded.
    if (takeActiveRef.current) {
      if (TAKE_STOP.test(clean)) window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
      return
    }
    // Defensive: the mic is already muted for the whole turn (syncMic), so echo
    // shouldn't reach here — but if a stray result slips through, only honour a
    // stop-word, never a new turn.
    if (isSpeaking()) {
      if (STOP.test(clean)) stopSpeaking()
      return
    }
    // Don't flip the global language per utterance (it landed on a wrong/defective
    // language). The reply's voice language is detected from the reply text in send().
    // A song/video is playing and you're not clearly addressing Kelion: stay out
    // of it. The mic is probably just hearing the media itself — so only the wake
    // word or an explicit media command (stop / close / switch) gets through, and
    // Kelion never interrupts the music unprompted.
    if (getWorkspace().tasks.some((t) => t.kind === 'youtube')) {
      if (!(WAKE.test(clean) || STOP.test(clean) || CLOSE_VERB.test(clean) || SWITCH_VERB.test(clean)))
        return
    }
    armIdle()
    accumulateHeard(WAKE.test(clean) ? clean.replace(WAKE, '').trim() || clean : clean)
  }

  // Start listening. Prefer the professional full-duplex path (browser AEC +
  // Google Chirp STT) so the user can talk over Kelion with no echo; fall back
  // to the Web Speech recognizer (half-duplex) where that's unavailable.
  async function startVoice(): Promise<void> {
    fdRef.current?.stop()
    fdRef.current = null
    contRef.current?.stop()
    contRef.current = null
    setMicError(null)

    const fd = await startFullDuplex(
      (text) => onHeardFull(text),
      (error) => {
        if (error === 'not-allowed') setMicError(t.micBlocked)
      },
      (status) => setVoiceStatus(status),
      // Anchor recognition on the user's established language — no more
      // auto-detect guessing Polish/Turkish on short Romanian utterances.
      () => speechLangRef.current,
    )
    if (fd) {
      fdRef.current = fd
      syncMic() // if a turn is already active, the fresh mic starts muted
      setListening(true)
      setAwake(true)
      armIdle()
      return
    }

    // Fallback: Web Speech (half-duplex; mic muted while Kelion speaks).
    const h = startContinuous(
      speechLangRef.current,
      (heard, conf) => onHeard(heard, conf),
      (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          setMicError(t.micBlocked)
          setListening(false)
          setAwake(false)
        } else if (error === 'audio-capture') {
          setMicError(t.micNoDevice)
          setListening(false)
          setAwake(false)
        }
      },
    )
    contRef.current = h
    if (h) {
      syncMic() // start muted if a turn is already active
      setListening(true)
      setAwake(true)
      armIdle()
      // Only auto-detect the language from the mic when the user has no
      // established/stored language yet — otherwise we'd clobber their choice.
      if (!langPinnedRef.current) {
        void detectLanguageFromMic().then((code) => {
          if (code) changeSpeechLang(code)
        })
      }
    } else {
      setMicError(t.micUnsupported)
    }
  }
  function stopVoice(): void {
    fdRef.current?.stop()
    fdRef.current = null
    contRef.current?.stop()
    contRef.current = null
    setListening(false)
    setAwake(false)
    stopSpeaking()
  }
  function toggleVoice(): void {
    if (listening) stopVoice()
    else void startVoice()
  }
  // Switch the language Kelion hears + speaks; restart the recognizer live and
  // persist the choice per user. No-op if it's already the active language.
  function changeSpeechLang(code: string): void {
    langPinnedRef.current = true // a language is now established — keep it
    if (code === speechLangRef.current) return
    speechLangRef.current = code
    setSpeechLang(code) // updates Kelion's voice (TTS) language immediately
    saveLang(code)
    // Only the Web Speech fallback needs a restart to change recognition
    // language; full-duplex (Chirp) auto-detects, so leave it running.
    if (listeningRef.current && contRef.current && !fdRef.current) {
      contRef.current.stop()
      contRef.current = null
      void startVoice()
    }
  }

  // Hands-free: auto-open the mic on load IF permission is already granted.
  // The browser blocks mic access without a user gesture on the very first
  // visit, so the 🎤 button stays for that one-time grant; after that, every
  // visit starts listening automatically (no button needed) — per the spec.
  useEffect(() => {
    if (!speechSupported()) return
    let cancelled = false
    const perms = navigator.permissions
    if (!perms?.query) return
    void perms
      .query({ name: 'microphone' as PermissionName })
      .then((st) => {
        if (cancelled) return
        if (st.state === 'granted' && !listeningRef.current) void startVoice()
        st.onchange = () => {
          if (st.state === 'granted' && !listeningRef.current) void startVoice()
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Mount-only auto-start; startVoice is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clean up the mic + timers when the panel unmounts.
  useEffect(() => {
    return () => {
      fdRef.current?.stop()
      fdRef.current = null
      contRef.current?.stop()
      contRef.current = null
      if (idleRef.current) globalThis.clearTimeout(idleRef.current)
      stopSpeaking()
    }
  }, [])

  // Connectivity recovery: after a turn failed offline, announce (spoken) that
  // we're back the moment the browser regains a connection — so a driver knows
  // they can talk again without looking. Each request is independent, so the
  // next message just works.
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
      } else if (voiceOutRef.current) {
        const lg = speechLangRef.current
        enqueueSpeech(strings(resolveLang(lg)).backOnline, lg)
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Half-duplex anti-echo: the mic is muted for the whole turn (thinking + talking)
  // and reopens only when Kelion goes silent. Both channels obey one authority
  // (syncMic); this callback fires when the speaking state flips.
  useEffect(() => {
    setOnSpeakingChange((speaking) => {
      syncMic()
      duckMedia(speaking) // dip background video volume while Kelion talks
    })
    return () => setOnSpeakingChange(null)
    // syncMic reads refs only (stable) — safe to wire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!code) return
      langPinnedRef.current = true // an established preference — don't auto-override
      if (code === speechLangRef.current) return
      speechLangRef.current = code
      setSpeechLang(code)
    }
    const local = loadLocalLang()
    apply(local)
    void loadServerLang().then((serverCode) => {
      apply(serverCode)
      // Server is the cross-device source of truth: if the local mirror is stale
      // (e.g. left over from an earlier mis-detection), correct it.
      if (serverCode && serverCode !== local) saveLang(serverCode)
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

  // Capture frames at a GPS-driven rate (1 fps still, 4 fps moving, scaling up
  // with speed). Frames are buffered locally; the latest is sent to Claude on a
  // turn (continuous send would be cost-prohibitive — see spec).
  useEffect(() => {
    if (!cameraOn) return
    let timer: number | null = null
    let watchId: number | null = null
    let fps = 1
    let last: { lat: number; lon: number; t: number } | null = null

    const tick = (): void => {
      const f = captureRef.current?.()
      if (f) latestFrameRef.current = f
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
          const next = mps < 0.5 ? 1 : Math.min(8, 4 + Math.floor(mps / 2))
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
  function toggleVoiceOut(): void {
    setVoiceOut((v) => {
      if (v) stopSpeaking()
      return !v
    })
  }
  function onCameraError(): void {
    setCameraOn(false)
  }

  // When the MONITOR shows content, the centre chat bubbles would cover it —
  // so Kelion's words move to a slim black bar just above the composer instead.
  const wsOpen = useSyncExternalStore(subscribeWorkspace, getWorkspace).open
  // Monitor mode = a surface is open OR the brain is executing live. In EITHER
  // case the chat collapses to the slim black bar above the composer so nothing
  // covers the monitor (Adrian's rule). `working` follows the live-work console.
  const monitorBusy = useSyncExternalStore(subscribeWorkspace, isMonitorWorking)
  const monitorMode = wsOpen || monitorBusy
  // Show the CURRENT exchange in writing: the user's request (so he sees it
  // arrived correctly the instant he speaks/types) AND Kelion's reply, which
  // updates live as Kelion speaks — not audio-only, not just one sentence.
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
  const hint = speechSupported() ? t.wakeHint : t.chatHint

  return (
    <div className="chat">
      <CameraView
        active={cameraOn}
        facing={facing}
        onError={onCameraError}
        captureRef={captureRef}
      />
      {/* Centre bubbles — HIDDEN while the monitor shows content OR the brain is
          executing live, so they never cover it (Kelion's words go to the black
          bar above the composer). */}
      {!monitorMode && (
        <div className="chat-log">
          {messages.length === 0 && <p className="chat-hint">{hint}</p>}
          {lastUser && lastUser.content && (
            <div className="bubble user">{lastUser.content.slice(0, 600)}{busy && delivered && <span className="sent-check" title="Mesaj primit de server">✓</span>}{lastUser.ts && <span className="bubble-time">{new Date(lastUser.ts).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}</span>}</div>
          )}
          {(lastAssistant || busy) && (
            <div className="bubble assistant">
              {lastAssistant?.content ? lastAssistant.content : busy ? '…' : ''}{lastAssistant?.ts && lastAssistant.content ? <span className="bubble-time">{new Date(lastAssistant.ts).toLocaleTimeString("ro-RO",{hour:"2-digit",minute:"2-digit"})}</span> : null}
            </div>
          )}
          {chatImage && (
            <img className="chat-image" src={chatImage} alt="Kelion generated" />
          )}
        </div>
      )}
      <MicMeter active={listening} label={t.hearingLabel} />
      {voiceStatus !== 'online' && (
        <p className="voice-recording">
          ● {voiceStatus === 'buffering' ? 'Recording — no signal, saving your words' : 'Reconnected — sending what you said'}
        </p>
      )}
      {micError && <p className="mic-error">{micError}</p>}
      {audioLocked && (
        <p className="audio-locked">🔊 Browserul a oprit sunetul după actualizare — atinge o dată oriunde și vocea revine singură.</p>
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
      {/* Monitor mode: Kelion's words in a slim black bar ABOVE the composer,
          so nothing covers what's on the monitor. */}
      {/* Adrian's rule (4 iul): ce e AFIȘAT pe monitor (un surface deschis) NU se
          mai repetă în bara de chat — dublarea acoperea monitorul. Bara vorbește
          doar când monitorul arată consola de lucru (fără surface). */}
      {monitorBusy && !wsOpen && (lastAssistant?.content || busy) && (
        <div className="monitor-speech">
          {lastAssistant?.content ? lastAssistant.content : '…'}
          {busy && delivered && <span className="sent-check" title="Mesaj primit de server">✓</span>}
        </div>
      )}
      <div className={`composer ${busy ? 'working' : ''}`}>
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
        <div className="composer-row">
          <div className="fn-wrap" ref={menuRef}>
            <button
              type="button"
              className={`composer-icon ${menuOpen || awake ? 'live' : ''}`}
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
                <button type="button" className="fn-item" onClick={toggleVoiceOut}>
                  <span className="ico">{voiceOut ? '🔊' : '🔇'}</span>
                  {t.voiceTitle}
                  {voiceOut && <span className="dot" />}
                </button>
                {cameraSupported() && (
                  <button type="button" className="fn-item" onClick={toggleCamera}>
                    <span className="ico">{cameraOn ? '🔌' : '📷'}</span>
                    {cameraOn ? t.disconnectCamTitle : t.connectCamTitle}
                    {cameraOn && <span className="dot" />}
                  </button>
                )}
                {/* No monitor or camera-switch buttons: Kelion opens the monitor on
                    his own (show_on_screen), and the camera is switched by voice or
                    text command ("switch camera", "comută camera", "camera spate").
                    Audio routing (incl. Bluetooth) follows the system default —
                    automatic, no picker. */}
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
          <input
            className="composer-input"
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
          />
          {speechSupported() && (
            <button
              type="button"
              className={`composer-icon ${listening ? 'live' : ''}`}
              onClick={toggleVoice}
              title={t.micTitle}
              aria-label={t.micTitle}
            >
              {listening ? '●' : '🎤'}
            </button>
          )}
          <button
            type="button"
            className="composer-send"
            onClick={() => void send(input)}
            disabled={busy || (!input.trim() && attachments.length === 0)}
            aria-label={t.send}
            title={t.send}
          >
            ↑
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
