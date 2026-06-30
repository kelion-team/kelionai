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

// ── Lip-sync: expose a 0..1 "mouth openness" while Kelion speaks. For Chirp
// audio we tap the real waveform (accurate); for browser TTS (no analysable
// stream) we drive a procedural mouth so the avatar still talks. ──
let speakCtx: AudioContext | null = null
let speakAnalyser: AnalyserNode | null = null
let speakData: Uint8Array<ArrayBuffer> | null = null
let browserSpeaking = false

function ensureSpeakCtx(): AudioContext | null {
  if (speakCtx) return speakCtx
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  speakCtx = new AC()
  speakAnalyser = speakCtx.createAnalyser()
  speakAnalyser.fftSize = 256
  speakData = new Uint8Array(new ArrayBuffer(speakAnalyser.frequencyBinCount))
  return speakCtx
}

/** 0..1 mouth openness for the avatar; 0 when Kelion is silent. */
export function getSpeakingLevel(): number {
  if (speakAnalyser && speakData && curAudio && !curAudio.paused) {
    speakAnalyser.getByteTimeDomainData(speakData)
    let sum = 0
    for (let i = 0; i < speakData.length; i++) {
      const v = (speakData[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / speakData.length) // 0..~0.5 typical speech
    return Math.min(1, rms * 3.2)
  }
  if (browserSpeaking) {
    // Procedural flap (no waveform to read from SpeechSynthesis).
    const t = performance.now() / 1000
    return 0.3 + 0.25 * Math.abs(Math.sin(t * 11)) + 0.15 * Math.abs(Math.sin(t * 6.3))
  }
  return 0
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
    await new Promise<void>((resolve) => {
      const audio = new Audio(url)
      audio.crossOrigin = 'anonymous'
      curAudio = audio
      // Route through the analyser so the avatar lip-syncs to the real waveform.
      const ctx = ensureSpeakCtx()
      if (ctx && speakAnalyser) {
        void ctx.resume()
        try {
          const node = ctx.createMediaElementSource(audio)
          node.connect(speakAnalyser)
          speakAnalyser.connect(ctx.destination)
        } catch {
          /* fall through — audio still plays via the element below */
        }
      }
      const done = (): void => {
        URL.revokeObjectURL(url)
        if (curAudio === audio) curAudio = null
        resolve()
      }
      audio.onended = done
      audio.onerror = done
      void audio.play().catch(done)
    })
    return true
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
  let played = false
  if (chirpMode !== 'off') played = await chirpSpeak(item.text, item.lang)
  if (!played) await browserSpeak(item.text, item.lang)
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
