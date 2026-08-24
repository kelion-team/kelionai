import { afterEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({
  config: {
    openai: {
      key: 'test-project-key',
      apiBaseUrl: 'https://api.openai.test/v1',
      callTranscription: 'gpt-test-transcribe',
    },
  },
}))
const usage = vi.hoisted(() => ({ record: vi.fn(async () => undefined) }))
vi.mock('../config.js', () => configMock)
vi.mock('../db.js', () => ({ recordProviderUsage: usage.record }))

const {
  CALL_AUDIO_MAX_BYTES,
  decodeCallAudio,
  transcribeCallAudio,
} = await import('./openaiCallTranscription.js')

function webmBase64(): string {
  const bytes = Buffer.alloc(128)
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(bytes)
  return bytes.toString('base64')
}

afterEach(() => {
  vi.unstubAllGlobals()
  usage.record.mockClear()
})

describe('call-specific OpenAI transcription', () => {
  it('rejects unsupported, forged and oversized audio before fetch', () => {
    expect(decodeCallAudio(webmBase64(), 'text/plain')).toEqual({ ok: false, error: 'call_audio_type_unsupported' })
    expect(decodeCallAudio(Buffer.alloc(128).toString('base64'), 'audio/webm')).toEqual({
      ok: false,
      error: 'call_audio_container_invalid',
    })
    expect(decodeCallAudio(Buffer.alloc(CALL_AUDIO_MAX_BYTES + 1).toString('base64'), 'audio/webm')).toEqual({
      ok: false,
      error: 'call_audio_too_large',
    })
  })

  it('sends an extension-bearing bounded multipart file and records token usage', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('model')).toBe('gpt-test-transcribe')
      expect(form.get('response_format')).toBe('json')
      const file = form.get('file') as File
      expect(file.name).toBe('utterance.webm')
      expect(file.type).toBe('audio/webm')
      expect(file.size).toBe(128)
      return new Response(JSON.stringify({
        text: 'Salut, lume!',
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          input_token_details: { audio_tokens: 11 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_audio_123' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeCallAudio(webmBase64(), {
      mime: 'audio/webm;codecs=opus',
      userEmail: 'user@example.test',
      surface: 'call_translation',
      eventKey: 'call:abc:11111111-1111-4111-8111-111111111111',
    })).resolves.toEqual({ ok: true, transcript: 'Salut, lume!', providerRequestId: 'req_audio_123' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.test/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer test-project-key' } }),
    )
    expect(usage.record).toHaveBeenCalledWith({
      responseId: 'req_audio_123',
      userEmail: 'user@example.test',
      surface: 'call_translation',
      model: 'gpt-test-transcribe',
      inputTokens: 12,
      outputTokens: 4,
      inputAudioTokens: 11,
    })
  })

  it('drops a known silence hallucination instead of creating phantom speech', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'Thanks for watching' }), {
      status: 200,
      headers: { 'x-request-id': 'req_audio_phantom' },
    })))
    const result = await transcribeCallAudio(webmBase64(), {
      mime: 'audio/webm',
      userEmail: 'user@example.test',
      surface: 'call_intent',
      eventKey: 'intent:abc:11111111-1111-4111-8111-111111111111',
    })
    expect(result).toMatchObject({ ok: true, transcript: '' })
  })
})
