// True full-duplex listening with acoustic echo cancellation.
//
// The browser's AEC (echoCancellation) subtracts Kelion's own TTS — played
// through the speakers — from the mic input, so the user can talk OVER Kelion
// and only the user's voice is captured (no feedback "choke", no half-duplex
// muting). Energy-based VAD segments utterances; each utterance is sent to the
// backend Google Chirp STT (/api/asr) for accurate transcription + automatic
// language detection. This is the professional path (vs the browser Web Speech
// recognizer, which can't be fed an echo-cancelled stream).

import { inputConstraint } from './audio'

export interface FullDuplexHandle {
  stop(): void
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

// VAD tuning (RMS in 0..1; ms thresholds). Onset is deliberately sensitive so
// the FIRST word isn't clipped ("guard at start"); the trailing-silence window
// guards the end so a word isn't cut while you pause mid-thought.
const START_RMS = 0.035 // speech onset (sensitive — catch the first syllable)
const END_RMS = 0.025 // below this counts as silence
const SILENCE_END_MS = 750 // trailing silence that ends an utterance (guard end)
const MIN_VOICED_MS = 150 // ignore blips shorter than this
const FRAME_MS = 1000 / 60

/**
 * Start full-duplex listening. `onFinal(text, lang)` fires per recognised
 * utterance (lang is the Chirp-detected language code, may be null). Returns
 * null if the browser lacks the needed APIs (caller should fall back).
 */
export async function startFullDuplex(
  onFinal: (text: string, lang: string | null) => void,
  onError?: (error: string) => void,
): Promise<FullDuplexHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...inputConstraint(), // chosen input device (e.g. a Bluetooth mic)
      },
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
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let speaking = false
  let voicedMs = 0
  let silenceMs = 0
  let raf = 0
  let stopped = false

  const sendUtterance = async (blob: Blob): Promise<void> => {
    try {
      const audio = await blobToBase64(blob)
      const res = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ audio }),
      })
      if (!res.ok) return
      const j = (await res.json()) as { transcript?: string; lang?: string | null }
      const text = j.transcript?.trim()
      if (text) onFinal(text, j.lang ?? null)
    } catch {
      /* best-effort — never throw from the audio loop */
    }
  }

  const startUtterance = (): void => {
    chunks = []
    try {
      recorder = new MediaRecorder(stream)
    } catch {
      recorder = null
      return
    }
    const rec = recorder
    const voicedAtStop = (): number => voicedMs
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      if (voicedAtStop() >= MIN_VOICED_MS && blob.size > 1200) void sendUtterance(blob)
    }
    rec.start()
  }

  const endUtterance = (): void => {
    try {
      recorder?.stop()
    } catch {
      /* already stopped */
    }
    recorder = null
  }

  const tick = (): void => {
    if (stopped) return
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
          endUtterance()
        }
      }
    } else if (rms > START_RMS) {
      speaking = true
      voicedMs = 0
      silenceMs = 0
      startUtterance()
    }
    raf = requestAnimationFrame(tick)
  }

  void ctx.resume()
  tick()

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      try {
        recorder?.stop()
      } catch {
        /* ignore */
      }
      recorder = null
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}
