import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { strings, type Lang } from '../lib/i18n'
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
import { startFullDuplex, type FullDuplexHandle } from '../lib/fullDuplexVoice'
import { loadLocalLang, loadServerLang, saveLang } from '../lib/prefs'
import { correctTranscript } from '../lib/correct'
import { openWorkspace, closeWorkspace } from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'

// Promo scenario recording: hard cap so a clip never runs away (a short clip is
// ~15s; a full landing demo can use the whole window).
const SCENARIO_MAX_MS = 60_000

// "Hey Kelion" wake word (interim — Web Speech transcript match; the spec's
// low-power engine is Picovoice Porcupine). Accepts the documented variants.
const WAKE = /\b(hey\s+|hei\s+)?(kelion|kelian|kelyon|hey\s*k(ey)?)\b/i
// Spoken interrupt while Kelion is talking (barge-in).
const STOP = /\b(stop|stai|opre[sș]te|opreste|gata|taci|destul)\b/i
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

// Spec: only ONE phrase on screen. Show the current/last sentence (live caption),
// updating as it streams.
function latestSentence(s: string): string {
  const parts = s.split(/(?<=[.!?…]["'”’)\]]?)\s+/)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim()
    if (p) return p
  }
  return s.trim()
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

export default function ChatPanel({ lang, isAdmin }: { readonly lang: Lang; readonly isAdmin: boolean }) {
  const t = strings(lang)
  // Speech language (recognition + Kelion's voice). Defaults to the browser
  // locale; the user can switch to any supported language in the ⊕ menu.
  const [speechLang, setSpeechLang] = useState(() => defaultSpeechLang(lang))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  const [awake, setAwake] = useState(false) // post wake-word active conversation
  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  // Attached images (ChatGPT-style composer). Sent to Claude's vision on send.
  const [attachments, setAttachments] = useState<{ id: string; url: string; name: string }[]>([])
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

  // Kelion drives the monitor himself (no manual button): a control frame from
  // the stream opens/clears the workspace surface behind the avatar.
  function handleControl(c: ChatControl): void {
    if (!c.monitor) return
    if (c.monitor.url) openWorkspace(c.monitor.title || t.monitorTitle, c.monitor.url)
    else closeWorkspace()
  }

  // Short spoken + on-screen acknowledgement for a local command (camera, etc.).
  function ack(text: string): void {
    setMessages((cur) => [...cur, { role: 'assistant', content: text }])
    if (voiceOutRef.current) enqueueSpeech(text, speechLangRef.current)
  }

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
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'))
    e.target.value = '' // let the same file be picked again later
    for (const file of files) {
      const reader = new FileReader()
      reader.onload = () =>
        setAttachments((cur) => [
          ...cur,
          { id: `${Date.now()}-${file.name}-${cur.length}`, url: String(reader.result), name: file.name },
        ])
      reader.readAsDataURL(file)
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
    if (busyRef.current || inFlightRef.current) return
    inFlightRef.current = true
    setInput('')
    setAttachments([])
    stopSpeaking()
    // A new turn returns the avatar to center; Kelion reopens the monitor via
    // show_on_screen if THIS turn needs it (otherwise it stays centered).
    closeWorkspace()
    const speak = voiceOutRef.current
    // The voice follows the LANGUAGE OF THIS REPLY (Kelion mirrors the user's
    // language), not a drifting global setting — so a Romanian reply is never
    // read by an English voice (the "defective ro"). Seed from the user's
    // message, then refine from the reply once enough text has streamed.
    // If the user's message is long enough to detect, lock the reply language now;
    // otherwise wait until enough reply text has streamed. We do NOT speak until
    // the language is locked, so the WHOLE reply uses one voice (no mid-reply
    // switch from a wrong seed → the "two voices" bug).
    const seedLang = detectLangFromText(msg)
    let replyLang = seedLang ?? speechLangRef.current
    let langFixed = seedLang !== null
    // An attached image takes priority over the live camera frame for this turn.
    const attached = atts.find((a) => a.url.startsWith('data:image'))?.url
    const image =
      attached ??
      (cameraOnRef.current
        ? (latestFrameRef.current ?? captureRef.current?.() ?? undefined)
        : undefined)
    const outgoing = msg || t.imagePrompt

    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      let acc = ''
      let spoken = 0
      for await (const chunk of streamChat(
        next,
        image ?? undefined,
        coordsRef.current ?? undefined,
        handleControl,
      )) {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc }])
        if (speak) {
          if (!langFixed && acc.trim().length >= 24) {
            replyLang = detectLangFromText(acc) ?? replyLang
            langFixed = true
          }
          if (langFixed) {
            const end = lastSentenceEnd(acc)
            if (end > spoken) {
              enqueueSpeech(acc.slice(spoken, end), replyLang)
              spoken = end
            }
          }
        }
      }
      if (speak) {
        if (!langFixed) replyLang = detectLangFromText(acc) ?? replyLang
        if (acc.length > spoken) enqueueSpeech(acc.slice(spoken), replyLang)
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'error'
      const m = code === 'brain_not_configured' ? t.brainNotActive : t.brainError
      setMessages([...next, { role: 'assistant', content: `⚠️ ${m}` }])
    } finally {
      inFlightRef.current = false
      setBusy(false)
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
    void sendRef.current(toSend)
  }

  // Heard a final utterance from the permanent mic.
  function onHeard(raw: string, confidence: number): void {
    const text = raw.trim()
    if (!text) return
    // While Kelion talks, only a stop-word counts (echo guard / barge-in).
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
    // While Kelion is speaking, only a stop-word counts — otherwise his own TTS
    // leaking through the mic (imperfect AEC) restarts the turn over and over.
    if (isSpeaking()) {
      if (STOP.test(clean)) stopSpeaking()
      return
    }
    // Don't flip the global language per utterance (it landed on a wrong/defective
    // language). The reply's voice language is detected from the reply text in send().
    armIdle()
    void sendRef.current(clean)
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
    )
    if (fd) {
      fdRef.current = fd
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

  // Anti-echo for the Web Speech fallback only: mute the recognizer while Kelion
  // speaks (it can't be echo-cancelled). Full-duplex uses real AEC, so it stays
  // open and the user can talk over Kelion.
  useEffect(() => {
    setOnSpeakingChange((speaking) => {
      if (!fdRef.current) contRef.current?.setMuted(speaking)
    })
    return () => setOnSpeakingChange(null)
  }, [])

  // Load the user's persisted speech language (localStorage instantly, then the
  // server which follows the user across devices). Auto-detection still refines
  // it from what's actually spoken/typed.
  useEffect(() => {
    const apply = (code: string | null): void => {
      if (!code) return
      langPinnedRef.current = true // an established preference — don't auto-override
      if (code === speechLangRef.current) return
      speechLangRef.current = code
      setSpeechLang(code)
    }
    apply(loadLocalLang())
    void loadServerLang().then(apply)
  }, [])

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

  const last = messages.at(-1)
  const hint = speechSupported() ? t.wakeHint : t.chatHint

  return (
    <div className="chat">
      <CameraView
        active={cameraOn}
        facing={facing}
        onError={onCameraError}
        captureRef={captureRef}
      />
      <div className="chat-log">
        {messages.length === 0 && <p className="chat-hint">{hint}</p>}
        {last && (
          <div className={`bubble ${last.role}`}>
            {last.content ? latestSentence(last.content) : busy ? '…' : ''}
          </div>
        )}
      </div>
      <MicMeter active={listening} label={t.hearingLabel} />
      {micError && <p className="mic-error">{micError}</p>}
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
          accept="image/*"
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
