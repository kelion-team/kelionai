import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraActivationAllowed, cameraImageRequested } from './lib/cameraConsent'
import {
  asteaptaDeschidereaSocket,
  golesteSurseAudio,
  instantaneeInputImage,
  poateTrimiteLive,
  vocalLiveStateForServerEvent,
} from './lib/vocalLive'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OpenAI Realtime media behavior', () => {
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
})
