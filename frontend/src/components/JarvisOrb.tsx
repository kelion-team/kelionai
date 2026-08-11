import { useEffect, useRef } from 'react'
import { vocileLuiKelion } from '../lib/vociKelion'

// ── GLOBUL JARVIS (Adrian, 11 aug — modul mașină) ────────────────────────────
// Imagine abstractă, voice-first: un glob luminos care PULSEAZĂ pe vocea REALĂ a
// lui Kelion (nu chip uman). Ușor — Canvas 2D, nu WebGL 3D → consum mic, potrivit
// pentru volan (se citește dintr-o ochire: pulsează = vorbește, calm = ascultă).
// Vocea o ia din registrul existent (vocileLuiKelion) printr-un AnalyserNode care
// DOAR analizează (nu redă din nou — sunetul e deja redat de sesiune).
export default function JarvisOrb(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    let audio: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    const conectate = new Set<MediaStream>()
    // Uint8Array<ArrayBuffer> explicit (TS 5.7+): getByteFrequencyData cere buffer
    // ne-partajat; tipul bar `Uint8Array` (ArrayBufferLike) e respins la build.
    let data: Uint8Array<ArrayBuffer> | null = null
    try {
      if (AC) {
        audio = new AC()
        analyser = audio.createAnalyser()
        analyser.fftSize = 256
        data = new Uint8Array(analyser.frequencyBinCount)
      }
    } catch {
      audio = null
    }

    // Conectează fluxurile noi de voce la analizor (fără a le reda din nou).
    const conecteaza = (): void => {
      if (!audio || !analyser) return
      if (audio.state === 'suspended') void audio.resume().catch(() => undefined)
      for (const s of vocileLuiKelion()) {
        if (conectate.has(s) || s.getAudioTracks().length === 0) continue
        try {
          audio.createMediaStreamSource(s).connect(analyser)
          conectate.add(s)
        } catch {
          /* flux mort — îl sărim */
        }
      }
    }
    const idFluxuri = window.setInterval(conecteaza, 700)
    conecteaza()

    // Dimensiunea reală (retina) — se reașază la resize.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const potrivesteMarime = (): void => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
    }
    potrivesteMarime()
    window.addEventListener('resize', potrivesteMarime)

    let raf = 0
    let faza = 0
    const deseneaza = (): void => {
      raf = requestAnimationFrame(deseneaza)
      const w = canvas.width
      const h = canvas.height
      const cx = w / 2
      const cy = h / 2
      // Nivelul vocii (0..1): media amplitudinilor, dacă avem analizor.
      let nivel = 0
      if (analyser && data) {
        analyser.getByteFrequencyData(data)
        let s = 0
        for (let i = 0; i < data.length; i++) s += data[i]
        nivel = Math.min(1, s / data.length / 128)
      }
      faza += 0.03
      // Respirație lentă când tace + pulsul vocii peste ea.
      const baza = Math.min(w, h) * 0.18
      const respir = baza * (1 + 0.05 * Math.sin(faza))
      const raza = respir * (1 + nivel * 0.9)

      ctx2d.clearRect(0, 0, w, h)

      // Halou exterior (glow) — crește cu vocea.
      const grd = ctx2d.createRadialGradient(cx, cy, raza * 0.2, cx, cy, raza * (2.4 + nivel * 1.5))
      grd.addColorStop(0, `rgba(90,180,255,${0.30 + nivel * 0.4})`)
      grd.addColorStop(0.5, `rgba(70,140,255,${0.12 + nivel * 0.2})`)
      grd.addColorStop(1, 'rgba(10,20,40,0)')
      ctx2d.fillStyle = grd
      ctx2d.fillRect(0, 0, w, h)

      // Inele care se dilată cu vocea.
      for (let k = 0; k < 3; k++) {
        const rr = raza * (1.25 + k * 0.35 + nivel * 0.6)
        ctx2d.beginPath()
        ctx2d.arc(cx, cy, rr, 0, Math.PI * 2)
        ctx2d.strokeStyle = `rgba(120,200,255,${(0.22 - k * 0.06) * (0.5 + nivel)})`
        ctx2d.lineWidth = dpr * (2 - k * 0.4)
        ctx2d.stroke()
      }

      // Globul plin.
      const orb = ctx2d.createRadialGradient(cx - raza * 0.3, cy - raza * 0.3, raza * 0.1, cx, cy, raza)
      orb.addColorStop(0, 'rgba(200,235,255,0.95)')
      orb.addColorStop(0.5, `rgba(90,170,255,${0.8})`)
      orb.addColorStop(1, `rgba(40,90,200,${0.7})`)
      ctx2d.beginPath()
      ctx2d.arc(cx, cy, raza, 0, Math.PI * 2)
      ctx2d.fillStyle = orb
      ctx2d.fill()
    }
    deseneaza()

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(idFluxuri)
      window.removeEventListener('resize', potrivesteMarime)
      void audio?.close().catch(() => undefined)
    }
  }, [])

  return <canvas ref={canvasRef} className="jarvis-orb" aria-hidden="true" />
}
