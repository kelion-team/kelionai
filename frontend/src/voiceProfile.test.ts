import { describe, expect, it } from 'vitest'
import {
  buildSpectralProfilePayload,
  isSpectralProfileAvailability,
  parseSpectralProfileStatus,
} from './lib/voiceProfile'

describe('spectral voice profile contract', () => {
  it('builds only the measured FFT vector and spectral centroid', () => {
    const payload = buildSpectralProfilePayload([
      [0, 10, 20, 30],
      [0, 30, 40, 50],
    ], 48_000, 512, 4)

    expect(payload.vector).toEqual([0, 20, 30, 40])
    expect(payload.meta).toEqual({ centroid: 208 })
    expect(payload).not.toHaveProperty('gender')
    expect(payload.meta).not.toHaveProperty('pitchMeanHz')
  })

  it('accepts only the non-neural personalisation availability contract', () => {
    expect(isSpectralProfileAvailability({
      method: 'spectral_profile',
      neuralSpeakerIdentification: false,
      authority: 'personalisation_only',
    })).toBe(true)
    expect(isSpectralProfileAvailability({
      method: 'spectral_profile',
      neuralSpeakerIdentification: true,
      authority: 'authentication',
    })).toBe(false)
  })

  it('refuses an empty capture instead of enrolling a zero-vector profile', () => {
    expect(() => buildSpectralProfilePayload([], 48_000, 512)).toThrow('empty_audio_profile')
  })

  it('unwraps the server response into metadata-only status without leaking the vector', () => {
    const response = {
      ok: true,
      voiceprint: {
        name: 'Customer',
        hasAudio: false,
        updatedAt: '2026-08-24T10:00:00.000Z',
        features: [1, 2, 3],
        audio: 'data:audio/webm;base64,AA==',
      },
      availability: {
        method: 'spectral_profile',
        neuralSpeakerIdentification: false,
        authority: 'personalisation_only',
      },
    } as const
    const sanitized = parseSpectralProfileStatus(response)
    expect(sanitized).toEqual({
      enrolled: true,
      name: 'Customer',
      hasAudio: false,
      updatedAt: '2026-08-24T10:00:00.000Z',
      availability: response.availability,
    })
    expect(JSON.stringify(sanitized)).not.toMatch(/vector|audio\/|base64/)
  })

  it('maps a null server voiceprint to a valid not-enrolled status', () => {
    const availability = {
      method: 'spectral_profile',
      neuralSpeakerIdentification: false,
      authority: 'personalisation_only',
    } as const
    expect(parseSpectralProfileStatus({ voiceprint: null, availability })).toEqual({
      enrolled: false,
      name: null,
      hasAudio: false,
      updatedAt: null,
      availability,
    })
  })

  it('rejects malformed nested server metadata', () => {
    expect(parseSpectralProfileStatus({
      voiceprint: { name: 'Customer', hasAudio: 'no', updatedAt: null },
      availability: {
        method: 'spectral_profile',
        neuralSpeakerIdentification: false,
        authority: 'personalisation_only',
      },
    })).toBeNull()
  })
})
