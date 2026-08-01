import { openMicGraph } from './audioGraph'
// AUDIO I/O — the gate to the brain (Adrian, Jul 4). The app does NOT synthesize and
// does NOT recognize anything locally: the microphone captures → sends to the server (STT), and
// the brain's voice arrives ready-synthesized from the server (Chirp 3) as an
// {audio} frame on the bridge and here it is ONLY decoded + played. Zero "voice in the front".
//
//  • Microphone: full-duplex (you can talk over the voice), professional noise filter
//    (echoCancellation + noiseSuppression + autoGainControl), VOX (starts on
//    voice, stops on silence) and a large buffer (nothing lost on long utterances).
//  • Playback: playVoice(base64) — decodes the MP3 received from the brain and plays it;
//    while playing, the microphone doesn't SEND anything (anti-echo), but stays ON WATCH:
//    if it hears Adrian's voice over the playback, it notifies via onBargeIn so the panel
//    cuts Kelion's voice at once (the order: "when he hears my voice, he interrupts me").

export interface MicHandle {
  stop(): void
  setMuted(m: boolean): void
}

// ── VOX (voice activity) reglaje ────────────────────────────────────────────
const START_RMS = 0.012 // pragul de la care „e voce"
const DOMINANCE = 2.2 // vocea apropiată domină zgomotul de fond de-atâtea ori
const SILENCE_MS = 450 // tăcere care închide o frază — redus 6 iul (ordinul lui Adrian: răspunde mai repede)
const MIN_UTTER_MS = 350 // sub atât = zgomot, nu frază — se ignoră
// Minimum REAL VOICE in an utterance (Adrian, Jul 10: "it's not fair outside the first
// utterance" — the ASR invented "Nu."/"Sim, mă simt" from noise clicks). `uttMs`
// included the tail silence too, so a short click + silence passed the threshold.
// We now require enough ACTUAL voice (not just duration) — a click has <150ms of voice.
const MIN_VOICED_MS = 220
const MAX_UTTER_MS = 60_000 // buffer mare: o frază poate dura până la 60s

// ── BARGE-IN (while Kelion speaks) ────────────────────────────────────────
// Stricter thresholds than normal VOX: echoCancellation removes Kelion's voice
// from the microphone, but a residue can remain — we require a clear, sustained signal
// so he doesn't cut himself off.
const BARGE_RMS = 0.024 // dublul pragului normal: doar voce apropiată, clară
const BARGE_HOLD_MS = 180 // vocea trebuie să țină atât ca să taie (nu un poc)
const BARGE_GUARD_MS = 300 // fereastră de gardă după ce începe redarea (onset)

// ── VOICEPRINT ─────────────────────────────────────────────────────────────
// 100% client-side filter: restricts the START of recording AND barge-in to
// Adrian's calibrated voice, so it doesn't react to any voice/noise that
// trece pragul de volum (TV, alt om etc.). Pentru rolul demo (vizitatori
// public), without a saved profile, behavior stays exactly as today (accepts
// any voice). For the admin, no saved profile = not enrolled yet → nothing is
// accepted until he calibrates (see `restrictToOwnerVoice` in startMic).
export interface VoicePrint {
  f0Min: number // frecvența fundamentală minimă observată la calibrare (Hz)
  f0Max: number // frecvența fundamentală maximă observată la calibrare (Hz)
  centroid: number // centroid spectral mediu (Hz) — „culoarea" timbrului
  tolerance: number // marjă în jurul [f0Min, f0Max] la potrivire (Hz)
}

// Features vocale trimise backendului pentru identificare speaker + gen.
export interface VoiceFeatureMeta {
  pitchMean: number
  pitchStd: number
  pitchMin: number
  pitchMax: number
  centroid: number
  rolloff: number
  zcr: number
  energy: number
  jitter: number
  shimmer: number
}

export interface VoiceFeatures {
  vector: number[]
  meta: VoiceFeatureMeta
  // A short audio sample (data-URL webm/opus) of the just-spoken utterance — sent
  // along with features so the admin can LISTEN to it from the panel ("play" button).
  clip?: string
}

let pendingVoiceFeatures: VoiceFeatures | null = null

export function getPendingVoiceFeatures(): VoiceFeatures | null {
  return pendingVoiceFeatures
}

export function setPendingVoiceFeatures(features: VoiceFeatures | null): void {
  pendingVoiceFeatures = features
}

export function clearPendingVoiceFeatures(): void {
  pendingVoiceFeatures = null
}

