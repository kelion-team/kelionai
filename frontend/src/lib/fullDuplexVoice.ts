// True full-duplex listening with acoustic echo cancellation + loss-proof capture.
//
// The mic stream is opened once (at app start) and stays open. A ScriptProcessor
// captures raw PCM CONTINUOUSLY into a ring buffer, so when speech is detected
// the utterance includes a ~400ms PRE-ROLL taken from just before onset — the
// first syllables are never clipped (the old code started a MediaRecorder only
// on onset and lost the beginning). Energy VAD segments utterances; a generous
// trailing-silence window lets the user pause mid-thought without being cut off.
//
// Loss-proof: each finished utterance is queued and POSTed to /api/asr. If the
// network is down (GSM lost — tunnel, poor signal), utterances stay in a queue
// that holds up to ~10 minutes of speech and is flushed automatically the moment
// connectivity returns. Nothing the user said is lost.

export interface FullDuplexHandle {
  stop(): void
  // Pause/resume capture. While muted the mic records NOTHING and drops any
  // utterance in progress — so Kelion's own voice (or noise) during his turn can
  // never be transcribed into a second, parallel turn.
  setMuted(muted: boolean): void
}

// Status for the UI: 'online' — everything sent; 'buffering' — signal lost, we
// are holding the user's speech locally; 'flushing' — reconnected, sending the
// held speech now.
export type VoiceStatus = 'online' | 'buffering' | 'flushing'

// VAD tuning (RMS in 0..1; ms thresholds).
const START_RMS = 0.05 // speech onset — above ambient noise/echo
const END_RMS = 0.035 // below this counts as silence
const SILENCE_END_MS = 1200 // trailing silence that ends an utterance (was 800 —
// raised so a natural mid-sentence pause doesn't split the request in two)
const MIN_VOICED_MS = 350 // ignore blips/noise shorter than this
// NEAR-VOICE DOMINANCE: only trigger on the loud, close voice (the owner speaking
// into the mic), not on background chatter. We track the ambient floor (which
// rises to include other people's distant voices) and require the onset to
// clearly dominate it. This ignores other voices without an ML model.
const DOMINANCE = 2.6 // onset must be ≥ this × the ambient floor
const FRAME_MS = 1000 / 60
const PREROLL_MS = 400 // audio kept from BEFORE onset so the start isn't clipped
const OUT_RATE = 16000 // downsample target (Chirp STT is happy at 16 kHz; small)
const RING_SECONDS = 35 // max single-utterance length held in the ring buffer
const MAX_QUEUE_MS = 10 * 60 * 1000 // hold up to 10 min of speech while offline

function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === OUT_RATE) return input
  const ratio = inRate / OUT_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = idx - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

// Float32 mono → 16-bit PCM WAV (base64). autoDecodingConfig on the backend
// accepts WAV, so no server change is needed.
function encodeWavBase64(samples: Float32Array): string {
  const n = samples.length
  const buf = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buf)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, OUT_RATE, true)
  view.setUint32(28, OUT_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, n * 2, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    o += 2
  }
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

/**
 * Start full-duplex listening. `onFinal(text, lang)` fires per recognised
 * utterance. `onStatus` (optional) reports online/buffering/flushing so the UI
 * can show a "Recording" indicator while the signal is down. Returns null if the
 * browser lacks the needed APIs (caller should fall back).
 */
