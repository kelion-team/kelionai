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
import { cameraSupported, hasMultipleCameras, type Facing } from '../lib/camera'

// "Hey Kelion" wake word (interim — Web Speech transcript match; the spec's
// low-power engine is Picovoice Porcupine). Accepts the documented variants.
const WAKE = /\b(hey\s+|hei\s+)?(kelion|kelian|kelyon|hey\s*k(ey)?)\b/i
// Spoken interrupt while Kelion is talking (barge-in).
const STOP = /\b(stop|stai|opre[sș]te|opreste|gata|taci|destul)\b/i
const IDLE_MS = 60_000 // back to standby after this much silence (spec: ~1 min)

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
  const speechLang = lang === 'ro' ? 'ro-RO' : 'en-US'
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  const [awake, setAwake] = useState(false) // post wake-word active conversation
  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<Facing>('user')
  const [canSwitchCam, setCanSwitchCam] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

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

  async function send(text: string): Promise<void> {
    const msg = text.trim()
    if (!msg || busyRef.current) return
    setInput('')
    stopSpeaking()
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
            enqueueSpeech(acc.slice(spoken, end), speechLang)
            spoken = end
          }
        }
      }
      if (speak && acc.length > spoken) enqueueSpeech(acc.slice(spoken), speechLang)
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
    if (idleRef.current) window.clearTimeout(idleRef.current)
    idleRef.current = window.setTimeout(() => setAwake(false), IDLE_MS)
  }

  // Heard a final utterance from the permanent mic.
  function onHeard(raw: string): void {
    const text = raw.trim()
    if (!text) return
    if (isSpeaking()) {
      // While Kelion talks, only a stop-word counts (echo guard / barge-in).
      if (STOP.test(text)) stopSpeaking()
      return
    }
    if (!awakeRef.current) {
      if (WAKE.test(text)) {
        setAwake(true)
        armIdle()
        const rest = text.replace(WAKE, '').trim()
        if (rest.length > 1) void sendRef.current(rest)
      }
      return
    }
    armIdle()
    void sendRef.current(text)
  }

  // Permanent listening — starts once, no button (spec: hands-free wake word).
  useEffect(() => {
    if (!speechSupported()) return
    const h = startContinuous(speechLang, (heard) => onHeard(heard))
    contRef.current = h
    return () => {
      h?.stop()
      contRef.current = null
      if (idleRef.current) window.clearTimeout(idleRef.current)
      stopSpeaking()
    }
    // run once for the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (timer) window.clearInterval(timer)
      timer = window.setInterval(tick, Math.round(1000 / fps))
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
      if (timer) window.clearInterval(timer)
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