const VOICEPRINT_KEY = 'kelion.voiceprint'
const CALIBRATION_MIN_FRAMES = 30 // cadre vocale minime ca să considerăm calibrarea reușită
// Jul 6: the first variant (25Hz / 35%) captured ONLY the intonation of the 3s calibration —
// real speech (questions, excitement, raised voice) varies much more and fell
// outside the range, blocking the microphone completely. Widened to cover the real
// intonation variation of the same person, while still keeping a useful filter.
const F0_TOLERANCE_HZ = 55 // marjă în jurul intervalului F0 calibrat
const CENTROID_TOLERANCE_RATIO = 0.48 // marjă relativă pentru centroidul spectral
const F0_MIN_HZ = 70 // sub-limita vocii umane utile — restul e zgomot/eroare
const F0_MAX_HZ = 400 // supra-limita vocii umane utile (bărbați + femei)
// Hysteresis for the match decision: F0 autocorrelation on ONE SINGLE frame of
// 2048 samples can miss by an octave or be fooled by transient noise —
// a single isolated error must no longer block the whole utterance from starting. We keep
// the last MATCH_WINDOW_FRAMES evaluations and a simple matching majority is enough.
// Reduced from 12 to 6 (Jul 2026): the old window cut ~190 ms from the start of
// the word when the voice profile was active; 6 frames (~95 ms) keep the
// isolated-error filter but reduce the loss of the first syllables.
const MATCH_WINDOW_FRAMES = 6 // ~95 ms de evaluări la ~16 ms/tick
const MATCH_WINDOW_RATIO = 0.5 // majoritate simplă — o eroare izolată nu mai decide singură

export function hasVoiceprint(): boolean {
  try {
    return localStorage.getItem(VOICEPRINT_KEY) !== null
  } catch {
    return false
  }
}

function loadVoiceprint(): VoicePrint | null {
  try {
    const raw = localStorage.getItem(VOICEPRINT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<VoicePrint>
    if (
      typeof p.f0Min === 'number' &&
      typeof p.f0Max === 'number' &&
      typeof p.centroid === 'number' &&
      typeof p.tolerance === 'number'
    )
      return p as VoicePrint
    return null
  } catch {
    return null
  }
}

// autocorrelation on the time-domain signal — estimates the fundamental frequency
// (classic ACF2+ algorithm: zero-crossing trim, autocorrelation, parabolic interpolation)
export function estimateF0(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length
  let rmsSum = 0
  for (let i = 0; i < SIZE; i++) rmsSum += buf[i] * buf[i]
  if (Math.sqrt(rmsSum / SIZE) < START_RMS) return -1

  let r1 = 0
  let r2 = SIZE - 1
  const thres = 0.2
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i
      break
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i
      break
    }
  }
  const trimmed = buf.slice(r1, r2)
  const n = trimmed.length
  if (n < 8) return -1

  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n - i; j++) sum += trimmed[j] * trimmed[j + i]
    c[i] = sum
  }
  let d = 0
  while (d + 1 < n && c[d] > c[d + 1]) d++
  let maxVal = -1
  let maxPos = -1
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i]
      maxPos = i
    }
  }
  if (maxPos <= 0 || maxPos >= n - 1) return -1

  // parabolic interpolation around the peak for a finer lag estimate
  const x1 = c[maxPos - 1]
  const x2 = c[maxPos]
  const x3 = c[maxPos + 1]
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  const t0 = a ? maxPos - b / (2 * a) : maxPos
  if (t0 <= 0) return -1

  const f0 = sampleRate / t0
  if (f0 < F0_MIN_HZ || f0 > F0_MAX_HZ) return -1
  return f0
}

// spectral centroid — the frequency average weighted by each bin's energy
export function estimateCentroid(freqData: Float32Array, sampleRate: number, fftSize: number): number {
  let num = 0
  let den = 0
  const binHz = sampleRate / fftSize
  for (let i = 0; i < freqData.length; i++) {
    const db = freqData[i]
    if (!Number.isFinite(db) || db < -100) continue
    const mag = Math.pow(10, db / 20)
    num += i * binHz * mag
    den += mag
  }
  return den > 0 ? num / den : 0
}

// zero-crossing rate — how "hissy" the voice is; helps voice/noise separation
export function estimateZcr(buf: Float32Array): number {
  let crossings = 0
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i] >= 0) !== (buf[i - 1] >= 0)) crossings++
  }
  return crossings / buf.length
}

