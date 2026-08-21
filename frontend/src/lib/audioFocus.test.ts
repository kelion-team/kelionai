import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./audioIO', () => {
  let playing = false
  return {
    isVoicePlaying: () => playing,
    stopVoice: () => {
      playing = false
    },
    __setPlaying: (v: boolean) => {
      playing = v
    },
  }
})

// VOCE SCOASĂ (21 aug clean-slate): requestTtsFocus/releaseTtsFocus au dispărut
// odată cu vocea de pe frontend, deci cazurile lor au fost eliminate. Rămân testate
// comportamentele PĂSTRATE: zăvorul cross-tab (setForeignVoiceLock/isForeignVoiceLocked)
// și interruptAll (taie orice redare — ex. naratorul), inclusiv tăierea sesiunii LIVE.
import {
  registerLiveFocus,
  unregisterLiveFocus,
  setForeignVoiceLock,
  isForeignVoiceLocked,
  interruptAll,
} from './audioFocus'
import * as audioIO from './audioIO'

const setPlaying = (audioIO as unknown as { __setPlaying: (v: boolean) => void }).__setPlaying
const isPlaying = (audioIO as unknown as { isVoicePlaying: () => boolean }).isVoicePlaying

describe('audioFocus single-voice lock', () => {
  beforeEach(() => {
    setForeignVoiceLock(false)
    unregisterLiveFocus()
    setPlaying(false)
    interruptAll('test-reset')
    setForeignVoiceLock(false)
  })

  it('setForeignVoiceLock toggles the cross-tab voice lock flag', () => {
    setForeignVoiceLock(true)
    expect(isForeignVoiceLocked()).toBe(true)
    setForeignVoiceLock(false)
    expect(isForeignVoiceLocked()).toBe(false)
  })

  it('taking the foreign lock cuts any local playout (one mouth in the browser)', () => {
    setPlaying(true)
    setForeignVoiceLock(true)
    expect(isPlaying()).toBe(false)
  })

  it('interruptAll stops every active playout (barge-in)', () => {
    setPlaying(true)
    interruptAll('barge-in')
    expect(isPlaying()).toBe(false)
  })

  it('a registered LIVE session gets its outbound audio cut on interruptAll', () => {
    const cut = vi.fn()
    registerLiveFocus({ onInterrupt: cut })
    interruptAll('barge-in')
    expect(cut).toHaveBeenCalledTimes(1)
    unregisterLiveFocus()
  })
})
