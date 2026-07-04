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
let chirpFails = 0 // consecutive Chirp failures; only give up after a few in a row
let onIdle: (() => void) | null = null
// Fires true when Kelion starts speaking, false when he stops. The mic layer
// uses this to go half-duplex (mute the recognizer while he talks) so his own
// voice from the speakers never feeds back into recognition (anti-echo).
let onSpeaking: ((speaking: boolean) => void) | null = null

export function setOnSpeakingChange(cb: ((speaking: boolean) => void) | null): void {
  onSpeaking = cb
}

// ── Lip-sync (text + playback-time driven, phoneme-weighted) ──────────────
// The mouth follows the ACTUAL words. We know each clip's text and how far its
// playback has progressed; playback time is mapped through PER-CHARACTER
// DURATION WEIGHTS — vowels ring long, consonants are brief, word gaps are
// short and punctuation is a real closed-mouth pause. That weighting is what
// keeps the mouth ON the vowels/consonants and CLOSED through pauses (a linear
// per-character mapping drifts out of sync, because speech isn't uniform).
// A small LEAD makes it cinematic: lips form the sound just before it's heard.
// AvatarModel smooths between shapes for the glide.
let curText = '' // text of the clip currently playing (drives the mouth)
let curWeights: Float32Array | null = null // prefix sums of char durations (time fallback)
let curTotal = 0
// Voiced-only prefix sums (pauses ≈ 0): used with the ENERGY alignment below,
// where silence itself handles the pauses and only voiced sound advances text.
let curVoiced: Float32Array | null = null
let curVoicedTotal = 0

// ── Millisecond truth: the clip's real energy envelope ────────────────────
// Every TTS clip is decoded (a COPY — playback stays a plain <audio> element,
// untouched) into a 10 ms RMS envelope. The mouth then follows the ACTUAL
// sound: silence closes it to the millisecond, loudness scales it, and the
// text position advances through CUMULATIVE ENERGY, so each phoneme shape
// lands on its real sound instead of an estimated time slot.
const ENV_WIN_S = 0.01
let curEnv: Float32Array | null = null
let curEnvCum: Float32Array | null = null
let curEnvTotal = 0
let curEnvPeak = 0
let decodeCtx: AudioContext | null = null // decode-only; never routes playback

function buildEnvelope(buf: AudioBuffer): void {
  const data = buf.getChannelData(0)
  const win = Math.max(1, Math.round(buf.sampleRate * ENV_WIN_S))
  const n = Math.ceil(data.length / win)
  const env = new Float32Array(n)
  const cum = new Float32Array(n)
  let peak = 0
  let acc = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    const start = i * win
    const end = Math.min(data.length, start + win)
    for (let j = start; j < end; j++) sum += data[j] * data[j]
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    env[i] = rms
    acc += rms
    cum[i] = acc
    if (rms > peak) peak = rms
  }
  curEnv = env
  curEnvCum = cum
  curEnvTotal = acc
  curEnvPeak = peak
}

// How much of the clip's spoken time each character really occupies.
function charWeight(ch: string): number {
  const c = ch.toLowerCase()
  if ('aăâeiîouy'.includes(c)) return 1.0 // vowels carry the sound
  if (',;:'.includes(c)) return 2.2 //       breath pause
  if ('.!?…'.includes(c)) return 3.5 //      sentence pause
  if (c === ' ' || c === '\n') return 0.55 // word gap
  if (/\p{L}/u.test(c)) return 0.62 //       consonants: quick
  return 0.4 //                              digits / other
}

function buildWeights(text: string): void {
  const w = new Float32Array(text.length)
  const v = new Float32Array(text.length)
  let acc = 0
  let vacc = 0
  for (let i = 0; i < text.length; i++) {
    const cw = charWeight(text[i])
    acc += cw
    w[i] = acc
    // Voiced-only weighting: pauses/gaps barely advance (the real silence in
    // the energy envelope is what holds the mouth closed through them).
    vacc += cw >= 2 || cw === 0.55 ? 0.08 : cw
    v[i] = vacc
  }
  curWeights = w
  curTotal = acc
  curVoiced = v
  curVoicedTotal = vacc
}

// Lips shape the phoneme slightly BEFORE the sound lands (like a real speaker).
const LIP_LEAD_S = 0.07

// ── Recording tap ─────────────────────────────────────────────────────────
// While a screen recording runs, the recorder registers a tap here and every
// TTS clip's audio is ALSO fed into the recording mix — Kelion's voice lands in
// the clip GUARANTEED, independent of the browser's "share audio" checkbox.
let voiceTap: ((s: MediaStream) => void) | null = null
export function setVoiceTap(tap: ((s: MediaStream) => void) | null): void {
  voiceTap = tap
}

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