// normalized RMS energy
export function estimateEnergy(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

// spectral rolloff — the frequency below which 85% of the spectral energy sits
export function estimateRolloff(freqData: Float32Array, sampleRate: number, fftSize: number): number {
  let total = 0
  for (let i = 0; i < freqData.length; i++) {
    const db = freqData[i]
    if (Number.isFinite(db) && db > -100) total += Math.pow(10, db / 20)
  }
  let acc = 0
  const target = total * 0.85
  const binHz = sampleRate / fftSize
  for (let i = 0; i < freqData.length; i++) {
    const db = freqData[i]
    if (Number.isFinite(db) && db > -100) acc += Math.pow(10, db / 20)
    if (acc >= target) return i * binHz
  }
  return freqData.length * binHz
}

// jitter = relative variation of the fundamental period (F0)
export function estimateJitter(f0s: number[]): number {
  if (f0s.length < 2) return 0
  let sum = 0
  for (let i = 1; i < f0s.length; i++) {
    sum += Math.abs(f0s[i] - f0s[i - 1])
  }
  const mean = f0s.reduce((a, b) => a + b, 0) / f0s.length
  return mean > 0 ? sum / ((f0s.length - 1) * mean) : 0
}

// shimmer = relative amplitude variation across consecutive voiced frames
export function estimateShimmer(energies: number[]): number {
  if (energies.length < 2) return 0
  let sum = 0
  for (let i = 1; i < energies.length; i++) {
    sum += Math.abs(energies[i] - energies[i - 1])
  }
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length
  return mean > 0 ? sum / ((energies.length - 1) * mean) : 0
}

// Normalizes a feature vector to mean=0, deviation=1, with clipping.
export function normalizeVector(v: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  const mean = v.reduce((a, b) => a + b, 0) / n
  const std = Math.sqrt(v.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n) || 1
  return v.map((x) => Math.max(-3, Math.min(3, (x - mean) / std)))
}

// Builds complete vocal features from a buffer of F0, energies and a
// cadru spectral. Vectorul e normalizat pentru a fi robust la volum/microfon.
export function buildVoiceFeatures(
  f0s: number[],
  energies: number[],
  centroid: number,
  rolloff: number,
  zcr: number,
  energy: number,
): VoiceFeatures {
  const validF0 = f0s.filter((x) => x > 0)
  const pitchMean = validF0.length ? validF0.reduce((a, b) => a + b, 0) / validF0.length : 0
  const pitchMin = validF0.length ? Math.min(...validF0) : 0
  const pitchMax = validF0.length ? Math.max(...validF0) : 0
  const pitchStd =
    validF0.length > 1
      ? Math.sqrt(validF0.reduce((s, x) => s + (x - pitchMean) ** 2, 0) / validF0.length)
      : 0
  const jitter = estimateJitter(validF0)
  const shimmer = estimateShimmer(energies.length ? energies : [energy])

  const meta: VoiceFeatureMeta = {
    pitchMean,
    pitchStd,
    pitchMin,
    pitchMax,
    centroid,
    rolloff,
    zcr,
    energy,
    jitter,
    shimmer,
  }

  const rawVector = [
    pitchMean,
    pitchStd,
    pitchMax - pitchMin,
    centroid,
    rolloff,
    zcr * 1000,
    energy * 100,
    jitter * 1000,
    shimmer * 1000,
  ]
  return { vector: normalizeVector(rawVector), meta }
}

// Calibration: briefly captures Adrian's voice and saves the profile to localStorage.
// Returns true only if it gathered enough voiced frames (RMS above threshold) — below
// that, the profile isn't trustworthy and isn't saved (today's behavior stays).
export async function calibrateVoiceprint(ms = 3000): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    return false
  }
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    return false
  }
  const ctx = new AC()
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048 // rezoluție mai bună la calibrare — F0 corect și la voci grave
  source.connect(analyser)
  const timeBuf = new Float32Array(analyser.fftSize)
  const freqBuf = new Float32Array(analyser.frequencyBinCount)

  const f0Samples: number[] = []
  const centroidSamples: number[] = []
  const start = performance.now()

  await new Promise<void>((resolve) => {
    const step = (): void => {
      if (performance.now() - start >= ms) {
        resolve()
        return
      }
      analyser.getFloatTimeDomainData(timeBuf)
      const f0 = estimateF0(timeBuf, ctx.sampleRate)
      if (f0 > 0) {
        f0Samples.push(f0)
        analyser.getFloatFrequencyData(freqBuf)
        centroidSamples.push(estimateCentroid(freqBuf, ctx.sampleRate, analyser.fftSize))
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  stream.getTracks().forEach((t) => t.stop())
  void ctx.close().catch(() => {})

  if (f0Samples.length < CALIBRATION_MIN_FRAMES) return false

  const profile: VoicePrint = {
    f0Min: Math.min(...f0Samples),
    f0Max: Math.max(...f0Samples),
    centroid: centroidSamples.reduce((a, b) => a + b, 0) / centroidSamples.length,
    tolerance: F0_TOLERANCE_HZ,
  }
  try {
    localStorage.setItem(VOICEPRINT_KEY, JSON.stringify(profile))
  } catch {
    return false
  }
  return true
}

export async function startMic(
  onTranscript: (text: string) => void,
  onError: (reason: string) => void,
  getLang: () => string,
  // called when Adrian's voice is heard WHILE the microphone is mute (Kelion speaks):
  // the panel cuts Kelion's voice and unmutes the microphone.
  onBargeIn?: () => void,
  // Adrian's order: "only my voice or my writing". true = the admin — if
  // there's no calibrated profile yet, the microphone accepts NO voice (not enrolled,
  // nu „orice voce"). false = rolul demo (vizitatori publici) — comportamentul
  // stays exactly as today: without a profile, accepts any voice above threshold.
  restrictToOwnerVoice = false,
  // stream pre-warmed by pressing the "mic on" button for instant activation.
  preWarmedStream?: MediaStream,
): Promise<MicHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    onError('unsupported')
    return null
  }
  // The microphone opening + audio context come from the SHARED source
  // (lib/audioGraph.ts) — the same constraints as dictation, so the two
  // can't hear differently (Batch D, unique without duplicates).
  const graph = await openMicGraph(onError, preWarmedStream)
  if (!graph) return null
  const { stream, ctx } = graph
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  // separate analyser, higher resolution, only for F0/centroid — doesn't touch
  // the RMS above (analyser stays exactly as today for VOX and barge-in)
  // `let`, not `const`: the profile can be LEARNED automatically on the go (see below).
  let voiceprint = loadVoiceprint()
  const pitchAnalyser = ctx.createAnalyser()
  pitchAnalyser.fftSize = 2048
  source.connect(pitchAnalyser)
  const pitchBuf = new Float32Array(pitchAnalyser.fftSize)
  const freqBuf = new Float32Array(pitchAnalyser.frequencyBinCount)

  const mime =
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ??
    ''

  let muted = false
  let stopped = false
  let recording = false
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  let voicedMs = 0
  let silenceMs = 0
  let noiseFloor = 0.006
  let uttMs = 0
  let raf = 0
  let mutedAt = 0 // când a început muțenia (redarea vocii) — pentru garda de onset
  let bargeMs = 0 // cât timp s-a auzit voce clară peste redare

  const send = async (blob: Blob): Promise<void> => {
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.onerror = () => reject(new Error('read'))
        fr.readAsDataURL(blob)
      })
      if (!b64) return
      const r = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // mime = containerul REAL al MediaRecorder-ului (ex. audio/mp4 pe
        // Safari) — the backend picks the file name for OpenAI from it.
        body: JSON.stringify({ audio: b64, lang: getLang(), mime: blob.type || mime }),
      })
      if (!r.ok) {
        // we no longer die silently — the error reaches Kelion through F12 reporting
        console.error('asr batch a picat:', r.status)
        return
      }
      const j = (await r.json()) as { transcript?: string }
      const text = (j.transcript ?? '').trim()
      if (text) onTranscript(text)
    } catch {
      /* a lost utterance doesn't stop the microphone */
    }
  }

  const startRec = (): void => {
    if (recording || !mime) return
    chunks = []
    resetVoiceFrameBuffers()
    try {
      rec = new MediaRecorder(stream, { mimeType: mime })
    } catch {
      rec = new MediaRecorder(stream)
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      const took = uttMs
      const voiced = voicedMs
      const blob = new Blob(chunks, { type: mime || 'audio/webm' })
      recording = false
      uttMs = 0
      voicedMs = 0
      const feats = finalizeVoiceFeatures()
      // under minimum = short noise, we don't send it. We ALSO require enough ACTUAL voice
      // (not just total duration) so a click + silence no longer produces phantom
      // transcription ("Nu.", "Sim, mă simt") — Jul 10 bug.
      if (took >= MIN_UTTER_MS && voiced >= MIN_VOICED_MS && blob.size > 0) {
        // AUDIO SAMPLE for the admin "play" button (Adrian, Jul 14): we attach a
        // copy of the utterance to the features, so he can LISTEN to it. Only small clips (an
        // utterance, not a monologue); the base64 conversion is ready long before the ASR
        // replies, so `clip` is set in time on the object ChatPanel reads.
        if (feats && blob.size <= 500_000) {
          const fr = new FileReader()
          fr.onload = () => {
            const url = String(fr.result || '')
            if (url.startsWith('data:')) feats.clip = url
          }
          try {
            fr.readAsDataURL(blob)
          } catch {
            /* no sample — identification works anyway */
          }
        }
        void send(blob)
      }
    }
    rec.start()
    recording = true
    uttMs = 0
  }
  const stopRec = (): void => {
    if (recording && rec && rec.state !== 'inactive') rec.stop()
  }

  // RAW evaluation on the current frame — checks F0 + centroid against the calibrated
  // profile. Not enrolled (no profile): demo → always true (unchanged behavior);
  // admin (restrictToOwnerVoice) → always false, while not yet calibrated (the order:
  // "only my voice, no other is accepted"). It can err in isolation (octave/noise) —
  // that's why it's not used directly, but through the hysteresis window below.
  // AUTO-ENROLLMENT (Adrian's order, Jul 10: "voice recognition you must
  // switch to automatic" + "microphone with autovox, instant"): without a saved profile,
  // the microphone no longer sits mute waiting for manual calibration — it accepts voice
  // IMMEDIATELY (autovox) and learns the voiceprint BY ITSELF from the first real utterances:
  // it gathers F0/centroid from the accepted voiced frames (only while Kelion is NOT playing,
  // so it doesn't learn its own voice from the echo) and, when it has enough, saves
  // the profile and only then starts applying it. Zero buttons, zero "say yes".
  const autoF0: number[] = []
  const autoCentroids: number[] = []
  const AUTO_ENROLL_FRAMES = 120 // ~2s de voce efectivă, adunate din primele fraze
  const matchesVoiceprintRaw = (): boolean => {
    if (!voiceprint) {
      if (!restrictToOwnerVoice) return true
      if (!muted) {
        pitchAnalyser.getFloatTimeDomainData(pitchBuf)
        const f0 = estimateF0(pitchBuf, ctx.sampleRate)
        if (f0 > 0) {
          autoF0.push(f0)
          pitchAnalyser.getFloatFrequencyData(freqBuf)
          autoCentroids.push(estimateCentroid(freqBuf, ctx.sampleRate, pitchAnalyser.fftSize))
          if (autoF0.length >= AUTO_ENROLL_FRAMES) {
            voiceprint = {
              f0Min: Math.min(...autoF0),
              f0Max: Math.max(...autoF0),
              centroid: autoCentroids.reduce((a, b) => a + b, 0) / autoCentroids.length,
              tolerance: F0_TOLERANCE_HZ,
            }
            try {
              localStorage.setItem(VOICEPRINT_KEY, JSON.stringify(voiceprint))
            } catch {
              /* localStorage unavailable — the profile stays in memory only */
            }
          }
        }
      }
      return true // autovox: vocea e acceptată din prima, cât se învață profilul
    }
    pitchAnalyser.getFloatTimeDomainData(pitchBuf)
    const f0 = estimateF0(pitchBuf, ctx.sampleRate)
    if (f0 < 0) return false
    if (f0 < voiceprint.f0Min - voiceprint.tolerance || f0 > voiceprint.f0Max + voiceprint.tolerance) return false
    pitchAnalyser.getFloatFrequencyData(freqBuf)
    const centroid = estimateCentroid(freqBuf, ctx.sampleRate, pitchAnalyser.fftSize)
    return Math.abs(centroid - voiceprint.centroid) <= voiceprint.centroid * CENTROID_TOLERANCE_RATIO
  }

  // hysteresis window: keeps the last MATCH_WINDOW_FRAMES raw evaluations and
  // decides by majority, not by the current frame — a single wrong frame no longer
  // blocks starting/stopping. Start-recording and barge-in have separate windows
  // (different context: one decides whether the utterance starts, the other whether Kelion's voice
  // gets cut), so one window's history doesn't contaminate the other's decision.
  const makeMatcher = (): (() => boolean) => {
    const history: boolean[] = []
    return () => {
      history.push(matchesVoiceprintRaw())
      if (history.length > MATCH_WINDOW_FRAMES) history.shift()
      const matched = history.reduce((n, v) => n + (v ? 1 : 0), 0)
      return matched / history.length >= MATCH_WINDOW_RATIO
    }
  }
  const matchesForStart = makeMatcher()
  const matchesForBargeIn = makeMatcher()

  // Colectare features vocale pentru backend (identificare speaker + gen).
  // They gather ONLY while recording a real utterance and NOT while Kelion speaks.
  const phraseF0: number[] = []
  const phraseEnergies: number[] = []
  let phraseCentroidSum = 0
  let phraseCentroidCount = 0
  let phraseRolloffSum = 0
  let phraseZcrSum = 0
  let phraseEnergySum = 0
  let phraseFrames = 0

  function collectVoiceFrame(): void {
    pitchAnalyser.getFloatTimeDomainData(pitchBuf)
    const f0 = estimateF0(pitchBuf, ctx.sampleRate)
    const energy = estimateEnergy(pitchBuf)
    phraseEnergies.push(energy)
    phraseEnergySum += energy
    phraseZcrSum += estimateZcr(pitchBuf)
    if (f0 > 0) phraseF0.push(f0)
    pitchAnalyser.getFloatFrequencyData(freqBuf)
    const centroid = estimateCentroid(freqBuf, ctx.sampleRate, pitchAnalyser.fftSize)
    if (centroid > 0) {
      phraseCentroidSum += centroid
      phraseCentroidCount++
    }
    phraseRolloffSum += estimateRolloff(freqBuf, ctx.sampleRate, pitchAnalyser.fftSize)
    phraseFrames++
  }

  function finalizeVoiceFeatures(): VoiceFeatures | null {
    if (phraseFrames < 8) return null
    const centroid = phraseCentroidCount > 0 ? phraseCentroidSum / phraseCentroidCount : 0
    pendingVoiceFeatures = buildVoiceFeatures(
      phraseF0,
      phraseEnergies,
      centroid,
      phraseRolloffSum / phraseFrames,
      phraseZcrSum / phraseFrames,
      phraseEnergySum / phraseFrames,
    )
    return pendingVoiceFeatures
  }

  function resetVoiceFrameBuffers(): void {
    phraseF0.length = 0
    phraseEnergies.length = 0
    phraseCentroidSum = 0
    phraseCentroidCount = 0
    phraseRolloffSum = 0
    phraseZcrSum = 0
    phraseEnergySum = 0
    phraseFrames = 0
  }

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    try {
      stopRec()
    } catch {
      /* deja oprit */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  // PERMANENT ON: if the track dies from outside (phone call, Bluetooth headphones
  // unplugged, another app takes the microphone), we notify — the panel reopens the mic by itself.
  stream.getAudioTracks().forEach((t) => {
    t.addEventListener('ended', () => {
      if (stopped) return
      cleanup()
      onError('track-ended')
    })
  })

  const tick = (): void => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    // the noise floor adapts slowly when quiet — but NOT while Kelion
    // plays (the echo residue would raise the floor and deafen barge-in)
    if (!recording && !muted) noiseFloor = noiseFloor * 0.95 + rms * 0.05
    const dt = 16
    const isVoice = !muted && rms > START_RMS && rms > noiseFloor * DOMINANCE

    // BARGE-IN: the microphone is mute (Kelion speaks), but still listens. A clear,
    // sustained voice over the playback = Adrian is speaking → we cut Kelion's voice. The same
    // voiceprint rule applies here too — otherwise any strong nearby voice
    // (TV, another person) could interrupt Kelion's voice, not just Adrian's.
    if (muted) {
      const pastGuard = performance.now() - mutedAt >= BARGE_GUARD_MS
      if (pastGuard && rms > BARGE_RMS && rms > noiseFloor * DOMINANCE && matchesForBargeIn()) {
        bargeMs += dt
        if (bargeMs >= BARGE_HOLD_MS) {
          bargeMs = 0
          onBargeIn?.()
        }
      } else {
        bargeMs = 0
      }
    }

    if (recording) {
      uttMs += dt
      if (isVoice) {
        voicedMs += dt
        silenceMs = 0
        collectVoiceFrame()
      } else {
        silenceMs += dt
      }
      if (silenceMs >= SILENCE_MS || uttMs >= MAX_UTTER_MS) stopRec()
    } else if (isVoice && matchesForStart()) {
      // The frame that triggered the recording IS voice — we give it credit, otherwise
      // short words (1-2 syllables) could fall under MIN_VOICED_MS because of
      // the tick lost between the decision and the first recorded frame.
      voicedMs = dt
      silenceMs = 0
      startRec()
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    stop() {
      cleanup()
    },
    setMuted(m: boolean) {
      muted = m
      if (m) {
        mutedAt = performance.now() // pornește garda anti-onset a barge-in-ului
        bargeMs = 0
      }
      // if the brain's voice starts while we were recording, we close the current utterance
      if (m && recording) stopRec()
    },
  }
}

