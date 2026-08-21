// ── AUDIO FOCUS MANAGER ─────────────────────────────────────────────────────
// Owner, 17 aug: chat LIVE audio first, fluent, interruptible — one mouth.
//
// Does NOT replace playVoice/stopVoice or vocal-live. It is the single
// arbitration layer above them:
//   • LIVE has priority over written-chat TTS (Chirp {audio})
//   • barge-in / user speech → interruptAll() stops every active playout now
//   • sources register/unregister so the panel does not juggle two pipelines
//
// Law of the house: wire what exists; do not invent a second voice stack.

import { stopVoice, isVoicePlaying } from './audioIO'

export type AudioFocusSource = 'live' | 'tts' | 'none'

let active: AudioFocusSource = 'none'

/** Optional: LIVE session can cut its own outbound audio on interrupt. */
let liveInterrupt: (() => void) | null = null

// Cross-tab single-voice lock (ChatPanel voceUnica). When another tab owns the
// mouth, this tab must not play Chirp TTS even if chat frames still arrive.
let foreignVoiceLock = false

/** Other tab holds the voice chain - drop local playout until released. */
export function setForeignVoiceLock(locked: boolean): void {
  foreignVoiceLock = locked
  if (locked && isVoicePlaying()) stopVoice()
}

export function isForeignVoiceLocked(): boolean {
  return foreignVoiceLock
}

function emit(next: AudioFocusSource): void {
  active = next
}

/** LIVE session registers so TTS knows not to steal the mouth. */
export function registerLiveFocus(opts?: { onInterrupt?: () => void }): void {
  liveInterrupt = opts?.onInterrupt ?? null
  // LIVE always wins: kill any Chirp still playing from a written turn.
  if (isVoicePlaying()) stopVoice()
  emit('live')
}

export function unregisterLiveFocus(): void {
  liveInterrupt = null
  if (active === 'live') emit(isVoicePlaying() ? 'tts' : 'none')
}

// VOCE SCOASĂ (21 aug clean-slate): requestTtsFocus/releaseTtsFocus (arbitrarea
// gurii Chirp pentru turele scrise) au dispărut odată cu vocea de pe frontend.
// Au rămas DOAR: interruptAll (taie orice redare rămasă — ex. naratorul) și
// setForeignVoiceLock/isForeignVoiceLocked (o singură gură în tot browserul).

/**
 * User started speaking (barge-in / VAD): stop every outbound stream immediately.
 * — TTS queue + current element via stopVoice()
 * — LIVE outbound cut hook if registered
 */
export function interruptAll(reason = 'barge-in'): void {
  void reason
  if (isVoicePlaying()) stopVoice()
  try {
    liveInterrupt?.()
  } catch {
    /* live path optional */
  }
  if (active !== 'live') emit('none')
  // If LIVE remains the session, keep focus=live (ear still open); only playout stopped.
  else emit('live')
}
