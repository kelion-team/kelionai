import { useCallback, useEffect, useRef, useState } from 'react'
import { streamChat, type ChatMessage } from '../lib/chat'
import { strings, type Lang } from '../lib/i18n'
import {
  enqueueSpeech,
  stopSpeaking,
  isSpeaking,
  setOnSpeechIdle,
  listenOnce,
  startContinuous,
  speechSupported,
  type ContinuousHandle,
} from '../lib/voice'
import CameraView from './CameraView'
import { cameraSupported, hasMultipleCameras, type Facing } from '../lib/camera'

// Index just past the last completed sentence in `s` (ends on . ! ? … then
// whitespace). Used to feed whole sentences to TTS as the reply streams in.
function lastSentenceEnd(s: string): number {
  const re = /[.!?…]["'”’)\]]?\s/g
  let end = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) end = m.index + m[0].length
  return end
}

export default function ChatPanel({ lang }: { lang: Lang }) {
  const t = strings(lang)
  const speechLang = lang === 'ro' ? 'ro-RO' : 'en-US'
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  const [listening, setListening] = useState(false) // push-to-talk active
  const [continuous, setContinuous] = useState(false) // permanent listening
  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<Facing>('user') // front by default
  const [canSwitchCam, setCanSwitchCam] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pttRef = useRef<{ stop: () => void } | null>(null)
  const contRef = useRef<ContinuousHandle | null>(null)
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  // When Kelion finishes speaking, re-open the continuous mic (anti-echo guard).
  useEffect(() => {
    setOnSpeechIdle(() => contRef.current?.setMuted(false))
    return () => setOnSpeechIdle(null)
  }, [])

  // Release mic + voice on unmount.
  useEffect(
    () => () => {
      contRef.current?.stop()
      pttRef.current?.stop()
      stopSpeaking()
    },
    [],
  )

  // Show the front/back switch only when the device has more than one camera.
  useEffect(() => {
    if (cameraSupported()) void hasMultipleCameras().then(setCanSwitchCam)
  }, [])

  const onCameraError = useCallback(() => setCameraOn(false), [])

  async function send(override?: string): Promise<void> {
    const text = (override ?? input).trim()
    if (!text || busy) return
    setInput('')
    stopSpeaking()
    contRef.current?.setMuted(true) // don't hear ourselves while replying
    const speak = voiceOutRef.current

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      let acc = ''
      let spoken = 0
      for await (const chunk of streamChat(next)) {
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
      const msg = code === 'brain_not_configured' ? t.brainNotActive : t.brainError
      setMessages([...next, { role: 'assistant', content: `⚠️ ${msg}` }])
    } finally {
      setBusy(false)
      // If we aren't (or won't be) speaking, reopen the mic now; otherwise the
      // speech-idle handler reopens it when TTS drains.
      if (!speak || !isSpeaking()) contRef.current?.setMuted(false)
    }
  }

  // Keep a stable reference to the latest send for the voice callbacks, which
  // are registered once but must see current state (messages/busy).
  const sendRef = useRef(send)
  sendRef.current = send

  function togglePtt(): void {
    if (listening) {
      pttRef.current?.stop()
      return
    }
    stopSpeaking()
    const handle = listenOnce(
      speechLang,
      (heard) => void sendRef.current(heard),
      () => {
        setListening(false)
        pttRef.current = null
      },
    )
    if (handle) {
      pttRef.current = handle
      setListening(true)
    }
  }

  function toggleContinuous(): void {
    if (continuous) {
      contRef.current?.stop()
      contRef.current = null
      setContinuous(false)
      setCameraOn(false) // closing the channel closes the camera too
      return
    }
    stopSpeaking()
    const handle = startContinuous(speechLang, (heard) => void sendRef.current(heard))
    if (handle) {
      contRef.current = handle
      setContinuous(true)
      // Spec: camera turns ON by default (front) when the channel opens.
      if (cameraSupported()) {
        setFacing('user')
        setCameraOn(true)
      }
    }
  }

  function toggleCamera(): void {
    setCameraOn((v) => !v)
  }

  function switchCamera(): void {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'))
  }

  function toggleVoiceOut(): void {
    setVoiceOut((v) => {
      if (v) {
        stopSpeaking()
        contRef.current?.setMuted(false) // we won't speak; reopen mic
      }
      return !v
    })
  }

  return (
    <div className="chat">
      <CameraView active={cameraOn} facing={facing} onError={onCameraError} />
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && <p className="chat-hint">{t.chatHint}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content || (busy && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>
      <div className="chat-input">
        {speechSupported() && (
          <>
            {!continuous && (
              <button
                type="button"
                className={`chat-icon ${listening ? 'live' : ''}`}
                onClick={togglePtt}
                title={t.micTitle}
                aria-label={t.micTitle}
              >
                {listening ? '●' : '🎤'}
              </button>
            )}
            <button
              type="button"
              className={`chat-icon ${continuous ? 'live' : ''}`}
              onClick={toggleContinuous}
              title={t.listenTitle}
              aria-label={t.listenTitle}
              aria-pressed={continuous}
            >
              {continuous ? '👂' : '∞'}
            </button>
          </>
        )}
        <button
          type="button"
          className="chat-icon"
          onClick={toggleVoiceOut}
          title={t.voiceTitle}
          aria-label={t.voiceTitle}
          aria-pressed={voiceOut}
        >
          {voiceOut ? '🔊' : '🔇'}
        </button>
        {cameraSupported() && (
          <>
            <button
              type="button"
              className={`chat-icon ${cameraOn ? 'live' : ''}`}
              onClick={toggleCamera}
              title={t.cameraTitle}
              aria-label={t.cameraTitle}
              aria-pressed={cameraOn}
            >
              {cameraOn ? '📸' : '📷'}
            </button>
            {cameraOn && canSwitchCam && (
              <button
                type="button"
                className="chat-icon"
                onClick={switchCamera}
                title={t.switchCamTitle}
                aria-label={t.switchCamTitle}
              >
                🔄
              </button>
            )}
          </>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={t.chatPlaceholder}
          disabled={busy}
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
          {t.send}
        </button>
      </div>
    </div>
  )
}
