import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { dezactiveazaPush } from './lib/pushTelefon'

const unsubscribe = vi.fn()
const getSubscription = vi.fn()
const subscription = { endpoint: 'https://push.example.test/subscription', unsubscribe }
beforeEach(() => {
  request.mockReset(); unsubscribe.mockReset(); getSubscription.mockReset()
  getSubscription.mockResolvedValue(subscription)
  vi.stubGlobal('window', { PushManager: class {}, Notification: class {} })
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription } }) } })
})
afterEach(() => vi.unstubAllGlobals())

describe('push revocation requires both server ACK and browser state', () => {
  it.each([503, 200])('does not unsubscribe locally or claim success when the server rejects (%i)', async (status) => {
    request.mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status }))
    await expect(dezactiveazaPush()).rejects.toThrow('nu a fost confirmată de server')
    expect(unsubscribe).not.toHaveBeenCalled()
  })
  it('keeps the endpoint available for retry after network failure', async () => {
    request.mockRejectedValueOnce(new Error('offline'))
    await expect(dezactiveazaPush()).rejects.toThrow('păstrată')
    expect(unsubscribe).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    unsubscribe.mockResolvedValueOnce(true)
    getSubscription.mockResolvedValueOnce(subscription).mockResolvedValueOnce(null)
    await expect(dezactiveazaPush()).resolves.toBe('inactiv')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each([false, true])('does not infer browser removal from unsubscribe=%s when it is still subscribed', async (result) => {
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    unsubscribe.mockResolvedValue(result)
    await expect(dezactiveazaPush()).rejects.toThrow('browserul nu a confirmat')
  })
  it('accepts a verified absence even when unsubscribe says already removed', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    getSubscription.mockResolvedValueOnce(subscription).mockResolvedValueOnce(null)
    unsubscribe.mockResolvedValue(false)
    await expect(dezactiveazaPush()).resolves.toBe('inactiv')
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0])
  })
  it('does not mutate or request permission when no subscription exists', async () => {
    getSubscription.mockResolvedValue(null)
    await expect(dezactiveazaPush()).resolves.toBe('inactiv')
    expect(request).not.toHaveBeenCalled()
  })
})
