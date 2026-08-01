import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'

// TTS — ONE SINGLE MALE VOICE ACROSS THE WHOLE APP.
//
// Adrian (24 Jul): "there are 2 voices, chat and brain — unify them". The
// full-duplex live voice is OpenAI Realtime, intrinsically tied to OpenAI
// voices (`ash`) and unable to render Chirp. To sound IDENTICAL everywhere
// (typed chat, landing greeting, /api/tts), synthesis uses the SAME OpenAI
// `ash` voice as the live voice.
// Google Chirp 3 HD remains ONLY a safety net — used only when OpenAI is
// unavailable (no key / failed call), so he is never left mute.

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const OPENAI_SPEECH = 'https://api.openai.com/v1/audio/speech'

const DEFAULT_REGION: Record<string, string> = {
  en: 'US', ro: 'RO', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL',
  pl: 'PL', ru: 'RU', uk: 'UA', tr: 'TR', ar: 'XA', hi: 'IN', ja: 'JP', ko: 'KR',
  zh: 'CN', sv: 'SE', da: 'DK', nb: 'NO', fi: 'FI', cs: 'CZ', el: 'GR', hu: 'HU',
  id: 'ID', th: 'TH', vi: 'VN',
}

export function normalizeLang(raw: string | undefined): string {
  const s = (raw ?? '').trim()
  const m = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec(s)
  if (!m) return 'en-US'
  const lng = m[1].toLowerCase()
  const region = m[2]?.toUpperCase() ?? DEFAULT_REGION[lng] ?? lng.toUpperCase()
  return `${lng}-${region}`
}

let auth: GoogleAuth | null = null
function getAuth(): GoogleAuth | null {
  if (!config.googleServiceAccountJson) return null
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(config.googleServiceAccountJson) as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

/** Google Chirp 3 HD is available (service account OR API key). */
function googleTtsAvailable(): boolean {
  return getAuth() !== null || !!config.googleTtsKey
}

/** True when a synthesis path EXISTS: Google Chirp 3 HD or OpenAI as backup. */
export function ttsConfigured(): boolean {
  return googleTtsAvailable() || !!config.openai.key
}

export type TtsResult =
  | { ok: true; audio: Buffer }
  | { ok: false; status: number; error: string }

export interface SynthOpts {
  // MP3 for the browser <audio> tag (default); LINEAR16 = raw 24kHz PCM.
  encoding?: 'MP3' | 'LINEAR16'
  sampleRateHertz?: number
  /** The voice chosen by this user. Unknown or missing → the app voice.
   *  Same rule as the live voice (`resolveVoice` in services/realtime.ts):
   *  a free-form name must never reach the API, because a 400 here means
   *  "Kelion went mute" for the person who merely changed a setting. */
  voice?: string | null
}

/**
 * Synthesizes `text` in language `langRaw`. Tries Chirp 3 HD (Google) first;
 * if not configured or it fails, falls back to OpenAI. Typed result so the
 * caller can map errors to the right HTTP status. MP3 by default;
 * `{ encoding: 'LINEAR16' }` → raw PCM (24kHz) for the voice agent.
 */
export async function synthesize(
  text: string,
  langRaw: string | undefined,
  opts: SynthOpts = {},
): Promise<TtsResult> {
  if (!ttsConfigured()) return { ok: false, status: 503, error: 'tts_not_configured' }
  const clean = text.trim()
  if (!clean) return { ok: false, status: 400, error: 'bad_request' }

  const lang = normalizeLang(langRaw)
  // ACADEMIC MODE: we respell technical acronyms letter-by-letter in the
  // target language so they are pronounced correctly. Pure text layer.
  const spoken = academicPronounce(clean, lang.split('-')[0])

  // ONE SINGLE MALE VOICE ACROSS THE WHOLE APP (Adrian: "there are 2 voices,
  // chat and brain — unify them"). The full-duplex live voice comes from OpenAI
  // Realtime, which is INTRINSICALLY tied to OpenAI voices (`ash`) and CANNOT
  // render Chirp. To sound IDENTICAL everywhere, typed chat uses the SAME
  // OpenAI voice as the live voice.
  // 1) OpenAI TTS with the `ash` voice (= the Realtime voice) — the one voice.
  if (config.openai.key) {
    const r = await synthOpenAI(spoken, opts)
    if (r.ok) return r
    // OpenAI failed (e.g. out of credit) → we don't stay mute, fall to Google below.
  }

  // 2) Safety net: Google Chirp 3 HD (only when OpenAI is unavailable).
  if (googleTtsAvailable()) return synthChirp(spoken, lang, opts)

  return { ok: false, status: 502, error: 'tts_failed' }
}

// The shared POST of both TTS engines (Google Chirp + OpenAI): fetch with a
// 30s timeout, returns 502 `tts_failed` on throw or non-ok response. Audio
// parsing differs (JSON base64 at Google, arrayBuffer at OpenAI) and stays with
// the caller. Returns Response on success, otherwise an error TtsResult.
// Single source (no duplicates).
async function ttsPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response | TtsResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, status: 502, error: 'tts_failed' }
  }
  if (!res.ok) return { ok: false, status: 502, error: 'tts_failed' }
  return res
}

