import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { recordProviderUsage } from '../db.js'
import { academicPronounce } from './pronounce.js'
import { readResponseBufferLimited, readResponseTextLimited } from './httpBody.js'

export const TTS_MAX_CHARS = 4_096
const TTS_RESPONSE_MAX_BYTES = 24_000_000
const TTS_ERROR_MAX_BYTES = 64_000
const DEFAULT_REGION: Record<string, string> = {
  en: 'US', ro: 'RO', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL',
  pl: 'PL', ru: 'RU', uk: 'UA', tr: 'TR', ar: 'XA', hi: 'IN', ja: 'JP', ko: 'KR',
  zh: 'CN', sv: 'SE', da: 'DK', nb: 'NO', fi: 'FI', cs: 'CZ', el: 'GR', hu: 'HU',
  id: 'ID', th: 'TH', vi: 'VN',
}

export function normalizeLang(raw: string | undefined): string {
  const match = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec((raw ?? '').trim())
  if (!match) return 'en-US'
  const language = match[1].toLowerCase()
  return `${language}-${match[2]?.toUpperCase() ?? DEFAULT_REGION[language] ?? language.toUpperCase()}`
}

export function openaiTtsAvailable(): boolean {
  return Boolean(config.openai.key && config.openai.tts)
}

export function ttsConfigured(): boolean {
  return openaiTtsAvailable()
}

export type TtsEngine = 'openai'
export type TtsResult =
  | { ok: true; audio: Buffer; engine: TtsEngine }
  | { ok: false; status: number; error: string; detaliu?: string }

export interface SynthOpts {
  encoding?: 'MP3' | 'LINEAR16'
  voice?: string | null
  usageContext?: { userEmail: string; surface: string }
}

function safeVoice(requested?: string | null): string {
  const candidate = (requested ?? '').trim()
  // OpenAI voices are server-configured. A free-form user value never reaches
  // the API; it can only match the configured voice exactly.
  return candidate && candidate === config.openaiVoice ? candidate : config.openaiVoice
}

export async function synthesize(text: string, langRaw: string | undefined, opts: SynthOpts = {}): Promise<TtsResult> {
  const clean = text.trim()
  if (!clean) return { ok: false, status: 400, error: 'bad_request' }
  if (clean.length > TTS_MAX_CHARS) return { ok: false, status: 413, error: 'tts_text_too_large' }
  if (!ttsConfigured()) return { ok: false, status: 503, error: 'tts_not_configured' }
  const lang = normalizeLang(langRaw)
  const spoken = academicPronounce(clean, lang.split('-')[0])
  try {
    const response = await fetch(`${config.openai.apiBaseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openai.tts,
        input: spoken,
        voice: safeVoice(opts.voice),
        response_format: opts.encoding === 'LINEAR16' ? 'pcm' : 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const detail = (await readResponseTextLimited(response, TTS_ERROR_MAX_BYTES).catch(() => ''))
        .replace(/\s+/g, ' ')
        .slice(0, 300)
      return { ok: false, status: response.status === 429 ? 429 : 502, error: `tts_http_${response.status}`, detaliu: detail }
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      return { ok: false, status: 502, error: 'tts_content_type_invalid' }
    }
    const audio = await readResponseBufferLimited(response, TTS_RESPONSE_MAX_BYTES)
    if (!audio.length) return { ok: false, status: 502, error: 'tts_empty' }
    if (opts.usageContext) {
      const headerId = response.headers.get('x-request-id')?.trim() ?? ''
      const responseId = /^[A-Za-z0-9._:-]{1,160}$/.test(headerId) ? headerId : `tts:${randomUUID()}`
      void recordProviderUsage({
        responseId,
        userEmail: opts.usageContext.userEmail,
        surface: opts.usageContext.surface,
        model: config.openai.tts,
        inputTokens: 0,
        outputTokens: 0,
      }).catch((error) => {
        // Speech responses do not expose request-level units. The admin-only
        // organization usage reconciler is authoritative for the actual cost.
        console.error(`[provider-usage] speech reconciliation required: ${String(error).slice(0, 120)}`)
      })
    }
    return { ok: true, audio, engine: 'openai' }
  } catch (error) {
    return { ok: false, status: 502, error: 'tts_failed', detaliu: String((error as Error)?.message ?? error).slice(0, 200) }
  }
}
