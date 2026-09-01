import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activationMarkerMatches,
  isActiveReleaseState,
  isReleaseProofReady,
  releaseRuntimeState,
  shutdownDeactivatedRelease,
} from './releaseActivation.js'

describe('release runtime state', () => {
  it('activează numai markerul release-ului exact', () => {
    const releaseId = 'a'.repeat(40)

    expect(activationMarkerMatches(releaseId, `${releaseId}\n`)).toBe(true)
    expect(activationMarkerMatches(releaseId, 'b'.repeat(40))).toBe(false)
    expect(activationMarkerMatches('', '')).toBe(false)
  })

  it('rămâne candidat inactiv înaintea markerului exact', () => {
    expect(releaseRuntimeState(false)).toEqual({
      candidate: true,
      sideEffectsActive: false,
    })
  })

  it('devine release activ, nu candidat, după markerul exact', () => {
    const state = releaseRuntimeState(true)

    expect(state).toEqual({ candidate: false, sideEffectsActive: true })
    expect(isActiveReleaseState(state)).toBe(true)
  })

  it('refuză drept release activ orice combinație parțială sau contradictorie', () => {
    expect(isActiveReleaseState({ candidate: true, sideEffectsActive: false })).toBe(false)
    expect(isActiveReleaseState({ candidate: true, sideEffectsActive: true })).toBe(false)
    expect(isActiveReleaseState({ candidate: false, sideEffectsActive: false })).toBe(false)
  })

  it('permite release-proof numai pentru readiness activ și commit complet valid', () => {
    const active = { candidate: false, sideEffectsActive: true }

    expect(isReleaseProofReady(true, active, 'a'.repeat(40))).toBe(true)
    expect(isReleaseProofReady(false, active, 'a'.repeat(40))).toBe(false)
    expect(isReleaseProofReady(true, { candidate: true, sideEffectsActive: true }, 'a'.repeat(40))).toBe(false)
    expect(isReleaseProofReady(true, active, 'a'.repeat(39))).toBe(false)
    expect(isReleaseProofReady(true, active, 'g'.repeat(40))).toBe(false)
  })
})

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
