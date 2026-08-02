import { describe, it, expect, vi } from 'vitest'

// The image cost must travel WITH the image: openrouterImage already returns
// the REAL usage.cost — the test pins down that generateImage no longer drops
// it on the floor (it used to, and the chat route charged a hand-typed $0.04
// flat rate instead of the measured figure).
const openrouterImage = vi.fn()
vi.mock('./openrouter.js', () => ({ openrouterImage }))
vi.mock('../db.js', () => ({
  saveGeneratedImage: vi.fn(async () => {}),
  loadGeneratedImage: vi.fn(async () => null),
}))

const { generateImage } = await import('./image.js')

describe('image.ts — costul REAL al generării ajunge la apelant', () => {
  it('costUsd din răspunsul OpenRouter NU se mai pierde', async () => {
    openrouterImage.mockResolvedValue({
      mime: 'image/png',
      buf: Buffer.from('fakepng'),
      costUsd: 0.0123,
    })
    const r = await generateImage('un castel pe un deal')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.costUsd).toBeCloseTo(0.0123, 9)
      expect(r.id).toBeTruthy()
      expect(r.mime).toBe('image/png')
    }
  })

  it('providerul NU detaliază costul → costUsd 0, iar apelantul cade pe estimare etichetată', async () => {
    openrouterImage.mockResolvedValue({ mime: 'image/png', buf: Buffer.from('x'), costUsd: 0 })
    const r = await generateImage('o pisică')
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.costUsd).toBe(0)
  })

  it('eroarea providerului se propagă ca atare, fără cost inventat', async () => {
    openrouterImage.mockResolvedValue({ error: 'image_http_429' })
    const r = await generateImage('ceva')
    expect(r).toEqual({ error: 'image_http_429' })
  })
})
