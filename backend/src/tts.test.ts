import { afterEach, describe, expect, it, vi } from 'vitest'
import { config } from './config.js'
import { normalizeLang, openaiTtsAvailable, synthesize, ttsConfigured, TTS_MAX_CHARS } from './services/tts.js'

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI speech synthesis', () => {
  it('normalizes supported language hints without selecting another provider', () => {
    expect(normalizeLang('ro')).toBe('ro-RO')
    expect(normalizeLang('en_gb')).toBe('en-GB')
    expect(normalizeLang('invalid')).toBe('en-US')
  })

  it('reports availability only from the configured OpenAI engine', () => {
    expect(openaiTtsAvailable()).toBe(Boolean(config.openai.key && config.openai.tts))
    expect(ttsConfigured()).toBe(openaiTtsAvailable())
  })

  it('rejects oversize text instead of silently truncating it', async () => {
    await expect(synthesize('x'.repeat(TTS_MAX_CHARS + 1), 'en')).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'tts_text_too_large',
    })
  })

  it('returns a named unavailable error when no speech engine is configured', async () => {
    const openai = config.openai as { key: string; tts: string }
    const previous = { key: openai.key, tts: openai.tts }
    openai.key = ''
    openai.tts = ''
    try {
      await expect(synthesize('salut', 'ro')).resolves.toEqual({
        ok: false,
        status: 503,
        error: 'tts_not_configured',
      })
    } finally {
      openai.key = previous.key
      openai.tts = previous.tts
    }
  })

  it('uses the configured OpenAI base URL and rejects a non-audio response', async () => {
    const openai = config.openai as { key: string; tts: string; apiBaseUrl: string }
    const previous = { key: openai.key, tts: openai.tts, apiBaseUrl: openai.apiBaseUrl }
    openai.key = 'test-key'
    openai.tts = 'test-tts'
    openai.apiBaseUrl = 'https://api.openai.test/v1'
    const fetchMock = vi.fn(async () => new Response('<html>no</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(synthesize('salut', 'ro')).resolves.toEqual({
        ok: false,
        status: 502,
        error: 'tts_content_type_invalid',
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.test/v1/audio/speech',
        expect.objectContaining({ method: 'POST' }),
      )
    } finally {
      openai.key = previous.key
      openai.tts = previous.tts
      openai.apiBaseUrl = previous.apiBaseUrl
    }
  })
})