// Keep the mouth subtle — real speech barely parts the lips; gaping looks wrong.
const JAW_MAX = 0.1
const VISEME_MAX = 0.4

// A character → its target mouth shape (unit weights, before caps). Returns null
// for a fully closed mouth (spaces, punctuation, and the lip-closing consonants).
function shapeForChar(ch: string): Partial<MouthState> | null {
  const c = ch.toLowerCase()
  if ('aăâ'.includes(c)) return { jaw: 1, aa: 1 }
  if (c === 'e') return { jaw: 0.6, E: 1 }
  if ('iî'.includes(c)) return { jaw: 0.3, I: 1 }
  if (c === 'o') return { jaw: 0.75, O: 1 }
  if (c === 'u') return { jaw: 0.45, U: 1 }
  if ('szjț'.includes(c)) return { jaw: 0.12, SS: 1 } // sibilants
  if ('fv'.includes(c)) return { jaw: 0.1, FF: 1 } //    labiodentals
  if ('mbp'.includes(c)) return null //                  lips pressed shut
  if (/[a-zà-ÿșţ]/.test(c)) return { jaw: 0.2 } //        other consonants: barely open
  return null //                                          space / punctuation / digit → closed
}

// Map a 0..1 progress through a prefix-sum array to its index (binary search —
// O(log n) per frame).
function indexAt(w: Float32Array, total: number, progress: number): number {
  if (w.length === 0 || total <= 0) return 0
  const target = progress * total
  let lo = 0
  let hi = w.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (w[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function getMouthState(): MouthState {
  if (curAudio && !curAudio.paused && curText) {
    const t = curAudio.currentTime + LIP_LEAD_S // cinematic anticipation
    let pos: number
    let level = 1 // how loud the sound is right now (scales the mouth)
    if (curEnv && curEnvCum && curEnvTotal > 0 && curEnvPeak > 0 && curVoiced) {
      // MILLISECOND TRUTH: follow the decoded waveform. Silence → closed, now.
      const i = Math.min(curEnv.length - 1, Math.max(0, Math.floor(t / ENV_WIN_S)))
      const rms = curEnv[i]
      if (rms < curEnvPeak * 0.07) return MOUTH_SILENT
      level = Math.min(1, rms / (curEnvPeak * 0.65))
      // Text advances through CUMULATIVE ENERGY: phonemes land on their sounds.
      pos = curEnvCum[i] / curEnvTotal
      const idx = Math.min(curText.length - 1, indexAt(curVoiced, curVoicedTotal, pos))
      return shapeAt(idx, level)
    }
    // Fallback (decode unavailable): phoneme-weighted playback time.
    const dur = curAudio.duration
    const p = dur && Number.isFinite(dur) && dur > 0 ? t / dur : 0
    pos = p < 0 ? 0 : p > 1 ? 1 : p
    const idx = Math.min(
      curText.length - 1,
      curWeights ? indexAt(curWeights, curTotal, pos) : 0,
    )
    return shapeAt(idx, 1)
  }
  return MOUTH_SILENT
}

function shapeAt(idx: number, level: number): MouthState {
  const s = shapeForChar(curText[idx] ?? ' ')
  if (!s) return MOUTH_SILENT
  // The jaw breathes with the real loudness; the viseme identity stays crisp.
  const jawAmp = JAW_MAX * (0.55 + 0.45 * level)
  const visAmp = VISEME_MAX * (0.75 + 0.25 * level)
  return {
    jaw: (s.jaw ?? 0) * jawAmp,
    aa: (s.aa ?? 0) * visAmp,
    E: (s.E ?? 0) * visAmp,
    I: (s.I ?? 0) * visAmp,
    O: (s.O ?? 0) * visAmp,
    U: (s.U ?? 0) * visAmp,
    SS: (s.SS ?? 0) * visAmp,
    FF: (s.FF ?? 0) * visAmp,
  }
}

// Fetch one Chirp clip as an audio blob, RETRYING transient failures with
// growing backoff so a weak mobile link (3G/tunnel) doesn't drop the voice.
// Returns the blob, 'off' (no TTS configured — disable for the session), or
// null (gave up after retries). This is the network side; playback is separate,
// which lets us PREFETCH the next clip while the current one is still playing —
// the "buffer" that keeps the voice smooth like internet radio.
async function fetchClip(text: string, lang: string): Promise<Blob | 'off' | null> {
  const backoffs = [0, 300, 700, 1500] // ~4 attempts, growing pause between
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt]) await new Promise((r) => setTimeout(r, backoffs[attempt]))
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, lang }),
      })
      if (r.status === 503) return 'off' // no key configured → Chirp off this session
      if (r.ok) return await r.blob()
      // A 5xx may be a transient edge/container blip — keep retrying; a 4xx won't
      // get better, so stop.
      if (r.status < 500) return null
    } catch {
      /* network hiccup — retry with backoff */
    }
  }
  return null
}

