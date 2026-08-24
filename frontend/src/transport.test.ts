import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, apiUrl, authUrl, wsUrl } from './lib/transport'

afterEach(() => vi.unstubAllGlobals())

describe('transport origin helpers', () => {
  it('preserves current same-origin behavior without runtime configuration', () => {
    expect(apiUrl('/api/health', null)).toBe('/api/health')
    expect(authUrl('/auth/me', null)).toBe('/auth/me')
  })

  it('routes HTTP, auth, SSE and WebSocket endpoints through one configured origin', () => {
    const origin = 'https://kelionai.app'
    expect(apiUrl('/api/health', origin)).toBe('https://kelionai.app/api/health')
    expect(authUrl('/auth/me', origin)).toBe('https://kelionai.app/auth/me')
    expect(wsUrl('/api/vocal-live', origin)).toBe('wss://kelionai.app/api/vocal-live')
  })

  it('rejects non-absolute API paths when an origin is configured', () => {
    expect(() => apiUrl('api/health', 'https://kelionai.app')).toThrow(/absolute/)
  })

  it('rejects protocol-relative, backslash and credential-bearing escape paths', () => {
    expect(() => apiUrl('//evil.test/collect', 'https://kelionai.app')).toThrow(/absolute/)
    expect(() => apiUrl('/\\evil.test/collect', 'https://kelionai.app')).toThrow(/origin/)
    expect(() => apiUrl('https://user:secret@kelionai.app/api/health', 'https://kelionai.app')).toThrow(/origin/)
  })

  it('rejects absolute URLs outside the configured API origin', () => {
    expect(() => apiUrl('https://evil.test/collect', 'https://kelionai.app')).toThrow(/not allowed/)
    expect(apiUrl('https://kelionai.app/api/health', 'https://kelionai.app')).toBe(
      'https://kelionai.app/api/health',
    )
  })

  it('rejects WebSocket origins outside the configured API origin', () => {
    expect(() => wsUrl('wss://evil.test/api/vocal-live', 'https://kelionai.app')).toThrow(/not allowed/)
    expect(wsUrl('wss://kelionai.app/api/vocal-live', 'https://kelionai.app')).toBe(
      'wss://kelionai.app/api/vocal-live',
    )
  })

  it('includes session credentials by default while respecting an explicit override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/health')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/health', { credentials: 'include' })
    await apiFetch('/api/public', { credentials: 'omit' })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public', { credentials: 'omit' })
  })

})
