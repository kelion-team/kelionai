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

import {
  requestTtsFocus,
  releaseTtsFocus,
  registerLiveFocus,
  unregisterLiveFocus,
  setForeignVoiceLock,
  isForeignVoiceLocked,
  interruptAll,
} from './audioFocus'
import * as audioIO from './audioIO'

const setPlaying = (audioIO as unknown as { __setPlaying: (v: boolean) => void }).__setPlaying

describe('audioFocus single-voice lock', () => {
  beforeEach(() => {
    setForeignVoiceLock(false)
    unregisterLiveFocus()
    releaseTtsFocus()
    setPlaying(false)
    interruptAll('test-reset')
    setForeignVoiceLock(false)
  })

  it('blocks TTS while a foreign tab holds the voice lock', () => {
    setForeignVoiceLock(true)
    expect(isForeignVoiceLocked()).toBe(true)
    expect(requestTtsFocus()).toBe(false)
  })

  it('allows TTS again after the foreign lock is released', () => {
    setForeignVoiceLock(true)
    expect(requestTtsFocus()).toBe(false)
    setForeignVoiceLock(false)
    expect(requestTtsFocus()).toBe(true)
    releaseTtsFocus()
  })

  it('LIVE still beats TTS when unlocked', () => {
    setForeignVoiceLock(false)
    registerLiveFocus()
    expect(requestTtsFocus()).toBe(false)
    unregisterLiveFocus()
  })

  // Finding 1 (owner, 19 aug: „se aud 2 voci… dacă îi scriu răspunde doar scris"):
  // LIVE rostește DOAR turele vocale. O tură SCRISĂ nu e rostită de LIVE, deci
  // Chirp-ul ei TREBUIE redat chiar și cât LIVE ține focus-ul — altfel scrisul
  // rămâne mut sub LIVE (exact bugul). Gardul între taburi rămâne peste tot.
  it('a WRITTEN turn plays TTS even while LIVE holds focus', () => {
    setForeignVoiceLock(false)
    registerLiveFocus()
    expect(requestTtsFocus()).toBe(false) // tură vocală sub LIVE → LIVE vorbește
    expect(requestTtsFocus({ turaScrisa: true })).toBe(true) // tura SCRISĂ → Chirp-ul ei se redă
    releaseTtsFocus()
    unregisterLiveFocus()
  })

  it('the foreign-tab lock beats even a written turn (one mouth in the whole browser)', () => {
    setForeignVoiceLock(true)
    expect(requestTtsFocus({ turaScrisa: true })).toBe(false)
  })
})
