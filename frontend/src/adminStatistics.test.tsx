import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { fetchVisitorStats, parseVisitorStats, startStatisticsPeriod, statisticsPeriodLabel } from './lib/adminStatistics'
import { VisitorStatsReport } from './components/admin/AdminVizitatori'
const stats = { visitsTotal: 12, visitsToday: 3, byCountry: [{ code: 'GB', count: 8 }], statsSince: null }
afterEach(() => request.mockReset())

describe('aggregate visitor statistics and nondestructive period', () => {
  it('projects only aggregate counters, with unknown country allowed, never private raw fields', () => {
    expect(parseVisitorStats({ ...stats, recent: [{ ip: 'private', path: 'private' }], secret: 'private' })).toEqual(stats)
    const html = renderToStaticMarkup(<VisitorStatsReport stats={stats} />)
    expect(html).toContain('Vizite în perioada internă')
    expect(html).toContain('nu persoane unice')
    expect(html).not.toContain('private')
  })
  it('rejects missing, impossible and unmeasured counters instead of zeroing them', () => {
    for (const value of [null, {}, { ...stats, statsSince: undefined }, { ...stats, visitsToday: 13 }, { ...stats, visitsTotal: -1 },
      { ...stats, byCountry: [{ code: 'GB', count: 8 }, { code: 'GB', count: 2 }] }, { ...stats, byCountry: [{ code: 'GB', count: 13 }] }]) {
      expect(parseVisitorStats(value)).toBeNull()
    }
    expect(parseVisitorStats({ visitsTotal: 0, visitsToday: 0, byCountry: [], statsSince: null })).not.toBeNull()
  })
  it('distinguishes DB/network failures from a successfully read zero', async () => {
    request.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(fetchVisitorStats()).resolves.toBeNull()
    request.mockRejectedValueOnce(new Error('offline'))
    await expect(fetchVisitorStats()).resolves.toBeNull()
    request.mockResolvedValueOnce(new Response(JSON.stringify(stats)))
    await expect(fetchVisitorStats()).resolves.toEqual(stats)
    expect(request).toHaveBeenLastCalledWith('/api/admin/demos', expect.objectContaining({ cache: 'no-store' }))
  })
  it('requires a nondestructive exact ACK and the server period timestamp', async () => {
    const statsSince = '2026-09-05T08:00:00.000Z'
    for (const body of [{ ok: true, sterse: 3, statsSince }, { ok: true, sterse: 0 }, { ok: false, sterse: 0, statsSince }, { ok: true, sterse: 0, statsSince: 'bad' }]) {
      request.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await expect(startStatisticsPeriod()).resolves.toBeNull()
    }
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sterse: 0, statsSince })))
    await expect(startStatisticsPeriod()).resolves.toBe(statsSince)
  })
  it('labels London instants, all-time and unknown separately and keeps the new action nondestructive', () => {
    expect(statisticsPeriodLabel(null)).toContain('tot istoricul')
    expect(statisticsPeriodLabel(undefined)).toContain('nu poate fi verificat')
    expect(statisticsPeriodLabel('2026-09-05T08:00:00Z')).toContain('09:00 BST')
    const source = readFileSync(new URL('./components/admin/AdminBani.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Începe perioadă nouă')
    expect(source).not.toContain('înregistrări șterse)')
    expect(source).not.toContain('Pune pe 0')
    expect(source).toContain('Costurile furnizorilor nu se resetează')
  })
})
