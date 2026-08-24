export type SpectralProfileAvailability = {
  method: 'spectral_profile'
  neuralSpeakerIdentification: false
  authority: 'personalisation_only'
}

export type SpectralProfilePayload = {
  vector: number[]
  meta: { centroid: number }
}

export type SpectralProfileStatus = {
  enrolled: boolean
  name: string | null
  hasAudio: boolean
  updatedAt: string | null
  availability: SpectralProfileAvailability
}

type SpectralProfileApiResponse = {
  voiceprint: null | {
    name: string
    hasAudio: boolean
    updatedAt: string
  }
  availability: SpectralProfileAvailability
}

export function buildSpectralProfilePayload(
  samples: readonly (readonly number[])[],
  sampleRate: number,
  fftSize: number,
  vectorLength = 32,
): SpectralProfilePayload {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(fftSize) || fftSize <= 0) {
    throw new Error('invalid_audio_metadata')
  }
  if (samples.length === 0) throw new Error('empty_audio_profile')

  const vector = Array.from({ length: vectorLength }, (_, index) => {
    const average = samples.reduce((sum, sample) => sum + (Number(sample[index]) || 0), 0) / samples.length
    return Math.max(0, Math.min(255, average))
  })
  const binHz = sampleRate / fftSize
  const totalMagnitude = vector.reduce((sum, magnitude) => sum + magnitude, 0)
  const weightedFrequency = vector.reduce(
    (sum, magnitude, index) => sum + magnitude * index * binHz,
    0,
  )

  return {
    vector,
    meta: {
      centroid: Math.max(
        0,
        Math.min(24_000, Math.round(totalMagnitude > 0 ? weightedFrequency / totalMagnitude : 0)),
      ),
    },
  }
}

export function isSpectralProfileAvailability(value: unknown): value is SpectralProfileAvailability {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpectralProfileAvailability>
  return candidate.method === 'spectral_profile'
    && candidate.neuralSpeakerIdentification === false
    && candidate.authority === 'personalisation_only'
}

export function parseSpectralProfileStatus(value: unknown): SpectralProfileStatus | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SpectralProfileApiResponse>
  if (!isSpectralProfileAvailability(candidate.availability)) return null
  if (candidate.voiceprint === null) {
    return {
      enrolled: false,
      name: null,
      hasAudio: false,
      updatedAt: null,
      availability: candidate.availability,
    }
  }
  if (!candidate.voiceprint || typeof candidate.voiceprint !== 'object') return null
  const profile = candidate.voiceprint
  if (typeof profile.name !== 'string'
    || typeof profile.hasAudio !== 'boolean'
    || typeof profile.updatedAt !== 'string') return null
  return {
    enrolled: true,
    name: profile.name,
    hasAudio: profile.hasAudio,
    updatedAt: profile.updatedAt,
    availability: candidate.availability,
  }
}
