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
import { cosineSim, VOICE_EMBED_DIM } from './voiceEmbedding.js'

// ── AMPRENTĂ NEURALĂ (Adrian, 6 aug: „amprenta e ADN, nu 9 numere; să mă
// recunoască și răgușit") ────────────────────────────────────────────────────
// Când avem embedding-ul neural de 256 (wespeaker, services/voiceEmbedding.ts),
// verdictul se dă pe COSINUS, nu pe distanța euclidiană a celor 9 numere.
// wespeaker/VoxCeleb: aceeași voce ~0.5–0.9, voci diferite ~0–0.3. Pragul e
// PERMISIV intenționat — owner-ul cere să fie recunoscut și când vocea variază
// (răgușeală); mai bine o fals-acceptare rară pe voci foarte apropiate decât
// să-l respingem PE EL. De potrivit pe măsurători live.
export const NEURAL_VOICE_THRESHOLD = 0.5

/** Amprenta stocată e NEURALĂ (256) sau veche (9/64, incompatibilă)? */
export function esteAmprentaNeurala(features: number[] | null | undefined): boolean {
  return !!features && features.length === VOICE_EMBED_DIM
}

/** Verdict pe embedding neural: aceeași persoană? (cosinus ≥ prag). Amprente de
 *  dimensiuni diferite (una veche, una nouă) NU se potrivesc — forțează re-înrolarea. */
export function sameSpeakerNeural(emb: number[], reference: number[]): boolean {
  if (!esteAmprentaNeurala(emb) || !esteAmprentaNeurala(reference)) return false
  return cosineSim(emb, reference) >= NEURAL_VOICE_THRESHOLD
}

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
