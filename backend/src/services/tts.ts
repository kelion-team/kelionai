import { config } from '../config.js'
import { academicPronounce } from './pronounce.js'

// TTS pe OpenAI (aceeași cheie ca vocea live) — pentru /api/tts + salutul de pe
// landing. Fără cheie Google TTS: „2 chei, punct" (Adrian). Voce masculină
// consistentă cu vocea live (`onyx`). OpenAI detectează limba din text.

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

/** True când cheia OpenAI e configurată (aceeași care face și vocea live). */
export function ttsConfigured(): boolean {
  return !!config.openai.key
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
 * Sintetizează `text` prin OpenAI TTS. Întoarce un rezultat tipat ca apelantul
 * să mapeze erorile pe statusul HTTP corect. Fără auth/cost aici (rămân în rută).
 * Implicit MP3; `{ encoding: 'LINEAR16' }` → PCM brut (24kHz) pentru agenți.
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

  // OpenAI TTS: `pcm` = LINEAR16 24kHz mono; altfel `mp3`. Voce masculină unică.
  const format = opts.encoding === 'LINEAR16' ? 'pcm' : 'mp3'
  let res: Response
  try {
    res = await fetch(OPENAI_SPEECH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openai.ttsModel,
        voice: config.openai.ttsVoice,
        input: spoken,
        response_format: format,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, status: 502, error: 'tts_failed' }
  }
  if (!res.ok) return { ok: false, status: 502, error: 'tts_failed' }
  const audio = Buffer.from(await res.arrayBuffer())
  if (audio.length === 0) return { ok: false, status: 502, error: 'tts_empty' }
  return { ok: true, audio }
}
