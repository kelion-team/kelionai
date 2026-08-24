import { afterEach, describe, expect, it, vi } from 'vitest'
import { shutdownDeactivatedRelease } from './releaseActivation.js'

describe('shutdownDeactivatedRelease', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('închide serverul și termină procesul cu succes', async () => {
    vi.useFakeTimers()
    const close = vi.fn(async () => undefined)
    const exit = vi.fn()

    shutdownDeactivatedRelease(close, exit)
    await vi.advanceTimersByTimeAsync(0)

    expect(close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('forțează ieșirea dacă închiderea serverului rămâne blocată', () => {
    vi.useFakeTimers()
    const close = vi.fn(() => new Promise(() => undefined))
    const exit = vi.fn()

    shutdownDeactivatedRelease(close, exit)
    vi.advanceTimersByTime(10_000)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('iese și când închiderea serverului eșuează', async () => {
    vi.useFakeTimers()
    const close = vi.fn(async () => { throw new Error('close failed') })
    const exit = vi.fn()

    shutdownDeactivatedRelease(close, exit)
    await vi.advanceTimersByTimeAsync(0)

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })
})
