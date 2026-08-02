// ── ONE THRESHOLD, ONE VERDICT (the voice-gate audit) ───────────────────────
//
// The speaker-match threshold used to be written THREE times: chat.ts (the
// holder check on the brain turn), realtime.ts (the voice gate's padlock) and
// guestVoices.ts (the approved-guest match). Three copies of one number are
// three places where the rule "the guest's threshold is the holder's
// threshold" could silently diverge — a guest stricter than the holder, or
// the gate looser than the brain.
//
// From here on there is exactly ONE constant and ONE pure verdict function.
// Any rule change ("the prints drifted apart, loosen a bit") lands once and
// applies to the holder AND the guests in the same deploy.

import { vectorDistance } from '../db.js'

/** Under this normalized Euclidean distance, two voiceprints are the same
 *  person. Calibrated on the holder's real prints (see poartaVoce.test.ts —
 *  the guest's threshold is the holder's threshold, by design). */
export const VOICE_MATCH_THRESHOLD = 0.38

/** Pure speaker verdict: does `vector` belong to the same person as
 *  `reference`? Empty/missing references never match (vectorDistance returns
 *  Infinity for them). The comparison is STRICTLY under the threshold — a
 *  distance exactly at the boundary is a different speaker. */
export function sameSpeaker(vector: number[], reference: number[]): boolean {
  if (!vector.length || !reference.length) return false
  return vectorDistance(vector, reference) < VOICE_MATCH_THRESHOLD
}
