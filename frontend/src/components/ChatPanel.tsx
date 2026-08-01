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
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { strings, resolveLang, uiStrings, type Lang } from '../lib/i18n'
import CameraView from './CameraView'
import { cameraSupported, type Facing } from '../lib/camera'
import { defaultSpeechLang } from '../lib/languages'
import { loadLocalLang, loadServerPrefs, mirrorLang } from '../lib/prefs'
import {
  openWorkspace,
  openWorkspaceCard,
  openWorkspaceDoc,
  openWorkspaceApp,
  openWorkspaceBuild,
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
  getPendingVoiceFeatures,
  clearPendingVoiceFeatures,
  getVoiceVolume,
  setVoiceVolume,
  type MicHandle,
} from '../lib/audioIO'
import { getPendingFaceDescriptor } from '../lib/faceprint'
import { setRealLatency, getRealLatency, subscribeRealLatency } from '../lib/latency'
import { keepScreenOn } from '../lib/wakelock'
import { startMicStream } from '../lib/micStream'
import { startRealtimeVoice, type RealtimeVoiceHandle } from '../lib/realtimeVoice'
import { createUtteranceCoalescer, type UtteranceCoalescer } from '../lib/utteranceCoalescer'
import { pushFacial } from '../lib/facialQueue'

// Gesturile-tool ale serverului (play_avatar_gesture, release-ul „v2.3” al
// builder) translated into the REAL clips from the RPM library — the skeleton
// moves only through clips (rule #125), so the label becomes the name
// of the equivalent clip and leaves on the same 'kelion-gesture' channel.
const GESTURE_TO_CLIP: Record<string, string> = {
  // Semantic vocabulary (Adrian, Jul 13) — the brain asks for the gesture by MEANING, here
  // it gets translated into the RPM clip. Each one is tied to a feeling/context.
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
  // Legacy — the deterministic voice commands in the backend still emit these.
  salute: 'expresie-1',
  raiseRightHand: 'expresie-13',
  pointMonitor: 'expresie-2',
}

// NO duration cap on recordings (Adrian, Jul 11 evening: "they must not
// have time settings or limits") — the scenario ends when it runs out of
// steps or when he says stop, not when an arbitrary timer expires.

