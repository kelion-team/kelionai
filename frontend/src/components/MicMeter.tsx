import { useEffect, useRef } from 'react'

// Live "what Kelion hears" bar graph. Taps the mic with a Web Audio
// AnalyserNode (separate from the Web Speech recognizer, which manages its own
// capture) and animates frequency bars. Visible movement = the mic signal is
// actually reaching Kelion, so you can tell hearing works end-to-end.

const BARS = 14

export default function MicMeter({
  active,
  label,
}: {
  readonly active: boolean
  readonly label: string
}) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!active) return
    let raf = 0
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let cancelled = false

    const draw = (analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): void => {
      analyser.getByteFrequencyData(data)
      const bins = Math.floor(data.length / BARS)
      for (let i = 0; i < BARS; i++) {
        let sum = 0
        for (let j = 0; j < bins; j++) sum += data[i * bins + j]
        const v = sum / bins / 255 // 0..1
        const el = barsRef.current[i]
        if (el) el.style.transform = `scaleY(${Math.max(0.06, v)})`
      }
      raf = requestAnimationFrame(() => draw(analyser, data))
    }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        ctx = new AC()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        analyser.smoothingTimeConstant = 0.7
        src.connect(analyser)
        const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        draw(analyser, data)
      } catch {
        /* permission/handle errors are surfaced by the recognizer path */
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [active])

  if (!active) return null

  return (
    <output className="mic-meter" aria-label={label} title={label}>
      <span className="mic-meter-bars">
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barsRef.current[i] = el
            }}
          />
        ))}
      </span>
      <span className="mic-meter-label">{label}</span>
    </output>
  )
}
