import { useEffect, useRef, useState } from 'react'
import { streamChat, type ChatMessage } from '../lib/chat'
import { strings, type Lang } from '../lib/i18n'
import {
  enqueueSpeech,
  stopSpeaking,
  isSpeaking,
  startContinuous,
  speechSupported,
  type ContinuousHandle,
} from '../lib/voice'
import CameraView from './CameraView'
import MicMeter from './MicMeter'
import { cameraSupported, hasMultipleCameras, type Facing } from '../lib/camera'
import { defaultSpeechLang, detectLangFromText } from '../lib/languages'
import { detectLanguageFromMic } from '../lib/langDetect'
import { loadLocalLang, loadServerLang, saveLang } from '../lib/prefs'
import { correctTranscript } from '../lib/correct'

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

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export default function ChatPanel({ lang }: { readonly lang: Lang }) {
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
  const [canSwitchCam, setCanSwitchCam] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)

  const contRef = useRef<ContinuousHandle | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const latestFrameRef = useRef<string | null>(null)
  const idleRef = useRef<number | null>(null)
  // Refs mirror state for the always-on voice callback (registered once).
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut
  const awakeRef = useRef(awake)
  awakeRef.current = awake
  const busyRef = useRef(busy)
  busyRef.current = busy
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  async function send(text: string): Promise<void> {
    const msg = text.trim()
    if (!msg || busyRef.current) return
    setInput('')
    stopSpeaking()
    // Auto-switch the voice/recognizer language from the message text (cheap;
    // audio-based detection on the mic covers the speak-first case).
    const detected = detectLangFromText(msg)
    if (detected) changeSpeechLang(detected)
    const ttsLang = speechLangRef.current
    const speak = voiceOutRef.current
    const image = cameraOnRef.current
      ? (latestFrameRef.current ?? captureRef.current?.() ?? undefined)
      : undefined

    const next: ChatMessage[] = [...messages, { role: 'user', content: msg }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      let acc = ''
      let spoken = 0
      for await (const chunk of streamChat(next, image ?? undefined)) {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc }])
        if (speak) {
          const end = lastSentenceEnd(acc)
          if (end > spoken) {
            enqueueSpeech(acc.slice(spoken, end), ttsLang)
            spoken = end
          }
        }
      }
      if (speak && acc.length > spoken) enqueueSpeech(acc.slice(spoken), ttsLang)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'error'
      const m = code === 'brain_not_configured' ? t.brainNotActive : t.brainError
      setMessages([...next, { role: 'assistant', content: `⚠️ ${m}` }])
    } finally {
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

  // The mic is button-driven: starting on a user click reliably gets the
  // browser mic permission (auto-start on mount was being blocked silently).
  function startVoice(): void {
    contRef.current?.stop()
    setMicError(null)
    const h = startContinuous(
      speechLangRef.current,
      (heard, conf) => onHeard(heard, conf),
      (error) => {
        // Permanent failures (permission blocked, no mic) — tell the user.
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
      setAwake(true) // channel ON = active conversation, no wake word needed
      armIdle()
      // Detect the spoken language from the audio itself (handles speaking a
      // language the browser recognizer isn't set to, e.g. Chinese on an EN
      // browser) and switch hearing + voice to it.
      void detectLanguageFromMic().then((code) => {
        if (code) changeSpeechLang(code)
      })
    } else {
      setMicError(t.micUnsupported)
    }
  }
  function stopVoice(): void {
    contRef.current?.stop()
    contRef.current = null
    setListening(false)
    setAwake(false)
    stopSpeaking()
  }
  function toggleVoice(): void {
    if (listening) stopVoice()
    else startVoice()
  }
  // Switch the language Kelion hears + speaks; restart the recognizer live and
  // persist the choice per user. No-op if it's already the active language.
  function changeSpeechLang(code: string): void {
    if (code === speechLangRef.current) return
    speechLangRef.current = code // apply immediately for startVoice below
    setSpeechLang(code)
    saveLang(code)
    if (listeningRef.current) {
      contRef.current?.stop()
      startVoice()
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
        if (st.state === 'granted' && !listeningRef.current) startVoice()
        st.onchange = () => {
          if (st.state === 'granted' && !listeningRef.current) startVoice()
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
      contRef.current?.stop()
      contRef.current = null
      if (idleRef.current) globalThis.clearTimeout(idleRef.current)
      stopSpeaking()
    }
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
    apply(loadLocalLang())
    void loadServerLang().then(apply)
  }, [])

  // Permanent vision — camera ON by default; detect a second camera for switch.
  useEffect(() => {
    if (cameraSupported()) {
      setCameraOn(true)
      void hasMultipleCameras().then(setCanSwitchCam)
    }
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
            {last.content || (busy ? '…' : '')}
          </div>
        )}
      </div>
      <MicMeter active={listening} label={t.hearingLabel} />
      {micError && <p className="mic-error">{micError}</p>}
      <div className="chat-input">
        <div className="fn-wrap" ref={menuRef}>
          <button
            type="button"
            className={`chat-icon ${menuOpen || awake ? 'live' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            title={t.functionsTitle}
            aria-label={t.functionsTitle}
            aria-expanded={menuOpen}
          >
            ⊕
          </button>
          {menuOpen && (
            <div className="fn-menu">
              <button type="button" className="fn-item" onClick={toggleVoiceOut}>
                <span className="ico">{voiceOut ? '🔊' : '🔇'}</span>
                {t.voiceTitle}
                {voiceOut && <span className="dot" />}
              </button>
              {cameraSupported() && (
                <>
                  <button type="button" className="fn-item" onClick={toggleCamera}>
                    <span className="ico">{cameraOn ? '🔌' : '📷'}</span>
                    {cameraOn ? t.disconnectCamTitle : t.connectCamTitle}
                    {cameraOn && <span className="dot" />}
                  </button>
                  {cameraOn && canSwitchCam && (
                    <button type="button" className="fn-item" onClick={switchCamera}>
                      <span className="ico">🔄</span>
                      {t.switchCamTitle}
                    </button>
                  )}
                </>
              )}
              <button type="button" className="fn-item" disabled>
                <span className="ico">📎</span>
                {t.attachTitle}
              </button>
            </div>
          )}
        </div>
        {speechSupported() && (
          <button
            type="button"
            className={`chat-icon ${listening ? 'live' : ''}`}
            onClick={toggleVoice}
            title={t.micTitle}
            aria-label={t.micTitle}
          >
            {listening ? '●' : '🎤'}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          placeholder={t.chatPlaceholder}
          disabled={busy}
        />
        <button type="button" onClick={() => void send(input)} disabled={busy || !input.trim()}>
          {t.send}
        </button>
      </div>
    </div>
  )
}
