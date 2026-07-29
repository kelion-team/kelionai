import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'

// TTS — O SINGURĂ VOCE MASCULINĂ ÎN TOATĂ APLICAȚIA.
//
// Adrian (24 iul): „sunt 2 voci, chat și creier — unifică". Vocea live
// full-duplex e OpenAI Realtime, legată intrinsec de vocile OpenAI (`ash`) și
// care NU poate reda Chirp. Ca să sune IDENTIC peste tot (chat scris, salut
// landing, /api/tts), sinteza folosește ACEEAȘI voce OpenAI `ash` ca vocea live.
// Google Chirp 3 HD rămâne DOAR plasă de siguranță — se folosește doar când
// OpenAI nu e disponibil (fără cheie / apel picat), ca să nu rămână niciodată mut.

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

/** Google Chirp 3 HD e disponibil (service account SAU cheie API). */
function googleTtsAvailable(): boolean {
  return getAuth() !== null || !!config.googleTtsKey
}

/** True când EXISTĂ o cale de sinteză: Google Chirp 3 HD sau OpenAI ca rezervă. */
export function ttsConfigured(): boolean {
  return googleTtsAvailable() || !!config.openai.key
}

export type TtsResult =
  | { ok: true; audio: Buffer }
  | { ok: false; status: number; error: string }

export interface SynthOpts {
  // MP3 pentru <audio> din browser (implicit); LINEAR16 = PCM brut 24kHz.
  encoding?: 'MP3' | 'LINEAR16'
  sampleRateHertz?: number
}

/**
 * Sintetizează `text` în limba `langRaw`. Încearcă întâi Chirp 3 HD (Google);
 * dacă nu e configurat sau pică, cade pe OpenAI. Rezultat tipat ca apelantul să
 * mapeze erorile pe statusul HTTP corect. Implicit MP3; `{ encoding: 'LINEAR16' }`
 * → PCM brut (24kHz) pentru agentul de voce.
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
  // MOD ACADEMIC: respellăm acronimele tehnice literă-cu-literă în limba țintă
  // ca să fie rostite corect (API → „a pe i"). Strat pur pe text.
  const spoken = academicPronounce(clean, lang.split('-')[0])

  // O SINGURĂ VOCE MASCULINĂ ÎN TOATĂ APLICAȚIA (Adrian: „sunt 2 voci, chat și
  // creier — unifică"). Vocea live full-duplex vine din OpenAI Realtime, care e
  // legat INTRINSEC de vocile OpenAI (`ash`) și NU poate reda Chirp. Ca să sune
  // IDENTIC peste tot, chatul scris folosește ACEEAȘI voce OpenAI ca vocea live.
  // 1) OpenAI TTS cu vocea `ash` (= vocea Realtime) — vocea unică.
  if (config.openai.key) {
    const r = await synthOpenAI(spoken, opts)
    if (r.ok) return r
    // OpenAI a picat (ex. fără credit) → nu rămânem muți, cădem pe Google mai jos.
  }

  // 2) Plasă de siguranță: Google Chirp 3 HD (doar când OpenAI nu e disponibil).
  if (googleTtsAvailable()) return synthChirp(spoken, lang, opts)

  return { ok: false, status: 502, error: 'tts_failed' }
}

// POST-ul comun al ambelor motoare TTS (Google Chirp + OpenAI): fetch cu timeout
// 30s, întoarce 502 `tts_failed` la throw sau răspuns ne-ok. Parsarea audio diferă
// (JSON base64 la Google, arrayBuffer la OpenAI) și rămâne la apelant. Întoarce
// Response la succes, altfel TtsResult de eroare. Sursă unică (unic, fără duplicate).
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
  // Forțăm mereu Chirp 3 HD: stilul din env poate fi un nume complet de voce
  // (ex. „ro-RO-Chirp3-HD-Charon") sau doar stilul (ex. „Charon"). Orice altceva
  // cade pe Charon — voce masculină caldă.
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

// ── Rezervă: OpenAI TTS ──────────────────────────────────────────────────────
async function synthOpenAI(spoken: string, opts: SynthOpts): Promise<TtsResult> {
  // OpenAI TTS: `pcm` = LINEAR16 24kHz mono; altfel `mp3`. Voce masculină unică.
  const format = opts.encoding === 'LINEAR16' ? 'pcm' : 'mp3'
  const r = await ttsPost(
    OPENAI_SPEECH,
    { Authorization: `Bearer ${config.openai.key}`, 'Content-Type': 'application/json' },
    { model: config.openai.ttsModel, voice: config.openai.ttsVoice, input: spoken, response_format: format },
  )
  if (!(r instanceof Response)) return r
  const audio = Buffer.from(await r.arrayBuffer())
  if (audio.length === 0) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio }
}
