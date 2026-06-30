// Voice I/O. ASR = Web Speech API (Chrome uses Google's engine, free + accurate;
// the spec primary). TTS = Google Chirp 3 HD via the backend /api/tts (male,
// academic — the spec voice), with the browser voice as an automatic fallback
// when no Google TTS key is configured. Spec next steps: Picovoice wake word +
// LiveKit full-duplex transport.

// ──────────────────────────── TTS (speak) ────────────────────────────
// Sentence queue so Kelion starts speaking the first sentence while the rest of
// the reply is still streaming (voice + text in parallel).

interface TtsItem {
  text: string
  lang: string
}

let ttsQueue: TtsItem[] = []
let ttsBusy = false
let curAudio: HTMLAudioElement | null = null
let chirpMode: 'unknown' | 'on' | 'off' = 'unknown'
let onIdle: (() => void) | null = null
// Fires true when Kelion starts speaking, false when he stops. The mic layer
// uses this to go half-duplex (mute the recognizer while he talks) so his own
// voice from the speakers never feeds back into recognition (anti-echo).
let onSpeaking: ((speaking: boolean) => void) | null = null

export function setOnSpeakingChange(cb: ((speaking: boolean) => void) | null): void {
  onSpeaking = cb
}

// ── Lip-sync (formant-based visemes) ──────────────────────────────────────
// Real-time viseme estimation from the TTS audio spectrum: we measure energy in
// the formant bands (F1 ≈ mouth openness, F2 ≈ front/back, plus the fricative
// and sibilant bands) and resolve weights for the Ready Player Me Oculus
// visemes (aa, E, I, O, U, SS, FF) instead of one crude "open jaw" amount. This
// is the same principle pro RPM lip-sync uses. Browser-TTS fallback (no
// analysable stream) drives a gentle procedural vowel cycle.
let speakCtx: AudioContext | null = null
let speakAnalyser: AnalyserNode | null = null
let speakFreq: Uint8Array<ArrayBuffer> | null = null
let browserSpeaking = false
// analyser → destination is wired once; re-connecting every turn is wasteful and
// the duplicate connects were part of why playback got flaky over a session.
let analyserWired = false

/** Per-viseme weights (0..1) for the avatar mouth, plus overall jaw openness. */
export interface MouthState {
  jaw: number
  aa: number
  E: number
  I: number
  O: number
  U: number
  SS: number
  FF: number
}
const MOUTH_SILENT: MouthState = { jaw: 0, aa: 0, E: 0, I: 0, O: 0, U: 0, SS: 0, FF: 0 }
export const VISEME_KEYS = ['aa', 'E', 'I', 'O', 'U', 'SS', 'FF'] as const

// Caps: visemes are already strong mouth shapes, so keep them subtle; jaw is a
// light extra openness on top. Real speech barely parts the lips.
const VISEME_MAX = 0.5
const JAW_MAX = 0.16
const SILENCE = 0.05 // below this band energy → mouth closed (start/end guard)

function ensureSpeakCtx(): AudioContext | null {
  if (speakCtx) return speakCtx
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  speakCtx = new AC()
  speakAnalyser = speakCtx.createAnalyser()
  speakAnalyser.fftSize = 1024 // ~47 Hz/bin at 48 kHz — enough to resolve formants
  speakAnalyser.smoothingTimeConstant = 0.5
  speakFreq = new Uint8Array(new ArrayBuffer(speakAnalyser.frequencyBinCount))
  return speakCtx
}