// Returns true if it played via Chirp; false means it couldn't. `prefetched` is
// an already-fetched blob (from the buffer) so we skip the network round-trip.
async function chirpSpeak(
  text: string,
  lang: string,
  prefetched?: Blob | 'off' | null,
): Promise<boolean> {
  const blob = prefetched !== undefined ? prefetched : await fetchClip(text, lang)
  if (blob === 'off') {
    chirpMode = 'off'
    return false
  }
  if (!blob) {
    // Do NOT swap to the browser voice — stay silent for this line; the academic
    // Chirp voice resumes on the next. Give up for the session only after a long
    // run of failures (the network is truly down).
    if (++chirpFails >= 6) chirpMode = 'off'
    return false
  }
  chirpFails = 0
  chirpMode = 'on'
  try {
    const url = URL.createObjectURL(blob)
    // Decode a COPY of the clip for the millisecond envelope BEFORE playing, so
    // the mouth is waveform-true from the very first frame. Decode failure just
    // falls back to the phoneme-weighted time mapping — playback never waits on
    // anything else and is never routed through WebAudio.
    curEnv = null
    curEnvCum = null
    curEnvTotal = 0
    curEnvPeak = 0
    try {
      decodeCtx ??= new (globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      buildEnvelope(await decodeCtx.decodeAudioData(await blob.arrayBuffer()))
    } catch {
      /* envelope optional */
    }
    // Resolves true if the clip actually played, false if it errored/couldn't —
    // false makes drain() fall back to the browser voice (alternate voice).
    const played = await new Promise<boolean>((resolve) => {
      const audio = new Audio(url)
      audio.preload = 'auto'
      curAudio = audio
      curText = text // the clip's (cleaned) text — drives the lip-sync
      buildWeights(text) // phoneme-weighted timing for the mouth
      // A screen recording is running: feed this clip's audio STRAIGHT into the
      // recorder's mix (captureStream taps the element without touching normal
      // playback), so Kelion's voice is in the clip even if "share tab audio"
      // wasn't ticked in the browser's picker.
      if (voiceTap) {
        try {
          const cap = (
            audio as HTMLAudioElement & { captureStream?: () => MediaStream }
          ).captureStream?.()
          if (cap) voiceTap(cap)
        } catch {
          /* tap is best-effort — playback must never depend on it */
        }
      }
      let guard = 0
      const finish = (ok: boolean): void => {
        globalThis.clearTimeout(guard)
        URL.revokeObjectURL(url)
        if (curAudio === audio) {
          curAudio = null
          curText = ''
          curWeights = null
          curTotal = 0
          curVoiced = null
          curVoicedTotal = 0
          curEnv = null
          curEnvCum = null
          curEnvTotal = 0
          curEnvPeak = 0
        }
        resolve(ok)
      }
      // Safety net: never let a stuck clip freeze the queue and keep the mic
      // muted. 30s covers LOADING only — once the real duration is known the
      // net stretches to the WHOLE clip + margin. (A fixed 30s abandoned a 60s
      // promo narration halfway: the mouth froze while the audio played on.)
      guard = globalThis.setTimeout(() => {
        try {
          audio.pause()
        } catch {
          /* already stopped */
        }
        finish(false)
      }, 30_000)
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          globalThis.clearTimeout(guard)
          guard = globalThis.setTimeout(() => {
            try {
              audio.pause()
            } catch {
              /* already stopped */
            }
            finish(false)
          }, audio.duration * 1000 + 8000)
        }
      }
      audio.onended = () => finish(true)
      audio.onerror = () => finish(false)
      // Play the element DIRECTLY — no Web Audio graph. Routing every clip through
      // an analyser was fragile: it made the volume start loud then drop and some
      // clips go silent ("nu rămâne același personaj"). Plain playback keeps ONE
      // consistent voice at a constant level; lip-sync is driven from the text.
      void audio.play().catch(() => finish(false))
    })
    return played
  } catch {
    return false
  }
}

// The clip fetched ahead of time (while the previous one plays) — the buffer.
let prefetch: { key: string; blob: Promise<Blob | 'off' | null> } | null = null
const clipKey = (t: string, l: string): string => `${l} ${t}`

