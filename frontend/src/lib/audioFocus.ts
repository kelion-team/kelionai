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

/**
 * Request the mouth for written-chat TTS.
 * Returns false if LIVE holds focus — caller must drop {audio} (LIVE speaks).
 *
 * `turaScrisa` (owner, 19 aug: „se aud 2 voci… dacă îi scriu răspunde doar
 * scris"): LIVE rostește DOAR turele VOCALE (prin WS — n-are `speak()` pentru
 * text scris). O tură SCRISĂ nu e rostită de LIVE, deci Chirp-ul ei TREBUIE
 * redat chiar și cât LIVE ține focus-ul — altfel scrisul rămâne MUT sub LIVE.
 * Ăsta era gardul C care ÎNVINGEA relaxarea gardului A din ChatPanel (măsurat):
 * gardul A lăsa turele scrise să treacă, iar `requestTtsFocus()` le pica aici,
 * pe `active === 'live'`. Blocajul între taburi (foreignVoiceLock) rămâne peste
 * tot — o singură gură în tot browserul, indiferent de felul turei.
 */
export function requestTtsFocus(opts?: { turaScrisa?: boolean }): boolean {
  if (foreignVoiceLock) return false
  if (active === 'live' && !opts?.turaScrisa) return false
  // O GURĂ NOUĂ OPREȘTE CELELALTE GURI (owner, 20 aug: „se aud multe voci paralele,
  // de la mai multe creiere… o singură ieșire audio"). O tură SCRISĂ care ia gura
  // cât LIVE e activ TREBUIE să taie ÎNTÂI playout-ul LIVE (PCM-ul Gemini Live rămas
  // în redare), altfel se aud DOUĂ voci: Chirp-ul scris PESTE vocea LIVE. Fiecare
  // cadru {audio} trece prin aici (ChatPanel: requestTtsFocus înainte de playVoice),
  // deci gura LIVE e silențiată exact în clipa în care Chirp-ul primește gura.
  if (active === 'live' && opts?.turaScrisa) {
    try {
      liveInterrupt?.()
    } catch {
      /* live path optional */
    }
  }
  emit('tts')
  return true
}

export function releaseTtsFocus(): void {
  // BUG REPARAT (registrul frontend #3, blocant — „vocile paralele", owner 20 aug):
  // după prima redare Chirp, starea cădea pe 'none' deși sesiunea LIVE era încă vie
  // (liveInterrupt înregistrat) → următorul requestTtsFocus nu mai intra pe ramura
  // `active==='live'` → nu mai tăia playout-ul Live → Chirp cânta PESTE vocea Live.
  // Gura se întoarce la 'live' cât timp sesiunea Live există; 'none' doar fără ea.
  if (active === 'tts') emit(isVoicePlaying() ? 'tts' : liveInterrupt ? 'live' : 'none')
}

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
