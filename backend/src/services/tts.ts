import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'

// Shared Google Cloud Text-to-Speech synthesis — Chirp 3 HD (male, academic).
// ONE implementation used by BOTH the authenticated /api/tts route and the
// public /api/greet landing greeting, so the synth logic is never duplicated.

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

// Default region per language for 2-letter shorthand (the frontend normally
// sends a full BCP-47 tag; this is a safety net).
const DEFAULT_REGION: Record<string, string> = {
  en: 'US', ro: 'RO', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL',
  pl: 'PL', ru: 'RU', uk: 'UA', tr: 'TR', ar: 'XA', hi: 'IN', ja: 'JP', ko: 'KR',
  zh: 'CN', sv: 'SE', da: 'DK', nb: 'NO', fi: 'FI', cs: 'CZ', el: 'GR', hu: 'HU',
  id: 'ID', th: 'TH', vi: 'VN',
}

// Normalise a locale to a BCP-47 `ll-RR` tag (e.g. "ro" → "ro-RO", "fr-fr" →
// "fr-FR"). Falls back to en-US for anything malformed.
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

/** True when SOME Google TTS credential is configured (service account or key). */
export function ttsConfigured(): boolean {
  return getAuth() !== null || !!config.googleTtsKey
}

export type TtsResult =
  | { ok: true; audio: Buffer }
  | { ok: false; status: number; error: string }

export interface SynthOpts {
  // Output encoding. Default MP3 (browser <audio>). The full-duplex voice agent
  // asks for LINEAR16 raw PCM at a fixed sample rate so it can push samples
  // straight into a LiveKit AudioSource — no client-side MP3 decoder needed.
  encoding?: 'MP3' | 'LINEAR16'
  sampleRateHertz?: number
}

/**
 * Synthesise `text` in `langRaw` via Chirp 3 HD. Returns a typed result so
 * callers can map failures to the right HTTP status. No auth, no cost
 * accounting here — that stays in the route. Default output is MP3; pass
 * `{ encoding: 'LINEAR16', sampleRateHertz }` for raw PCM (voice agent).
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
  // ca să fie rostite corect (API → „a pe i"), nu stâlcite. Strat pur pe text,
  // nu atinge microfonul. Vezi services/pronounce.ts.
  const spoken = academicPronounce(clean, lang.split('-')[0])
  // Forțăm mereu Chirp 3 HD: stilul din env poate fi fie un nume complet de
  // voce (ex. "ro-RO-Chirp3-HD-Charon"), fie doar stilul (ex. "Charon").
  // Orice altceva / non-Chirp cade pe Charon — nu permitem sinteză non-Chirp.
  // FIX: numele complet din env poate avea o limbă diferită de limba curentă;
  // extragem doar stilul (ultimul segment) și reconstruim vocea în `lang`.
  const configured = config.ttsVoiceStyle.trim()
  let style = 'Charon'
  if (/Chirp3-HD/i.test(configured)) {
    const parts = configured.split('-')
    style = parts[parts.length - 1] || 'Charon'
  } else if (/^[A-Z][a-z]+$/.test(configured)) {
    style = configured
  }
  const voiceName = `${lang}-Chirp3-HD-${style}`

  const a = getAuth()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let url = TTS_URL
  if (a) {
    const token = await a.getAccessToken()
    if (!token) return { ok: false, status: 502, error: 'tts_auth_failed' }
    headers.Authorization = `Bearer ${token}`
  } else {
    url = `${TTS_URL}?key=${config.googleTtsKey}`
  }

  const encoding = opts.encoding ?? 'MP3'
  const audioConfig: Record<string, unknown> = { audioEncoding: encoding }
  // LINEAR16 must declare its sample rate — the voice agent pushes these samples
  // into a LiveKit AudioSource created at the SAME rate, so they line up 1:1.
  if (encoding === 'LINEAR16') audioConfig.sampleRateHertz = opts.sampleRateHertz ?? 24000

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { text: spoken },
      voice: { languageCode: lang, name: voiceName },
      audioConfig,
    }),
  })
  if (!res.ok) return { ok: false, status: 502, error: 'tts_failed' }
  const j = (await res.json()) as { audioContent?: string }
  if (!j.audioContent) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio: Buffer.from(j.audioContent, 'base64') }
}
