// AUDIO I/O — poarta către creier (Adrian, 4 iul). Aplicația NU sintetizează și
// NU recunoaște nimic local: microfonul captează → trimite la server (STT), iar
// vocea creierului vine gata sintetizată de pe server (Chirp 3) ca un cadru
// {audio} pe punte și aici DOAR se decodează + se redă. Zero „voce în front".
//
//  • Microfon: full-duplex (poți vorbi peste voce), filtru profesional de zgomot
//    (echoCancellation + noiseSuppression + autoGainControl), VOX (pornește la
//    voce, se oprește la tăcere) și buffer mare (nimic pierdut la fraze lungi).
//  • Redare: playVoice(base64) — decodează MP3-ul primit de la creier și-l redă;
//    cât redă, microfonul nu TRIMITE nimic (anti-ecou), dar rămâne DE VEGHE:
//    dacă aude vocea lui Adrian peste redare, anunță prin onBargeIn ca panoul
//    să taie vocea lui Kelion pe loc (ordinul: „când aude vocea mea, mă-ntrerupe").

export interface MicHandle {
  stop(): void
  setMuted(m: boolean): void
}

// ── VOX (voice activity) reglaje ────────────────────────────────────────────
const START_RMS = 0.012 // pragul de la care „e voce"
const DOMINANCE = 2.2 // vocea apropiată domină zgomotul de fond de-atâtea ori
const SILENCE_MS = 450 // tăcere care închide o frază — redus 6 iul (ordinul lui Adrian: răspunde mai repede)
const MIN_UTTER_MS = 350 // sub atât = zgomot, nu frază — se ignoră
// VOCE REALĂ minimă în frază (Adrian, 10 iul: „nu e corect în afara primei
// fraze" — ASR-ul inventa „Nu."/„Sim, mă simt" din pocnete de zgomot). `uttMs`
// includea și tăcerea de la coadă, deci un poc scurt + tăcere trecea pragul.
// Cerem acum destulă VOCE efectivă (nu doar durată) — un poc are <150ms voce.
const MIN_VOICED_MS = 220
const MAX_UTTER_MS = 60_000 // buffer mare: o frază poate dura până la 60s

// ── BARGE-IN (cât vorbește Kelion) ──────────────────────────────────────────
// Praguri mai stricte decât VOX-ul normal: echoCancellation scoate vocea lui
// Kelion din microfon, dar poate rămâne un rest — cerem semnal clar și susținut
// ca să nu se taie singur.
const BARGE_RMS = 0.024 // dublul pragului normal: doar voce apropiată, clară
const BARGE_HOLD_MS = 180 // vocea trebuie să țină atât ca să taie (nu un poc)
const BARGE_GUARD_MS = 300 // fereastră de gardă după ce începe redarea (onset)

// ── VOICEPRINT (amprentă vocală) ────────────────────────────────────────────
// Filtru 100% client-side: restrânge PORNIREA înregistrării ȘI barge-in-ul la
// vocea calibrată a lui Adrian, ca să nu reacționeze la orice voce/zgomot care
// trece pragul de volum (TV, alt om etc.). Pentru rolul demo (vizitatori
// publici), fără profil salvat, comportamentul rămâne exact cel de azi (accept
// orice voce). Pentru admin, fără profil salvat = neînrolat încă → nu se
// acceptă nimic până nu calibrează (vezi `restrictToOwnerVoice` în startMic).
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
  // Mostră audio scurtă (data-URL webm/opus) a frazei tocmai vorbite — trimisă
  // odată cu features ca adminul s-o poată ASCULTA din panou (buton „play").
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
// 6 iul: prima variantă (25Hz / 35%) surprindea DOAR intonația celor 3s de calibrare —
// vorbirea reală (întrebări, entuziasm, voce ridicată) variază mult mai mult și cădea
// în afara intervalului, blocând microfonul complet. Lărgite ca să acopere variația
// reală de intonație a aceleiași persoane, păstrând totuși un filtru util.
const F0_TOLERANCE_HZ = 55 // marjă în jurul intervalului F0 calibrat
const CENTROID_TOLERANCE_RATIO = 0.48 // marjă relativă pentru centroidul spectral
const F0_MIN_HZ = 70 // sub-limita vocii umane utile — restul e zgomot/eroare
const F0_MAX_HZ = 400 // supra-limita vocii umane utile (bărbați + femei)
// Histerezis pentru decizia de potrivire: autocorelația F0 pe UN SINGUR cadru de
// 2048 sample-uri poate greși de octavă sau poate fi păcălită de zgomot tranzitoriu —
// o singură eroare izolată nu mai trebuie să blocheze pornirea întregii fraze. Ținem
// ultimele MATCH_WINDOW_FRAMES evaluări și e suficientă o majoritate simplă potrivită.
// Redus de la 12 la 6 (iul 2026): fereastra veche tăia ~190 ms de la începutul
// cuvântului când profilul vocal era activ; 6 cadre (~95 ms) păstrează filtrul
// anti-eroare izolată dar reduce pierderea primelor silabe.
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