// Camera + monitor-tab commands ("închide harta", "camera spate", "switch to
// the video") are interpreted on the SERVER now (backend services/commands.ts,
// owner's order: as much of the app as possible on the server). The server
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
// (Adrian, Jul 26: "only when GPS apps are used or location detection
// is needed"). Covers Romanian + English: weather, maps, position, routes.
const LOC_INTENT =
  /\b(vreme(a|me)?|meteo|prognoz\w*|weather|forecast|unde (sunt|m[ăa] aflu)|where am i|l[âa]ng[ăa] mine|near me|aproape de mine|[îi]n zon[ăa]|hart[ăa]|h[ăa]r[țt]i|maps?|traseu|rut[ăa]|drum(ul)? (spre|p[âa]n[ăa])|direc[țt]ii|directions|navig\w*|loca[țt]ia (mea|curent[ăa])|locul meu|pozi[țt]ia mea|coordonate(le)? mele|gps)\b/i

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
}: {
  readonly lang: Lang
  readonly isAdmin: boolean
}) {
  const t = strings(lang)
  // Fix hydration: start with the deterministic UI lang, then resolve the browser locale on the client.
  const [speechLang, setSpeechLang] = useState<string>(lang)
  useEffect(() => {
    setSpeechLang(defaultSpeechLang(lang))
  }, [lang])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // CLEAN PAGE ON OPEN (Adrian, Jul 26: "it must look like it starts clean
  // on the page, without mumbling the last sentence"). The "permanent
  // history" hydration from Jul 24 USED to live here, filling the chat with the old conversation on EVERY
  // open — and it defeated the newer mechanism below (restore ONLY on
  // release refresh). It was removed: memory stays ACTIVE on the server
  // (the brain gets the history every turn, the voice too), only the screen
  // starts clean. The full history stays in Admin → Istoric chat.
  const [chatImage, setChatImage] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Microphone (input) — capture → server (STT) → brain. It is NOT "voice in front".
  const [listening, setListening] = useState(false)
  // VOICE VOLUME (Jul 25): the value persisted from audioIO, mirrored in the slider.
  const [voiceVol, setVoiceVolState] = useState(() => getVoiceVolume())
  // LIVE DICTATION: the current sentence, word by word, with a cinematic effect on
  // the ticker while Adrian speaks; it empties when the sentence leaves for the brain.
  const [liveVoice, setLiveVoice] = useState('')
  // BRAIN-INPUT TICKER (Adrian, Jul 10): the EXACT text handed
  // to the brain on the current turn — it comes from the SERVER ({heard}), not a local echo.
  const [heard, setHeard] = useState('')
  // TICKER (fixed rule, Jul 10): the scroll duration scales with the text
  // length, so it stays readable — neither too fast, nor forever.
  const tickerDur = (s: string): string => `${Math.min(22, Math.max(3.5, s.length / 14))}s`
  // QUICK SUMMARY (Adrian, Jul 10: "if the pause outlasts the thinking, don't
  // leave a gap on the brain's line — a few-word summary, hold it until
  // the next one"). Extracted INSTANTLY from {heard} (the request already confirmed by
  // the server as handed to the brain) — zero latency, doesn't wait for the model.
  const synthesize = (s: string, maxWords = 8): string => {
    const words = s.trim().split(/\s+/).filter(Boolean)
    return words.length <= maxWords ? s.trim() : `${words.slice(0, maxWords).join(' ')}…`
  }
  // Modul microfon: true = dictare live (streaming WS); cade pe batch dovedit
  // if the WS drops or goes silent, so the voice never breaks.
  const streamModeRef = useRef(true)
  const micRef = useRef<MicHandle | null>(null)
  // VOCE = OpenAI Realtime `cedar` — chat FULL-DUPLEX nativ cu escaladare, pe
  // cele 2 chei (Adrian, 24 iul: „chat fullduplex realtime cu escaladare").
  // Chirp would have required a 3rd Google key (no AIza key was ever given in
  // chat — verified). ONLY if Realtime fails (no key / WebRTC failure) we fall
  // back ONCE to STT→brain→TTS for the session (a fallback, not the rule).
  const realtimeOffRef = useRef(false)
  // FIX "chat full duplex doesn't exist" (Adrian, Jul 24): before, ANY error
  // Realtime (even a transient one — a 502, an ICE hop, a benign input-ended)
  // set `realtimeOffRef=true` PERMANENTLY for the whole session → full-duplex
  // died for good and fell silent onto half-duplex STT. Now we count failures:
  // we give full-duplex 3 chances before latching onto STT, and a successful
  // connection (`live`) resets the counter. This way a transient failure no longer kills the duplex.
  const realtimeFailCountRef = useRef(0)
  const REALTIME_MAX_FAILS = 3
  // AUTOMATIC RECOVERY (Jul 25 — the real cause of "the voice is robotic"): once latched
  // onto the TTS fallback (robotic), `realtimeOffRef` stayed true FOREVER in
  // that tab — even after the session was fixed on the server, the user heard
  // the robot until a HARD reload, which they had no way to know about. Now
  // the latch is time-based: after `REALTIME_RECOVER_MS` we retry the REAL voice, and
  // the failure counter resets — a fixed deploy recovers on its own.
  const realtimeOffAtRef = useRef(0)
  const REALTIME_RECOVER_MS = 90_000
  // SEMI-DUPLEX ON ESCALATION (Adrian: "when it escalates it uses the same
  // voice and switches to semi-duplex while it thinks, then returns to normal once
  // it's resolved"). When the live voice calls the heavy brain (`ask_brain`), thinking +
  // answering take time; we mute the microphone (semi-duplex) while it thinks, so
  // it doesn't talk over itself, then we return to full-duplex when it finishes speaking.
  // The voice stays THE SAME (still Realtime) — only the duplex mode changes.
  const thinkingRef = useRef(false)
  // Joins the VOX pieces cut at a thinking pause (not an end-of-sentence one)
  // into a single thought, before sending it to the brain. Rebuilt on every
  // (re)start of the microphone — see ensureMic below.
  const coalescerRef = useRef<UtteranceCoalescer | null>(null)
  // The voiceprint — restricts the permanent microphone to Adrian's
  // voice. Without a UI entry point, hasVoiceprint() stays false forever: the button
  // below is the only place where the profile can be enrolled/reset.
  const [voiceCalState, setVoiceCalState] = useState<'idle' | 'listening' | 'ok' | 'fail'>('idle')
  // Fix hydration: localStorage is client-only; read it after hydration.
  const [hasVoicePrint, setHasVoicePrint] = useState(false)
  useEffect(() => {
    setHasVoicePrint(hasVoiceprint())
  }, [])
  // Messages typed during an active turn — visible, not lost in a queue.
  const [queued, setQueued] = useState<string[]>([])
  // Adrian, Jul 11: "the camera didn't start [after restart] — that's wrong" → the camera
  // starts BY DEFAULT on every load; the button remains for turning it off.
  const [cameraOn, setCameraOn] = useState(true)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)
  // Attached images (ChatGPT-style composer). Sent to the brain's vision on send.
  // Attachments are images (url = data URL, used for vision), documents
  // (text = the Markdown extracted by MarkItDown, prepended to the message),
  // or — for the ADMIN — ANY raw file (url = data URL, type set): photos,
  // texts, archives, video, everything rides the bridge to the developer.
  const [attachments, setAttachments] = useState<
    { id: string; url: string; name: string; text?: string; type?: string }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The typing field: a single click anywhere in the bar focuses it (the input's real
  // area is narrow, and a click "next to" the text didn't grab focus — it took
  // several clicks). The ref is targeted by the handler on the composer row.
  const composerInputRef = useRef<HTMLInputElement>(null)
  // Admin promo-scenario recorder: type steps, hit Record, Kelion runs them while
  // the screen + voice are recorded, then it saves an MP4 to Downloads.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioRunning, setScenarioRunning] = useState(false)
  const scenarioRunningRef = useRef(false)
  scenarioRunningRef.current = scenarioRunning
  const scenarioRecRef = useRef<RecordingHandle | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const latestFrameRef = useRef<string | null>(null)
  // The last 4 frames (Adrian, Jul 11: "the camera doesn't capture 4 frames per second
  // + Kelion's audit: "it sends a single frame instead of four — vision
  // isn't continuous"). Circular buffer; on every turn ALL 4 leave.
  const frameBufRef = useRef<string[]>([])
  const coordsRef = useRef<Coords | null>(null)
  // The LIVE voice session (if any) — used by the location tools to
  // refresh its position exactly when needed (updateCoords, on demand).
  const rvLiveRef = useRef<RealtimeVoiceHandle | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  // The abort controller of the current turn — "stop" aborts it on the spot.
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
    // (No separate UI: the user text already shows ONCE in the single band below.)
    if (c.receipt) return
    // GESTURE ON COMMAND (Adrian, Jul 11: "commanded movements for everything I want him
    // to do"): the brain put [GEST name] in the reply → the server turned it
    // into the {gest} frame → the movement direction (AvatarModel) plays the clip once.
    if (c.gest) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: c.gest }))
      return
    }
    // The server-side tool's {gesture} frame — translated into the equivalent clip.
    if (c.gesture && GESTURE_TO_CLIP[c.gesture]) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: GESTURE_TO_CLIP[c.gesture] }))
      return
    }
    // Kelion opens the app's tabs from the WRITTEN chat (open_app_view →
    // {nav} frame); Stage listens to kelion:navigate and enforces the admin gate.
    if (c.nav?.view) {
      window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: c.nav }))
      return
    }
    // The brain-input ticker: the server says EXACTLY what text it hands
    // to the brain — shown on the dedicated ticker until the next turn.
    if (c.heard !== undefined) {
      setHeard(c.heard)
      return
    }
    // THE BRAIN'S VOICE: MP3 pre-synthesized on the server (Chirp 3) — we ONLY play it.
    // While it speaks, the microphone doesn't send (anti-echo), but stays on watch:
    // vocea lui Adrian taie redarea pe loc (barge-in, vezi ensureMic).
    if (c.audio) {
      // THE SINGLE-VOICE RULE (Adrian, Jul 26, real bug: he sent a picture during
      // the voice session and "a second voice came in at the same time"): as long as
      // the Realtime session is installed, IT is the only voice — the written chat's
      // {audio} frames are dropped. A net too for frames already synthesized by a
      // turn started before the flag (serverVoiceOff stops the source, this drains the rest).
      if ((micRef.current as unknown as { isRealtime?: boolean } | null)?.isRealtime === true) return
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
    // PLAYGROUND: the page written by Kelion runs live on the monitor (sandboxed frame).
    if (c.app && c.app.html.trim()) {
      openWorkspaceApp(c.app.title || t.monitorTitle, c.app.html)
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
    if (!c.monitor) return
    if (c.monitor.url) openWorkspace(c.monitor.title || t.monitorTitle, c.monitor.url)
    else closeWorkspace()
  }

  // Short on-screen acknowledgement for a local command (camera, etc.).
  function ack(text: string): void {
    setMessages((cur) => [...cur, { role: 'assistant', content: text, ts: Date.now() }])
    suggestFacial(text)
  }

  // The face micro-expression, GENTLEMAN style (Adrian, Jul 12: "the mug of a rascal,
  // not a gentleman"). A gentleman is COMPOSED: the face stays neutral BY DEFAULT; an expression
  // appears RARELY and ONLY at a real, clear feeling — never reactive to
  // every punctuation mark (amazement at every "!", an eyebrow at every
  // "?" — that looked agitated). No default expression: the face's silence is dignified.
  function suggestFacial(text: string): void {
    const s = text.trim()
    if (!s) return
    // Warm, sincere gratitude → a restrained smile.
    if (/\b(mul[țt]umesc|[îi][țt]i mul[țt]umesc|thank you|apreciez|bravo|felicit)\b/i.test(s))
      return pushFacial('warmth')
    // Genuine regret/empathy → a soft expression.
    if (/\b([îi]mi pare r[ăa]u|regret|condolean|din p[ăa]cate|sympath|my condolences)\b/i.test(s))
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
      // THE CLIP'S VOICE (QA Jul 24: the approved script was NEVER spoken during
      // recording — the clip came out mute). We synthesize the script with the single voice
      // (ash, via /api/tts) and play it over the rolling scenes.
      // IN CHUNKS (Jul 25): /api/tts silently cuts at 5000 characters — a 5-10 minute
      // clip lost its voice halfway through. We split the script into
      // ≤3500-char sentence chunks, synthesize them IN ORDER and playVoice queues
      // them (same reply, no cuts).
      void (async () => {
        const chunks: string[] = []
        let cur = ''
        for (const sentence of p.script.split(/(?<=[.!?…])\s+/)) {
          if (cur && cur.length + sentence.length + 1 > 3500) {
            chunks.push(cur)
            cur = sentence
          } else {
            cur = cur ? `${cur} ${sentence}` : sentence
          }
        }
        if (cur) chunks.push(cur)
        for (const chunk of chunks) {
          try {
            const r = await fetch('/api/tts', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: chunk, lang: p.lang ?? 'ro-RO' }),
            })
            if (!r.ok) continue
            const buf = await r.arrayBuffer()
            let bin = ''
            const bytes = new Uint8Array(buf)
            for (let i = 0; i < bytes.length; i += 0x8000)
              bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            playVoice(btoa(bin))
          } catch {
            /* a dropped chunk doesn't stop the rest of the narration */
          }
        }
      })()
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
                ? 'Dubla s-a oprit și clipul s-a salvat. Spune „reluăm” pentru încă o dublă cu același scenariu.'
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
  // is kept RAW — it rides the bridge to the developer as-is.
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
  // Paste an image/file straight into the chat (Ctrl+V) or drag-and-drop a file.
  // DIRECT PRINTSCREEN (Adrian, Jul 25: "it doesn't take printscreens directly").
  // A pasted screenshot (Win+Shift+S, "Copy image") often does NOT land in
  // clipboardData.files, but in clipboardData.items (kind:'file', type:image/*).
  // We read BOTH sources → the pasted capture is caught every time. Dedup on
  // (name+size) so we don't add the same image twice.
  function onPasteFiles(e: ReactClipboardEvent): void {
    const seen = new Set<string>()
    const collected: File[] = []
    for (const f of e.clipboardData.files) {
      const key = `${f.name}:${f.size}`
      if (!seen.has(key)) { seen.add(key); collected.push(f) }
    }
    for (const it of e.clipboardData.items) {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) {
          const key = `${f.name}:${f.size}`
          if (!seen.has(key)) { seen.add(key); collected.push(f) }
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
    // Admin recorder commands — handled locally, never sent to the brain.
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
              ? `Scenariul salvat era în altă limbă. Spune-mi din nou „fă un clip despre ${saved.subject}” și îl refac în limba curentă.`
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
    // IMMEDIATE STOP (Adrian, Jul 10: "I tell it stop and it ignores me, it doesn't take
    // the command right away"). A typed or spoken "stop" is NOT queued — it cuts the voice
    // and the current turn ON THE SPOT, empties the queue and closes the request on the server. The software
    // does NOT break: the backend finishes its turn on its own in the background; I just stop
    // waiting and stop speaking. Checked BEFORE the "busy" guard.
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
      // Closes the request/loop on the server (the backend's stop handler).
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
      // REAL FULL-DUPLEX (Adrian, Jul 13: "while it works it doesn't hear the microphone / the text
      // doesn't reach it"): new input (typed OR spoken) while Kelion works =
      // BARGE-IN — we cancel the current turn and start the new one IMMEDIATELY. We no longer queue
      // it: the queue BLOCKED full-duplex (the second message didn't reach the brain
      // until the first finished). The backend + worker already accept concurrent
      // turns. No text (attachment only) → we leave the current turn alone, we don't cut it.
      if (!msg) return
      stopVoice() // taie vocea rămasă din tura veche, să nu vorbească peste
      abortRef.current?.abort() // tura veche devine „superseded"; finally-ul ei nu mai resetează
      // NO return — we fall through below and start the new turn right now.
    }
    inFlightRef.current = true
    setInput('')
    // New turn: the server-confirmed text of the FINISHED turn is cleared —
    // the band never shows a stale "what the brain got" from the previous one.
    setHeard('')
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
    // CONTINUOUS VISION (Adrian, Jul 11): with the camera on, the LAST 8 FRAMES leave
    // (≈2s of motion at 4 fps), not a single one — the brain sees MOTION, not a
    // frozen blink. The same for ALL users (rule no. 9): the frames go through
    // `images`, while an explicitly attached picture goes through `image`.
    const camFrames = cameraOnRef.current && !attached ? frameBufRef.current.slice(-8) : []

    // Voice features collected from the last spoken sentence (live dictation or batch).
    const voiceFeatures = getPendingVoiceFeatures() ?? undefined
    clearPendingVoiceFeatures()
    // The facial descriptor READY in the background (if the camera is on and it caught a
    // face). Instant — it waits for no inference, it doesn't slow down the send.
    const face = getPendingFaceDescriptor()

    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing, ts: Date.now() }]
    // STABLE ts for THIS turn's in-progress reply — the functional updater
    // below recognizes and replaces it, without deleting the messages
    // (e.g. voice transcripts) that arrived meanwhile.
    const turnTs = Date.now()
    setMessages([...next, { role: 'assistant', content: '', ts: turnTs }])
    setChatImage(null) // a new turn clears any previously shown image
    // The abort controller of THIS turn — "stop" aborts it on the spot.
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    let acc = ''
    // REAL RESPONSE TIME (measured here, in the browser — what the user feels): from
    // send → first visible word → complete reply. Shown on the counter.
    const t0 = performance.now()
    let firstAt = 0
    try {
      const wsNow = getWorkspace()
      const screen = wsNow.open
        ? wsNow.tasks.map((tk) => ({ kind: tk.kind, title: tk.title, active: tk.id === wsNow.activeId }))
        : undefined
      // GPS ONLY WHEN NEEDED: we read the REAL position right now, just once,
      // ONLY if the message really asks for the location (weather/maps/"where am I"/route).
      // Otherwise we detect nothing — at most the last known position leaves.
      const locTurn = LOC_INTENT.test(msg)
      const turnCoords = locTurn ? await getFreshCoords() : coordsRef.current
      for await (const chunk of streamChat(
        next,
        image ?? undefined,
        turnCoords ?? undefined,
        handleControl,
        screen,
        ac.signal,
        Boolean(attached), // poză lipită/încărcată explicit — analiză fără condiție
        // Continuous vision for ALL users (rule no. 9): the last frames.
        camFrames.length > 0 ? camFrames : undefined,
        voiceFeatures,
        face?.descriptor,
        face?.photo,
        // THE SINGLE-VOICE RULE: with the Realtime session active, the written turn gets
        // no Chirp voice from the server (the session remains the only voice).
        (micRef.current as unknown as { isRealtime?: boolean } | null)?.isRealtime === true,
      )) {
        if (!firstAt && chunk && chunk.trim()) firstAt = performance.now() // primul cuvânt REAL
        acc += chunk
        // FUNCTIONAL updater, not a snapshot (Jul 25): with a fixed [...next, ...], a
        // VOICE transcript arriving during the written turn was overwritten by
        // the next update and disappeared from the chat. We keep any message added
        // meanwhile and only replace/add the turn's in-progress reply.
        setMessages((cur) => {
          const base = cur.length >= next.length && cur.slice(0, next.length).every((m, i) => m === next[i])
            ? cur
            : next
          const rest = base.slice(next.length).filter((m) => !(m.role === 'assistant' && m.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc, ts: turnTs }]
        })
      }
      // Publishes the REAL time on the counter (only if visible text arrived).
      if (firstAt) {
        setRealLatency({ firstMs: firstAt - t0, totalMs: performance.now() - t0, at: Date.now() })
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
      else suggestFacial(acc) // fața însoțește tonul replicii încheiate
    } catch (err) {
      // A REPLACED TURN MAY NO LONGER WRITE (Adrian, Jul 31: "it hears the second
      // question, briefly shows it, but doesn't pass it on" + "the message that technically
      // appeared again").
      //
      // The `finally` below has long checked `stillCurrent` — it knows the turn
      // may have been replaced by a new one (barge-in) and then leaves its
      // state alone. This `catch` checked NOTHING: the old turn's error rewrote
      // the message list with ITS snapshot, i.e. over the new turn. Your second
      // question appeared and vanished, with a ⚠️ on top. The asymmetry between catch
      // and finally WAS the bug.
      // (Written without the call literal: a guard in aDouaIntrebare.test.ts
      // counts the snapshot writes in the file, and a comment quoting
      // them would be counted as a real one.)
      const codErr = err instanceof Error ? err.message : 'error'
      const inlocuita = abortRef.current !== ac
      if (ac.signal.aborted || codErr === 'aborted' || inlocuita) {
        // Stopped by Adrian or replaced by the new question — no error
        // message, no writing over what's on the screen right now.
      } else {
        // Don't let the voice say more than was written (Jul 10 bug: the text
        // disappeared on error, but the audio kept going).
        stopVoice()
        const code = codErr
        const spoken = strings(resolveLang(replyLang))
        const m =
          code === 'brain_not_configured'
            ? t.brainNotActive
            : code === 'offline'
              ? spoken.offline
              : t.brainError
        // KEEP the text already received (don't drop it) — just add a discreet note,
        // so the text stays complete versus what was heard.
        // FUNCTIONAL updater, not a snapshot — the same lesson as in the streaming
        // loop (line ~912): a message arriving meanwhile (voice transcript,
        // a new question) must not disappear because this turn failed.
        setMessages((cur) => {
          const baza = cur.length >= next.length && cur.slice(0, next.length).every((mm, i) => mm === next[i]) ? cur : next
          const rest = baza.slice(next.length).filter((mm) => !(mm.role === 'assistant' && mm.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`, ts: Date.now() }]
        })
        if (code === 'offline') {
          offlineRef.current = true
          retryTextRef.current = msg // resume THIS message when the signal returns
        }
      }
    } finally {
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

  // The microphone is PERMANENT ON: it starts by itself on entry and reopens
  // by itself when the track dies (phone call, Bluetooth headset removed, another app takes
  // the microphone) or when the tab becomes visible again. The button remains only as a manual
  // pause — the only case where the microphone stays off intentionally.
  const micManualOffRef = useRef(false)
  const micStartingRef = useRef(false)
  const micRetryRef = useRef<number | null>(null)
  const micBackoffRef = useRef(1000)
  // "VOICE PER SENTENCE" — TRIED AND ROLLED BACK (Jul 25): it closed the paid session
  // after every exchange + reopened it by itself on local speech detection
  // (`speechWake.ts`). Two real regressions on the same day (it cut the sentence after 2
  // words; then "hears but doesn't speak") → Adrian: "go back to the full-duplex
  // chat". The session stays open continuously, as before the experiment.

  const onMicErr = (reason: string): void => {
    micRef.current = null
    coalescerRef.current?.cancel()
    setListening(false)
    setLiveVoice('')
    if (reason === 'not-allowed' || reason === 'unsupported') return
    micRetryRef.current = window.setTimeout(() => void ensureMicRef.current(), micBackoffRef.current)
    micBackoffRef.current = Math.min(micBackoffRef.current * 2, 15_000)
  }

  async function ensureMic(preWarmedStream?: MediaStream): Promise<void> {
    if (micRef.current || micStartingRef.current || micManualOffRef.current) return
    if (micRetryRef.current) {
      window.clearTimeout(micRetryRef.current)
      micRetryRef.current = null
    }
    micStartingRef.current = true

    // Adrian, Jul 11: "on restart the microphone button freezes / gets
    // disabled". Cause: if the start threw an exception, the "starting
    // now" flag stayed stuck on true forever → every press fell onto
    // the STOP branch (nothing to stop) and the button looked dead. try/finally
    // guarantees the flag is released on EVERY exit path.
    try {
      // ── VOCE LIVE OpenAI Realtime (full-duplex): microfon + WebRTC direct la
      // OpenAI (the voice brain), which plays the reply itself + has native barge-in/anti-
      // echo. The transcript flows onto the ticker and gets saved on the server. If it's
      // not available (no key / failure), we fall back ONCE to STT→brain→TTS.
      // Kelion takes back its real voice BY ITSELF: if it was latched onto the fallback but
      // the recovery window has passed, it unlatches and retries full-duplex.
      if (realtimeOffRef.current && Date.now() - realtimeOffAtRef.current > REALTIME_RECOVER_MS) {
        realtimeOffRef.current = false
        realtimeFailCountRef.current = 0
      }
      if (!realtimeOffRef.current) {
        try {
          const rv = await startRealtimeVoice({
            language: speechLangRef.current,
            // GPS FROM THE DEVICE (Jul 25): when the session starts we send the current
            // position → the server puts it into the voice context (weather/"where am I").
            coords: coordsRef.current ?? undefined,
            // VERBAL CAMERA/SCREEN COMMAND (Jul 25): the server interprets
            // the speech and returns the command; we execute it on the usual SSE path.
            onDevice: (device) => handleControl({ device }),
            // TEXT accompanies the speech (Adrian, Jul 24: "it doesn't show what it says,
            // it just speaks"): the partials flow onto the live ticker, and the FINAL
            // transcript of every turn enters the CHAT as a visible message.
            onUserTranscript: (text, done) => {
              if (done) {
                setLiveVoice('')
                const t = text.trim()
                if (t) setMessages((ms) => [...ms, { role: 'user', content: t, ts: Date.now() }])
              } else setLiveVoice(text)
            },
            onAssistantTranscript: (text, done) => {
              if (done) {
                setLiveVoice('')
                const t = text.trim()
                if (t) setMessages((ms) => [...ms, { role: 'assistant', content: t, ts: Date.now() }])
                // The EXIT from semi-duplex, UNCONDITIONAL (bug proven Jul 27,
                // "it can't hear me anymore"): only the thinking flag was cleared here,
                // without reopening the microphone — and the 125s net below
                // checks the flag, which I had just cleared → after
                // ANY ask_brain the microphone stayed mute forever. The rule:
                // every entry into mute has a guaranteed exit on ALL
                // paths — reply arrived (here), reply lost (the net).
                // Reopening is idempotent and is the normal full-duplex state.
                thinkingRef.current = false
                micRef.current?.setMuted?.(false)
              } else setLiveVoice(text)
            },
            // REVENIT LA FULL-DUPLEX (Adrian, 25 iul: „revino la chat
            // full-duplex" — after 2 real regressions on the same day with "voice per
            // sentence": it cut the sentence after 2 words, then "hears but doesn't speak").
            // The session stays OPEN continuously, as before the experiment —
            // no automatic closing (no `onResponseDone` here).
            // VOICE AUTONOMY (Adrian, Jul 24: "it doesn't call the tools, it's
            // missing the tools to show things on screen"): the tools requested by
            // the voice model run HERE — show_on_screen directly in the client
            // (the monitor belongs to the browser), the rest through the server, which returns
            // the result + any screen_url to put on the monitor.
            onToolCall: async (name, argsJson) => {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(argsJson || '{}') as Record<string, unknown>
              } catch {
                /* argumente stricate → obiect gol */
              }
              // ESCALATION TO THE BRAIN → SEMI-DUPLEX: while the heavy brain
              // thinks and Kelion is about to speak the reply, we put
              // the microphone on mute so it doesn't talk over itself. We return to
              // full-duplex when Kelion's FINAL transcript arrives
              // (see onAssistantTranscript). The same voice the whole time.
              if (name === 'ask_brain') {
                thinkingRef.current = true
                micRef.current?.setMuted?.(true)
                // Safety net: if the reply never arrives (error),
                // we re-enable the microphone so it doesn't stay mute forever. 125s, not
                // 30s (Jul 25): the brain has a 120s timeout — with 30s, the net
                // opened DURING the thinking on heavy 40-60s requests and
                // the user's speech started a parallel reply over the one in progress.
                window.setTimeout(() => {
                  if (thinkingRef.current) {
                    thinkingRef.current = false
                    micRef.current?.setMuted?.(false)
                  }
                }, 125000)
              }
              // VISION IN VOICE (Adrian: "why can't it see?"): on "look", we capture
              // the current frame from the user's camera and inject it into the call, so
              // the server can give it to the vision model. No camera/frame →
              // the server returns "no_camera" and Kelion says it naturally.
              if (name === 'look' || name === 'see') {
                // ONLY with the camera ON (Jul 25): with the camera off,
                // latestFrameRef kept the last frame from before the shutdown and
                // Kelion "saw" with conviction a scene minutes old.
                const frame = cameraOnRef.current
                  ? (latestFrameRef.current ?? captureRef.current?.() ?? '')
                  : ''
                if (frame) (args as Record<string, unknown>).image = frame
              }
              // GPS ON DEMAND, a dedicated tool (the Jul 26 outage: "gps is not
              // accessible" — after the permanent flow was removed, the voice had
              // NO way to learn the position on "where am I"/"here"). It runs
              // HERE, in the browser: it reads the device's real GPS now,
              // refreshes the session too (updateCoords), returns lat/lon.
              // THE MONITOR, NOT THE CAMERA (Adrian, Jul 27: "when I ask him what's on
              // the monitor he looks at the camera and says what the camera gives him"): the tool
              // reads the ACTUAL monitor state — the open tabs + what's
              // shown now — directly from the workspace store, in the client.
              if (name === 'get_monitor') {
                const w = getWorkspace()
                if (!w.open)
                  return JSON.stringify({ monitor: 'gol', hint: 'Nimic afișat acum pe monitor — spune-i userului sincer.' })
                // THE REAL STATE (Adrian, Jul 27): 'ok' = it really rendered; 'error'
                // = it failed (inaccessible file, a site that refuses embedding);
                // 'loading' = still loading (call get_monitor again in 1-2s).
                const st = w.status ?? 'loading'
                return JSON.stringify({
                  activ: {
                    tip: w.kind,
                    titlu: w.title,
                    url: w.url || undefined,
                    stareReala: st,
                    text: (w.text ?? '').slice(0, 800) || undefined,
                    paginaScrisaDeMine: w.html ? true : undefined,
                  },
                  taburiDeschise: w.tasks.map((tk) => ({ tip: tk.kind, titlu: tk.title, stare: tk.status ?? 'loading' })),
                  indicatie:
                    st === 'error'
                      ? 'SUPRAFAȚA ACTIVĂ A PICAT — NU spune userului că ai afișat-o. Încearcă altă cale (alt URL, adu datele cu o unealtă și afișează-le ca document, sau spune sincer că nu se poate) până apare cu adevărat.'
                      : st === 'loading'
                        ? 'Încă se încarcă — mai verifică peste 1-2 secunde înainte să confirmi.'
                        : 'Randat cu succes.',
                })
              }
              if (name === 'get_location') {
                const fresh = await getFreshCoords()
                if (fresh) {
                  rvLiveRef.current?.updateCoords(fresh)
                  // "PUT ME ON THE MAP" (Adrian, live test Jul 29: "I asked him to
                  // see where I am and he didn't pick up the GPS"): get_location took
                  // the coordinates but did NOT open any map — that's why "it couldn't
                  // be seen". Now, when it gets the real position, it opens on the monitor
                  // the map centered on it, with a pin (OSM → embed with a marker in Stage).
                  handleControl({
                    monitor: { url: `https://www.openstreetmap.org/?mlat=${fresh.lat}&mlon=${fresh.lon}`, title: 'Locația ta' },
                  })
                  return JSON.stringify({ lat: fresh.lat, lon: fresh.lon, shown_on_map: true })
                }
                return JSON.stringify({
                  error: 'location_unavailable',
                  hint: 'Permisiunea de locație e refuzată sau nu există semnal — spune-i userului SINCER că nu ai locația și cere-i să activeze permisiunea. NU inventa un loc, NU folosi o locație implicită.',
                })
              }
              // GPS ONLY WHEN NEEDED, BUT REAL (Adrian, Jul 26): exactly at
              // the moment the voice uses a location tool
              // (weather/maps/routes) we read the device's REAL position — a
              // single query, not a permanent flow — and we give it to the session too
              // (updateCoords), so that "here"/"from here" means the place of NOW.
              if (name === 'get_weather' || name === 'maps_search' || name === 'maps_directions') {
                const fresh = await getFreshCoords()
                if (fresh) rvLiveRef.current?.updateCoords(fresh)
                if (name === 'get_weather' && fresh) {
                  const hasLoc = String(args.location ?? '').trim() !== ''
                  const hasLatLon = Number.isFinite(args.lat as number) && Number.isFinite(args.lon as number)
                  if (!hasLoc && !hasLatLon) {
                    args.lat = fresh.lat
                    args.lon = fresh.lon
                  }
                }
              }
              if (name === 'show_on_screen') {
                const url = String(args.url ?? '').trim()
                const title = String(args.title ?? '') || 'Ecran'
                if (url) handleControl({ monitor: { url, title } })
                else closeAllTasks()
                return JSON.stringify({ shown: true, url })
              }
              // PLAYGROUND IN VOICE (parity with typing): the page written by Kelion
              // runs live on the monitor (sandboxed frame), it can be saved.
              if (name === 'run_web_app') {
                const title = String(args.title ?? '') || 'Aplicație'
                const html = String(args.html ?? '')
                if (html.trim()) handleControl({ app: { title, html } })
                return JSON.stringify({ running: Boolean(html.trim()), title, savable: true })
              }
              // THE BUILDER'S PANEL IN VOICE (Stage 4b, parity with typing):
              // when Kelion takes a build order or is asked for status, it opens
              // the live display on the monitor. We do NOT interrupt the server-side execution —
              // we just open the panel, then let the tool go to the server.
              if (name === 'build_software' || name === 'constructor_status') {
                handleControl({ build: { open: true } })
              }
              // REAL ACCESS TO THE APP (Adrian, Jul 24): Kelion opens the app's
              // own panels by voice. It runs in the client (it's its UI):
              // dispatch an event that Stage/WalletButton listens to. The admin
              // gate is in Stage (a regular user cannot open the admin).
              if (name === 'open_app_view') {
                const view = String(args.view ?? '').trim()
                const section = String(args.section ?? '').trim()
                window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: { view, section } }))
                return JSON.stringify({ opened: view || 'home', section: section || null })
              }
              // GESTURES IN VOICE (Jul 25, parity with the chat): the avatar belongs to
              // the browser → we run the gesture here, on the {gesture} frame.
              if (name === 'play_avatar_gesture') {
                const gesture = String(args.gesture ?? '').trim()
                if (gesture) handleControl({ gesture })
                return JSON.stringify({ gesture })
              }
              try {
                const r = await fetch('/api/realtime/tool', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ name, args }),
                })
                const j = (await r.json()) as {
                  output?: string
                  screen?: { url: string; title: string }
                  promo?: unknown
                }
                if (j.screen?.url) handleControl({ monitor: { url: j.screen.url, title: j.screen.title } })
                // §1 "what typing can do, voice can do too": the promo clip requested by SPEAKING
                // arms the Rec button exactly as from typing (the {promo} frame → armPromo).
                if (j.promo) handleControl({ promo: j.promo as never })
                return String(j.output ?? '{}')
              } catch (e) {
                return JSON.stringify({ error: String(e).slice(0, 200) })
              }
            },
            onState: (s, note) => {
              // SOLID Realtime connection (WebRTC `connected`) → resets the failure
              // counter: full-duplex works, any earlier mishap is forgiven.
              if (s === 'live') {
                realtimeFailCountRef.current = 0
                return
              }
              if (s === 'error') {
                // SESSION ROTATION ≠ FAILURE (live F12 proof, Jul 24: "Your
                // session hit the maximum duration of 60 minutes" → the counter
                // reached 3 after 3 hours of continuous use and extinguished
                // full-duplex for good). OpenAI's 60-min limit is a NORMAL
                // life cycle: we restart WITHOUT penalizing.
                const isRotation = /maximum duration|session.*(expired|limit)|60 minutes/i.test(note ?? '')
                if (!isRotation) {
                  // We count the REAL failure. Latch onto STT ONLY after 3 failures; below
                  // the threshold the next start RETRIES full-duplex.
                  realtimeFailCountRef.current += 1
                  const giveUp = realtimeFailCountRef.current >= REALTIME_MAX_FAILS
                  console.error(
                    `voce realtime a picat (${realtimeFailCountRef.current}/${REALTIME_MAX_FAILS}):`,
                    note ?? 'fără detalii',
                  )
                  if (giveUp) { realtimeOffRef.current = true; realtimeOffAtRef.current = Date.now() }
                }
                if (micRef.current) {
                  // Cleans up the Realtime session if it still exists (mic + WebRTC),
                  // otherwise it stayed captured in parallel with the STT microphone.
                  micRef.current?.stop?.()
                  micRef.current = null
                  setListening(false)
                  setLiveVoice('')
                  micStartingRef.current = false
                  void ensureMicRef.current()
                }
              }
            },
          })
          if (micManualOffRef.current || micRef.current) {
            rv.stop()
            return
          }
          // THE SINGLE-VOICE RULE (Adrian, Jul 26: "there must never be
          // 2 voices at the same time"): we mark the handle as a Realtime session — while it's
          // installed, the written chat's Chirp voice is NOT played (see c.audio) and
          // is no longer synthesized on the server either (serverVoiceOff on send).
          ;(rv as unknown as { isRealtime?: boolean }).isRealtime = true
          micRef.current = rv as unknown as MicHandle
          rvLiveRef.current = rv
          // The pre-warmed stream is only for the STT path; Realtime opens
          // its own microphone — without the closing here, the pre-warm capture stayed
          // STUCK in parallel (mic open twice) for as long as the voice session lasted.
          preWarmedStream?.getTracks().forEach((t) => t.stop())
          // If the fallback TTS is still playing at install time, we start MUTED
          // (anti-echo), as on the STT paths — the unmute comes from stopVoice/onEnd.
          if (isVoicePlaying()) rv.setMuted(true)
          // PROACTIVE ROTATION at 55 min (OpenAI's limit is 60): we restart the session
          // BEFORE the server cuts it — the user feels no break
          // and no "failure" gets counted. The timer dies with the session.
          const rotateTimer = window.setTimeout(() => {
            if (micRef.current === (rv as unknown as MicHandle) && !micManualOffRef.current) {
              rv.stop()
              micRef.current = null
              setListening(false)
              micStartingRef.current = false
              void ensureMicRef.current()
            }
          }, 55 * 60_000)
          // VOICE BILLING PER MINUTE (Adrian, Jul 25): while the voice is active,
          // we pulse every 20s → the server debits the seconds from the credits. On "stop"
          // from the server (out of credit) we stop the voice; on any stop, the timer dies.
          // (GPS is NO longer pushed on this pulse — Adrian, Jul 26: "only
          // when GPS apps are used or location detection is needed".
          // The position is read on demand, in the location tools — see
          // onToolCall + getFreshCoords.)
          let lastTick = Date.now()
          const voiceTick = window.setInterval(() => {
            const secs = Math.round((Date.now() - lastTick) / 1000)
            lastTick = Date.now()
            void fetch('/api/realtime/tick', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ seconds: secs }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((j: { stop?: boolean } | null) => {
                window.dispatchEvent(new CustomEvent('kelion:credits-changed'))
                if (j?.stop) {
                  rv.stop()
                  micRef.current = null
                  setListening(false)
                }
              })
              .catch(() => {})
          }, 20_000)
          const rotStop = rv.stop.bind(rv)
          const origStop = () => {
            clearInterval(voiceTick)
            rotStop()
          }
          rv.stop = () => {
            clearTimeout(rotateTimer)
            // Sesiunea s-a oprit → marcajul cade IMEDIAT, pe orice drum de stop
            // (manual, rotation, out of credit) — even if micRef gets cleaned up
            // later, the chat's Chirp voice doesn't stay stuck on mute.
            ;(rv as unknown as { isRealtime?: boolean }).isRealtime = false
            if (rvLiveRef.current === rv) rvLiveRef.current = null
            origStop()
          }
          micBackoffRef.current = 1000
          setListening(true)
          return
        } catch {
          // The Realtime start threw (no key / WebRTC blocked). We count the
          // same way: 3 chances before latching onto STT — a transient start failure
          // no longer extinguishes full-duplex for the whole session.
          realtimeFailCountRef.current += 1
          if (realtimeFailCountRef.current >= REALTIME_MAX_FAILS) { realtimeOffRef.current = true; realtimeOffAtRef.current = Date.now() }
        }
      }

      // ── LIVE DICTATION (streaming): every word appears on the ticker instantly, gets
      // validated when confirmed, and on a PAUSE > 3s the sentence leaves for the brain
      // (Adrian's order, Jul 10). If the WS drops or goes silent, we fall back ONCE
      // to the proven batch path — the voice never breaks.
      if (streamModeRef.current) {
        const sh = await startMicStream({
          preWarmedStream,
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
          // STOP pressed while I was starting, or another start already installed a
          // microphone — respect the existing state, don't install over it.
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

      // ── BATCH (proven): records the sentence, transcribes it at /api/asr. ──
      coalescerRef.current = createUtteranceCoalescer((text) => void sendRef.current(text))
      const h = await startMic(
        (text) => coalescerRef.current?.push(text),
        onMicErr,
        () => speechLangRef.current,
        // BARGE-IN (Adrian's order): when his voice is heard over Kelion,
        // Kelion's voice is cut ON THE SPOT and the microphone comes back to listen to him.
        () => {
          stopVoice()
          micRef.current?.setMuted(false)
        },
        // "only my voice or my writing, no other is accepted" — admin is the only
        // role restricted to its own calibrated voice; demo (visitors) stays unchanged.
        isAdmin,
        preWarmedStream,
      )
      if (h) {
        // STOP pressed while I was starting, or another start already installed a
        // microphone — respect the existing state, don't install over it.
        if (micManualOffRef.current || micRef.current) {
          h.stop()
          return
        }
        micRef.current = h
        micBackoffRef.current = 1000
        setListening(true)
        // Restarted while the brain is still speaking: it starts muted (anti-echo); it comes back
        // by itself at the end of the playback, as with any reply.
        if (isVoicePlaying()) h.setMuted(true)
      }
    } finally {
      micStartingRef.current = false
    }
  }
  const ensureMicRef = useRef(ensureMic)
  ensureMicRef.current = ensureMic

  function toggleMic(): void {
    // Adrian, Jul 11: "the microphone button doesn't work right". Cause: the start
    // is async (~0.5–2s); a press in that window didn't find micRef yet
    // and fell onto the START branch — i.e. stopping was impossible to express
    // while the boot was in flight, and a double-click left the microphone forever
    // on. Now: pressed during the start = STOP (manualOff), and
    // ensureMic checks manualOff after every await before installing.
    if (micRef.current || micStartingRef.current) {
      micManualOffRef.current = true
      // Also release the start flag: if the boot really is in flight, it sees
      // manualOff at the end and stops by itself; if the flag was stuck from an
      // old error, the button heals here instead of staying dead.
      micStartingRef.current = false
      micRef.current?.stop()
      micRef.current = null
      // intentional stop: a stuck fragment must NOT be sent after teardown
      coalescerRef.current?.cancel()
      setListening(false)
      return
    }
    micManualOffRef.current = false

    // PRE-WARM: we open the microphone before startMicStream, so that pressing
    // the "mic on" button activates almost instantly. If the user presses
    // STOP during the warmup, we stop the pre-warmed stream and give up.
    if (navigator.mediaDevices?.getUserMedia) {
      micStartingRef.current = true
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
          if (micManualOffRef.current || micRef.current) {
            stream.getTracks().forEach((t) => t.stop())
            micStartingRef.current = false
            return
          }
          // WE HAND OVER THE BATON (Jul 25 — Adrian: "after I stop the microphone I can't
          // start it again"): ensureMic guards on micStartingRef and exited IMMEDIATELY
          // while our pre-warm flag was still true → the button's start
          // died in vain, and the flag stayed stuck on true and every
          // next press fell alternately onto stop/nothing. We release the flag
          // right before the handover — the section is synchronous, ensureMic takes it
          // back by itself on entry, so the race window is zero.
          micStartingRef.current = false
          await ensureMicRef.current(stream)
          if (!micRef.current) {
            stream.getTracks().forEach((t) => t.stop())
          }
        } catch {
          // Pre-warm failed → we let the normal path report the error/correctly.
          micStartingRef.current = false
          void ensureMicRef.current()
        }
      })()
      return
    }
    void ensureMicRef.current()
  }

  // Permanent hearing: starts TOGETHER WITH THE AVATAR LOADING (Adrian, Jul 28:
  // "move the opening to when the GLB loads"). WHY: starting at the raw
  // mount ran DURING the heavy parsing of the 3D model (`/kelion-rpm.glb`) —
  // main thread busy → getUserMedia/AudioContext stumbled, the first
  // call failed and went into backoff retries (1s→2s→4s…), hence "starts
  // slowly". Now we wait for the `kelion:avatar-ready` signal (emitted by AvatarModel
  // when the base GLB has loaded, the thread is free) and ONLY THEN arm
  // the microphone — the first try catches, no backoff. For the owner (permission
  // already granted) it starts with no click. 4s net: if the avatar doesn't load
  // (page without an avatar / GLB failure), the microphone starts anyway, it's not lost.
  useEffect(() => {
    let armed = false
    const arm = (): void => {
      if (armed) return
      armed = true
      void ensureMicRef.current()
    }
    // If the avatar already loaded before we attach the listener (a race on
    // a fast start), we start on the spot; otherwise we wait for the event.
    if ((window as unknown as { __kelionAvatarReady?: boolean }).__kelionAvatarReady) arm()
    else window.addEventListener('kelion:avatar-ready', arm, { once: true })
    const armFallback = window.setTimeout(arm, 4000)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void ensureMicRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('kelion:avatar-ready', arm)
      window.clearTimeout(armFallback)
      document.removeEventListener('visibilitychange', onVisible)
      if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
      micRef.current?.stop()
      micRef.current = null
      coalescerRef.current?.cancel()
      stopVoice()
    }
  }, [])

  // ULTRA-FAST FULL-DUPLEX STREAMING FOR EVERYONE, THE SAME (Adrian, Jul 14: "audio
  // full duplex streaming ultra fast for everyone, now; everyone equally fast").
  // REMOVED the admin-only LiveKit detour: it entered the LiveKit room ALONE and stopped
  // the HTTP microphone, but when the voice agent on the VPS did NOT process audio, the state
  // stayed `live` (fallback ONLY on `error`/`closed`) → the admin "left but couldn't
  // hear", a different (deaf) experience than the clients'. NOW admin AND clients use
  // EXACTLY the same path: instant streaming (`micStream` → /api/asr-stream Google STT,
  // VOX + barge-in, fast first word), started default-on by the "Permanent hearing"
  // above — proven to work (the real voiceprints are created on it). Zero separate
  // admin channel, zero dependency on the LiveKit agent.

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
  useEffect(() => {
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
  }, [])

  // Permanent vision — camera ON by default. The camera is switched by voice/
  // text command (no button), so no need to probe for a second camera here.
  useEffect(() => {
    if (cameraSupported()) setCameraOn(true)
  }, [])

  // GPS ONLY WHEN NEEDED (Adrian, Jul 26: "only when GPS apps are used
  // or location detection is needed" — he explicitly rejected the permanent flow).
  // We NO longer keep watchPosition running non-stop: the position is read ON THE SPOT, with
  // a single query, at the moment the turn/tool really needs
  // it (weather, maps, "where am I"). `coordsRef` keeps only the last legitimate
  // reading, as a memory — it never refreshes itself.
  const getFreshCoords = (): Promise<Coords | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(coordsRef.current)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lon: pos.coords.longitude }
          coordsRef.current = c
          resolve(c)
        },
        // Refusal/failure → we stay on the last known position (may be null).
        () => resolve(coordsRef.current),
        // THE "GPS inaccessible" OUTAGE (Jul 26): the first variant asked for HIGH
        // (satellite) precision with a 5s timeout — on a COLD read, with no permanent watcher,
        // the GPS fix takes well over 5s → it failed most of the time. Now: standard
        // precision (network/wifi — answers in 1-3s, enough for weather/
        // maps/"where am I"), 10s timeout, 2 min cache.
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 },
      )
    })

  // Capture at 4 frames/s PERMANENTLY (Adrian, Jul 11 — the old 1 fps pace on
  // the spot left vision choppy; indoor GPS doesn't detect movement, so it
  // stayed on 1 forever). In motion it climbs up to 8 fps. The frames collect in
  // the circular buffer (the last 4); they leave for the brain only on a turn — continuous
  // sending remains forbidden by cost.
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
        // We keep the LAST 8 frames (≈2s at 4 fps) — the K2 brain sees the motion over
        // a longer window (Adrian, Jul 13). The send takes `slice(-8)`.
        if (b.length > 8) b.shift()
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
      // Camera off → the buffer empties (old frames must not show up
      // in a later turn, after a restart). latestFrameRef too (Jul 25):
      // it stayed full and `look` from the voice described an old scene with the camera off.
      frameBufRef.current = []
      latestFrameRef.current = null
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
  // STABLE IDENTITY (the Jul 27 fluidity audit, defect 4): as a plain
  // function, it got a NEW identity on every render → the CameraView effect
  // (dependent on onError) unmounted/remounted CONTINUOUSLY: the camera stopped-started
  // dozens of times per second during streaming, and the serial release
  // chain (camera.ts, 450ms/stop) grew faster than real time —
  // vision died. useCallback([]) = a single identity for the component's lifetime.
  const onCameraError = useCallback((): void => {
    setCameraOn(false)
  }, [])

  // Voiceprint calibration: 3s of capturing Adrian's voice, then the profile
  // saves locally (audioIO.ts) and the permanent microphone starts filtering it.
  async function calibrateVoice(): Promise<void> {
    if (voiceCalState === 'listening') return
    setVoiceCalState('listening')
    const ok = await calibrateVoiceprint(3000)
    setHasVoicePrint(hasVoiceprint())
    setVoiceCalState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setVoiceCalState('idle'), 2000)
  }
  // AUTOMATIC (Adrian, Jul 12: "the one with the button happens automatically"): voice
  // recognition no longer asks for a click. When the admin enters and has no voiceprint yet, we
  // calibrate it OURSELVES (from the first seconds of speech); if it doesn't catch (silence),
  // it retries until it succeeds. The manual button was removed.
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
  // The REAL latency measured in the browser — shown as proof, not thrown away.
  const realLatency = useSyncExternalStore(subscribeRealLatency, getRealLatency)
  const monitorMode = wsOpen || monitorBusy
  // Show the CURRENT exchange in writing: the user's request (so he sees it
  // arrived correctly the instant he types) AND Kelion's reply, which updates
  // live as it streams — not just one sentence.
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
  const hint = t.chatHint
  // The right-hand button concerns ONLY the WRITTEN chat. You have something to send (text or
  // attached file) → it's active. Empty field → the chat is AUDIO (the microphone is always
  // on, the voice comes in by itself), so the button stays a neutral arrow, NOT a
  // dead stop-square. The ■ square appears ONLY when you really have text to stack over
  // a turn in progress (then click = you queue it, it interrupts nothing).
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
          spațiului de acolo răspunsurile de chat”). Bulele care pluteau peste
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
      {/* VITEZA REALĂ (auditul 27 iul: latența se măsura la fiecare tură și se
          ARUNCA — cititorii nu erau chemați de nimeni). Dovada regulii „primul
          cuvânt sub 1s", discretă, doar proaspătă (sub 2 min de la măsurare). */}
      {realLatency && Date.now() - realLatency.at < 120_000 && (
        <span className="latency-chip" title={uiStrings().latencyChip}>
          ⚡ {(realLatency.firstMs / 1000).toFixed(1)}s · {(realLatency.totalMs / 1000).toFixed(1)}s
        </span>
      )}
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
      <div className={`composer ${busy ? 'working' : ''}`}>
        {/* DICTARE LIVE cu efect cinematografic (ca în filmele cu AI): pe măsură
            ce Adrian vorbește, fraza apare cuvânt cu cuvânt, cu cursor care
            clipește; la pauză > 3s pleacă la creier și banda se golește. */}
        {/* REGULĂ FIXĂ (Adrian, 10 iul: „nu vreau să văd pe interfață ceva ce
            acoperă pagina — textul curge ca teletextul, pe o singură linie”):
            ORICE bandă live e o linie fixă, text pe o singură linie, care
            derulează (teletext) dacă nu încape — NICIODATĂ nu crește pe
            verticală, niciodată nu acoperă pagina. */}
        {liveVoice && (
          <div className="voice-live" aria-live="polite">
            <span className="voice-live-dot" />
            {/* COADĂ FIXĂ, nu teletext remontat (fluiditate #9): la dictare,
                textul crește pe loc arătându-și coada — nu mai sare off-screen
                la fiecare cuvânt nou. */}
            <span className="speech-tail">
              <span className="speech-tail-text">{liveVoice}</span>
            </span>
            <span className="voice-live-caret" />
          </div>
        )}
        {/* ONE BAND, BOTH DIRECTIONS (Adrian, Jul 11 evening: "things must be
            swept here, from the brain and towards the brain — no other written
            chat shows"). The band changes its sign with the turn's phase:
            👤 = YOUR TEXT, SHOWN ONCE (Adrian, Aug 1: "the text must not show
            towards the model and then the same text again towards the brain —
            only what enters the brain, a single time") — first what was sent,
            swapped IN PLACE for the server-confirmed {heard} when it arrives,
            never a second display; 🧠 = the brain is thinking (only when there
            is no user text to show); K = the reply flows FROM the brain (text
            tail while streaming, ticker when done). One row, always. */}
        {busy && !lastAssistant?.content ? (
          heard || lastUser?.content ? (
            <div className="heard-band user-band" aria-live="polite">
              <span className="heard-band-label" title={uiStrings().heardYouTitle}>👤</span>
              <span className="speech-tail">
                <span className="speech-tail-text">{(heard || lastUser?.content || '').slice(0, 400)}</span>
              </span>
            </div>
          ) : (
            <div className="heard-band" aria-live="polite">
              <span className="heard-band-label" title={uiStrings().heardBrainTitle}>🧠</span>
              <span className="speech-tail">
                <span className="speech-tail-text">…</span>
              </span>
            </div>
          )
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
                  key={lastAssistant?.ts ?? 'empty'}
                  style={{ '--ticker-dur': tickerDur(lastAssistant?.content ?? '') } as CSSProperties}
                >
                  {lastAssistant?.content}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {/* SCOS (ordin Adrian, 10 iul: „scoate chestia aia microphone is muted,
            că e greșită” + „microfon cu autovox, instant”): microfonul nu mai
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
            // A click anywhere in the bar (outside the buttons and the input itself)
            // focuses the typing field ON THE FIRST TRY — no more multiple clicks.
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
                {/* Full-duplex mâini-libere: NU mai există buton — microfonul se
                    deschide SINGUR la montarea chatului (vezi useEffect „Permanent
                    hearing”), cu VOX + barge-in. Butonul LiveKit a fost scos (ordin
                    Adrian, 13 iul): era un dublet mort (serverul LiveKit nici nu e
                    pornit), full-duplexul real merge pe calea vocală automată. */}
                {/* Butonul „Trezire Kelion” a fost SCOS (Adrian, 13 iul): trezirea e
                    AUTOMATĂ — microfonul e deja mereu pornit (useEffect „Permanent
                    hearing”), deci Kelion se trezește la PRIMUL SUNET auzit; iar la
                    scris se trezește la PRIMA LITERĂ tastată (câmpul e mereu activ).
                    Nu mai e nimic de apăsat. */}
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
                {/* Butoanele „Recunoaște-mi vocea” ȘI „Resetează vocea” au fost
                    SCOASE (Adrian, 13 iul): calibrarea vocală e complet automată
                    (vezi useEffect-ul de calibrare de mai sus); nu mai e nimic de
                    apăsat manual. */}
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
          {/* VOLUMUL VOCII (25 iul — Adrian: „volumul audio incontrolabil"):
              o singură comandă pentru TOATĂ vocea lui Kelion (Realtime + TTS),
              persistată; până azi nu exista niciun control de volum în aplicație. */}
          <input
            type="range"
            className="composer-volume"
            min={0}
            max={100}
            value={Math.round(voiceVol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setVoiceVolState(v)
              setVoiceVolume(v)
            }}
            aria-label="Volumul vocii lui Kelion"
            title={`Volum voce: ${Math.round(voiceVol * 100)}%`}
          />
          <button
            type="button"
            className={`composer-send ${queueing ? 'queueing' : ''}`}
            onClick={() => {
              // Typed text has PRIORITY: we cancel the pending voice,
              // we don't send it ahead of the text (lost typed messages bug).
              coalescerRef.current?.cancel()
              void send(input)
            }}
            // Active while you have something TYPED to send. Empty field (audio chat) → it stays
            // a neutral arrow, disabled — not a dead stop-square. A text sent
            // while Kelion is answering does NOT interrupt the turn: it gets queued
            // (send() stacks it) and leaves as soon as the turn ends.
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
          // ANY FILE TYPE (Adrian, Jul 25: "it can't analyze what I send,
          // any file type"): no restrictive list on the picker — images
          // go to vision, the rest through MarkItDown (PDF/Word/Excel/PPT/HTML/…) →
          // text for the brain; what can't be converted goes raw to the admin.
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
