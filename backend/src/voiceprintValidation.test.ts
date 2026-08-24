import { describe, expect, it } from 'vitest'
import { valideazaVoiceprintPayload } from './routes/voiceprint.js'

describe('validarea profilului vocal spectral', () => {
  it('acceptă exact vectorul FFT și centroidul măsurat de client', () => {
    const result = valideazaVoiceprintPayload(
      { vector: Array.from({ length: 32 }, (_, i) => i), meta: { centroid: 2_400 } },
      'Customer',
    )
    expect(result).toMatchObject({ ok: true, meta: { centroid: 2_400 } })
  })

  it('respinge vectori goi, supradimensionați, ne-finiți sau în afara benzilor FFT', () => {
    expect(valideazaVoiceprintPayload({ vector: [], meta: { centroid: 1 } }, 'x')).toMatchObject({ ok: false, error: 'invalid_vector' })
    expect(valideazaVoiceprintPayload({ vector: Array(257).fill(0), meta: { centroid: 1 } }, 'x')).toMatchObject({ ok: false })
    expect(valideazaVoiceprintPayload({ vector: [0, Number.NaN, 1], meta: { centroid: 1 } }, 'x')).toMatchObject({ ok: false })
    expect(valideazaVoiceprintPayload({ vector: [0, 256, 1], meta: { centroid: 1 } }, 'x')).toMatchObject({ ok: false })
  })

  it('respinge centroid inventat/ne-finit și clipuri fără MIME/magic audio permis', () => {
    expect(valideazaVoiceprintPayload({ vector: [0, 1, 2], meta: {} }, 'x')).toMatchObject({ ok: false, error: 'invalid_meta' })
    expect(valideazaVoiceprintPayload({ vector: [0, 1, 2], meta: { centroid: Infinity } }, 'x')).toMatchObject({ ok: false, error: 'invalid_meta' })
    expect(valideazaVoiceprintPayload({ vector: [0, 1, 2], meta: { centroid: 1 }, clip: 'data:text/html;base64,PGgxPg==' }, 'x')).toMatchObject({ ok: false, error: 'invalid_clip' })
  })
})
