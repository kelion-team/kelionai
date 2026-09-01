import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { config } from './config.js'
import { legalRoutes } from './routes/legal.js'

describe('public legal pages reflect the active product', () => {
  it('describes the OpenAI-only, minimised implementation without retired claims', async () => {
    const app = Fastify()
    await app.register(legalRoutes)
    try {
      const response = await app.inject({ method: 'GET', url: '/privacy' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain(config.product.supportEmail)
      expect(response.body).toContain(config.product.appName)
      expect(response.body).toContain('OpenAI API')
      expect(response.body).toContain('does not enrol new facial biometric profiles')
      expect(response.body).toContain('is not retained as sensor history')
      expect(response.body).not.toMatch(/face profile persists|device fingerprint|personal Gmail/i)
    } finally {
      await app.close()
    }
  })

  it('keeps account deletion factual about retained legal records', async () => {
    const app = Fastify()
    await app.register(legalRoutes)
    try {
      const response = await app.inject({ method: 'GET', url: '/delete-account' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('authenticated self-service account deletion')
      expect(response.body).toContain('pseudonymisation')
      expect(response.body).toContain('manual_required')
      expect(response.body).not.toMatch(/everything is permanently deleted|email us to delete/i)
    } finally {
      await app.close()
    }
  })
})
