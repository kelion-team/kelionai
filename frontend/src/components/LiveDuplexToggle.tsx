import { useCallback, useEffect, useRef, useState } from 'react'
import { startLiveVoice, type LiveVoiceHandle, type LiveVoiceState } from '../lib/liveVoice'

// Butonul MOD FULL-DUPLEX (Adrian, 12 iul: „chatul full duplex") — pasul 3.
// Complet izolat: pornește/oprește sesiunea LiveKit (lib/liveVoice) fără să
// atingă traseul de voce HTTP existent. O apăsare = intri în cameră, microfonul
// e deschis permanent și auzi vocea agentului; încă o apăsare = ieși.

export function LiveDuplexToggle() {
  const [state, setState] = useState<LiveVoiceState | 'idle'>('idle')
  const [note, setNote] = useState('')
  const handleRef = useRef<LiveVoiceHandle | null>(null)

  // La demontare, închide sesiunea ca să nu rămână microfonul deschis.
  useEffect(() => {
    return () => {
      void handleRef.current?.stop()
      handleRef.current = null
    }
  }, [])

  const toggle = useCallback(async () => {
    if (handleRef.current) {
      await handleRef.current.stop()
      handleRef.current = null
      setState('idle')
      setNote('')
      return
    }
    setNote('')
    try {
      handleRef.current = await startLiveVoice({ onState: (s, n) => { setState(s); if (n) setNote(n) } })
    } catch {
      handleRef.current = null
      // starea 'error' + nota vin deja prin onState
    }
  }, [])

  const live = state === 'live'
  const busy = state === 'connecting'
  const label = live ? '⏹ Full-duplex' : busy ? '… conectez' : '🎙 Full-duplex'
  const title =
    state === 'error'
      ? `Mod mâini-libere (full-duplex) — eroare: ${note}`
      : live
        ? 'Mod mâini-libere ACTIV — vorbește liber; apasă ca să ieși'
        : 'Mod mâini-libere (full-duplex): microfon deschis permanent + vocea lui Kelion'

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={title}
      aria-pressed={live}
      className={`duplex-btn${live ? ' live' : ''}${state === 'error' ? ' err' : ''}`}
    >
      {label}
    </button>
  )
}
