import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cameraActivationAllowed, cameraImageRequested } from './lib/cameraConsent'
import {
  asteaptaDeschidereaSocket,
  deschideVocalLive,
  golesteSurseAudio,
  instantaneeInputImage,
  poateTrimiteLive,
  vocalLiveDisponibila,
  vocalLiveStateForServerEvent,
} from './lib/vocalLive'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpenAI Realtime media behavior', () => {
  it('ține aceeași limită de retry după ready și invalidează pornirile stale înainte de await', () => {
    const source = readFileSync(fileURLToPath(new URL('./components/ChatPanel.tsx', import.meta.url)), 'utf8')
    const ensureStart = source.indexOf('async function ensureMic()')
    const ensureEnd = source.indexOf('const ensureMicRef', ensureStart)
    const ensure = source.slice(ensureStart, ensureEnd)
    expect(ensureStart).toBeGreaterThan(0)
    expect(ensure.indexOf('const generatie = ++vlGeneratieRef.current')).toBeLessThan(
      ensure.indexOf('await vocalLiveDisponibila()'),
    )
    expect(ensure).toContain('signal: startController.signal')
    expect(ensure).toContain('startController.signal.aborted')
    expect(ensure).toMatch(/finally\s*\{[\s\S]*generatie === vlGeneratieRef\.current[\s\S]*micStartControllerRef\.current === startController/)

    const readyStart = ensure.indexOf('onGata: () =>')
    const readyEnd = ensure.indexOf('onUser:', readyStart)
    const ready = ensure.slice(readyStart, readyEnd)
    expect(ready).not.toContain('micRetryAttemptsRef.current = 0')
    expect(ready).not.toContain('micRetryStoppedAckedRef.current = false')
  })

  it('nu pornește nicio resursă pentru o tentativă deja anulată', async () => {
    const controller = new AbortController()
    controller.abort()
    const onEroare = vi.fn()
    await expect(deschideVocalLive({
      signal: controller.signal,
      onEroare,
    })).resolves.toBeNull()
    expect(onEroare).not.toHaveBeenCalled()
  })

  it('barge-in oprește fiecare sursă și golește coada chiar dacă una era deja terminată', () => {
    const first = { stop: vi.fn() }
    const ended = { stop: vi.fn(() => { throw new DOMException('ended') }) }
    const last = { stop: vi.fn() }

    const queue = golesteSurseAudio([first, ended, last])

    expect(queue).toEqual([])
    expect(first.stop).toHaveBeenCalledOnce()
    expect(ended.stop).toHaveBeenCalledOnce()
    expect(last.stop).toHaveBeenCalledOnce()
  })

  it('limitează backpressure-ul în loc să crească nelimitat coada audio', () => {
    expect(poateTrimiteLive(0)).toBe(true)
    expect(poateTrimiteLive(512 * 1024)).toBe(true)
    expect(poateTrimiteLive(512 * 1024 + 1)).toBe(false)
    expect(poateTrimiteLive(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('deschiderea socketului curăță timeoutul; abortul ignoră un open întârziat', async () => {
    vi.useFakeTimers()
    const opened = vi.fn()
    const socket = { onopen: null } as Pick<WebSocket, 'onopen'>
    const controller = new AbortController()
    const waiting = asteaptaDeschidereaSocket(socket, opened, controller.signal, 100)
    socket.onopen?.(new Event('open'))
    await expect(waiting).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    expect(opened).toHaveBeenCalledOnce()

    const lateOpen = vi.fn()
    const lateSocket = { onopen: null } as Pick<WebSocket, 'onopen'>
    const lateController = new AbortController()
    const cancelled = asteaptaDeschidereaSocket(lateSocket, lateOpen, lateController.signal, 100)
    lateController.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    lateSocket.onopen?.(new Event('open'))
    expect(lateOpen).not.toHaveBeenCalled()
  })

  it('raportează timeout când socketul nu se deschide', async () => {
    vi.useFakeTimers()
    const socket = { onopen: null } as Pick<WebSocket, 'onopen'>
    const waiting = asteaptaDeschidereaSocket(socket, vi.fn(), new AbortController().signal, 100)
    const assertion = expect(waiting).rejects.toThrow('timeout la deschiderea sesiunii')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('trimite cel mult un `input_image` valid și numai la cerere explicită', () => {
    const valid = 'data:image/jpeg;base64,AA=='
    expect(instantaneeInputImage(undefined)).toEqual([])
    expect(instantaneeInputImage(['https://example.test/camera.jpg'])).toEqual([])
    expect(instantaneeInputImage([valid, 'data:image/png;base64,AA=='])).toEqual([valid])
    expect(cameraImageRequested('Salut, cum ești?')).toBe(false)
    expect(cameraImageRequested('Uită-te la cameră și spune-mi ce vezi.')).toBe(true)
  })

  it('camera nu pornește fără consimțământ și nu cere din nou cât este deja activă', () => {
    const denied = vi.fn(() => false)
    expect(cameraActivationAllowed(false, denied)).toBe(false)
    expect(denied).toHaveBeenCalledOnce()

    const unnecessary = vi.fn(() => false)
    expect(cameraActivationAllowed(true, unnecessary)).toBe(true)
    expect(unnecessary).not.toHaveBeenCalled()
  })

  it('expune stările Live pentru ascultare, gândire, vorbire și barge-in', async () => {
    vi.useFakeTimers()
    let state = vocalLiveStateForServerEvent('gata')
    expect(state).toBe('listening')

    await vi.advanceTimersByTimeAsync(20_000)
    expect(state).toBe('listening')

    state = vocalLiveStateForServerEvent('user', true)
    expect(state).toBe('thinking')
    state = vocalLiveStateForServerEvent('audio')
    expect(state).toBe('speaking')
    state = vocalLiveStateForServerEvent('intrerupt')
    expect(state).toBe('interrupted')
    state = vocalLiveStateForServerEvent('tura_gata')
    expect(state).toBe('listening')
  })

  it('păstrează verdictul capability pentru 401/429/5xx fără body liber', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const [status, code, retryable] of [
      [401, 'unauthorized', false],
      [403, 'unauthorized', false],
      [429, 'rate_limit', true],
      [503, 'transport', true],
    ] as const) {
      fetchMock.mockResolvedValueOnce(new Response('provider body must stay ignored', { status }))
      await expect(vocalLiveDisponibila()).resolves.toMatchObject({
        disponibil: false,
        code,
        retryable,
      })
    }

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      disponibil: false,
      model: 'gpt-realtime',
      voce: 'cedar',
      code: 'invalid_key',
      retryable: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(vocalLiveDisponibila()).resolves.toMatchObject({
      disponibil: false,
      code: 'invalid_key',
      retryable: false,
    })
  })
})
