import { describe, it, expect, vi } from 'vitest'
import { runVoiceTurn, type VoiceTurnDeps } from './voiceTurn.js'

// Mock STT/TTS so the test proves the audio-to-audio *pipeline*, not the
// external Google APIs.
vi.mock('./asr.js', () => ({
  transcribe: vi.fn(),
}))
vi.mock('./tts.js', () => ({
  synthesize: vi.fn(),
}))

import { transcribe } from './asr.js'
import { synthesize } from './tts.js'

const fakeDeps = (reply: string | null): VoiceTurnDeps => ({
  askBrain: vi.fn().mockResolvedValue(reply),
})

const PCM = 'cGNtLWRhdGE=' // base64 of "pcm-data"

// Build a minimal valid WAV (mono, 48 kHz, 16-bit) with one zero sample.
function makeWav(sampleRate = 48000): Buffer {
  const data = Buffer.alloc(2, 0)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // subchunk1Size
  header.writeUInt16LE(1, 20) // audioFormat PCM
  header.writeUInt16LE(1, 22) // numChannels
  header.writeUInt32LE(sampleRate, 24) // sampleRate
  header.writeUInt32LE(sampleRate * 2, 28) // byteRate
  header.writeUInt16LE(2, 32) // blockAlign
  header.writeUInt16LE(16, 34) // bitsPerSample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

describe('runVoiceTurn — audio-to-audio pipeline', () => {
  it('returns bad_request when pcm is empty', async () => {
    const r = await runVoiceTurn('', 48000, '', '', fakeDeps(null))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.stage).toBe('input')
      expect(r.error).toContain('bad_request')
    }
  })

  it('returns stt error when transcription fails', async () => {
    vi.mocked(transcribe).mockResolvedValue({ ok: false, status: 502, error: 'asr_failed' })
    const r = await runVoiceTurn(PCM, 48000, '', 'visitor-1', fakeDeps(null))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.stage).toBe('stt')
      expect(r.error).toBe('asr_failed')
    }
  })

  it('returns skip=true when input is silence/no transcript', async () => {
    vi.mocked(transcribe).mockResolvedValue({ ok: true, lang: 'ro-RO', transcript: '   ' })
    const r = await runVoiceTurn(PCM, 48000, 'ro', 'visitor-1', fakeDeps(null))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('skip' in r ? r.skip : false).toBe(true)
      expect(r.transcript).toBe('')
      expect(r.reply).toBe('')
    }
  })

  it('runs STT → brain → TTS and returns transcript, reply and WAV', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      ok: true,
      lang: 'ro-RO',
      transcript: 'Bună, ce mai faci?',
    })
    const wav = makeWav(48000)
    vi.mocked(synthesize).mockResolvedValue({
      ok: true,
      audio: wav,
    })

    const deps = fakeDeps('Salut! Sunt aici, mulțumesc.')
    const r = await runVoiceTurn(PCM, 48000, 'ro', 'visitor-1', deps)

    expect(r.ok).toBe(true)
    if (r.ok && !('skip' in r)) {
      expect(r.transcript).toBe('Bună, ce mai faci?')
      expect(r.reply).toBe('Salut! Sunt aici, mulțumesc.')
      expect(r.lang).toBe('ro-RO')
      expect(r.sampleRate).toBe(48000)
      expect(r.wav).toBe(wav.toString('base64'))
      expect(r.ttsError).toBeUndefined()
    }

    expect(deps.askBrain).toHaveBeenCalledTimes(1)
    const prompt = vi.mocked(deps.askBrain).mock.calls[0][0]
    expect(prompt).toContain('Bună, ce mai faci?')
    expect(prompt).toContain('[VOCE]')
  })

  it('falls back to accumulated chunks when brain returns null', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      ok: true,
      lang: 'en-US',
      transcript: 'Hello',
    })
    const wav = makeWav(48000)
    vi.mocked(synthesize).mockResolvedValue({ ok: true, audio: wav })

    // askBrain streams chunks but ultimately returns null.
    const deps: VoiceTurnDeps = {
      askBrain: vi.fn(async (_prompt, _visitor, onChunk) => {
        onChunk('Hi')
        onChunk(' there')
        return null
      }),
    }

    const r = await runVoiceTurn(PCM, 48000, '', 'visitor-1', deps)
    expect(r.ok).toBe(true)
    if (r.ok && !('skip' in r)) {
      expect(r.reply).toBe('Hi there')
    }
  })

  it('uses fallback line when brain and chunks are empty', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      ok: true,
      lang: 'ro-RO',
      transcript: 'Salut',
    })
    vi.mocked(synthesize).mockResolvedValue({ ok: true, audio: makeWav(48000) })

    const deps = fakeDeps('   ')
    const r = await runVoiceTurn(PCM, 48000, '', 'visitor-1', deps)
    expect(r.ok).toBe(true)
    if (r.ok && !('skip' in r)) {
      expect(r.reply).toBe('Te ascult.')
    }
  })

  it('returns ttsError when synthesis fails', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      ok: true,
      lang: 'ro-RO',
      transcript: 'Salut',
    })
    vi.mocked(synthesize).mockResolvedValue({ ok: false, status: 503, error: 'tts_not_configured' })

    const r = await runVoiceTurn(PCM, 48000, '', 'visitor-1', fakeDeps('Bună'))
    expect(r.ok).toBe(true)
    if (r.ok && !('skip' in r)) {
      expect(r.reply).toBe('Bună')
      expect(r.wav).toBe('')
      expect(r.ttsError).toBe('tts_not_configured')
    }
  })

  it('respects a custom sample rate and forwards it to TTS', async () => {
    vi.mocked(transcribe).mockResolvedValue({
      ok: true,
      lang: 'en-US',
      transcript: 'Test',
    })
    vi.mocked(synthesize).mockResolvedValue({ ok: true, audio: makeWav(24000) })

    const r = await runVoiceTurn(PCM, 24000, 'en', 'v-2', fakeDeps('OK'))
    expect(r.ok).toBe(true)
    if (r.ok && !('skip' in r)) {
      expect(r.sampleRate).toBe(24000)
    }
    expect(vi.mocked(synthesize)).toHaveBeenLastCalledWith(
      'OK',
      'en-US',
      expect.objectContaining({ encoding: 'LINEAR16', sampleRateHertz: 24000 }),
    )
  })
})
