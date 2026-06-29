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

export default function ChatPanel({ lang }: { readonly lang: Lang }) {
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
  const [menuOpen, setMenuOpen] = useState(false) // ⊕ functions menu
  const pttRef = useRef<{ stop: () => void } | null>(null)
  const contRef = useRef<ContinuousHandle | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut

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

  // Close the functions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

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
      if (!speak || !isSpeaking()) contRef.current?.setMuted(false)
    }
  }

  // Stable reference to the latest send for the voice callbacks (registered once).
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

  // Only the latest message is shown on screen (history stays in state).
  const last = messages.at(-1)

  return (
    <div className="chat">
      <CameraView active={cameraOn} facing={facing} onError={onCameraError} />
      <div className="chat-log">
        {messages.length === 0 && <p className="chat-hint">{t.chatHint}</p>}
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
            className={`chat-icon ${menuOpen ? 'live' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            title={t.functionsTitle}
            aria-label={t.functionsTitle}
            aria-expanded={menuOpen}
          >
            ⊕
          </button>
          {menuOpen && (
            <div className="fn-menu" role="menu">
              {speechSupported() && (
                <>
                  <button type="button" className="fn-item" onClick={togglePtt} disabled={continuous}>
                    <span className="ico">🎤</span>
                    {t.micTitle}
                    {listening && <span className="dot" />}
                  </button>
                  <button type="button" className="fn-item" onClick={toggleContinuous}>
                    <span className="ico">{continuous ? '👂' : '∞'}</span>
                    {t.listenTitle}
                    {continuous && <span className="dot" />}
                  </button>
                </>
              )}
              <button type="button" className="fn-item" onClick={toggleVoiceOut}>
                <span className="ico">{voiceOut ? '🔊' : '🔇'}</span>
                {t.voiceTitle}
                {voiceOut && <span className="dot" />}
              </button>
              {cameraSupported() && (
                <>
                  <button type="button" className="fn-item" onClick={toggleCamera}>
                    <span className="ico">{cameraOn ? '📸' : '📷'}</span>
                    {t.cameraTitle}
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