// autocorelație pe semnalul din domeniul timp — estimează frecvența fundamentală
// (algoritm ACF2+ clasic: trim la zero-crossing, autocorelație, interpolare parabolică)
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

  // interpolare parabolică în jurul vârfului pentru o estimare mai fină a lag-ului
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

// centroid spectral — media frecvențelor ponderată cu energia din fiecare bin
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

// zero-crossing rate — cât de "șuierătoare" e vocea; ajută la separare voce/zgomot
export function estimateZcr(buf: Float32Array): number {
  let crossings = 0
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i] >= 0) !== (buf[i - 1] >= 0)) crossings++
  }
  return crossings / buf.length
}

// energie RMS normalizată
export function estimateEnergy(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

// spectral rolloff — frecvența sub care stă 85% din energia spectrală
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

// jitter = variație relativă a perioadei fundamentale (F0)
export function estimateJitter(f0s: number[]): number {
  if (f0s.length < 2) return 0
  let sum = 0
  for (let i = 1; i < f0s.length; i++) {
    sum += Math.abs(f0s[i] - f0s[i - 1])
  }
  const mean = f0s.reduce((a, b) => a + b, 0) / f0s.length
  return mean > 0 ? sum / ((f0s.length - 1) * mean) : 0
}

// shimmer = variație relativă a amplitudinii pe cadre vocale consecutive
export function estimateShimmer(energies: number[]): number {
  if (energies.length < 2) return 0
  let sum = 0
  for (let i = 1; i < energies.length; i++) {
    sum += Math.abs(energies[i] - energies[i - 1])
  }
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length
  return mean > 0 ? sum / ((energies.length - 1) * mean) : 0
}

// Normalizează un vector de features la medie=0, deviație=1, cu clipping.
export function normalizeVector(v: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  const mean = v.reduce((a, b) => a + b, 0) / n
  const std = Math.sqrt(v.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n) || 1
  return v.map((x) => Math.max(-3, Math.min(3, (x - mean) / std)))
}

// Construiește features vocale complete dintr-un buffer de F0, energii și un
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

// Calibrare: captează scurt vocea lui Adrian și salvează profilul în localStorage.
// Returnează true doar dacă a strâns destule cadre vocale (RMS peste prag) — sub
// atât, profilul nu e de încredere și nu se salvează (rămâne comportamentul azi).
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
  // chemat când se aude vocea lui Adrian CÂT microfonul e mut (Kelion vorbește):
  // panoul taie vocea lui Kelion și dezmutează microfonul.
  onBargeIn?: () => void,
  // ordinul lui Adrian: „doar vocea mea sau scrisul meu". true = adminul — dacă
  // nu există încă profil calibrat, microfonul NU acceptă nicio voce (neînrolat,
  // nu „orice voce"). false = rolul demo (vizitatori publici) — comportamentul
  // rămâne exact cel de azi: fără profil, acceptă orice voce peste prag.
  restrictToOwnerVoice = false,
  // stream pre-încălzit de la apăsarea butonului "mic on" pentru activare instant.
  preWarmedStream?: MediaStream,
): Promise<MicHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    onError('unsupported')
    return null
  }
  let stream: MediaStream
  if (preWarmedStream && preWarmedStream.getAudioTracks().length > 0) {
    stream = preWarmedStream
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      // Refuz de permisiune ≠ eșec trecător: refuzul nu se reîncearcă singur,
      // eșecul trecător (dispozitiv ocupat, căști scoase) da.
      const name = (e as { name?: string })?.name
      onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
      return null
    }
  }

  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    onError('unsupported')
    return null
  }
  const ctx = new AC()
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  // analizor separat, cu rezoluție mai mare, doar pentru F0/centroid — nu atinge
  // RMS-ul de mai sus (analyser rămâne exact ca azi pentru VOX și barge-in)
  // `let`, nu `const`: profilul se poate ÎNVĂȚA automat în mers (vezi mai jos).
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
        // Safari) — backendul alege numele fișierului pentru OpenAI după el.
        body: JSON.stringify({ audio: b64, lang: getLang(), mime: blob.type || mime }),
      })
      if (!r.ok) {
        // nu mai murim tăcut — eroarea ajunge la Kelion prin raportarea F12
        console.error('asr batch a picat:', r.status)
        return
      }
      const j = (await r.json()) as { transcript?: string }
      const text = (j.transcript ?? '').trim()
      if (text) onTranscript(text)
    } catch {
      /* o frază pierdută nu oprește microfonul */
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
      // sub minim = zgomot scurt, nu-l trimitem. Cerem ȘI destulă VOCE efectivă
      // (nu doar durată totală) ca un poc + tăcere să nu mai producă transcriere
      // fantomă („Nu.", „Sim, mă simt") — bug 10 iul.
      if (took >= MIN_UTTER_MS && voiced >= MIN_VOICED_MS && blob.size > 0) {
        // MOSTRĂ AUDIO pentru butonul „play" din admin (Adrian, 14 iul): atașăm o
        // copie a frazei la features, ca s-o poată ASCULTA. Doar clipuri mici (o
        // frază, nu un monolog); conversia base64 e gata mult înainte ca ASR-ul să
        // răspundă, deci `clip` e pus la timp pe obiectul citit de ChatPanel.
        if (feats && blob.size <= 500_000) {
          const fr = new FileReader()
          fr.onload = () => {
            const url = String(fr.result || '')
            if (url.startsWith('data:')) feats.clip = url
          }
          try {
            fr.readAsDataURL(blob)
          } catch {
            /* fără mostră — identificarea merge oricum */
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

  // evaluare BRUTĂ pe cadrul curent — verifică F0 + centroid contra profilului
  // calibrat. Neînrolat (fără profil): demo → true mereu (comportament neschimbat);
  // admin (restrictToOwnerVoice) → false mereu, cât nu s-a calibrat încă (ordinul:
  // „doar vocea mea, nu se acceptă alta"). Poate greși izolat (octavă/zgomot) — de
  //-aia nu se folosește direct, ci prin fereastra de histerezis de mai jos.
  // AUTO-ÎNROLARE (ordin Adrian, 10 iul: „recunoașterea vocală trebuie s-o
  // treci pe automat" + „microfon cu autovox, instant"): fără profil salvat,
  // microfonul NU mai stă mut așteptând calibrarea manuală — acceptă vocea
  // IMEDIAT (autovox) și învață amprenta SINGUR din primele fraze reale:
  // strânge F0/centroid din cadrele vocale acceptate (doar cât NU redă Kelion,
  // ca să nu-și învețe propria voce din ecou) și, când are destule, salvează
  // profilul și abia apoi începe să-l aplice. Zero butoane, zero „dă-i da".
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
              /* localStorage indisponibil — profilul rămâne doar în memorie */
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

  // fereastră de histerezis: ține ultimele MATCH_WINDOW_FRAMES evaluări brute și
  // decide după majoritate, nu după cadrul curent — un singur cadru greșit nu mai
  // blochează pornirea/oprirea. Start-recording și barge-in au ferestre separate
  // (context diferit: una decide dacă începe fraza, alta dacă se taie vocea lui
  // Kelion), ca istoricul uneia să nu contamineze decizia celeilalte.
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
  // Se strâng DOAR cât înregistrăm o frază reală și NU cât Kelion vorbește.
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

  // PERMANENT ON: dacă pista moare din exterior (apel telefonic, căști Bluetooth
  // scoase, alt app ia microfonul), anunțăm — panoul redeschide microfonul singur.
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
    // RITMUL DIN CAMERĂ (Adrian, 27 iul: „când e pe YouTube/muzică și îi cer,
    // să sincronizeze muzica cu mișcările"): audio-ul din iframe-ul YouTube NU
    // poate fi citit de pagină (cross-origin), DAR microfonul AUDE muzica din
    // difuzoare. Expunem energia microfonului (chiar și cât e mut pentru voce —
    // tot analizează) ca semnal de ritm pentru dansul avatarului. Anvelopă cu
    // atac rapid / cădere lentă → pe bătaie sare, între bătăi coboară lin.
    const inst = Math.min(1, rms * 8)
    micBeatLevel = inst > micBeatLevel ? inst : micBeatLevel * 0.86 + inst * 0.14
    // podeaua de zgomot se adaptează lent când e liniște — dar NU cât redă
    // Kelion (restul de ecou ar urca podeaua și-ar surzi barge-in-ul)
    if (!recording && !muted) noiseFloor = noiseFloor * 0.95 + rms * 0.05
    const dt = 16
    const isVoice = !muted && rms > START_RMS && rms > noiseFloor * DOMINANCE

    // BARGE-IN: microfonul e mut (Kelion vorbește), dar tot ascultă. Voce clară
    // și susținută peste redare = Adrian vorbește → tăiem vocea lui Kelion. Aceeași
    // regulă a amprentei vocale se aplică și aici — altfel orice voce puternică din
    // preajmă (TV, alt om) ar putea întrerupe vocea lui Kelion, nu doar a lui Adrian.
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
      // Cadrul care a declanșat înregistrarea ESTE voce — îi dăm credit, altfel
      // cuvinte scurte (1-2 silabe) puteau cădea sub MIN_VOICED_MS din cauza
      // tic-ului pierdut între decizie și primul cadru înregistrat.
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
      // dacă începe vocea creierului cât înregistram, închidem fraza curentă
      if (m && recording) stopRec()
    },
  }
}

// ── REDARE: vocea creierului, sosită gata sintetizată de pe server ──────────
let curVoice: HTMLAudioElement | null = null

// ── LIP-SYNC: nivelul (0..1) al amplitudinii vocii redate acum ──────────────
// Regulă de aur: e un bonus vizual — dacă analiza eșuează din orice motiv,
// vocea trebuie să rămână audibilă neschimbată. Un singur AudioContext,
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

// RITMUL DIN MICROFON (dansul pe muzică): energia captată de microfon, ca
// anvelopă de bătaie — avatarul o folosește ca să-și miște corpul pe muzica
// pe care microfonul o aude din difuzoare. 0 când nu e microfon activ.
let micBeatLevel = 0
export function getMicBeatLevel(): number {
  return micBeatLevel
}

function stopLevelLoop(): void {
  if (levelRaf) cancelAnimationFrame(levelRaf)
  levelRaf = 0
  voiceLevel = 0
}

// Rutează redarea prin Web Audio API DOAR ca să măsoare amplitudinea (RMS),
// fără să schimbe redarea audibilă. Dacă orice pas eșuează, ieșim liniștiți —
// audio.play() de mai sus rămâne singurul responsabil de sunet.
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

    // createMediaElementSource poate fi apelat o singură dată per element —
    // dacă acest element audio a mai fost analizat (nu ar trebui, e mereu nou),
    // sau contextul refuză, renunțăm silențios la analiză, nu la sunet.
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
    // analiza a eșuat — vocea rămâne audibilă normal, doar gura nu se mișcă
    stopLevelLoop()
  }
}

