// ── URECHEA LOCALĂ, GRATUITĂ (Adrian, 25 iul: „vocea se închide imediat după
// frază și se redeschide la următoarea frază automat") ───────────────────────
// Sesiunea de voce OpenAI e plătită PE MINUT — analiza reală a arătat ~$21/oră
// arși cu microfonul deschis degeaba. Soluția: cât sesiunea plătită e ÎNCHISĂ,
// ascultă analizorul LOCAL din browser (zero cost, zero rețea, nimic nu pleacă
// de pe dispozitiv) și la prima vorbire reală cheamă onSpeech() — care
// redeschide sesiunea. Prag pe energie RMS + durată minimă, ca un pocnet sau
// zgomotul de fond să nu pornească plata.

export interface SpeechWakeHandle {
  stop(): void
}

const RMS_THRESHOLD = 0.02 // vorbire apropiată; zgomotul de fundal stă sub prag
const FRAMES_NEEDED = 6 // ~180ms de energie continuă — anti-pocnet/tuse scurtă
const TICK_MS = 30 // setInterval, nu rAF: merge și cu tabul în fundal

export async function startSpeechWake(onSpeech: () => void): Promise<SpeechWakeHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser()
  an.fftSize = 512
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  let hot = 0
  let stopped = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    window.clearInterval(iv)
    try {
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => {})
  }

  const iv = window.setInterval(() => {
    if (stopped) return
    an.getFloatTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    const rms = Math.sqrt(s / buf.length)
    hot = rms > RMS_THRESHOLD ? hot + 1 : 0
    if (hot >= FRAMES_NEEDED) {
      stop()
      onSpeech()
    }
  }, TICK_MS)

  return { stop }
}
