import { afterEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { compareReleaseVersions, fetchReleaseVersions, fetchRuntimeVersion, formatLondonTimestamp, installedBuildLabel, parseReleaseCommit, parseRuntimeVersion, releaseComparisonLabel, runtimeVersionLabel } from './lib/versionEvidence'

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
    expect(installedBuildLabel('1.0.0', '2026-09-05T05:54:00Z','a'.repeat(40))).toBe('UI V1.0.0 · commit aaaaaaa · build 2026-09-05 06:54 BST (London)')
    expect(installedBuildLabel(null, null)).toBe('UI versiune necunoscută · commit necunoscut · build necunoscut')
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

describe('loaded UI, runtime and active release compare exact full commits', () => {
  const sha = 'abcdef0'+'1'.repeat(33)
  const collision = 'abcdef0'+'2'.repeat(33)
  const runtime = { commit:sha,startedAt:'2026-09-05T06:05:00Z' }
  const proof = { ready:true,candidate:false,sideEffectsActive:true,activeCommit:sha }
  it('accepts only active, ready full-SHA proof and rejects contradictory nested state', () => {
    expect(parseReleaseCommit(proof)).toBe(sha)
    for (const invalid of [null,{}, { ...proof,activeCommit:sha.slice(0,7) },{ ...proof,ready:false },
      { ...proof,candidate:true },{ ...proof,sideEffectsActive:false },{ ...proof,release:{ candidate:true,sideEffectsActive:true } }]) {
      expect(parseReleaseCommit(invalid)).toBeNull()
    }
  })
  it('distinguishes exact agreement, changed UI and runtime mismatch without prefix equivalence', () => {
    expect(compareReleaseVersions(sha,runtime,sha,sha).state).toBe('synced')
    expect(compareReleaseVersions(collision,runtime,sha,sha).state).toBe('ui_different')
    expect(compareReleaseVersions(sha,{ ...runtime,commit:collision },sha,sha).state).toBe('runtime_mismatch')
    expect(releaseComparisonLabel(compareReleaseVersions(sha,runtime,sha,sha))).toContain('SHA complet verificat')
    for (const ui of [null,'unknown',sha.slice(0,7)]) expect(compareReleaseVersions(ui,runtime,sha,sha).state).toBe('unverified')
    expect(compareReleaseVersions(sha,{ ...runtime,commit:sha.slice(0,7) },sha,sha).state).toBe('unverified')
  })
  it('never combines reads from different deployments into a green verdict', () => {
    for (const after of [null,collision]) {
      expect(compareReleaseVersions(sha,runtime,sha,after)).toMatchObject({ state:'unverified',liveCommit:null })
    }
    expect(compareReleaseVersions(sha,null,sha,sha).state).toBe('unverified')
  })
  it('uses the new full commit only when it agrees with legacy version fields', () => {
    expect(parseRuntimeVersion({ v:sha.slice(0,7),ver:sha.slice(0,7),commit:sha,at:runtime.startedAt })).toEqual(runtime)
    expect(parseRuntimeVersion({ v:'9999999',commit:sha,at:runtime.startedAt })).toEqual({ commit:null,startedAt:runtime.startedAt })
    expect(parseRuntimeVersion({ v:sha.slice(0,7),commit:'invalid' })).toBeNull()
  })
  it('brackets the runtime call with no-store public proofs and handles cutover/failure as unknown', async () => {
    const signal = new AbortController().signal
    const version = { v:sha.slice(0,7),ver:sha.slice(0,7),commit:sha,at:runtime.startedAt }
    for (const finalProof of [proof,{ ...proof,activeCommit:collision },null]) {
      request.mockResolvedValueOnce(new Response(JSON.stringify(proof)))
        .mockResolvedValueOnce(new Response(JSON.stringify(version)))
        .mockResolvedValueOnce(new Response(JSON.stringify(finalProof)))
      const result = await fetchReleaseVersions(sha,signal)
      expect(result.state).toBe(finalProof === proof ? 'synced' : 'unverified')
    }
    expect(request.mock.calls.slice(0,3)).toEqual([
      ['/api/release-proof',{ signal,cache:'no-store' }],['/api/version',{ signal,cache:'no-store' }],['/api/release-proof',{ signal,cache:'no-store' }],
    ])
    request.mockRejectedValue(new Error('offline'))
    expect(await fetchReleaseVersions(sha,signal)).toEqual({ runtime:null,liveCommit:null,state:'unverified' })
  })
})
