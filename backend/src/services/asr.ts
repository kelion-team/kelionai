import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { normalizeLang } from './tts.js'

// Shared Google Cloud Speech-to-Text v2 (chirp_3) transcription. ONE
// implementation used by BOTH the session-gated /api/asr route (browser sends a
// WAV/encoded blob → autoDecodingConfig) AND the full-duplex voice agent, which
// captures RAW LiveKit PCM (Int16 LINEAR16) and needs an explicit decoding
// config. Speech is Google-only per spec. Region + model must match asr.ts's
// original proven values (chirp_3, region 'eu', automatic punctuation).

// REGIUNEA DOVEDITĂ (matrice live, 10 iul): chirp_3 NU EXISTĂ în us-central1 —
// există în multi-regiunile 'us' și 'eu'. 'eu' = latență minimă pentru
// utilizatorii europeni. Aceeași regiune și la streaming (asr-stream.ts).
const REGION = 'eu'

let auth: GoogleAuth | null = null
let projectId = ''
function getAuth(): GoogleAuth | null {
  if (!config.googleServiceAccountJson) return null
  if (!auth) {
    const creds = JSON.parse(config.googleServiceAccountJson) as { project_id?: string }
    projectId = creds.project_id ?? ''
    auth = new GoogleAuth({
      credentials: creds as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

/** True when the Google service-account credential (with a project id) is set. */
export function asrConfigured(): boolean {
  return getAuth() !== null && !!projectId
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
}

/**
 * Transcribe base64 audio via Google STT v2 chirp_3. Returns a typed result so
 * callers map failures to the right HTTP status. No auth gate, no cost
 * accounting here — that stays in the caller (route vs. voice agent path).
 */
export async function transcribe(audioBase64: string, opts: TranscribeOpts = {}): Promise<TranscribeResult> {
  const a = getAuth()
  if (!a || !projectId) return { ok: false, status: 503, error: 'asr_not_configured' }
  const audio = audioBase64.trim()
  if (!audio) return { ok: false, status: 400, error: 'bad_request' }

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
    const url = `https://${REGION}-speech.googleapis.com/v2/projects/${projectId}/locations/${REGION}/recognizers/_:recognize`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          // chirp_3 PESTE TOT (Adrian, 10 iul). Streamingul e deja chirp_3;
          // calea batch și vocea full-duplex folosesc același model.
          model: 'chirp_3',
          languageCodes: langHint ? [langHint] : ['auto'],
          ...decodingConfig,
          features: { enableAutomaticPunctuation: true },
        },
        content: audio,
      }),
    })
    if (!res.ok) {
      return { ok: false, status: 502, error: `asr_failed:${res.status}` }
    }
    const j = (await res.json()) as {
      results?: { languageCode?: string; alternatives?: { transcript?: string }[] }[]
    }
    const r0 = j.results?.find((r) => r.alternatives?.[0]?.transcript)
    return { ok: true, lang: r0?.languageCode ?? null, transcript: r0?.alternatives?.[0]?.transcript ?? '' }
  } catch {
    return { ok: false, status: 502, error: 'asr_failed' }
  }
}
