import { GoogleAuth } from 'google-auth-library'
import { normalizeLang } from './tts.js'
import { googleServiceAccount } from './googleCreds.js'
import { config } from '../config.js'
import { localTranscribe, localVoskAvailable } from './localVosk.js'
import { pcm16InWav, transcrieGemini } from './urecheGemini.js'

// Shared Google Cloud Speech-to-Text v2 (chirp_3) transcription. ONE
// implementation used by BOTH the session-gated /api/asr route (browser sends a
// WAV/encoded blob → autoDecodingConfig) AND the full-duplex voice agent, which
// captures RAW LiveKit PCM (Int16 LINEAR16) and needs an explicit decoding
// config. Speech is Google-only per spec. Region + model must match asr.ts's
// original proven values (chirp_3, region 'eu', automatic punctuation).

// THE PROVEN REGION (live matrix, 10 Jul): chirp_3 does NOT EXIST in
// us-central1 — it exists in the 'us' and 'eu' multi-regions. 'eu' = minimum
// latency for European users. (STT-ul streaming a fost scos total pe 5 aug —
// voce unificată; rămâne DOAR dictarea batch de aici.)
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

// ── GOOGLE-ONLY (OpenAI scos complet, Adrian 3 aug: „OpenAI scos din toată
// aplicația") ────────────────────────────────────────────────────────────────
// Rezerva OpenAI de STT a fost scoasă. În locul ei (Adrian, 3 aug seara:
// „auzul trebuie să fie pe Gemini", după căderea Chirp cu PERMISSION_DENIED):
// când Chirp refuză sau nu e configurat, auzul cade pe URECHEA GEMINI
// (services/urecheGemini.ts — cheia GEMINI_API_KEY, fără cont de serviciu).

/** Rezerva Gemini a căii batch: PCM se îmbracă în WAV, blobul de browser merge
 *  cu mime-ul lui real. Eroarea Gemini se raportează NUMITĂ, nu mascată. */
async function transcribeFallbackGemini(audio: string, opts: TranscribeOpts): Promise<TranscribeResult> {
  const wav = opts.pcm
    ? pcm16InWav(Buffer.from(audio, 'base64'), opts.pcm.sampleRateHertz, opts.pcm.channels ?? 1)
    : null
  const r = await transcrieGemini(
    wav ? wav.toString('base64') : audio,
    wav ? 'audio/wav' : (opts.mime ?? 'audio/webm'),
    opts.langHint,
  )
  if (!r.ok) return { ok: false, status: 502, error: `asr_failed (gemini: ${r.error})` }
  return { ok: true, lang: opts.langHint ?? null, transcript: r.transcript }
}

/**
 * Transcribe base64 audio: întâi Google STT v2 chirp_3; dacă lipsește contul
 * de serviciu sau Google refuză → urechea Gemini (fără IAM). Typed result;
 * no auth-gate/cost here (they stay with the caller).
 */
export async function transcribe(audioBase64: string, opts: TranscribeOpts = {}): Promise<TranscribeResult> {
  const audio = audioBase64.trim()
  if (!audio) return { ok: false, status: 400, error: 'bad_request' }

  if (config.useLocalVosk) {
    if (!localVoskAvailable()) {
      return { ok: false, status: 503, error: 'asr_not_configured' }
    }
    const result = await localTranscribe(audio, opts.langHint ?? 'auto')
    if (result.ok) {
      return { ok: true, lang: result.lang, transcript: result.transcript }
    } else {
      return { ok: false, status: 502, error: result.error }
    }
  }

  const a = getAuth()
  if (!a || !projectId) return transcribeFallbackGemini(audio, opts)

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
      // Google a refuzat (ex: rol IAM pierdut) → urechea Gemini preia — dar
      // CAUZA se scrie în jurnal ÎNTÂI (registrul backend #6): înainte, refuzul
      // Chirp cădea MUT pe rezervă și nimeni n-ar fi văzut zile întregi că
      // urechea principală e moartă (exact clasa PERMISSION_DENIED din 3 aug).
      const corp = (await res.text().catch(() => '')).slice(0, 200)
      console.error(`[ASR CHIRP CĂZUT] HTTP ${res.status} de la Speech v2 (${corp || 'corp gol'}) — trec pe urechea Gemini`)
      return transcribeFallbackGemini(audio, opts)
    }
    const j = (await res.json()) as {
      results?: { languageCode?: string; alternatives?: { transcript?: string }[] }[]
    }
    const r0 = j.results?.find((r) => r.alternatives?.[0]?.transcript)
    return { ok: true, lang: r0?.languageCode ?? null, transcript: r0?.alternatives?.[0]?.transcript ?? '' }
  } catch (e) {
    // Aceeași regulă ca la refuzul HTTP: rezerva preia, dar cauza se vede.
    console.error(`[ASR CHIRP CĂZUT] ${String(e).slice(0, 200)} — trec pe urechea Gemini`)
    return transcribeFallbackGemini(audio, opts)
  }
}
