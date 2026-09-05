import { describe, expect, it, vi } from 'vitest'
vi.mock('../config.js', () => ({ config: { publicOrigin: 'https://app.example.test', httpUserAgent: 'test' } }))
import { createStorePresenceReader } from './storePresence.js'
const target = { key: 'example', name: 'Example', store: 'Store', url: 'https://store.example.test/app' }
describe('store presence keeps failed measurement distinct from delisting', () => {
  it.each([[200, true, null], [404, false, null], [410, false, null], [403, null, 'http_403'], [429, null, 'http_429'], [500, null, 'http_500']])('classifies HTTP %i', async (status, listed, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: Number(status) }))
    const read = createStorePresenceReader([target], fetcher, () => Date.parse('2026-09-05T08:00:00Z'))
    await expect(read()).resolves.toEqual([{ ...target, listed, reason, checkedAt: '2026-09-05T08:00:00.000Z' }])
  })
  it('keeps timeout/network error unknown and never leaks exception data', async () => {
    const read = createStorePresenceReader([target], vi.fn<typeof fetch>().mockRejectedValue(new Error('private-network-detail')))
    expect((await read())[0]).toMatchObject({ listed: null, reason: 'transport_unavailable' })
    expect(JSON.stringify(await read())).not.toContain('private-network-detail')
  })
  it('preserves measurement time during cache and remeasures after five minutes', async () => {
    let now = Date.parse('2026-09-05T08:00:00Z')
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 200 }))
    const read = createStorePresenceReader([target], fetcher, () => now)
    const first = await read()
    now += 60_000
    expect(await read()).toEqual(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 5 * 60_000
    expect((await read())[0].checkedAt).not.toEqual(first[0].checkedAt)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