// ── LIP-SYNC pentru pista LiveKit (full-duplex, pasul 4) ────────────────────
// Vocea agentului în modul full-duplex NU vine prin `curVoice` (redarea HTTP),
// ci printr-un <audio> separat atașat pistei LiveKit (lib/liveVoice.ts). Ca
// GURA avatarului să se miște și acolo, măsurăm amplitudinea acelui element cu
// propriul analizor și scriem în ACELAȘI `voiceLevel` pe care îl citește
// avatarul. Mutual exclusiv în timp cu calea HTTP (când una redă, cealaltă e
// oprită), deci nu se calcă. Bonus pur vizual: dacă eșuează, vocea rămâne
// audibilă neschimbată. Întoarce o funcție de oprire (curăță RAF + rutare).
let extAnalyser: AnalyserNode | null = null
let extBuf: Uint8Array<ArrayBuffer> | null = null
let extLevelSource: MediaStreamAudioSourceNode | null = null
let extLevelRaf = 0
// IMPORTANT (bug „audio nu merge", 13 iul): analizăm FLUXUL (MediaStream), NU
// elementul <audio>. `createMediaElementSource` PREIA ieșirea elementului în
// graful Web Audio — dacă AudioContext-ul e suspendat (politica de autoplay),
// sunetul dispare complet. `createMediaStreamSource` doar ASCULTĂ fluxul în
// paralel: elementul <audio> al pistei LiveKit redă neatins, iar noi măsurăm
// amplitudinea separat pentru gura avatarului. Nu conectăm la destination.
// Lip-sync pentru pista LiveKit din ELEMENTUL <audio> care o redă, NU din pista
// WebRTC brută. `captureStream()` dă un flux SEPARAT al ieșirii deja decodate a
// elementului — elementul continuă să redea neatins (spre deosebire de
// `createMediaElementSource`, care i-ar fura ieșirea și ar tăcea într-un context
// suspendat) și fără al doilea consumator pe pista brută (cauza brumului, 13 iul).
// Tolerant la eșec: fără captureStream → fără gură, dar vocea rămâne curată.
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
    // analiza a eșuat — vocea LiveKit rămâne audibilă, doar gura nu se mișcă
    return noop
  }
}

