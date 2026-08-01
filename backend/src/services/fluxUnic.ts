// ── THE SAME THING IS NEVER WRITTEN TWICE ───────────────────────────────────
//
// Adrian, Jul 31: "in chat his written reply drools out several times, it's
// wrong, doesn't he hear me the first time?" — then: "writes the same sentence
// nonstop".
//
// It's NOT that he doesn't hear. The cause, found in the code:
//
//   orchestrator.ts runs up to 8 ROUNDS (model → tool → model → …), and
//   chat.ts:1809 sends to the client, through `onText`, EVERY piece of EVERY
//   round. Nothing compared the new round to what had already been said. When
//   the model gets stuck — repeats the same sentence and calls the same tool —
//   the sentence gets written once per round. Eight times. "Nonstop", exactly
//   as it looked.
//
// The filter here is the visible part of the repair: what reached the human
// once doesn't reach him a second time. (The other part is in the
// orchestrator: the loop breaks when a round brings nothing new — otherwise
// we'd still pay eight rounds to cut seven.)
//
// THE DESIGN PRINCIPLE, because this is where it can go badly wrong: it's
// better to let a repetition slip through than to swallow real text. A cut
// answer is far worse than one said twice. That's why the comparison below
// exists with an explicit threshold, and why cutting is conservative.

/** Below this many characters, a repetition is let through.
 *
 *  A "Da." or "Gata." can legitimately appear ten times in a conversation, and
 *  is always a substring of what was said before. If we cut that too, a short
 *  final answer would vanish completely from the screen — exactly the disease
 *  we're repairing, only backwards. The annoying duplication is a whole
 *  SENTENCE, not a word. */
export const PRAG_REPETITIE = 40

export interface FiltruRepetitie {
  /** What must be sent to the client for the received piece. `''` = nothing. */
  bucata(txt: string): string
  /** Closes the round. Returns what's left to send (`''` if the round was a
   *  repetition and gets dropped). */
  inchideRunda(): string
  /** The round just closed brought NOTHING new (stuck signal). */
  rundaAFostGoala(): boolean
  /** Everything that actually reached the client, across all rounds. */
  emis(): string
}

// ── WHY WE NO LONGER COMPARE EXACTLY (Adrian, Jul 31, the second time) ───────
//
// Him, after the 12:25 repair was live: "coming back with the question, why do
// you permanently drool the reply in chat?"
//
// Because we compared EXACTLY. We chose it deliberately — "better let a
// repetition slip than swallow real text" — but a model doesn't repeat
// identically: it changes a comma, a word, a space. And at the smallest
// difference, the filter let it all through. So my repair caught exactly the
// case that never happens.
//
// Now we compare on a NORMALIZED form (lowercase, no punctuation, squeezed
// spaces) — but we EMIT the original text, untouched. Normalization is just
// the glasses through which we check whether it was said before, not what
// reaches the human.
const norm = (t: string): string =>
  t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function filtruRepetitie(): FiltruRepetitie {
  let emis = ''
  // The normalized mirror of `emis`. Kept in parallel so we don't renormalize
  // the whole history on every piece coming from the stream.
  let emisNorm = ''
  // What the current round produced and we don't yet know if new or repetition.
  let asteptare = ''
  // The round diverged from what was said before → from now on it flows freely,
  // at no cost.
  let curge = false
  // Did the CURRENT round bring anything new? Reset on every `inchideRunda`.
  let aduseNou = false
  // The verdict of the last CLOSED round — this is the stuck signal the
  // orchestrator reads. Separate from `aduseNou`, otherwise it would answer
  // about the whole turn, not about the round that just ended.
  let ultimaRundaGoala = false

  return {
    bucata(txt: string): string {
      if (!txt) return ''
      if (curge) {
        emis += txt
        emisNorm = norm(emis)
        return txt
      }
      asteptare += txt
      // Still contained in what was said before → hold it, it may be a
      // repetition. We compare NORMALIZED: a changed comma no longer turns a
      // repetition into new text. (On the first round `emisNorm` is empty, and
      // ''.includes(something) is false, so the first word flows instantly —
      // latency doesn't suffer.)
      if (emisNorm.includes(norm(asteptare))) return ''
      // It diverged. We send ONLY the new part: we look for the longest
      // beginning that had already been said and cut exactly that much. The
      // search is on the normalized form, but the cut happens in the ORIGINAL
      // text — the human gets what the model wrote, not our working form.
      let k = asteptare.length
      while (k > 0 && !emisNorm.includes(norm(asteptare.slice(0, k)))) k--
      // THE BOUNDARY THAT WAS MISSING, and without which the repair became
      // worse than the disease: on the normalized form, a SHORT beginning
      // almost always matches somewhere in the history ("A", "Al", a space).
      // Without this threshold, the filter cut "Al" out of "Altceva" on the
      // first test — exactly what I had sworn not to do: truncate real text.
      // We cut only if the already-said piece is a SENTENCE, not a syllable;
      // below the threshold we cut nothing.
      // The space between the repetition and the new text belongs to the NEW
      // text: if we cut it, the words glue together ("…dimineață.Ai o
      // ședință"). Normalization can't see it, because it squeezes it — so we
      // recover it here, explicitly.
      while (k > 0 && /\s/.test(asteptare[k - 1] ?? '')) k--
      const nou = k >= PRAG_REPETITIE ? asteptare.slice(k) : asteptare
      asteptare = ''
      curge = true
      aduseNou = true
      emis += nou
      emisNorm = norm(emis)
      return nou
    },

    inchideRunda(): string {
      let iese = ''
      if (asteptare) {
        // The whole round fit into what had already been said.
        if (asteptare.length >= PRAG_REPETITIE) {
          // A true repetition → dropped. THIS is the repair.
        } else {
          // Too short to be sure ("Da.", "Gata.") → we let it through.
          iese = asteptare
          emis += iese
          emisNorm = norm(emis)
          aduseNou = true
        }
      }
      asteptare = ''
      curge = false
      ultimaRundaGoala = !aduseNou
      aduseNou = false
      return iese
    },

    rundaAFostGoala(): boolean {
      return ultimaRundaGoala
    },

    emis(): string {
      return emis
    },
  }
}
