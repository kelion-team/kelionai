import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'
import { googleServiceAccount } from './googleCreds.js'

// TTS — GOOGLE CHIRP 3 HD IS THE PRIMARY VOICE, OPENAI STRICTLY THE RESERVE.
//
// Adrian, Aug 2: "openai ramine rezerva doar daca google pica" + "voce
// masculina in orice limba". The old order (OpenAI first, to sound IDENTICAL
// to the OpenAI Realtime live voice) died when the live mouth itself moved
// to Google — the unification reason is gone. And OpenAI TTS burned $65 in 2
// weeks of voice, while Chirp 3 HD has a 1M characters/month free tier and
// the service account (GOOGLE_SERVICE_ACCOUNT_JSON on the server) is PROVEN
// live: it synthesizes fine and there are 30 ro-RO-Chirp3-HD-* voices.
// So: 1) Google Chirp 3 HD first; 2) OpenAI TTS only when Google is not
// configured OR the call failed — he is never left mute.

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
  if (!auth) {
    const creds = googleServiceAccount()
    if (!creds) return null
    auth = new GoogleAuth({
      credentials: creds as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

/** Google Chirp 3 HD is available (service account OR API key).
 *  Exported for GET /api/tts/status — booleans only, never the keys. */
export function googleTtsAvailable(): boolean {
  return getAuth() !== null || !!config.googleTtsKey
}

/** True when a synthesis path EXISTS: Google Chirp 3 HD or OpenAI as backup. */
export function ttsConfigured(): boolean {
  return googleTtsAvailable() || !!config.openai.key
}

export type TtsEngine = 'google' | 'openai'

export type TtsResult =
  | { ok: true; audio: Buffer; engine: TtsEngine }
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
 * Synthesizes `text` in language `langRaw`. Tries Chirp 3 HD (Google) FIRST —
 * the primary voice; if not configured or it fails, falls back to the OpenAI
 * reserve. Typed result so the caller can map errors to the right HTTP status.
 * MP3 by default; `{ encoding: 'LINEAR16' }` → raw PCM (24kHz) for the voice
 * agent.
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

  // GOOGLE FIRST, OPENAI STRICTLY THE RESERVE (Adrian, Aug 2: "openai ramine
  // rezerva doar daca google pica"). The old reason for OpenAI-first — sound
  // identical to the OpenAI Realtime live mouth — is gone: the live mouth is
  // Google now. OpenAI TTS burned $65 in 2 weeks; Chirp 3 HD has 1M free
  // characters/month.
  // 1) Google Chirp 3 HD — the app voice (male, in any language).
  if (googleTtsAvailable()) {
    const r = await synthChirp(spoken, lang, opts)
    if (r.ok) return r
    // Google failed → we don't stay mute, fall to the OpenAI reserve below.
  }

  // 2) Reserve: OpenAI TTS (only when Google is unconfigured or failed).
  if (config.openai.key) return synthOpenAI(spoken, opts)

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
// MALE VOICE IN EVERY LANGUAGE (Adrian, Aug 2: "voce masculina in orice
// limba"). The known FEMALE Chirp3-HD styles. A female style — from env, from
// a full voice name, from anywhere — must NEVER reach the Google API: the
// order is male everywhere, so any female style is rewritten to Charon.
const FEMININE_CHIRP_STYLES = new Set([
  'Aoede', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux', 'Kore', 'Laomedeia',
  'Leda', 'Pulcherrima', 'Sulafat', 'Vindemiatrix', 'Zephyr', 'Achernar',
  'Autonoe',
])
export const MALE_CHIRP_DEFAULT = 'Charon' // warm male voice, valid in every Chirp3-HD locale

/**
 * VOCE MASCULINĂ PESTE TOT (Adrian, 2 aug: „voce masculină în orice limbă").
 * Din stilul configurat — un stil simplu („Charon") SAU un nume complet
 * („ro-RO-Chirp3-HD-Charon") — păstrăm DOAR stilul; orice stil FEMININ, sau
 * necunoscut, sau gol → devine Charon (masculin). Pură și EXPORTATĂ dinadins ca
 * regula să fie bătută în cuie cu test (lacat.test.ts): dacă cineva o schimbă,
 * testul din CI cade și schimbarea nu se poate face merge. Nu se mai distruge.
 */
export function resolveChirpStyle(configured: string | null | undefined): string {
  const c = (configured ?? '').trim()
  const style = /Chirp3-HD/i.test(c) ? (c.split('-').pop() ?? '') : c
  return /^[A-Z][a-z]+$/.test(style) && !FEMININE_CHIRP_STYLES.has(style)
    ? style
    : MALE_CHIRP_DEFAULT
}

async function synthChirp(spoken: string, lang: string, opts: SynthOpts): Promise<TtsResult> {
  // We always force Chirp 3 HD. The env style can be a full voice name
  // (e.g. "ro-RO-Chirp3-HD-Charon") or just the style (e.g. "Charon"); either
  // way we keep ONLY the style and rebuild the name with the language being
  // spoken, so the voice matches the text. Anything unknown — and ANY female
  // style — falls back to Charon (male, see resolveChirpStyle above).
  const safeStyle = resolveChirpStyle(config.ttsVoiceStyle)
  const voiceName = `${lang}-Chirp3-HD-${safeStyle}`

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
  return { ok: true, audio: Buffer.from(j.audioContent, 'base64'), engine: 'google' }
}

// ── Reserve: OpenAI TTS ──────────────────────────────────────────────────────
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
  return { ok: true, audio, engine: 'openai' }
}
