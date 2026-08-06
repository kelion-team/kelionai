import { describe, it, expect } from 'vitest'
import { buildPromo } from './promo.js'
import { CAPABILITIES } from './brainCapabilities.js'

describe('prepare_promo_clip capability & service', () => {
  it('has voiceViaBrain enabled for prepare_promo_clip capability (One-Brain architecture)', () => {
    const cap = CAPABILITIES.find((c) => c.name === 'prepare_promo_clip')
    expect(cap).toBeDefined()
    expect(cap?.voice).toBe(false)
    expect(cap?.voiceViaBrain).toBe(true)
  })

  it('builds promo correctly for valid input', async () => {
    const result = await buildPromo({
      subject: 'Test Promo',
      script: 'Acesta este un script de test',
      duration_seconds: 15,
      scenes: [{ at_seconds: 0, title: 'Intro' }],
    })
    expect('promo' in result).toBe(true)
    if ('promo' in result) {
      expect(result.promo.subject).toBe('Test Promo')
      expect(result.promo.duration).toBe(15)
      expect(result.promo.scenes).toHaveLength(1)
    }
  })

  it('returns missing_params error when subject or script is missing', async () => {
    const result = await buildPromo({
      subject: '',
      script: 'Script fara subiect',
    })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('missing_params')
    }
  })

  it('validates image scene url prefix', async () => {
    const result = await buildPromo({
      subject: 'Test Image Promo',
      script: 'Script',
      scenes: [{ kind: 'image', url: 'https://external.com/image.png' }],
    })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('image_scene_needs_api_image_url')
    }
  })
})
