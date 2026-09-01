import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.hoisted(() => vi.fn())
const esteAdminKelion = vi.hoisted(() => vi.fn())
const cheiePublicaPush = vi.hoisted(() => vi.fn())
const aboneazaPush = vi.hoisted(() => vi.fn())
const dezaboneazaPush = vi.hoisted(() => vi.fn())
const normalizeazaAbonarePush = vi.hoisted(() => vi.fn())
const normalizeazaEndpointPush = vi.hoisted(() => vi.fn())

vi.mock('./session.js', () => ({ getSessionUser }))
vi.mock('./services/adminIdentity.js', () => ({ esteAdminKelion }))
vi.mock('./services/pushTelefon.js', () => ({
  cheiePublicaPush,
  aboneazaPush,
  dezaboneazaPush,
  normalizeazaAbonarePush,
  normalizeazaEndpointPush,
}))

import { pushRoutes } from './routes/push.js'

async function appPush() {
  const app = Fastify()
  await app.register(pushRoutes)
  return app
}

beforeEach(() => {
  getSessionUser.mockReset().mockReturnValue(null)
  esteAdminKelion.mockReset().mockReturnValue(false)
  cheiePublicaPush.mockReset().mockResolvedValue('public-key')
  aboneazaPush.mockReset().mockResolvedValue(true)
  dezaboneazaPush.mockReset().mockResolvedValue(true)
  normalizeazaAbonarePush.mockReset().mockReturnValue(null)
  normalizeazaEndpointPush.mockReset().mockReturnValue(null)
})

describe('rutele push sunt exclusiv pentru adminul Google verificat', () => {
  it('refuză lipsa sesiunii și un customer înainte de a expune cheia', async () => {
    const app = await appPush()
    expect((await app.inject({ method: 'GET', url: '/api/push/cheie' })).statusCode).toBe(401)
    getSessionUser.mockReturnValue({ email: 'customer@example.test' })
    expect((await app.inject({ method: 'GET', url: '/api/push/cheie' })).statusCode).toBe(403)
    expect(cheiePublicaPush).not.toHaveBeenCalled()
    await app.close()
  })

  it('întoarce cheia publică numai adminului și eșuează închis când push e oprit', async () => {
    const app = await appPush()
    getSessionUser.mockReturnValue({ email: 'admin@example.test' })
    esteAdminKelion.mockReturnValue(true)
    expect((await app.inject({ method: 'GET', url: '/api/push/cheie' })).json()).toEqual({ cheie: 'public-key' })
    cheiePublicaPush.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/api/push/cheie' })).statusCode).toBe(503)
    await app.close()
  })

  it('validează schema și abonarea înainte de scriere', async () => {
    const app = await appPush()
    getSessionUser.mockReturnValue({ email: 'admin@example.test' })
    esteAdminKelion.mockReturnValue(true)
    const invalid = await app.inject({ method: 'POST', url: '/api/push/aboneaza', payload: { abonare: { endpoint: 'x' } } })
    expect(invalid.statusCode).toBe(400)
    expect(aboneazaPush).not.toHaveBeenCalled()

    const abonare = {
      endpoint: 'https://push.example.test/subscription/1',
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }
    normalizeazaAbonarePush.mockReturnValue(abonare)
    const valid = await app.inject({ method: 'POST', url: '/api/push/aboneaza', payload: { abonare } })
    expect(valid.statusCode).toBe(200)
    expect(aboneazaPush).toHaveBeenCalledWith('admin@example.test', abonare)
    await app.close()
  })

  it('revocarea este validată și raportează indisponibilitatea DB', async () => {
    const app = await appPush()
    getSessionUser.mockReturnValue({ email: 'admin@example.test' })
    esteAdminKelion.mockReturnValue(true)
    const endpoint = 'https://push.example.test/subscription/1'
    normalizeazaEndpointPush.mockReturnValue(endpoint)
    dezaboneazaPush.mockResolvedValue(false)
    const response = await app.inject({ method: 'POST', url: '/api/push/dezaboneaza', payload: { endpoint } })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'unsubscribe_unavailable' })
    await app.close()
  })
})
