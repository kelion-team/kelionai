import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { email: string; role: 'admin' | 'user' },
}))

vi.mock('./session.js', () => ({
  getSessionUser: () => state.user,
}))

vi.mock('./services/adminIdentity.js', () => ({
  esteAdminKelion: (email: string) => email.trim().toLowerCase() === 'owner@example.test',
}))

vi.mock('./services/manualLang.js', () => ({
  normalizeLang: (value: string) => value.trim().toLowerCase(),
  translateStrings: vi.fn().mockResolvedValue({}),
  translationReady: vi.fn().mockResolvedValue(null),
}))

import { manualRoutes } from './routes/manual.js'

async function appWithManual() {
  const app = Fastify()
  await app.register(manualRoutes)
  return app
}

afterEach(() => {
  state.user = null
})

describe('manual audience boundary', () => {
  it('never includes admin sections for an anonymous request', async () => {
    const app = await appWithManual()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/manual?lang=en' })
      expect(response.statusCode).toBe(200)
      const body = response.json<{ sections: Array<{ title: string; audience: string }> }>()
      expect(body.sections.length).toBeGreaterThan(0)
      expect(body.sections.every((section) => section.audience === 'public')).toBe(true)
      expect(body.sections.some((section) => section.title.includes('Doar admin'))).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('does not trust a forged session role', async () => {
    state.user = { email: 'customer@example.test', role: 'admin' }
    const app = await appWithManual()
    try {
      const json = await app.inject({ method: 'GET', url: '/api/manual?lang=en' })
      expect(json.json<{ sections: Array<{ audience: string }> }>().sections
        .every((section) => section.audience === 'public')).toBe(true)

      const html = await app.inject({ method: 'GET', url: '/manual.html?lang=en' })
      expect(html.body).not.toContain('Constructor și publicare')
    } finally {
      await app.close()
    }
  })

  it('uses the configured-email identity even when the stored role is not admin', async () => {
    state.user = { email: 'OWNER@example.test', role: 'user' }
    const app = await appWithManual()
    try {
      const json = await app.inject({ method: 'GET', url: '/api/manual?lang=en' })
      const sections = json.json<{ sections: Array<{ title: string; audience: string }> }>().sections
      expect(sections.some((section) => section.audience === 'admin')).toBe(true)
      expect(sections.find((section) => section.title.includes('Constructor'))?.audience).toBe('admin')

      const html = await app.inject({ method: 'GET', url: '/manual.html?lang=en' })
      expect(html.body).toContain('Constructor și publicare')
    } finally {
      await app.close()
    }
  })
})