export async function startFullDuplex(
  onFinal: (text: string, lang: string | null) => void,
  onError?: (error: string) => void,
  onStatus?: (status: VoiceStatus) => void,
  // The user's established language — sent with every clip so recognition is
  // ANCHORED (auto-detect on short utterances mis-guessed Polish/Turkish).
  getLang?: () => string,
): Promise<FullDuplexHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    onError?.('not-allowed')
    return null
  }

  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    return null
  }
  const ctx = new AC()
  const sr = ctx.sampleRate
  const source = ctx.createMediaStreamSource(stream)

  // VAD path.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))

  // Continuous PCM capture into a ring buffer (for pre-roll + full utterance).
  const ring = new Float32Array(sr * RING_SECONDS)
  let writePos = 0 // total samples written (monotonic)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (e) => {
    const inp = e.inputBuffer.getChannelData(0)
    for (let i = 0; i < inp.length; i++) {
      ring[writePos % ring.length] = inp[i]
      writePos++
    }
  }
  // A ScriptProcessor only runs while connected to a destination; route it
  // through a silent gain so it processes without echoing the mic to speakers.
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(proc)
  proc.connect(sink)
  sink.connect(ctx.destination)

  // ── loss-proof send queue ────────────────────────────────────────────────
  const queue: { wav: string; ms: number }[] = []
  let queuedMs = 0
  let sending = false
  let stopped = false

  const emit = (): void => {
    onStatus?.(queue.length > 0 ? (navigator.onLine ? 'flushing' : 'buffering') : 'online')
  }

  const flush = async (): Promise<void> => {
    if (sending || stopped) return
    sending = true
    emit()
    while (queue.length > 0 && navigator.onLine && !stopped) {
      const item = queue[0]
      try {
        const res = await fetch('/api/asr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ audio: item.wav, lang: getLang?.() || undefined }),
        })
        if (!res.ok) break // server hiccup — keep it, retry later
        queue.shift()
        queuedMs -= item.ms
        const j = (await res.json()) as { transcript?: string; lang?: string | null }
        const text = j.transcript?.trim()
        if (text) onFinal(text, j.lang ?? null)
      } catch {
        break // network down — hold the queue, flush on reconnect
      }
    }
    sending = false
    emit()
  }

  const enqueue = (wav: string, ms: number): void => {
    queue.push({ wav, ms })
    queuedMs += ms
    // Cap the hold at ~10 minutes — drop the OLDEST if we somehow overflow.
    while (queuedMs > MAX_QUEUE_MS && queue.length > 1) {
      const dropped = queue.shift()
      if (dropped) queuedMs -= dropped.ms
    }
    void flush()
  }

  const onOnline = (): void => void flush()
  window.addEventListener('online', onOnline)
  const retry = window.setInterval(() => {
    if (queue.length > 0) void flush()
  }, 5000)

  // ── VAD segmentation over the ring buffer ────────────────────────────────
  let speaking = false
  let voicedMs = 0
  let silenceMs = 0
  let raf = 0
  let muted = false
  let uttStart = 0 // ring sample index where the current utterance began
  const preroll = Math.floor(sr * (PREROLL_MS / 1000))
  // Ambient floor — the background level (room noise + OTHER people's voices).
  // It adapts during silence; the owner's near voice must clearly rise above it.
  let noiseFloor = 0.02

  const finishUtterance = (): void => {
    const end = writePos
    let start = uttStart
    // Never read further back than what's still in the ring.
    const oldest = Math.max(0, end - ring.length + 1)
    if (start < oldest) start = oldest
    const len = end - start
    if (voicedMs < MIN_VOICED_MS || len < sr * 0.2) return
    const slice = new Float32Array(len)
    for (let i = 0; i < len; i++) slice[i] = ring[(start + i) % ring.length]
    const ms = (len / sr) * 1000
    enqueue(encodeWavBase64(resampleTo16k(slice, sr)), ms)
  }

  const tick = (): void => {
    if (stopped) return
    if (muted) {
      if (speaking) {
        speaking = false // Kelion's turn — abandon anything in progress, unsent
      }
      raf = requestAnimationFrame(tick)
      return
    }
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / data.length)
    if (speaking) {
      if (rms > END_RMS) {
        voicedMs += FRAME_MS
        silenceMs = 0
      } else {
        silenceMs += FRAME_MS
        if (silenceMs >= SILENCE_END_MS) {
          speaking = false
          finishUtterance()
        }
      }
    } else {
      // Not speaking → let the ambient floor track the background (other voices,
      // room noise). Clamped so it can't drift so high the owner is ignored.
      noiseFloor = Math.min(0.09, noiseFloor * 0.96 + rms * 0.04)
      // Start ONLY when the near voice clearly dominates the ambient floor —
      // this is what makes it ignore other, quieter/distant voices.
      if (rms > START_RMS && rms > noiseFloor * DOMINANCE) {
        speaking = true
        voicedMs = 0
        silenceMs = 0
        uttStart = Math.max(0, writePos - preroll) // include the pre-roll
      }
    }
    raf = requestAnimationFrame(tick)
  }

  void ctx.resume()
  tick()

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      window.removeEventListener('online', onOnline)
      window.clearInterval(retry)
      try {
        proc.disconnect()
        sink.disconnect()
        source.disconnect()
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
    setMuted(m: boolean) {
      muted = m
    },
  }
}