// Coadă de redare: creierul acum trimite vocea PE BUCĂȚI (frază cu frază, vezi
// streamVoice/backend chat.ts) ca sinteza să nu mai aștepte tot răspunsul.
// Bucata 2 poate sosi cât încă redă bucata 1 — aici NU se taie una pe alta, se
// pun la coadă și redau în ordine, ca o singură replică neîntreruptă. onStart
// se cheamă o singură dată (la prima bucată a replicii, mutează microfonul);
// onEnd la fel, o singură dată, după ce s-a redat ULTIMA bucată din coadă.
const voiceQueue: string[] = []
let pendingVoiceEnd: (() => void) | null = null
// ANTI-ECOU ÎNTRE FRAZE (Adrian, 10 iul: „ai distrus detecția de voce"). Vocea
// vine acum frază-cu-frază: bucata 1 se poate TERMINA de redat înainte să
// sosească sunetul bucății 2 (care încă se sintetizează pe server). Dacă la
// golirea cozii redeschideam microfonul pe loc, prindea ecoul propriei voci a
// lui Kelion în golul dintre fraze → detecție falsă / barge-in care tăia
// răspunsul. Acum, când coada se golește, NU redeschidem microfonul imediat:
// așteptăm această fereastră; dacă sosește altă bucată, e aceeași replică
// (timerul se anulează, microfonul rămâne mut); dacă NU mai vine nimic, abia
// atunci se cheamă onEnd (redeschidem). Acoperă golul de sinteză, ca microfonul
// să stea mut peste TOT răspunsul, exact ca înainte de vocea pe bucăți.
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
// Până azi aplicația NU avea NICIO comandă de volum: elementul audio Realtime
// și cel de TTS porneau fix pe 1.0. O singură valoare, persistată, aplicată pe
// TOATE elementele vocii (Realtime + TTS) — sliderul din ChatPanel o mișcă live.
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
    /* privat/plin — volumul rămâne pe sesiune */
  }
  for (const el of voiceElements) el.volume = voiceVolume
}

/** Înscrie un element audio al vocii ca să urmeze volumul global (și acum, și la schimbări). */
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
  // Coada s-a golit — dar poate mai vine o frază (sinteza ei e încă pe drum).
  // NU redeschide microfonul acum; lasă fereastra anti-ecou. Dacă vine altă
  // bucată, playVoice anulează timerul; dacă nu, abia atunci onEnd (unmute).
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
    // deja redă o bucată din ACEEAȘI replică — se adaugă la coadă, nu se taie.
    voiceQueue.push(base64Mp3)
    return
  }
  // Într-un GOL între fraze (microfon deja mut, așteptam bucata următoare):
  // e continuarea ACELEIAȘI replici — anulează redeschiderea, NU rechema
  // onStart (microfonul e deja mut), redă mai departe.
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
  // FIX „microfon mut pe viață" (audit 24 iul, P1): callback-ul de final (care
  // face UNMUTE pe microfonul sesiunii Realtime) era ARUNCAT fără să fie chemat
  // → după un „stop"/barge-in scris în timpul redării, pista rămânea enabled=false
  // pentru totdeauna = „nu mă aude". Îl executăm ÎNAINTE de a-l șterge.
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
