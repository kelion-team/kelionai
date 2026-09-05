import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const state = vi.hoisted(() => ({
  ok: true,
  body: {} as unknown,
  jsonFails: false,
}))

vi.mock('./lib/transport', () => ({
  apiFetch: vi.fn(async () => ({
    ok: state.ok,
    json: async () => {
      if (state.jsonFails) throw new Error('invalid_json')
      return state.body
    },
  })),
}))

import { apiFetch } from './lib/transport'
import {
  canonicalDisabledGestures,
  fetchDisabledGestures,
  parseDisabledGesturesResponse,
  saveDisabledGesturesCanonical,
  watchDisabledGestures,
} from './lib/gestures'

beforeEach(() => {
  state.ok = true
  state.body = {}
  state.jsonFails = false
  vi.mocked(apiFetch).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('gesture response parsing is strict', () => {
  it('accepts only explicit canonical string arrays', () => {
    expect(parseDisabledGesturesResponse({ disabled: [] })).toEqual([])
    expect(parseDisabledGesturesResponse({ disabled: ['expresie-1', 'dans'] })).toEqual(['expresie-1', 'dans'])
    expect(parseDisabledGesturesResponse({})).toBeNull()
    expect(parseDisabledGesturesResponse({ disabled: null })).toBeNull()
    expect(parseDisabledGesturesResponse({ disabled: ['dans', 7] })).toBeNull()
    expect(parseDisabledGesturesResponse({ disabled: ['dans', 'dans'] })).toBeNull()
    expect(parseDisabledGesturesResponse({ disabled: ['x'.repeat(41)] })).toBeNull()
  })

  it('never turns a failed or malformed 200 GET into an empty success', async () => {
    state.body = {}
    await expect(fetchDisabledGestures()).resolves.toBeNull()
    state.body = { disabled: 'none' }
    await expect(fetchDisabledGestures()).resolves.toBeNull()
    state.body = { disabled: [] }
    await expect(fetchDisabledGestures()).resolves.toEqual([])
    state.ok = false
    await expect(fetchDisabledGestures()).resolves.toBeNull()
    state.ok = true
    state.jsonFails = true
    await expect(fetchDisabledGestures()).resolves.toBeNull()
  })
})

describe('gesture save requires a canonical server echo', () => {
  it('applies a confirmed save immediately and does not let an earlier read restore the old policy', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    let finishOldRead!: (value: Awaited<ReturnType<typeof apiFetch>>) => void
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve }))
    const onChange = vi.fn()
    const stop = watchDisabledGestures(onChange, target)
    state.body = { ok: true, disabled: ['dans'] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toEqual(['dans'])
    expect(onChange).toHaveBeenLastCalledWith(['dans'])
    expect(onChange).toHaveBeenCalledOnce()
    finishOldRead({ ok: true, json: async () => ({ disabled: [] }) } as Response)
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenCalledOnce()
    stop()
    state.body = { ok: true, disabled: [] }
    await saveDisabledGesturesCanonical([])
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('keeps the policy unchanged when a save fails verification', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    state.body = { disabled: [] }
    const onChange = vi.fn()
    const stop = watchDisabledGestures(onChange, target)
    await vi.advanceTimersByTimeAsync(0)
    onChange.mockClear()
    state.body = { ok: true, disabled: [] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })
  it('accepts only ok:true plus the exact persisted canonical list', async () => {
    state.body = { ok: true, disabled: ['dans'] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toEqual(['dans'])

    state.body = { ok: true, disabled: [] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
    state.body = { disabled: ['dans'] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
    state.body = { ok: true, disabled: ['dans', 'dans'] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
    state.ok = false
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
  })

  it('returns the canonical echo for the serialized Admin save path', async () => {
    state.body = { ok: true, disabled: ['dans'] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toEqual(['dans'])
    state.body = { ok: true, disabled: [] }
    await expect(saveDisabledGesturesCanonical(['dans'])).resolves.toBeNull()
  })

  it('sends only the canonical request and verifies that same value', async () => {
    const canonical = canonicalDisabledGestures(['dans', 'dans', 'x'.repeat(41)])
    state.body = { ok: true, disabled: canonical }
    await expect(saveDisabledGesturesCanonical(['dans', 'dans', 'x'.repeat(41)])).resolves.toEqual(canonical)
    const [, init] = vi.mocked(apiFetch).mock.calls.at(-1) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ disabled: canonical })
  })

  it('disables the full avatar catalog when public policy is unavailable', () => {
    const avatar = fs.readFileSync(new URL('./components/AvatarModel.tsx', import.meta.url), 'utf8')
    expect(avatar).toContain('useRef<Set<string>>(new Set(GESTURE_CATALOG.map(({ clip }) => clip)))')
    expect(avatar).toContain('new Set(list ?? GESTURE_CATALOG.map(({ clip }) => clip))')
  })

  it('serializes Admin toggles and refetches truth after an ambiguous failure', () => {
    const panel = fs.readFileSync(new URL('./components/admin/AdminUtilizatori.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('gestSavePendingRef.current) return')
    expect(panel).toContain('const persisted = await saveDisabledGesturesCanonical(next)')
    expect(panel).toContain('setGestOff(await fetchDisabledGestures())')
    expect(panel).toContain('disabled={!gestOffData || gestSaving}')
    expect(panel).not.toContain('setGestOff(inainte)')
  })
})