// Average normalized (0..1) magnitude over a frequency band [loHz, hiHz).
function bandEnergy(freq: Uint8Array, binHz: number, loHz: number, hiHz: number): number {
  const lo = Math.max(1, Math.floor(loHz / binHz))
  const hi = Math.min(freq.length, Math.ceil(hiHz / binHz))
  if (hi <= lo) return 0
  let s = 0
  for (let i = lo; i < hi; i++) s += freq[i]
  return s / (hi - lo) / 255
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function visemesFromSpectrum(freq: Uint8Array, sampleRate: number): MouthState {
  const binHz = sampleRate / (freq.length * 2)
  const f1 = bandEnergy(freq, binHz, 250, 900) //   openness  (a/o)
  const f2 = bandEnergy(freq, binHz, 900, 2500) //  frontness (e/i)
  const fric = bandEnergy(freq, binHz, 2500, 4500) // f/v/th
  const sib = bandEnergy(freq, binHz, 4500, 9000) //  s/z/sh
  const loud = Math.max(f1, f2, fric, sib)
  if (loud < SILENCE) return MOUTH_SILENT

  const sibW = clamp01(sib * 2.4)
  const fricW = clamp01(fric * 2.0) * (1 - sibW)
  const vowel = clamp01(1 - sibW - fricW * 0.7)

  const open = clamp01(f1 * 2.6) //          how open the jaw is
  const front = f1 + f2 > 0 ? f2 / (f1 + f2) : 0 //  0 back … 1 front
  const round = clamp01(1 - front * 2) //    low F2 → rounded back vowel (o/u)

  const v = VISEME_MAX
  return {
    jaw: clamp01(open * loud) * JAW_MAX,
    aa: clamp01(vowel * open * (1 - round) * (1 - Math.max(0, front - 0.5) * 1.6)) * v,
    E: clamp01(vowel * front * (1 - open * 0.4)) * v,
    I: clamp01(vowel * Math.max(0, front - 0.55) * 1.8) * v,
    O: clamp01(vowel * round * Math.min(1, open + 0.3) * 0.8) * v,
    U: clamp01(vowel * round * (1 - open) * 0.7) * v,
    SS: clamp01(sibW * loud) * v,
    FF: clamp01(fricW * loud) * v,
  }
}

export function getMouthState(): MouthState {
  if (speakAnalyser && speakFreq && speakCtx && curAudio && !curAudio.paused) {
    speakAnalyser.getByteFrequencyData(speakFreq)
    return visemesFromSpectrum(speakFreq, speakCtx.sampleRate)
  }
  if (browserSpeaking) {
    // No analysable stream from the browser voice — cycle a/e/o gently so the
    // mouth still articulates instead of flapping.
    const t = performance.now() / 1000
    const e = 0.4 + 0.35 * Math.abs(Math.sin(t * 9))
    const phase = (Math.sin(t * 3.3) + 1) / 2
    return {
      jaw: JAW_MAX * e,
      aa: phase > 0.62 ? VISEME_MAX * e : 0,
      E: phase <= 0.62 && phase > 0.3 ? VISEME_MAX * e : 0,
      O: phase <= 0.3 ? VISEME_MAX * e : 0,
      I: 0,
      U: 0,
      SS: 0,
      FF: 0,
    }
  }
  return MOUTH_SILENT
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase()
  const voices = globalThis.speechSynthesis.getVoices()
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  const male = sameLang.find((v) =>
    /male|b[aă]rbat|masculin|david|george|andrei|paul|daniel/i.test(v.name),
  )
  return male ?? sameLang[0] ?? null
}

function browserSpeak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = globalThis.speechSynthesis
    if (!synth) {
      resolve()
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = pickVoice(lang)
    if (v) u.voice = v
    u.rate = 1
    const finish = (): void => {
      browserSpeaking = false
      resolve()
    }
    u.onstart = () => {
      browserSpeaking = true
    }
    u.onend = finish
    u.onerror = finish
    synth.speak(u)
  })
}

// Returns true if it played via Chirp; false means "fall back to the browser".
async function chirpSpeak(text: string, lang: string): Promise<boolean> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, lang }),
    })
    if (res.status === 503) {
      chirpMode = 'off' // no key configured — stop trying for this session
      return false
    }
    if (!res.ok) return false
    chirpMode = 'on'
    const url = URL.createObjectURL(await res.blob())
    // Resolves true if the clip actually played, false if it errored/couldn't —
    // false makes drain() fall back to the browser voice (alternate voice).
    const played = await new Promise<boolean>((resolve) => {
      const audio = new Audio(url)
      audio.crossOrigin = 'anonymous'
      curAudio = audio
      const ctx = ensureSpeakCtx()
      const finish = (ok: boolean): void => {
        URL.revokeObjectURL(url)
        if (curAudio === audio) curAudio = null
        resolve(ok)
      }
      audio.onended = () => finish(true)
      audio.onerror = () => finish(false)
      const route = (): void => {
        // Route through the analyser so the avatar lip-syncs to the real
        // waveform. Once an element is routed into Web Audio its output goes
        // ONLY through the graph, so the context must be running or it's silent.
        if (ctx && speakAnalyser) {
          try {
            const node = ctx.createMediaElementSource(audio)
            node.connect(speakAnalyser)
            if (!analyserWired) {
              speakAnalyser.connect(ctx.destination)
              analyserWired = true
            }
          } catch {
            /* source already exists / unavailable — element plays on its own */
          }
        }
        void audio.play().catch(() => finish(false))
      }
      if (ctx && ctx.state === 'suspended') void ctx.resume().finally(route)
      else route()
    })
    return played
  } catch {
    return false
  }
}

