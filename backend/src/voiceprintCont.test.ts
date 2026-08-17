import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('./session.js', () => ({
  getSessionUser: vi.fn(() => ({
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
  })),
}))

vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>()
  const prints: Record<string, unknown> = {}
  return {
    ...actual,
    saveVoiceprint: vi.fn(async (v) => {
      prints[v.email] = {
        email: v.email,
        name: v.name,
        gender: v.gender,
        isAdmin: v.isAdmin,
        features: v.features,
        featureMeta: v.featureMeta,
        audioClip: v.audioClip,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }),
    getVoiceprint: vi.fn(async (email) => prints[email] || null),
    listVoiceprints: vi.fn(async () => Object.values(prints)),
  }
})

import { voiceprintRoutes } from './routes/voiceprint.js'
import { saveVoiceprint } from './db.js'

describe('Voiceprint User Account Linking (Cerinta #18)', () => {
  it('saves and associates voiceprint directly with the user profile in the database', async () => {
    const app = Fastify()
    await app.register(voiceprintRoutes)

    const payload = {
      vector: [0.1, 0.2, 0.3, 0.4, 0.5],
      meta: {
        pitchMean: 140,
        pitchStd: 12,
        pitchMin: 100,
        pitchMax: 200,
        centroid: 520,
        rolloff: 800,
        zcr: 0.1,
        energy: 45.2,
        jitter: 0.01,
        shimmer: 0.02,
      },
      clip: 'data:audio/wav;base64,AAA...',
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/voiceprint/me',
      payload,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.voiceprint).toBeDefined()
    expect(body.voiceprint.email).toBe('user@example.com')
    expect(saveVoiceprint).toHaveBeenCalled()

    const checkRes = await app.inject({
      method: 'GET',
      url: '/api/voiceprint/me',
    })

    expect(checkRes.statusCode).toBe(200)
    const checkBody = JSON.parse(checkRes.body)
    expect(checkBody.voiceprint).toBeDefined()
    expect(checkBody.voiceprint.email).toBe('user@example.com')
  })

  it('rejects invalid or empty vectors when saving voiceprint', async () => {
    const app = Fastify()
    await app.register(voiceprintRoutes)

    const res = await app.inject({
      method: 'POST',
      url: '/api/voiceprint/me',
      payload: { vector: [] },
    })

    expect(res.statusCode).toBe(400)
  })
})
