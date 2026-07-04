import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'

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

/**
 * Synthesise `text` in `langRaw` to an MP3 buffer via Chirp 3 HD. Returns a
 * typed result so callers can map failures to the right HTTP status. No auth,
 * no cost accounting here — that stays in the route.
 */
export async function synthesize(text: string, langRaw: string | undefined): Promise<TtsResult> {
  if (!ttsConfigured()) return { ok: false, status: 503, error: 'tts_not_configured' }
  const clean = text.trim()
  if (!clean) return { ok: false, status: 400, error: 'bad_request' }

  const lang = normalizeLang(langRaw)
  // A valid Chirp 3 HD style is a single capitalised name (e.g. Charon). Guard
  // against legacy/invalid values that would make Google reject the voice.
  const style = /^[A-Z][a-z]+$/.test(config.ttsVoiceStyle) ? config.ttsVoiceStyle : 'Charon'
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

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { text: clean },
      voice: { languageCode: lang, name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  if (!res.ok) return { ok: false, status: 502, error: 'tts_failed' }
  const j = (await res.json()) as { audioContent?: string }
  if (!j.audioContent) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio: Buffer.from(j.audioContent, 'base64') }
}