async function drain(): Promise<void> {
  const item = ttsQueue.shift()
  if (!item) {
    ttsBusy = false
    prefetch = null
    onSpeaking?.(false) // Kelion finished — mic may reopen (anti-echo half-duplex)
    onIdle?.()
    return
  }
  ttsBusy = true
  // ONE voice — the real Chirp 3 HD academic voice, or nothing. All-or-nothing:
  // we NEVER substitute the cheaper browser voice (a "worse voice" degrades the
  // product). If Chirp can't speak a line, we stay silent for it; the reply is
  // still shown as text. The real voice always works while there's credit.
  if (chirpMode !== 'off') {
    // Use the buffered clip if we prefetched exactly this one; else fetch now.
    const key = clipKey(item.text, item.lang)
    const blob = prefetch && prefetch.key === key ? await prefetch.blob : await fetchClip(item.text, item.lang)
    prefetch = null
    // Start buffering the NEXT clip now, so its network time hides behind this
    // clip's playback (no gap between sentences on a slow mobile link). chirp is
    // still enabled here (nothing above disables it); chirpSpeak below may.
    const next = ttsQueue[0]
    if (next) {
      prefetch = { key: clipKey(next.text, next.lang), blob: fetchClip(next.text, next.lang) }
    }
    await chirpSpeak(item.text, item.lang, blob)
  }
  void drain()
}

// Strip any markdown/symbols so the voice never reads "asterisk", "hash", etc.
// (Belt-and-braces: the model is already told to speak in plain text.)
function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*•+]\s+/gm, '') // bullet lists
    .replace(/^\s*\d+\.\s+/gm, '') // numbered lists
    .replace(/[*_#`~>]/g, '') // any stray markdown chars (incl. lone asterisks)
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Split a LONG text into sentence-boundary chunks under Google TTS's request
// limit (~5000 bytes; we stay well under). A 10-minute promo script arrives as
// one string — chunking + the prefetch buffer make it play seamlessly.
const TTS_CHUNK_CHARS = 1200
function chunkForTts(text: string): string[] {
  if (text.length <= TTS_CHUNK_CHARS) return [text]
  const sentences = text.match(/[^.!?…]+[.!?…]+["']?\s*|[^.!?…]+$/g) ?? [text]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur && cur.length + s.length > TTS_CHUNK_CHARS) {
      chunks.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

/** Queue text to speak. Safe to call repeatedly while a reply streams in. */
export function enqueueSpeech(text: string, lang: string): void {
  const clean = stripForSpeech(text)
  if (!clean) return
  for (const chunk of chunkForTts(clean)) ttsQueue.push({ text: chunk, lang })
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
  curText = ''
  globalThis.speechSynthesis?.cancel()
}

// ── Landing hover-greeting ────────────────────────────────────────────────
// The public /api/greet endpoint returns a canned, time-appropriate English
// greeting as MP3 (+ the spoken text in X-Greet-Text). We play it through the
// SAME machinery the app uses for Kelion's speech — curAudio + the decoded
// energy envelope + buildWeights — so getMouthState() animates his mouth with
// zero duplicated code. Landing page ONLY (never after login).
let lastGreet = 0

function greetSlot(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 22) return 'evening'
  return 'night'
}

/**
 * Speak the time-appropriate greeting (call on avatar hover). No-ops if already
 * speaking or within the cooldown, so re-hovering doesn't stack greetings.
 * Audio may be blocked until the visitor's first interaction (browser autoplay
 * policy) — it fails silently and simply speaks on a later hover.
 */
export async function greetOnHover(): Promise<void> {
  if (isSpeaking()) return
  const now = Date.now()
  if (now - lastGreet < 12_000) return
  lastGreet = now
  try {
    const res = await fetch(`/api/greet?slot=${greetSlot()}`)
    if (!res.ok) return
    const text = res.headers.get('X-Greet-Text') ?? ''
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    // Decode a copy for the millisecond mouth envelope before playing.
    curEnv = null
    curEnvCum = null
    curEnvTotal = 0
    curEnvPeak = 0
    try {
      decodeCtx ??= new (globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      buildEnvelope(await decodeCtx.decodeAudioData(await blob.arrayBuffer()))
    } catch {
      /* envelope optional — the phoneme-weighted time mapping still drives the mouth */
    }
    const audio = new Audio(url)
    curAudio = audio
    curText = text
    buildWeights(text)
    const done = (): void => {
      URL.revokeObjectURL(url)
      if (curAudio === audio) {
        curAudio = null
        curText = ''
        curWeights = null
        curTotal = 0
        curVoiced = null
        curVoicedTotal = 0
        curEnv = null
        curEnvCum = null
        curEnvTotal = 0
        curEnvPeak = 0
      }
    }
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done) // autoplay may be blocked pre-interaction
  } catch {
    /* network hiccup — silent; greeting is a nicety, never an error */
  }
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
