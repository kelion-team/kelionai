import { afterEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { fetchRuntimeVersion, formatLondonTimestamp, installedBuildLabel, parseRuntimeVersion, runtimeVersionLabel } from './lib/versionEvidence'

afterEach(() => { request.mockReset(); vi.useRealTimers() })

describe('London timestamps identify the actual event without local-zone or now fallbacks', () => {
  it('uses BST in summer and GMT in winter', () => {
    expect(formatLondonTimestamp('2026-09-05T05:54:00.000Z')).toBe('2026-09-05 06:54 BST (London)')
    expect(formatLondonTimestamp('2026-01-05T05:54:00.000Z')).toBe('2026-01-05 05:54 GMT (London)')
  })
  it('follows both exact DST transitions without a hardcoded one-hour offset', () => {
    expect(formatLondonTimestamp('2026-03-29T00:59:00Z')).toBe('2026-03-29 00:59 GMT (London)')
    expect(formatLondonTimestamp('2026-03-29T01:00:00Z')).toBe('2026-03-29 02:00 BST (London)')
    expect(formatLondonTimestamp('2026-10-25T00:59:00Z')).toBe('2026-10-25 01:59 BST (London)')
    expect(formatLondonTimestamp('2026-10-25T01:00:00Z')).toBe('2026-10-25 01:00 GMT (London)')
  })
  it('rejects null, invalid calendar values and ambiguous local timestamps', () => {
    for (const invalid of [null, undefined, '', 'invalid', 0, '2026-09-05 05:54', '2026-09-05T05:54:00', '2026-02-30T05:54:00Z', '2026-13-05T05:54:00Z', '2026-09-05T24:00:00Z']) {
      expect(formatLondonTimestamp(invalid)).toBeNull()
    }
  })
  it('keeps installed product version/build distinct from server process boot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
    expect(installedBuildLabel('1.0.0', '2026-09-05T05:54:00Z')).toBe('UI V1.0.0 · build 2026-09-05 06:54 BST (London)')
    expect(installedBuildLabel(null, null)).toBe('UI versiune necunoscută · build necunoscut')
    expect(runtimeVersionLabel(null)).toBe('Server commit necunoscut · pornire necunoscută')
    expect(runtimeVersionLabel({ commit: 'e65f011', startedAt: '2026-09-05T06:05:00Z' })).toBe('Server e65f011 · pornire 2026-09-05 07:05 BST (London)')
  })
})

describe('runtime version uses only the canonical read-only API evidence', () => {
  it('validates SHA and never calls a timestamp version fallback a commit', () => {
    const at = '2026-09-05T06:05:00.000Z'
    expect(parseRuntimeVersion({ v: 'e65f011', ver: 'e65f011', at })).toEqual({ commit: 'e65f011', startedAt: at })
    expect(parseRuntimeVersion({ v: at, ver: at, at })).toEqual({ commit: null, startedAt: at })
    expect(parseRuntimeVersion({ v: 'a'.repeat(40), at: null })).toEqual({ commit: 'a'.repeat(40), startedAt: null })
    expect(parseRuntimeVersion({ v: 'e65f011', ver: 'b'.repeat(7), at: null })).toBeNull()
    for (const invalid of [null, [], {}, { v: 'latest', at: 'now' }]) expect(parseRuntimeVersion(invalid)).toBeNull()
  })
  it('reads no-store without changing application or deployment state', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValue(new Response(JSON.stringify({ v: 'e65f011', at: '2026-09-05T06:05:00Z' })))
    await expect(fetchRuntimeVersion(signal)).resolves.toEqual({ commit: 'e65f011', startedAt: '2026-09-05T06:05:00Z' })
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/version', { signal, cache: 'no-store' })
  })
  it('returns unknown on failed reads, malformed payloads and absent evidence', async () => {
    const signal = new AbortController().signal
    for (const response of [new Response('null'), new Response('{}'), new Response('invalid'), new Response('{}', { status: 503 })]) {
      request.mockResolvedValueOnce(response)
      await expect(fetchRuntimeVersion(signal)).resolves.toBeNull()
    }
    request.mockRejectedValueOnce(new Error('offline'))
    await expect(fetchRuntimeVersion(signal)).resolves.toBeNull()
  })
})