async function drain(): Promise<void> {
  const item = ttsQueue.shift()
  if (!item) {
    ttsBusy = false
    onSpeaking?.(false) // Kelion finished — mic may reopen (anti-echo half-duplex)
    onIdle?.()
    return
  }
  ttsBusy = true
  // ONE consistent voice. Use Chirp 3 HD whenever it's available; only use the
  // browser voice when Chirp is off for the WHOLE session (no key) — never as a
  // mid-reply substitute, which is what made the voice sound mixed/unintelligible.
  // (chirpSpeak() may flip chirpMode to 'off' if there's no key; re-check after.)
  let played = false
  if (chirpMode !== 'off') played = await chirpSpeak(item.text, item.lang)
  if (!played && chirpMode === 'off') await browserSpeak(item.text, item.lang)
  void drain()
}

/** Queue text to speak. Safe to call repeatedly while a reply streams in. */
export function enqueueSpeech(text: string, lang: string): void {
  const clean = text.trim()
  if (!clean) return
  ttsQueue.push({ text: clean, lang })
  if (!ttsBusy) {
    onSpeaking?.(true) // Kelion starts — mute the mic so his voice doesn't feed back
    void drain()
  }
}

export function setOnSpeechIdle(cb: (() => void) | null): void {
  onIdle = cb
}

export function isSpeaking(): boolean {
  return ttsBusy || curAudio !== null || globalThis.speechSynthesis?.speaking === true
}

export function stopSpeaking(): void {
  ttsQueue = []
  ttsBusy = false
  if (curAudio) {
    curAudio.pause()
    curAudio = null
  }
  globalThis.speechSynthesis?.cancel()
}

// ──────────────────────────── STT (listen) ────────────────────────────

interface RecAlternative {
  readonly transcript: string
  readonly confidence?: number
}
interface RecResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: RecAlternative
}
interface RecResultList {
  readonly length: number
  readonly [index: number]: RecResult
}
interface RecEvent {
  readonly resultIndex: number
  readonly results: RecResultList
}
interface RecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: RecEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => RecognitionLike

function getCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return getCtor() !== null
}

/** One-shot listen (push-to-talk): captures a single utterance, then stops. */
export function listenOnce(
  lang: string,
  onText: (text: string) => void,
  onEnd: () => void,
): { stop: () => void } | null {
  const Ctor = getCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.continuous = false
  rec.onresult = (e) => {
    const text = e.results[0]?.[0]?.transcript?.trim() ?? ''
    if (text) onText(text)
  }
  rec.onerror = () => {}
  rec.onend = () => onEnd()
  rec.start()
  return { stop: () => rec.stop() }
}

export interface ContinuousHandle {
  stop(): void
  setMuted(muted: boolean): void
}

/**
 * Permanent (continuous) listening. Streams the mic and fires `onFinal` for
 * every completed utterance, auto-restarting when the browser ends a segment.
 */
export function startContinuous(
  lang: string,
  onFinal: (text: string, confidence: number) => void,
  onError?: (error: string) => void,
): ContinuousHandle | null {
  const Ctor = getCtor()
  if (!Ctor) return null

  let stopped = false
  let muted = false
  let rec: RecognitionLike | null = null
  // Permission/availability failures are permanent — don't busy-loop restart.
  const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture'])

  const start = (): void => {
    if (stopped || muted || rec) return
    const r = new Ctor()
    r.lang = lang
    r.interimResults = true
    r.maxAlternatives = 1
    r.continuous = true
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const item = e.results[i]
        if (item?.isFinal) {
          const text = item[0]?.transcript?.trim() ?? ''
          // Chrome reports a confidence in [0,1]; default to 1 when absent.
          const conf = typeof item[0]?.confidence === 'number' ? item[0].confidence : 1
          if (text) onFinal(text, conf)
        }
      }
    }
    r.onerror = (e) => {
      onError?.(e.error)
      if (FATAL.has(e.error)) {
        stopped = true // give up; surfaced to the UI via onError
        rec = null
      }
    }
    r.onend = () => {
      rec = null
      if (!stopped && !muted) start()
    }
    rec = r
    try {
      r.start()
    } catch {
      // start() throws if a previous instance hasn't fully released; retry once.
      rec = null
      if (!stopped && !muted) globalThis.setTimeout(start, 250)
    }
  }

  start()

  return {
    stop() {
      stopped = true
      muted = true
      try {
        rec?.abort()
      } catch {
        /* already stopped */
      }
      rec = null
    },
    setMuted(m: boolean) {
      if (m === muted) return
      muted = m
      if (m) {
        try {
          rec?.abort()
        } catch {
          /* already stopped */
        }
        rec = null
      } else if (!stopped) {
        start()
      }
    },
  }
}
