import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callBrowserWorker } = vi.hoisted(() => ({ callBrowserWorker: vi.fn() }))
vi.mock('./services/browserWorker.js', () => ({ callBrowserWorker }))
vi.mock('./config.js', () => ({
  config: {
    sessionSecret: 's'.repeat(32),
    publicOrigin: 'https://app.example',
  },
}))

const {
  browserOpen,
  browserType,
  browserClose,
  getShot,
} = await import('./services/browser.js')

const snapshot = (screenshotBase64 = '') => ({
  ok: true,
  snapshot: {
    url: 'https://public.example/',
    title: 'Public',
    text: 'Visible text',
    elements: [{ index: 0, tag: 'input', label: 'Value', href: '' }],
    screenshotBase64,
  },
})

describe('browser worker boundary', () => {
  beforeEach(() => callBrowserWorker.mockReset())

  it('stores only a validated JPEG and binds its monitor URL to the owner', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]).toString('base64')
    callBrowserWorker.mockResolvedValue(snapshot(jpeg))
    const result = await browserOpen('owner@example.invalid', 'https://ignored.example', 'https://public.example/')
    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error(result.error)
    expect(result.shotUrl).toMatch(/^https:\/\/app\.example\/api\/browser\/shot\/[0-9a-f-]+$/)
    const id = result.shotUrl.split('/').at(-1) as string
    expect(getShot(id, 'owner@example.invalid')?.buf.equals(Buffer.from(jpeg, 'base64'))).toBe(true)
    expect(getShot(id, 'other@example.invalid')).toBeNull()
    expect(callBrowserWorker).toHaveBeenCalledWith('/v1/browser/action', expect.objectContaining({
      sessionId: expect.stringMatching(/^[A-Za-z0-9_-]{32,128}$/),
      discreet: false,
      action: { type: 'open', url: 'https://public.example/' },
    }))
  })

  it('keeps screenshots off after sensitive digits are typed', async () => {
    callBrowserWorker.mockResolvedValue(snapshot())
    await browserOpen('private@example.invalid', '', 'https://public.example/')
    await browserType('private@example.invalid', '', 0, '4111 1111 1111 1111', false)
    expect(callBrowserWorker).toHaveBeenLastCalledWith('/v1/browser/action', expect.objectContaining({
      discreet: true,
      action: expect.objectContaining({ type: 'type' }),
    }))
  })

  it('requires a worker receipt before reporting a close', () => {
    const source = browserClose.toString()
    expect(source).toContain('await')
    expect(source).toContain('return { closed: true }')
    expect(source).toContain('return { error: workerError(error) }')
  })
})
