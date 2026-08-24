import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const state = vi.hoisted(() => ({ email: 'a@example.test', rows: new Map<string, unknown>() }))

vi.mock('./session.js', () => ({
  getSessionUser: () => state.email
    ? { email: state.email, name: 'Customer', role: 'customer', authProvider: 'google', picture: '', locale: 'en' }
    : null,
}))
vi.mock('./db.js', () => ({
  saveVoiceprint: vi.fn(async (input: { email: string; name: string; features: number[]; featureMeta: { centroid: number } }) => {
    state.rows.set(input.email, { email: input.email, name: input.name, features: input.features, featureMeta: input.featureMeta })
  }),
  getVoiceprint: vi.fn(async (email: string) => state.rows.get(email) ?? null),
  deleteVoiceprint: vi.fn(async (email: string) => state.rows.delete(email)),
}))

const { voiceprintRoutes } = await import('./routes/voiceprint.js')

beforeEach(() => {
  state.email = 'a@example.test'
  state.rows = new Map([
    ['b@example.test', { email: 'b@example.test', features: [9, 9, 9], featureMeta: { centroid: 9 } }],
  ])
})

describe('profil vocal user-scoped', () => {
  it('înscrie profilul fără gender/admin și declară lipsa identificării neurale', async () => {
    const app = Fastify()
    await app.register(voiceprintRoutes)
    const response = await app.inject({
      method: 'POST',
      url: '/api/voiceprint/me',
      payload: { vector: [1, 2, 3], meta: { centroid: 2_000 } },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      voiceprint: { email: 'a@example.test' },
      availability: { method: 'spectral_profile', neuralSpeakerIdentification: false, authority: 'personalisation_only' },
    })
    expect(response.body).not.toContain('gender')
    expect(response.body).not.toContain('isAdmin')
  })

  it('revocă numai profilul sesiunii și nu atinge alt cont', async () => {
    state.rows.set('a@example.test', { email: 'a@example.test' })
    const app = Fastify()
    await app.register(voiceprintRoutes)
    const response = await app.inject({ method: 'DELETE', url: '/api/voiceprint/me', payload: { email: 'b@example.test' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, deleted: true })
    expect(state.rows.has('a@example.test')).toBe(false)
    expect(state.rows.has('b@example.test')).toBe(true)
  })
})
