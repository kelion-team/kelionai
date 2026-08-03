import { useEffect, useRef, useState } from 'react'

/**
 * CLEPSIDRA + CRONOMETRU (Adrian, 3 aug: „când Kelion primește un task trebuie
 * afișată o clepsidră când Kelion lucrează cu adevărat, cu un cronometru").
 *
 * Cinstit prin construcție: numără timpul REAL (wall-clock) al turei aflate în
 * lucru pe server. Nu pornește dintr-o simplă afirmație („am preluat sarcina") —
 * pornește doar când `busy` e adevărat, adică serverul chiar procesează tura.
 * Când tura se termină, dispare. Nu acoperă pagina (regula lui Adrian): e un chip
 * mic, pe un singur rând, în colț.
 *
 * Perechea lui vizuală e `latency-chip` (verde = GATA, timpul măsurat la final);
 * clepsidra e amber (--warn) = ÎN LUCRU, timpul care curge acum.
 */
export function WorkClock({
  busy,
  title,
  label,
}: {
  busy: boolean
  title?: string
  label?: string
}) {
  const [elapsed, setElapsed] = useState(0) // secunde
  const startRef = useRef(0)

  useEffect(() => {
    if (!busy) {
      setElapsed(0)
      return
    }
    startRef.current = performance.now()
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000)
    }, 200)
    return () => clearInterval(id)
  }, [busy])

  if (!busy) return null

  const s = elapsed
  const shown =
    s < 60
      ? `${s.toFixed(1)}s`
      : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <span className="kelion-workclock" title={title} aria-live="polite">
      <span className="kelion-workclock-glass" aria-hidden>
        ⏳
      </span>
      {label ? <span className="kelion-workclock-label">{label}</span> : null}
      <span className="kelion-workclock-time">{shown}</span>
    </span>
  )
}
