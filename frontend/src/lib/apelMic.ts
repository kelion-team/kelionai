// ── MESSENGER KELION↔KELION — CAPTURA VOCII ÎN APEL (Faza 2, Adrian) ─────────────
// Cât ești într-un apel, ascultăm microfonul și tăiem FRAZE (VAD: pornim la
// vorbire, oprim la ~0,5s de liniște), fiecare frază → base64 → trimisă pe WS
// pentru traducere. Folosim `openMicGraph` (deschide microfonul + deblochează
// AudioContext-ul la primul gest), un AnalyserNode pentru detecția vorbirii și un
// MediaRecorder pentru fiecare frază. Independent de vocea cu Kelion (aia se
// suspendă cât ești în apel — vezi ChatPanel), deci nu se ceartă două microfoane.
import { openMicGraph } from './audioGraph'
import { shouldSplitCallUtterance } from './callMedia'

export interface CapturaApel {
  opreste(): void
}

// Praguri de vorbire (aliniate cu VAD-ul din audioIO): pornire pe energie,
// oprire după liniște, ignoră frazele prea scurte (clic/pocnet).
const START_RMS = 0.012
const SILENCE_MS = 550
const MIN_UTTER_MS = 350
const MIN_BLOB = 1200 // octeți — sub asta e practic tăcere

function alegeMime(): string {
  const candidati = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  const MR = (globalThis as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder
  if (MR?.isTypeSupported) {
    for (const c of candidati) if (MR.isTypeSupported(c)) return c
  }
  return ''
}

export async function pornesteCapturaApel(
  onFraza: (audioB64: string, mime: string) => void,
  onEroare?: (motiv: string) => void,
): Promise<CapturaApel | null> {
  const graf = await openMicGraph((e) => onEroare?.(String(e)))
  if (!graf) return null
  const { stream, ctx } = graf
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const sursa = ctx.createMediaStreamSource(stream)
  sursa.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  const mime = alegeMime()
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  let vorbeste = false
  let recordingStartedAt = 0
  let ultimSunet = 0
  let raf = 0
  let oprit = false

  const porneceRec = (): void => {
    if (rec && rec.state === 'recording') return
    chunks = []
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      try {
        rec = new MediaRecorder(stream)
      } catch {
        rec = null
        return
      }
    }
    const recLocal = rec
    const startedAt = performance.now()
    recordingStartedAt = startedAt
    recLocal.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recLocal.onstop = () => {
      const durata = performance.now() - startedAt
      const tip = (recLocal.mimeType || mime || 'audio/webm').split(';')[0]
      const blob = new Blob(chunks, { type: recLocal.mimeType || mime || 'audio/webm' })
      chunks = []
      if (oprit || durata < MIN_UTTER_MS || blob.size < MIN_BLOB) return
      const fr = new FileReader()
      fr.onload = () => {
        const s = String(fr.result || '')
        const i = s.indexOf(',')
        if (i >= 0) onFraza(s.slice(i + 1), tip)
      }
      fr.readAsDataURL(blob)
    }
    try {
      recLocal.start()
    } catch {
      /* pornire eșuată — reîncercăm la fraza următoare */
    }
  }

  const opresteRec = (): void => {
    if (rec && rec.state === 'recording') {
      try {
        rec.stop()
      } catch {
        /* deja oprit */
      }
    }
  }

  const tick = (): void => {
    if (oprit) return
    raf = requestAnimationFrame(tick)
    analyser.getFloatTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    const rms = Math.sqrt(s / buf.length)
    const now = performance.now()
    if (rms > START_RMS) {
      if (!vorbeste) {
        vorbeste = true
        porneceRec()
      }
      ultimSunet = now
      if (rec?.state === 'recording' && shouldSplitCallUtterance(recordingStartedAt, now)) {
        // A continuous speaker is split into bounded phrases instead of
        // growing one unbounded WebM blob until silence finally arrives.
        vorbeste = false
        opresteRec()
      }
    } else if (vorbeste && now - ultimSunet > SILENCE_MS) {
      vorbeste = false
      opresteRec()
    }
  }
  raf = requestAnimationFrame(tick)

  return {
    opreste() {
      oprit = true
      cancelAnimationFrame(raf)
      opresteRec()
      try {
        stream.getTracks().forEach((tr) => tr.stop())
      } catch {
        /* deja oprit */
      }
      try {
        void ctx.close()
      } catch {
        /* deja închis */
      }
    },
  }
}
