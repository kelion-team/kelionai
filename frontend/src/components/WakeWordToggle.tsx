import { useCallback, useEffect, useRef, useState } from 'react'
import { startWakeWord, wakeWordSupported } from '../lib/wakeWord'

// Butonul CUVÂNT DE TREZIRE: îl armezi o dată și Kelion ascultă în fundal; când
// aude numele, cheamă `onWake` (ChatPanel pornește microfonul). Complet opt-in,
// izolat. Dacă browserul nu suportă recunoașterea, butonul nici nu apare.

interface Props {
  onWake: () => void
  lang?: string
}

export function WakeWordToggle({ onWake, lang }: Props) {
  const [armed, setArmed] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  // Ținem cea mai nouă funcție onWake fără să repornim ascultarea la fiecare render.
  const onWakeRef = useRef(onWake)
  onWakeRef.current = onWake

  useEffect(() => {
    return () => {
      stopRef.current?.()
      stopRef.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    if (stopRef.current) {
      stopRef.current()
      stopRef.current = null
      setArmed(false)
      return
    }
    stopRef.current = startWakeWord(['kelion', 'chelion', 'kelian'], () => onWakeRef.current(), lang || 'ro-RO')
    setArmed(true)
  }, [lang])

  if (!wakeWordSupported()) return null

  return (
    <button
      type="button"
      className={`fn-item${armed ? ' wake-armed' : ''}`}
      onClick={toggle}
      title={armed ? 'Ascult numele „Kelion" — apasă ca să oprești' : 'Trezire pe voce: spune „Kelion" și pornește singur microfonul'}
      aria-pressed={armed}
    >
      <span className="ico">{armed ? '🔔' : '🔕'}</span>
      {armed ? 'Ascult „Kelion"…' : 'Trezire „Kelion"'}
      {armed && <span className="dot" />}
    </button>
  )
}
