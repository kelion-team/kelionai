import { describe, it, expect, vi } from 'vitest'

// Image generation runs on the owner's Gemini key now (services/geminiDirect.ts
// geminiImage), OpenRouter removed. The cost must still travel WITH the image:
// these tests pin down that generateImage forwards the generator's result
// faithfully — the bytes get stored, the mime and costUsd are passed through,
// and an error propagates as-is without an invented cost.
const geminiImage = vi.fn()
vi.mock('./geminiDirect.js', () => ({ geminiImage }))
vi.mock('../db.js', () => ({
  saveGeneratedImage: vi.fn(async () => {}),
  loadGeneratedImage: vi.fn(async () => null),
}))

const { generateImage } = await import('./image.js')

describe('image.ts — rezultatul generării ajunge la apelant', () => {
  it('costUsd din răspunsul generatorului NU se mai pierde', async () => {
    // Non-zero on purpose: proves generateImage forwards whatever cost the
    // generator reports (it used to drop it, and the route charged a flat rate).
    geminiImage.mockResolvedValue({
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

  it('generatorul NU raportează cost → costUsd 0, iar apelantul cade pe estimare etichetată', async () => {
    geminiImage.mockResolvedValue({ mime: 'image/png', buf: Buffer.from('x'), costUsd: 0 })
    const r = await generateImage('o pisică')
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.costUsd).toBe(0)
  })

  it('eroarea generatorului se propagă ca atare, fără cost inventat', async () => {
    geminiImage.mockResolvedValue({ error: 'image_not_configured' })
    const r = await generateImage('ceva')
    expect(r).toEqual({ error: 'image_not_configured' })
  })
})
