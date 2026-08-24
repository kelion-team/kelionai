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

  it('accepts only metadata-only status and rejects a biometric vector response', () => {
    const status = {
      enrolled: true,
      name: null,
      hasAudio: false,
      updatedAt: '2026-08-24T10:00:00.000Z',
      availability: {
        method: 'spectral_profile',
        neuralSpeakerIdentification: false,
        authority: 'personalisation_only',
      },
    } as const
    expect(parseSpectralProfileStatus(status)).toEqual(status)
    const sanitized = parseSpectralProfileStatus({ ...status, vector: [1, 2, 3], audio: 'data:audio/webm;base64,AA==' })
    expect(sanitized).toEqual(status)
    expect(JSON.stringify(sanitized)).not.toMatch(/vector|audio\/|base64/)
  })
})
