// UTTERANCE COALESCER — joins the pieces transcribed by VOX into a single
// thought. Why it exists: the microphone (audioIO.ts) cuts on silence
// (SILENCE_MS, today 450ms — a threshold calibrated by Adrian for speed, NOT
// touched here). A natural breathing/thinking pause in the middle of a
// sentence is longer than that, but much shorter than a real end-of-thought
// pause — resulting in utterances cut into disjointed pieces sent separately
// to the brain ("I am in setting." / "a" / ...).
// Fix strictly at text level: every transcribed fragment enters here, not
// straight to the brain; if another fragment arrives within `windowMs`, they
// merge — only at the first REAL silence (no new fragment for a while) is a
// single complete utterance sent.

export interface UtteranceCoalescer {
  push(text: string): void
  flushNow(): void
  cancel(): void
}

export function createUtteranceCoalescer(
  onFlush: (text: string) => void,
  windowMs = 900,
): UtteranceCoalescer {
  let buffer: string[] = []
  let timer: number | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): void => {
    clearTimer()
    if (buffer.length === 0) return
    const text = buffer.join(' ')
    buffer = []
    onFlush(text)
  }

  return {
    push(text: string) {
      const t = text.trim()
      if (!t) return
      buffer.push(t)
      // classic debounce: each new fragment delays the sending, doesn't rush it
      clearTimer()
      timer = window.setTimeout(flush, windowMs)
    },
    flushNow() {
      flush()
    },
    cancel() {
      clearTimer()
      buffer = []
    },
  }
}