// ── Chirp 3 HD (Google) ──────────────────────────────────────────────────────
async function synthChirp(spoken: string, lang: string, opts: SynthOpts): Promise<TtsResult> {
  // We always force Chirp 3 HD: the env style can be a full voice name
  // (e.g. "ro-RO-Chirp3-HD-Charon") or just the style (e.g. "Charon").
  // Anything else falls back to Charon — a warm male voice.
  const configured = config.ttsVoiceStyle.trim()
  const voiceName = /Chirp3-HD/i.test(configured)
    ? configured
    : /^[A-Z][a-z]+$/.test(configured)
      ? `${lang}-Chirp3-HD-${configured}`
      : `${lang}-Chirp3-HD-Charon`

  const a = getAuth()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let url = GOOGLE_TTS_URL
  if (a) {
    const token = await a.getAccessToken().catch(() => null)
    if (!token) return { ok: false, status: 502, error: 'tts_auth_failed' }
    headers.Authorization = `Bearer ${token}`
  } else {
    url = `${GOOGLE_TTS_URL}?key=${config.googleTtsKey}`
  }

  const encoding = opts.encoding ?? 'MP3'
  const audioConfig: Record<string, unknown> = { audioEncoding: encoding }
  if (encoding === 'LINEAR16') audioConfig.sampleRateHertz = opts.sampleRateHertz ?? 24000

  const r = await ttsPost(url, headers, {
    input: { text: spoken },
    voice: { languageCode: lang, name: voiceName },
    audioConfig,
  })
  if (!(r instanceof Response)) return r
  const j = (await r.json().catch(() => ({}))) as { audioContent?: string }
  if (!j.audioContent) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio: Buffer.from(j.audioContent, 'base64') }
}

// ── Backup: OpenAI TTS ───────────────────────────────────────────────────────
async function synthOpenAI(spoken: string, opts: SynthOpts): Promise<TtsResult> {
  // OpenAI TTS: `pcm` = LINEAR16 24kHz mono; otherwise `mp3`. Single male voice.
  const format = opts.encoding === 'LINEAR16' ? 'pcm' : 'mp3'
  const r = await ttsPost(
    OPENAI_SPEECH,
    { Authorization: `Bearer ${config.openai.key}`, 'Content-Type': 'application/json' },
    {
      model: config.openai.ttsModel,
      voice: opts.voice && config.openai.realtimeVoices.includes(opts.voice) ? opts.voice : config.openai.ttsVoice,
      input: spoken,
      response_format: format,
    },
  )
  if (!(r instanceof Response)) return r
  const audio = Buffer.from(await r.arrayBuffer())
  if (audio.length === 0) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio }
}
