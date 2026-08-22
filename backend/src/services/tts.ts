import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'
import { googleServiceAccount } from './googleCreds.js'
import { localSynthesize, localVoskAvailable } from './localVosk.js'

// TTS — GOOGLE CHIRP 3 HD, SINGURA VOCE (OpenAI scos complet, Adrian 3 aug:
// „OpenAI scos din toată aplicația").
//
// Rezerva OpenAI TTS a murit: contul OpenAI a ars $65 în 2 săptămâni, iar Chirp
// 3 HD are 1M caractere/lună gratis, cu serviciul (GOOGLE_SERVICE_ACCOUNT_JSON)
// dovedit live (sintetizează + 30 voci ro-RO-Chirp3-HD-*). Dacă Google nu e
// configurat sau pică, întoarcem eroare (nu mai cădem pe OpenAI) — Google-only.

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

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

/** True when a synthesis path EXISTS: Google Chirp 3 HD (singura sursă acum). */
export function ttsConfigured(): boolean {
  if (config.useLocalVosk) {
    return localVoskAvailable()
  }
  return googleTtsAvailable()
}

export type TtsEngine = 'google' | 'local'

export type TtsResult =
  | { ok: true; audio: Buffer; engine: TtsEngine }
  | { ok: false; status: number; error: string; detaliu?: string }

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
 * Synthesizes `text` in language `langRaw` cu Google Chirp 3 HD — SINGURA voce
 * (OpenAI scos, Adrian 3 aug). Dacă Google nu e configurat → 503; dacă apelul
 * pică → eroarea lui Chirp (nu se mai cade pe OpenAI). Typed result ca apelantul
 * să mapeze erorile pe statusul HTTP corect. MP3 by default; `{ encoding:
 * 'LINEAR16' }` → raw PCM (24kHz) pentru agentul vocal.
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

  if (config.useLocalVosk) {
    const result = await localSynthesize(spoken, lang)
    if (result.ok) {
      return { ok: true, audio: result.audio, engine: 'local' }
    } else {
      return { ok: false, status: 502, error: result.error }
    }
  }

  // GOOGLE-ONLY (Adrian, 3 aug): Chirp 3 HD e singura voce — voce masculină în
  // orice limbă, 1M caractere/lună gratis. Fără rezervă OpenAI. Dacă pică,
  // întoarcem eroarea lui Chirp (apelantul o mapează), nu mai chemăm OpenAI.
  return synthChirp(spoken, lang, opts)
}

// The POST of the Google Chirp TTS call: fetch with a 30s timeout, returns 502
// `tts_failed` on throw or non-ok response. Audio parsing (JSON base64) stays
// with the caller. Returns Response on success, otherwise an error TtsResult.
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
  } catch (e) {
    // De ce a picat CHIAR (rețea/timeout) — nu mai ascundem motivul (owner, 19 aug:
    // „Chirp 3 HD nu e funcțional — de ce?"). Fără el, cauza rămânea invizibilă.
    const motiv = String((e as Error)?.message ?? e).slice(0, 200)
    console.error(`[tts] Chirp fetch a picat: ${motiv}`)
    return { ok: false, status: 502, error: 'tts_failed', detaliu: motiv }
  }
  if (!res.ok) {
    // MOTIVUL REAL AL LUI GOOGLE (înainte se arunca): 403 = API Text-to-Speech
    // neactivat / cont de serviciu fără drept; 429 = cotă/billing; 400 = voce/limbă
    // invalidă. Acum apare în server_logs, ca să știm cauza, nu s-o ghicim.
    const corp = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    console.error(`[tts] Chirp HTTP ${res.status}: ${corp}`)
    return { ok: false, status: 502, error: `tts_http_${res.status}`, detaliu: corp }
  }
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
 * („ro-RO-Chirp3-HD-Charon") — păstrăm DOAR stilul (partea finală), fiindcă
 * limba vine din `lang`, nu din numele vocii. Orice stil FEMININ cunoscut e
 * rescris în `MALE_CHIRP_DEFAULT` (Charon), ca să nu ajungă la Google o voce
 * feminină. Un stil necunoscut (care nu e în lista feminină) trece direct,
 * fiindcă poate fi un stil masculin nou adăugat de Google, și nu trebuie să
lul; orice stil FEMININ, sau
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
  const url = GOOGLE_TTS_URL
  if (a) {
    const token = await a.getAccessToken().catch(() => null)
    if (!token) return { ok: false, status: 502, error: 'tts_auth_failed' }
    headers.Authorization = `Bearer ${token}`
  } else {
    headers['x-goog-api-key'] = config.googleTtsKey
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

