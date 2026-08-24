import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ email: '', admin: false }))
const speech = vi.hoisted(() => ({
  synthesize: vi.fn(async () => ({ ok: true as const, audio: Buffer.from('mp3'), engine: 'openai' as const })),
}))
vi.mock('./session.js', () => ({
  getSessionUser: () => state.email
    ? { email: state.email, name: 'Test', role: 'customer', picture: '', locale: 'en', authProvider: 'local' }
    : null,
}))
vi.mock('./services/adminIdentity.js', () => ({ esteAdminKelion: () => state.admin }))
vi.mock('./db.js', () => ({ getVoicePref: vi.fn(async () => null) }))
vi.mock('./services/tts.js', () => ({
  TTS_MAX_CHARS: 4_096,
  openaiTtsAvailable: () => true,
  ttsConfigured: () => true,
  synthesize: speech.synthesize,
}))

const { ttsRoutes } = await import('./routes/tts.js')

beforeEach(() => {
  state.email = ''
  state.admin = false
  speech.synthesize.mockClear()
})

describe('admin-only upload speech route', () => {
  it('requires a session and rejects customer access before synthesis', async () => {
    const app = Fastify()
    await app.register(ttsRoutes)
    expect((await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'hello' } })).statusCode).toBe(401)
    state.email = 'customer@example.test'
    expect((await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'hello' } })).statusCode).toBe(403)
    expect(speech.synthesize).not.toHaveBeenCalled()
  })

  it('rejects text above the published cap instead of truncating it', async () => {
    state.email = 'admin@example.test'
    state.admin = true
    const app = Fastify()
    await app.register(ttsRoutes)
    const response = await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'x'.repeat(4_097) } })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ error: 'tts_text_too_large' })
    expect(speech.synthesize).not.toHaveBeenCalled()
  })

  it('returns private audio for an authenticated admin', async () => {
    state.email = 'admin@example.test'
    state.admin = true
    const app = Fastify()
    await app.register(ttsRoutes)
    const response = await app.inject({ method: 'POST', url: '/api/tts', payload: { text: 'hello', lang: 'en' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('audio/mpeg')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.rawPayload).toEqual(Buffer.from('mp3'))
  })
})
