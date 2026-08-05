import { describe, expect, it, vi } from 'vitest'
import { buildPromo } from './promo.js'

describe('promo module', () => {
  it('returns missing_params if subject or script is missing', async () => {
    const res1 = await buildPromo({ script: 'hello' })
    expect(res1).toEqual({ error: 'missing_params' })

    const res2 = await buildPromo({ subject: 'test' })
    expect(res2).toEqual({ error: 'missing_params' })
  })

  it('rejects image scene without /api/image/ url', async () => {
    const res = await buildPromo({
      subject: 'Test',
      script: 'Script',
      scenes: [{ kind: 'image', url: 'https://external.com/pic.png' }],
    })
    expect(res).toEqual({ error: 'image_scene_needs_api_image_url' })
  })

  it('builds valid promo payload with client-ready scene shapes', async () => {
    const res = await buildPromo({
      subject: 'Cluj Napoca',
      duration_seconds: 15,
      script: 'Promo script for Cluj',
      lang: 'ro-RO',
      scenes: [
        { kind: 'image', url: '/api/image/123.png', at_seconds: 5, title: 'Image' },
        { kind: 'avatar', at_seconds: 10 },
      ],
    })

    expect('promo' in res).toBe(true)
    if ('promo' in res) {
      expect(res.promo.subject).toBe('Cluj Napoca')
      expect(res.promo.duration).toBe(15)
      expect(res.promo.script).toBe('Promo script for Cluj')
      expect(res.promo.lang).toBe('ro-RO')
      expect(res.promo.scenes.length).toBe(2)
      expect(res.promo.scenes[0]).toEqual({
        at: 5,
        title: 'Image',
        url: '/api/image/123.png',
      })
      expect(res.promo.scenes[1]).toEqual({
        at: 10,
        title: 'Cluj Napoca',
        close: true,
      })
    }
  })
})