// ── PLAYBACK: the brain's voice, arriving ready-synthesized from the server ──
let curVoice: HTMLAudioElement | null = null

// ── LIP-SYNC: nivelul (0..1) al amplitudinii vocii redate acum ──────────────
// Golden rule: it's a visual bonus — if the analysis fails for any reason,
// the voice must stay audible, unchanged. A single AudioContext,
// reutilizat, creat lazy la prima redare (nevoie de gest de utilizator).
let levelCtx: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSource: MediaElementAudioSourceNode | null = null
let levelBuf: Uint8Array<ArrayBuffer> | null = null
let levelRaf = 0
let voiceLevel = 0

export function getVoiceLevel(): number {
  return voiceLevel
}

function stopLevelLoop(): void {
  if (levelRaf) cancelAnimationFrame(levelRaf)
  levelRaf = 0
  voiceLevel = 0
}

// Routes playback through the Web Audio API ONLY to measure amplitude (RMS),
// without changing the audible playback. If any step fails, we exit quietly —
// audio.play() above stays the only one responsible for sound.
function attachLevelAnalysis(audio: HTMLAudioElement): void {
  try {
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!levelCtx) {
      levelCtx = new AC()
      levelAnalyser = levelCtx.createAnalyser()
      levelAnalyser.fftSize = 256
      levelAnalyser.smoothingTimeConstant = 0.5
      levelBuf = new Uint8Array(levelAnalyser.frequencyBinCount)
    }
    if (levelCtx.state === 'suspended') void levelCtx.resume().catch(() => {})
    if (!levelAnalyser || !levelBuf) return

    // createMediaElementSource can be called only once per element —
    // if this audio element was analyzed before (it shouldn't, it's always new),
    // or the context refuses, we silently give up the analysis, not the sound.
    if (!levelSource) {
      levelSource = levelCtx.createMediaElementSource(audio)
    } else {
      try {
        levelSource.disconnect()
      } catch {
        /* deja deconectat */
      }
      levelSource = levelCtx.createMediaElementSource(audio)
    }
    levelSource.connect(levelAnalyser)
    levelSource.connect(levelCtx.destination)

    const analyser = levelAnalyser
    const buf = levelBuf
    const step = (): void => {
      if (curVoice !== audio) {
        stopLevelLoop()
        return
      }
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buf.length)
      voiceLevel = Math.min(1, rms * 6)
      levelRaf = requestAnimationFrame(step)
    }
    levelRaf = requestAnimationFrame(step)
  } catch {
    // the analysis failed — the voice stays normally audible, only the mouth doesn't move
    stopLevelLoop()
  }
}

