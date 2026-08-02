import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { normalizeLang } from './tts.js'
import { googleServiceAccount } from './googleCreds.js'

// Shared Google Cloud Speech-to-Text v2 (chirp_3) transcription. ONE
// implementation used by BOTH the session-gated /api/asr route (browser sends a
// WAV/encoded blob → autoDecodingConfig) AND the full-duplex voice agent, which
// captures RAW LiveKit PCM (Int16 LINEAR16) and needs an explicit decoding
// config. Speech is Google-only per spec. Region + model must match asr.ts's
// original proven values (chirp_3, region 'eu', automatic punctuation).

// THE PROVEN REGION (live matrix, 10 Jul): chirp_3 does NOT EXIST in
// us-central1 — it exists in the 'us' and 'eu' multi-regions. 'eu' = minimum
// latency for European users. SINGLE source: asr-stream.ts (the streaming
// twin) imports these instead of keeping its own copy.
export const GOOGLE_STT_REGION = 'eu'
// The most advanced model Adrian asked for: chirp_3 EVERYWHERE (batch,
// streaming, full-duplex voice).
export const GOOGLE_STT_MODEL = 'chirp_3'

let auth: GoogleAuth | null = null
let projectId = ''
function getAuth(): GoogleAuth | null {
  if (!auth) {
    const creds = googleServiceAccount()
    if (!creds) return null
    projectId = creds.project_id ?? ''
    auth = new GoogleAuth({
      credentials: creds as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

export type TranscribeResult =
  | { ok: true; lang: string | null; transcript: string }
  | { ok: false; status: number; error: string }

export interface TranscribeOpts {
  // The user's established chat language (a bare 'll' or 'll-RR' tag). When
  // present the recogniser is PINNED to it; short utterances on 'auto' kept
  // mis-guessing (Romanian transcribed as Polish/Turkish).
  langHint?: string
  // RAW PCM path (voice agent): the audio is bare LINEAR16 samples, not an
  // encoded container, so Google needs to be told the format explicitly. When
  // omitted we use autoDecodingConfig (browser WAV/encoded blob).
  pcm?: { sampleRateHertz: number; channels?: number }
  // The real container of the browser's MediaRecorder (e.g. 'audio/mp4' on
  // Safari) — on the OpenAI path it chooses the extension of the file sent
  // to transcription.
  mime?: string
}

// ── OpenAI BACKUP (the same key as the voice) ───────────────────────────────
// HEARING MUST NOT DIE (Adrian, 24 Jul: "he can't hear me"): if Realtime
// fails on the client, the batch STT path was the only net — but it required
// Google STT, which is not configured on the VPS → Kelion stayed deaf. Now:
// Google first (if a service account exists), otherwise OpenAI
// /v1/audio/transcriptions on the existing key.

// Raw PCM → minimal WAV (44-byte header), so OpenAI can decode it.
function pcmToWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32)
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, Buffer.from(pcm)])
}

async function transcribeOpenAI(audioBase64: string, opts: TranscribeOpts): Promise<TranscribeResult> {
  if (!config.openai.key) return { ok: false, status: 503, error: 'asr_not_configured' }
  let buf: Uint8Array = Buffer.from(audioBase64, 'base64')
  // OpenAI decodes by the file name's EXTENSION — we choose it from the
  // browser's real mimetype (Safari sends audio/mp4, not webm), otherwise
  // transcription failed exactly on Apple devices.
  const mime = (opts.mime ?? '').toLowerCase()
  let filename = 'audio.webm' // default: the Chrome/Firefox blob
  if (mime.includes('audio/mp4')) filename = 'audio.mp4'
  else if (mime.includes('audio/ogg')) filename = 'audio.ogg'
  else if (mime.includes('audio/wav')) filename = 'audio.wav'
  if (opts.pcm) {
    buf = pcmToWav(buf, opts.pcm.sampleRateHertz, opts.pcm.channels ?? 1)
    filename = 'audio.wav'
  }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), filename)
  form.append('model', config.openai.transcribeModel)
  const lang2 = (opts.langHint ?? '').trim().slice(0, 2).toLowerCase()
  if (/^[a-z]{2}$/.test(lang2)) form.append('language', lang2)
  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.key}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return { ok: false, status: 502, error: `asr_failed:${res.status}` }
    const j = (await res.json()) as { text?: string }
    return { ok: true, lang: lang2 || null, transcript: (j.text ?? '').trim() }
  } catch {
    return { ok: false, status: 502, error: 'asr_failed' }
  }
}

/**
 * Transcribe base64 audio. Google STT v2 chirp_3 when a service account
 * exists (the original, proven path); otherwise — or if Google fails —
 * OpenAI on the same key as the voice. Typed result; no auth-gate/cost here
 * (they stay with the caller).
 */
export async function transcribe(audioBase64: string, opts: TranscribeOpts = {}): Promise<TranscribeResult> {
  const audio = audioBase64.trim()
  if (!audio) return { ok: false, status: 400, error: 'bad_request' }
  const a = getAuth()
  if (!a || !projectId) return transcribeOpenAI(audio, opts)

  const rawLang = (opts.langHint ?? '').trim()
  const langHint = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(rawLang) ? normalizeLang(rawLang) : ''

  const decodingConfig = opts.pcm
    ? {
        explicitDecodingConfig: {
          encoding: 'LINEAR16',
          sampleRateHertz: opts.pcm.sampleRateHertz,
          audioChannelCount: opts.pcm.channels ?? 1,
        },
      }
    : { autoDecodingConfig: {} }

  try {
    const token = await a.getAccessToken()
    if (!token) return { ok: false, status: 502, error: 'asr_auth_failed' }
    const url = `https://${GOOGLE_STT_REGION}-speech.googleapis.com/v2/projects/${projectId}/locations/${GOOGLE_STT_REGION}/recognizers/_:recognize`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          // chirp_3 EVERYWHERE (Adrian, 10 Jul). Streaming is already
          // chirp_3; the batch path and the full-duplex voice use the same
          // model — the single constant above.
          model: GOOGLE_STT_MODEL,
          languageCodes: langHint ? [langHint] : ['auto'],
          ...decodingConfig,
          features: { enableAutomaticPunctuation: true },
        },
        content: audio,
      }),
    })
    if (!res.ok) {
      // Google refused — we don't stay deaf: we try OpenAI on the same key.
      return transcribeOpenAI(audio, opts)
    }
    const j = (await res.json()) as {
      results?: { languageCode?: string; alternatives?: { transcript?: string }[] }[]
    }
    const r0 = j.results?.find((r) => r.alternatives?.[0]?.transcript)
    return { ok: true, lang: r0?.languageCode ?? null, transcript: r0?.alternatives?.[0]?.transcript ?? '' }
  } catch {
    return transcribeOpenAI(audio, opts)
  }
}
