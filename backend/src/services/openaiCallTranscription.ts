import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { recordProviderUsage } from '../db.js'
import { readResponseTextLimited } from './httpBody.js'

/** The call recorder emits short phrases, never whole calls. This limit keeps
 * both the WebSocket and the paid provider request bounded. */
export const CALL_AUDIO_MAX_BYTES = 2_500_000
export const CALL_TRANSCRIPT_MAX_CHARS = 12_000

const PROVIDER_RESPONSE_MAX_BYTES = 256_000
const PROVIDER_TIMEOUT_MS = 30_000

interface AudioKind {
  mime: string
  extension: string
  magic(buffer: Buffer): boolean
}

const AUDIO_KINDS: Record<string, AudioKind> = {
  'audio/webm': {
    mime: 'audio/webm',
    extension: 'webm',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
  'audio/ogg': {
    mime: 'audio/ogg',
    extension: 'ogg',
    magic: (b) => b.length >= 4 && b.subarray(0, 4).toString('ascii') === 'OggS',
  },
  'audio/mp4': {
    mime: 'audio/mp4',
    extension: 'mp4',
    magic: (b) => b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  'audio/wav': {
    mime: 'audio/wav',
    extension: 'wav',
    magic: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
  'audio/mpeg': {
    mime: 'audio/mpeg',
    extension: 'mp3',
    magic: (b) => b.length >= 3 && (
      b.subarray(0, 3).toString('ascii') === 'ID3' ||
      (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
    ),
  },
}

export type CallTranscriptionResult =
  | { ok: true; transcript: string; providerRequestId: string }
  | { ok: false; status: number; error: string }

export interface CallTranscriptionOptions {
  mime: string
  userEmail: string
  surface: 'call_translation' | 'call_intent'
  eventKey: string
}

function normalizeMime(raw: string): string {
  const mime = raw.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mime === 'audio/x-wav' || mime === 'audio/wave') return 'audio/wav'
  if (mime === 'audio/mp3') return 'audio/mpeg'
  return mime
}

function decodedLengthUpperBound(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

/** Strictly validates both the declared container and its leading bytes. A
 * MIME string alone never decides what gets forwarded to OpenAI. */
export function decodeCallAudio(
  audioBase64: string,
  mimeRaw: string,
): { ok: true; audio: Buffer; kind: AudioKind } | { ok: false; error: string } {
  const encoded = audioBase64.trim()
  const mime = normalizeMime(mimeRaw)
  const kind = AUDIO_KINDS[mime]
  if (!kind) return { ok: false, error: 'call_audio_type_unsupported' }
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { ok: false, error: 'call_audio_base64_invalid' }
  }
  if (decodedLengthUpperBound(encoded) > CALL_AUDIO_MAX_BYTES) {
    return { ok: false, error: 'call_audio_too_large' }
  }
  const audio = Buffer.from(encoded, 'base64')
  if (audio.length < 64 || audio.length > CALL_AUDIO_MAX_BYTES || !kind.magic(audio)) {
    return { ok: false, error: 'call_audio_container_invalid' }
  }
  return { ok: true, audio, kind }
}

const ASR_PHANTOMS = new Set([
  'gret',
  'greata',
  'subtitrare',
  'subtitrari',
  'multumesc pentru vizionare',
  'multumesc ca ati urmarit',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subtitles by',
  'music',
  'muzica',
])

function cleanTranscript(raw: unknown): string {
  const text = typeof raw === 'string'
    ? raw.replaceAll('\0', '').replace(/\s+/g, ' ').trim().slice(0, CALL_TRANSCRIPT_MAX_CHARS)
    : ''
  if (!text || !/[a-z0-9\u00c0-\u024f]/iu.test(text)) return ''
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return ASR_PHANTOMS.has(normalized) ? '' : text
}

function safeInteger(raw: unknown): number {
  const value = Number(raw ?? 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function providerId(response: Response, eventKey: string): string {
  const header = response.headers.get('x-request-id')?.trim() ?? ''
  if (/^[A-Za-z0-9._:-]{1,160}$/.test(header)) return header
  return `audio:${createHash('sha256').update(eventKey).digest('hex').slice(0, 48)}`
}

/** OpenAI-only transcription adapter for the authenticated Kelion-to-Kelion
 * call flow. Audio is kept in memory only for this bounded provider request. */
export async function transcribeCallAudio(
  audioBase64: string,
  options: CallTranscriptionOptions,
): Promise<CallTranscriptionResult> {
  if (!config.openai.key || !config.openai.callTranscription) {
    return { ok: false, status: 503, error: 'call_transcription_not_configured' }
  }
  if (
    !/^[A-Za-z0-9._:-]{1,150}$/.test(options.eventKey) ||
    !options.userEmail.trim()
  ) return { ok: false, status: 400, error: 'call_transcription_context_invalid' }

  const decoded = decodeCallAudio(audioBase64, options.mime)
  if (!decoded.ok) {
    const status = decoded.error === 'call_audio_too_large' ? 413 : 400
    return { ok: false, status, error: decoded.error }
  }

  const form = new FormData()
  form.append('model', config.openai.callTranscription)
  form.append('response_format', 'json')
  form.append(
    'file',
    new Blob([new Uint8Array(decoded.audio)], { type: decoded.kind.mime }),
    `utterance.${decoded.kind.extension}`,
  )

  try {
    const response = await fetch(`${config.openai.apiBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.key}` },
      body: form,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const body = await readResponseTextLimited(response, PROVIDER_RESPONSE_MAX_BYTES)
    if (!response.ok) {
      return {
        ok: false,
        status: response.status === 429 ? 429 : 502,
        error: `call_transcription_http_${response.status}`,
      }
    }

    let json: Record<string, unknown>
    try {
      const parsed = JSON.parse(body) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      json = parsed as Record<string, unknown>
    } catch {
      return { ok: false, status: 502, error: 'call_transcription_response_invalid' }
    }

    const requestId = providerId(response, options.eventKey)
    const usage = json.usage && typeof json.usage === 'object'
      ? json.usage as Record<string, unknown>
      : {}
    const details = usage.input_token_details && typeof usage.input_token_details === 'object'
      ? usage.input_token_details as Record<string, unknown>
      : {}
    try {
      await recordProviderUsage({
        responseId: requestId,
        userEmail: options.userEmail,
        surface: options.surface,
        model: config.openai.callTranscription,
        inputTokens: safeInteger(usage.input_tokens),
        outputTokens: safeInteger(usage.output_tokens),
        inputAudioTokens: safeInteger(details.audio_tokens),
      })
    } catch (error) {
      // The provider may already have charged the request. Never repeat that
      // side effect just because the local usage journal needs reconciliation.
      console.error(`[provider-usage] call transcription reconciliation required: ${String(error).slice(0, 120)}`)
    }

    return { ok: true, transcript: cleanTranscript(json.text), providerRequestId: requestId }
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    return {
      ok: false,
      status: /too_large/i.test(message) ? 502 : 502,
      error: /too_large/i.test(message) ? 'call_transcription_response_too_large' : 'call_transcription_failed',
    }
  }
}
