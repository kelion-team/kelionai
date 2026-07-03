// ── Resumable reply buffer ("internet-radio" resume) ──────────────────────
// A chat reply is streamed to the client AND mirrored into a short-lived
// in-memory buffer keyed by a turn id. If the network drops mid-reply (common
// on 3G/5G handoffs while driving), the client reconnects to /api/chat/resume
// with the turn id and how much it already received, and we replay the rest
// from the buffer — no regeneration, no lost words, resume exactly where it
// left off. Buffers self-expire so memory stays bounded.

interface Turn {
  text: string // the raw stream so far (visible text + control frames)
  done: boolean
  ts: number
  waiters: (() => void)[] // resolved whenever new text arrives or it completes
}

const turns = new Map<string, Turn>()
const TTL_MS = 120_000 // a turn is resumable for 2 minutes after last activity

function sweep(): void {
  const now = Date.now()
  for (const [id, t] of turns) if (now - t.ts > TTL_MS) turns.delete(id)
}

export function startTurn(id: string): void {
  sweep()
  turns.set(id, { text: '', done: false, ts: Date.now(), waiters: [] })
}

export function appendTurn(id: string, chunk: string): void {
  const t = turns.get(id)
  if (!t) return
  t.text += chunk
  t.ts = Date.now()
  const w = t.waiters
  t.waiters = []
  for (const fn of w) fn()
}

export function finishTurn(id: string): void {
  const t = turns.get(id)
  if (!t) return
  t.done = true
  t.ts = Date.now()
  const w = t.waiters
  t.waiters = []
  for (const fn of w) fn()
  // Keep it briefly so a client that dropped right at the end can still resume.
  setTimeout(() => turns.delete(id), 30_000)
}

/**
 * Stream the buffered reply from character offset `from` onward, waiting for
 * new text as it is produced, until the turn completes. Yields nothing and
 * ends immediately if the turn is unknown/expired (client then gives up
 * gracefully). Character offsets match the raw decoded stream on both sides.
 */
export async function* readTurnFrom(id: string, from: number): AsyncGenerator<string> {
  let offset = Math.max(0, from)
  for (;;) {
    const t = turns.get(id)
    if (!t) return // unknown or expired
    if (offset < t.text.length) {
      yield t.text.slice(offset)
      offset = t.text.length
    }
    if (t.done && offset >= t.text.length) return
    // Wait for more text (or completion), with a timeout so we never hang.
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, 15_000)
      t.waiters.push(done)
    })
  }
}