// ── LIP-SYNC pentru pista LiveKit (full-duplex, pasul 4) ────────────────────
// The agent's voice in full-duplex mode does NOT come through `curVoice` (HTTP playback),
// but through a separate <audio> attached to the LiveKit track (lib/liveVoice.ts). So
// the avatar's MOUTH moves there too, we measure that element's amplitude with
// its own analyser and write into the SAME `voiceLevel` the avatar
// reads. Mutually exclusive in time with the HTTP path (when one plays, the other is
// off), so they don't trample each other. Purely visual bonus: if it fails, the voice stays
// audibly unchanged. Returns a stop function (cleans RAF + routing).
let extAnalyser: AnalyserNode | null = null
let extBuf: Uint8Array<ArrayBuffer> | null = null
let extLevelSource: MediaStreamAudioSourceNode | null = null
let extLevelRaf = 0
// IMPORTANT ("audio doesn't work" bug, Jul 13): we analyze the STREAM (MediaStream), NOT
// the <audio> element. `createMediaElementSource` TAKES OVER the element's output into
// the Web Audio graph — if the AudioContext is suspended (autoplay policy),
// the sound disappears completely. `createMediaStreamSource` only LISTENS to the stream in
// parallel: the LiveKit track's <audio> element plays untouched, and we measure
// the amplitude separately for the avatar's mouth. We don't connect to destination.
// Lip-sync for the LiveKit track from the <audio> ELEMENT playing it, NOT from the raw
// WebRTC track. `captureStream()` gives a SEPARATE stream of the element's already-decoded
// output — the element keeps playing untouched (unlike
// `createMediaElementSource`, which would steal its output and go silent in a suspended
// context) and without a second consumer on the raw track (the cause of the hum, Jul 13).
// Failure-tolerant: no captureStream → no mouth, but the voice stays clean.
export function driveVoiceLevelFromElement(el: HTMLAudioElement): () => void {
  const noop = (): void => {}
  try {
    const cap =
      (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream ??
      (el as HTMLAudioElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream
    if (!cap) return noop
    const stream = cap.call(el)
    if (!stream || stream.getAudioTracks().length === 0) return noop
    return driveVoiceLevelFrom(stream)
  } catch {
    return noop
  }
}

export function driveVoiceLevelFrom(stream: MediaStream): () => void {
  const noop = (): void => {}
  try {
    const AC =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return noop
    if (!levelCtx) levelCtx = new AC()
    if (levelCtx.state === 'suspended') void levelCtx.resume().catch(() => {})
    if (!extAnalyser) {
      extAnalyser = levelCtx.createAnalyser()
      extAnalyser.fftSize = 256
      extAnalyser.smoothingTimeConstant = 0.5
      extBuf = new Uint8Array(extAnalyser.frequencyBinCount)
    }
    const analyser = extAnalyser
    const buf = extBuf
    if (!buf) return noop
    extLevelSource = levelCtx.createMediaStreamSource(stream)
    extLevelSource.connect(analyser) // DOAR spre analizor — NU spre destination
    const step = (): void => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      voiceLevel = Math.min(1, Math.sqrt(sum / buf.length) * 6)
      extLevelRaf = requestAnimationFrame(step)
    }
    extLevelRaf = requestAnimationFrame(step)
    return () => {
      if (extLevelRaf) cancelAnimationFrame(extLevelRaf)
      extLevelRaf = 0
      voiceLevel = 0
      try {
        extLevelSource?.disconnect()
      } catch {
        /* deja deconectat */
      }
      extLevelSource = null
    }
  } catch {
    // the analysis failed — the LiveKit voice stays audible, only the mouth doesn't move
    return noop
  }
}

// Playback queue: the brain now sends voice IN CHUNKS (utterance by utterance, see
// streamVoice/backend chat.ts) so synthesis no longer waits for the whole reply.
// Chunk 2 can arrive while chunk 1 is still playing — here one doesn't cut the other, they
// queue up and play in order, like a single uninterrupted reply. onStart
// is called once (on the reply's first chunk, mutes the microphone);
// onEnd likewise, once, after the LAST chunk of the queue has played.
const voiceQueue: string[] = []
let pendingVoiceEnd: (() => void) | null = null
// ANTI-ECHO BETWEEN UTTERANCES (Adrian, Jul 10: "you destroyed voice detection"). The voice
// now comes utterance-by-utterance: chunk 1 can FINISH playing before
// chunk 2's sound arrives (still being synthesized on the server). If at
// golirea cozii redeschideam microfonul pe loc, prindea ecoul propriei voci a
// Kelion's in the gap between utterances → false detection / barge-in that cut
// the reply. Now, when the queue empties, we do NOT reopen the microphone immediately:
// we wait out this window; if another chunk arrives, it's the same reply
// (the timer cancels, the microphone stays mute); if NOTHING more comes, only
// then onEnd is called (we reopen). It covers the synthesis gap, so the microphone
// stays mute across the WHOLE reply, exactly as before chunked voice.
let voiceGapTimer: number | null = null
const VOICE_GAP_MS = 1800
function clearGapTimer(): void {
  if (voiceGapTimer !== null) {
    window.clearTimeout(voiceGapTimer)
    voiceGapTimer = null
  }
}

// ── VOLUM UNIC PENTRU VOCEA LUI KELION (25 iul — Adrian: „volumul audio
// incontrolabil") ────────────────────────────────────────────────────────────
// Until today the app had NO volume control: the Realtime audio element
// and the TTS one started fixed at 1.0. One single value, persisted, applied to
// ALL voice elements (Realtime + TTS) — the ChatPanel slider moves it live.
const VOL_KEY = 'kelion:voice-volume'
let voiceVolume = ((): number => {
  const v = Number(localStorage.getItem(VOL_KEY) ?? '1')
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
})()
const voiceElements = new Set<HTMLAudioElement>()

export function getVoiceVolume(): number {
  return voiceVolume
}

export function setVoiceVolume(v: number): void {
  voiceVolume = Math.min(1, Math.max(0, v))
  try {
    localStorage.setItem(VOL_KEY, String(voiceVolume))
  } catch {
    /* private/full — the volume stays for the session */
  }
  for (const el of voiceElements) el.volume = voiceVolume
}

/** Enrolls a voice audio element to follow the global volume (now and on changes). */
export function registerVoiceAudioElement(el: HTMLAudioElement): () => void {
  el.volume = voiceVolume
  voiceElements.add(el)
  return () => voiceElements.delete(el)
}

function playNow(base64Mp3: string): void {
  try {
    const audio = new Audio(`data:audio/mp3;base64,${base64Mp3}`)
    audio.volume = voiceVolume
    voiceElements.add(audio)
    curVoice = audio
    const done = (): void => {
      voiceElements.delete(audio)
      if (curVoice === audio) curVoice = null
      stopLevelLoop()
      playNextQueued()
    }
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done)
    attachLevelAnalysis(audio)
  } catch {
    playNextQueued()
  }
}

