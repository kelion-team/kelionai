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

  // Owner, 20 aug: „se aud multe voci paralele… o singură ieșire audio". O tură
  // SCRISĂ care ia gura cât LIVE e activ TREBUIE să taie ÎNTÂI playout-ul LIVE
  // (PCM-ul rămas), altfel Chirp-ul scris se aude PESTE vocea LIVE. O gură nouă
  // închide celelalte guri.
  it('a WRITTEN turn CUTS the LIVE mouth before taking the mouth (one output)', () => {
    const taieLive = vi.fn()
    registerLiveFocus({ onInterrupt: taieLive })
    expect(requestTtsFocus({ turaScrisa: true })).toBe(true)
    expect(taieLive).toHaveBeenCalledTimes(1) // gura LIVE a fost tăiată la sursă
    releaseTtsFocus()
    unregisterLiveFocus()
  })

  // TRUNCHEREA MĂSURATĂ (owner, 22 aug: „chatul se truncheaza audio"; vânător +
  // verificator adversarial, BLOCANT): sesiunea Live cade singură des (1006,
  // 1000 de la server, schimbare de rută) și e repornită TĂCUT — iar
  // registerLiveFocus omora Chirp-ul turei scrise fix în mijlocul propoziției.
  it('re-registering LIVE while a WRITTEN turn is PLAYING does NOT kill the mouth', () => {
    expect(requestTtsFocus({ turaScrisa: true })).toBe(true)
    setPlaying(true)
    registerLiveFocus() // sesiunea Live s-a redeschis singură sub Chirp viu
    expect(audioIO.isVoicePlaying()).toBe(true) // redarea NU a fost tăiată
    // ...și tura scrisă următoare tot are voie la gură (starea a rămas 'tts'):
    expect(requestTtsFocus({ turaScrisa: true })).toBe(true)
    setPlaying(false)
    releaseTtsFocus()
    unregisterLiveFocus()
  })

  it('a STALE tts state (no real playback) is repaired to live on re-register', () => {
    expect(requestTtsFocus({ turaScrisa: true })).toBe(true)
    setPlaying(false) // onEnd pierdut — starea 'tts' a rămas fără redare reală
    registerLiveFocus()
    // gura s-a întors la Live: o tură VOCALĂ (fără turaScrisa) e refuzată,
    // exact contractul „LIVE vorbește el" — starea nu mai e blocată pe 'tts'.
    expect(requestTtsFocus()).toBe(false)
    unregisterLiveFocus()
  })
})
