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

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase()
  const voices = window.speechSynthesis.getVoices()
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  const male = sameLang.find((v) =>
    /male|b[aă]rbat|masculin|david|george|andrei|paul|daniel/i.test(v.name),
  )
  return male ?? sameLang[0] ?? null
}

function browserSpeak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    if (!synth) {
      resolve()
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = pickVoice(lang)
    if (v) u.voice = v
    u.rate = 1.0
    u.onend = () => resolve()
    u.onerror = () => resolve()
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
      curAudio = audio
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
  if (!ttsBusy) void drain()
}

export function setOnSpeechIdle(cb: (() => void) | null): void {
  onIdle = cb
}

export function isSpeaking(): boolean {
  return ttsBusy || curAudio !== null || window.speechSynthesis?.speaking === true
}

export function stopSpeaking(): void {
  ttsQueue = []
  ttsBusy = false
  if (curAudio) {
    curAudio.pause()
    curAudio = null
  }
  window.speechSynthesis?.cancel()
}

// ──────────────────────────── STT (listen) ────────────────────────────

interface RecAlternative {
  readonly transcript: string
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
  const w = window as unknown as {
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
  onFinal: (text: string) => void,
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
          if (text) onFinal(text)
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
      if (!stopped && !muted) window.setTimeout(start, 250)
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
