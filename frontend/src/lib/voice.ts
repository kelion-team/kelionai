// Browser-native voice — interim increment. ASR = Web Speech API (Chrome uses
// Google's engine, free + accurate). TTS = SpeechSynthesis. The spec target is
// Google Chirp 3 HD (male, academic) + "Hey Kelion" wake word + LiveKit
// full-duplex. Everything here is isolated behind small functions so the TTS
// engine and ASR transport can be swapped later without touching the chat UI.

// ──────────────────────────── TTS (speak) ────────────────────────────
// A sentence queue so Kelion can start speaking the first sentence while the
// rest of the reply is still streaming (voice + text in parallel).

let ttsQueue: string[] = []
let ttsSpeaking = false
let ttsLang = 'en-US'
let onIdle: (() => void) | null = null

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase()
  const voices = window.speechSynthesis.getVoices()
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  // Prefer a male voice when one exists (academic register, per spec).
  const male = sameLang.find((v) =>
    /male|b[aă]rbat|masculin|david|george|andrei|paul|daniel/i.test(v.name),
  )
  return male ?? sameLang[0] ?? null
}

function drain(): void {
  const synth = window.speechSynthesis
  const next = ttsQueue.shift()
  if (next === undefined) {
    ttsSpeaking = false
    onIdle?.()
    return
  }
  ttsSpeaking = true
  const u = new SpeechSynthesisUtterance(next)
  u.lang = ttsLang
  const v = pickVoice(ttsLang)
  if (v) u.voice = v
  u.rate = 1.0
  u.onend = () => drain()
  u.onerror = () => drain()
  synth.speak(u)
}

/** Queue a piece of text to be spoken. Safe to call repeatedly while streaming. */
export function enqueueSpeech(text: string, lang: string): void {
  const synth = window.speechSynthesis
  if (!synth) return
  const clean = text.trim()
  if (!clean) return
  ttsLang = lang
  ttsQueue.push(clean)
  if (!ttsSpeaking) drain()
}

/** Called once the whole TTS queue has finished playing. */
export function setOnSpeechIdle(cb: (() => void) | null): void {
  onIdle = cb
}

export function isSpeaking(): boolean {
  return ttsSpeaking || window.speechSynthesis?.speaking === true
}

export function stopSpeaking(): void {
  ttsQueue = []
  ttsSpeaking = false
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
  /** Permanently stop listening and release the mic. */
  stop(): void
  /** Temporarily mute (e.g. while Kelion is speaking) without losing the session. */
  setMuted(muted: boolean): void
}

/**
 * Permanent (continuous) listening. Streams the mic and fires `onFinal` for
 * every completed utterance. Auto-restarts when the browser ends a segment
 * (Chrome stops after silence/~60s). `setMuted(true)` is used while Kelion
 * speaks so its own TTS voice is not picked up (interim echo guard — true
 * echo-cancelled barge-in arrives with the LiveKit milestone).
 */
export function startContinuous(
  lang: string,
  onFinal: (text: string) => void,
): ContinuousHandle | null {
  const Ctor = getCtor()
  if (!Ctor) return null

  let stopped = false
  let muted = false
  let rec: RecognitionLike | null = null

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
    // 'no-speech' / 'aborted' are normal; onend handles restart.
    r.onerror = () => {}
    r.onend = () => {
      rec = null
      if (!stopped && !muted) start()
    }
    rec = r
    try {
      r.start()
    } catch {
      rec = null
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
