// ── Resumable SSE replay buffer (per-conversation ring) ─────────────────
// Every SSE event is stored with a monotonic sequence number per conversation.
// If the network drops mid-reply, the client reconnects with Last-Event-ID and
// we replay only the missing events for the SAME turn. Ring size is bounded to
// keep memory predictable. Buffer overflow is handled by emitting a DESYNC
// control frame instead of crashing, so the client can fall back to a fresh turn.

const RING_SIZE = 1024
const TTL_MS = 120_000 // a turn is resumable for 2 minutes after last activity

interface Event {
  seq: number
  turnId: string
  payload: string
  ts: number
}

interface ConversationBuffer {
  seq: number // last used sequence number
  events: Event[] // ring buffer, oldest at index 0
  // Turele ÎNCHEIATE (25 iul): fără asta, resume-ul nu putea ști dacă tura mai
  // produce evenimente — replay-a bufferul și ÎNCHIDEA, trunchiind răspunsul.
  finished: Set<string>
}

const buffers = new Map<string, ConversationBuffer>()

function sweep(): void {
  const now = Date.now()
  for (const [email, buf] of buffers) {
    // Keep the buffer alive while the newest event is fresh.
    const newest = buf.events[buf.events.length - 1]
    if (newest && now - newest.ts > TTL_MS) buffers.delete(email)
  }
}

function getBuffer(email: string): ConversationBuffer {
  let buf = buffers.get(email)
  if (!buf) {
    buf = { seq: 0, events: [], finished: new Set() }
    buffers.set(email, buf)
  }
  return buf
}

function formatSSE(seq: number, data: string): string {
  // SSE: every line of data is prefixed with "data: ". The event is terminated by
  // a blank line. The id field is the sequence number used for Last-Event-ID.
  const lines = data.split('\n')
  const id = `id: ${seq}\n`
  const body = lines.map((l) => `data: ${l}`).join('\n')
  return `${id}${body}\n\n`
}

export function heartbeatSSE(): string {
  return ': keep-alive\n\n'
}

export function desyncSSE(): string {
  // A synthetic control frame that tells the client the ring buffer overflowed
  // and the server can no longer guarantee gapless replay. The client will see
  // this as a normal control frame and should treat it as a desync signal.
  const CTRL = String.fromCharCode(31)
  return `${CTRL}{"desync":true}${CTRL}`
}

/**
 * Start tracking a new turn for this conversation. Creates the ring buffer if
 * it does not exist yet. The turn id is stored on every subsequent event so
 * replays only replay the same reply, not unrelated older turns.
 */
export function startTurn(email: string, turnId: string): void {
  sweep()
  const buf = getBuffer(email)
  // Mark the turn start as an invisible event so the ring keeps a boundary.
  buf.events.push({ seq: ++buf.seq, turnId, payload: '', ts: Date.now() })
  trim(buf)
}

function trim(buf: ConversationBuffer): void {
  if (buf.events.length > RING_SIZE) {
    // Drop oldest events until we are back at the ring size. If this removes the
    // start boundary of the current turn, the client will receive a DESYNC frame
    // on the next append so it knows replay is no longer possible.
    const overflow = buf.events.length - RING_SIZE
    buf.events.splice(0, overflow)
  }
}

/**
 * Append a raw chunk to the turn and return the SSE-encoded event ready to be
 * written to the wire. The chunk is stored verbatim so the client can still
 * parse its internal control frames (U+001F delimited JSON).
 */
export function appendTurn(email: string, turnId: string, chunk: string): string {
  const buf = getBuffer(email)
  const seq = ++buf.seq
  const ev: Event = { seq, turnId, payload: chunk, ts: Date.now() }
  buf.events.push(ev)
  trim(buf)
  return formatSSE(seq, chunk)
}

/**
 * Mark the turn as finished. We do not emit a dedicated "done" event; SSE ends
 * when the connection closes. The buffer is kept briefly for late reconnects.
 */
export function finishTurn(email: string, turnId: string): void {
  const buf = getBuffer(email)
  if (!buf) return
  // Refresh TTL on finish.
  const ev = buf.events[buf.events.length - 1]
  if (ev && ev.turnId === turnId) ev.ts = Date.now()
  // Marchează tura ÎNCHEIATĂ — resume-ul (readTurnFrom) se poate opri curat.
  buf.finished.add(turnId)
  if (buf.finished.size > 32) {
    // Nu creștem la nesfârșit; turele vechi ies oricum din ring/TTL.
    const first = buf.finished.values().next().value
    if (first !== undefined) buf.finished.delete(first)
  }
}

/**
 * Stream buffered SSE events for a turn starting after `lastSeq`. Yields fully
 * formatted SSE events. If the ring buffer overflowed and the requested events
 * are no longer available, yields a DESYNC control frame once and then ends.
 */
export async function* readTurnFrom(
  email: string,
  turnId: string,
  lastSeq: number,
): AsyncGenerator<string> {
  const buf = buffers.get(email)
  if (!buf) return

  const startSeq = Math.max(0, lastSeq) + 1
  const first = buf.events[0]

  // If the requested range is before the oldest buffered event, we overflowed.
  if (first && startSeq < first.seq) {
    yield formatSSE(++buf.seq, desyncSSE())
    return
  }

  // LIVE-FOLLOW (25 iul — bug REAL de trunchiere): înainte, bucla replay-a doar
  // ce era DEJA în buffer și se termina — dacă tura încă rula pe server (ex. o
  // unealtă de 20s), clientul primea jumătate de răspuns prezentat ca întreg,
  // fără nicio eroare. Acum: replay ce există, apoi URMĂREȘTE tura vie și cedează
  // evenimentele noi pe măsură ce sosesc, până când tura e marcată încheiată
  // (finishTurn) sau expiră TTL-ul — abia atunci stream-ul se închide.
  let cursor = startSeq
  const deadline = Date.now() + TTL_MS
  for (;;) {
    let emitted = false
    for (const ev of buf.events) {
      if (ev.seq < cursor) continue
      if (ev.turnId !== turnId) continue
      cursor = ev.seq + 1
      if (ev.payload === '') continue // skip synthetic turn-start markers
      emitted = true
      yield formatSSE(ev.seq, ev.payload)
    }
    if (buf.finished.has(turnId)) return // tura e gata — tot ce era de dat s-a dat
    if (Date.now() > deadline) return // plasă: nu ținem conexiunea la nesfârșit
    // Tura încă rulează — așteaptă puțin și verifică iar (fără busy-loop).
    if (!emitted) await new Promise((r) => setTimeout(r, 150))
  }
}

/**
 * Return the last sequence number known for a conversation. Useful for the
 * resume endpoint to know whether a client is asking for a completely lost range.
 */
export function lastSeqFor(email: string): number {
  return buffers.get(email)?.seq ?? 0
}

/**
 * Return the oldest sequence number still in the ring. Useful for overflow checks.
 */
export function oldestSeqFor(email: string): number {
  return buffers.get(email)?.events[0]?.seq ?? 0
}