function playNextQueued(): void {
  const next = voiceQueue.shift()
  if (next) {
    playNow(next)
    return
  }
  // The queue emptied — but another utterance may still come (its synthesis is still on the way).
  // Do NOT reopen the microphone now; let the anti-echo window run. If another
  // chunk comes, playVoice cancels the timer; if not, only then onEnd (unmute).
  clearGapTimer()
  voiceGapTimer = window.setTimeout(() => {
    voiceGapTimer = null
    const end = pendingVoiceEnd
    pendingVoiceEnd = null
    end?.()
  }, VOICE_GAP_MS)
}

export function playVoice(base64Mp3: string, onStart?: () => void, onEnd?: () => void): void {
  pendingVoiceEnd = onEnd ?? null
  if (curVoice) {
    // already playing a chunk of the SAME reply — it queues up, doesn't get cut.
    voiceQueue.push(base64Mp3)
    return
  }
  // In a GAP between utterances (microphone already mute, we were waiting for the next chunk):
  // it's the continuation of the SAME reply — cancel the reopening, do NOT re-call
  // onStart (the microphone is already mute), keep playing.
  if (voiceGapTimer !== null) {
    clearGapTimer()
    playNow(base64Mp3)
    return
  }
  onStart?.()
  playNow(base64Mp3)
}

export function stopVoice(): void {
  clearGapTimer()
  voiceQueue.length = 0
  // FIX "microphone mute forever" (Jul 24 audit, P1): the end callback (which
  // UNMUTES the Realtime session's microphone) was DISCARDED without being called
  // → after a "stop"/barge-in typed during playback, the track stayed enabled=false
  // forever = "he doesn't hear me". We execute it BEFORE deleting it.
  const end = pendingVoiceEnd
  pendingVoiceEnd = null
  end?.()
  if (curVoice) {
    try {
      curVoice.pause()
    } catch {
      /* deja oprit */
    }
    curVoice = null
  }
  stopLevelLoop()
}

export function isVoicePlaying(): boolean {
  return curVoice !== null
}
