import { createHash, createHmac, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { config } from '../config.js'
import { conexiuneDb, getPool } from '../dbPool.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_RE = /^[0-9a-f]{64}$/
const CTRL = String.fromCharCode(31)

// A normal chat/tool turn fits well inside this lease. Writes and tool
// boundaries refresh it; expiry exists only to recover after a process crash.
const LEASE_MS = 2 * 60 * 1000
// Visible replay text is deliberately bounded so personal chat text is not
// retained forever. The minimal UUID/hash tombstone remains until account
// erasure; otherwise a delayed offline retry could repeat an external effect.
const REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RESULT_BYTES = 256 * 1024
const LEASE_REFRESH_MS = 30_000

const EXPIRE_CHAT_REPLAY_RESULTS_SQL = `UPDATE chat_turn_replays
  SET state='indeterminate', result_text=NULL,
      terminal_code='replay_result_expired', terminal_http_status=409,
      updated_at=$1
WHERE expires_at <= $1
  AND state IN ('completed', 'failed')`

interface ChatReplayRow {
  request_hash: string
  turn_id: string
  state: 'running' | 'completed' | 'failed' | 'indeterminate'
  lease_token: string
  lease_expires_at: string | Date
  side_effect_started: boolean
  result_text: string | null
  terminal_code: string | null
  terminal_http_status: number | null
}

export type ChatTurnClaim =
  | { kind: 'acquired'; turnId: string; leaseToken: string; recovered: boolean }
  | { kind: 'replay'; turnId: string; state: 'completed' | 'failed'; text: string; code: string; httpStatus: number }
  | { kind: 'in_progress'; turnId: string; retryAfterMs: number }
  | { kind: 'indeterminate'; turnId: string; code: string }
  | { kind: 'conflict' }
  | { kind: 'unavailable' }

function accountKey(email: string): string {
  return email.trim().toLowerCase()
}

function validInput(email: string, idempotencyKey: string, requestHash: string, turnId: string): boolean {
  const account = accountKey(email)
  return account.length >= 3 && account.length <= 320
    && UUID_RE.test(idempotencyKey)
    && HASH_RE.test(requestHash)
    && UUID_RE.test(turnId)
}

function digest(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? createHash('sha256').update(value).digest('hex')
    : null
}

/** Hashes the stable semantics of a turn without retaining its raw media.
 * The whole conversation projection is bound to the UUID, not only the last
 * sentence: changing earlier context must not recover a crashed operation as
 * a different request. Ephemeral timestamps, network tier, coordinates and
 * monitor snapshots remain excluded so an unchanged transport retry matches. */
export function hashChatReplayRequest(body: unknown): string {
  const request = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const messages = Array.isArray(request.messages) ? request.messages : []
  const conversation = messages.map((value) => {
    const message = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return {
      role: typeof message.role === 'string' ? message.role : '',
      content: typeof message.content === 'string' ? message.content : '',
    }
  })
  const images = Array.isArray(request.images)
    ? request.images.map(digest).filter((value): value is string => value !== null)
    : []
  const stable = {
    conversation,
    imageSha256: digest(request.image),
    imageSequenceSha256: images,
    audioSha256: digest(request.audio),
    imageIsAttachment: request.imageIsAttachment === true,
    spoken: request.spoken === true,
    ambientVoice: request.voceAmbianta === true,
    carMode: request.carMode === true,
    brainDoor: request.usaCreierului === true,
    brainDoorContinuation: request.continuareUsa === true,
  }
  // A keyed digest keeps the retained tombstone from becoming a dictionary
  // oracle for short chat messages if a database snapshot is exposed.
  return createHmac('sha256', config.sessionSecret).update(JSON.stringify(stable)).digest('hex')
}

function rowToTerminal(row: ChatReplayRow): ChatTurnClaim {
  if (row.state === 'completed' || row.state === 'failed') {
    return {
      kind: 'replay',
      turnId: row.turn_id,
      state: row.state,
      text: row.result_text ?? '',
      code: row.terminal_code ?? row.state,
      httpStatus: row.terminal_http_status ?? 200,
    }
  }
  return {
    kind: 'indeterminate',
    turnId: row.turn_id,
    code: row.terminal_code ?? 'turn_result_indeterminate',
  }
}

/** Removes retained visible text after its bounded replay window while keeping
 * the minimal idempotency tombstone. Called both on claim and by the process
 * retention job, so expiry does not depend on future user traffic. */
export async function expireChatReplayResults(nowMs = Date.now()): Promise<number> {
  if (!config.databaseUrl) return 0
  const result = await getPool().query(EXPIRE_CHAT_REPLAY_RESULTS_SQL, [new Date(nowMs)])
  return result.rowCount ?? 0
}

async function rollback(client: pg.PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined)
}

/** Claims one logical turn per account and UUID. Expired work can be recovered
 * only if no external effect was marked. Once an effect may have started, an
 * ambiguous crash is fail-closed instead of executing it twice. */
export async function claimChatTurn(input: {
  userEmail: string
  idempotencyKey: string
  requestHash: string
  turnId?: string
  nowMs?: number
}): Promise<ChatTurnClaim> {
  if (!config.databaseUrl) return { kind: 'unavailable' }
  const userEmail = accountKey(input.userEmail)
  const idempotencyKey = input.idempotencyKey.toLowerCase()
  const requestHash = input.requestHash.toLowerCase()
  const turnId = input.turnId?.toLowerCase() ?? randomUUID()
  if (!validInput(userEmail, idempotencyKey, requestHash, turnId)) return { kind: 'conflict' }

  const nowMs = input.nowMs ?? Date.now()
  const leaseToken = randomUUID()
  const leaseUntil = new Date(nowMs + LEASE_MS)
  const expiresAt = new Date(nowMs + REPLAY_TTL_MS)
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    // Expire retained response text, not the idempotency tombstone. Deleting
    // the row would let the same durable offline UUID execute again later.
    await client.query(
      EXPIRE_CHAT_REPLAY_RESULTS_SQL,
      [new Date(nowMs)],
    )
    const inserted = await client.query<ChatReplayRow>(
      `INSERT INTO chat_turn_replays
         (user_email, idempotency_key, request_hash, turn_id, state,
          lease_token, lease_expires_at, expires_at)
       VALUES ($1,$2::uuid,$3,$4::uuid,'running',$5::uuid,$6,$7)
       ON CONFLICT (user_email, idempotency_key) DO NOTHING
       RETURNING request_hash, turn_id, state, lease_token, lease_expires_at,
                 side_effect_started, result_text, terminal_code, terminal_http_status`,
      [userEmail, idempotencyKey, requestHash, turnId, leaseToken, leaseUntil, expiresAt],
    )
    if (inserted.rows[0]) {
      await client.query('COMMIT')
      return { kind: 'acquired', turnId, leaseToken, recovered: false }
    }

    const selected = await client.query<ChatReplayRow>(
      `SELECT request_hash, turn_id, state, lease_token, lease_expires_at,
              side_effect_started, result_text, terminal_code, terminal_http_status
         FROM chat_turn_replays
        WHERE user_email=$1 AND idempotency_key=$2::uuid
        FOR UPDATE`,
      [userEmail, idempotencyKey],
    )
    const row = selected.rows[0]
    if (!row || row.request_hash !== requestHash) {
      await client.query('COMMIT')
      return { kind: 'conflict' }
    }
    if (row.state !== 'running') {
      await client.query('COMMIT')
      return rowToTerminal(row)
    }

    const remainingMs = new Date(row.lease_expires_at).getTime() - nowMs
    if (remainingMs > 0) {
      await client.query('COMMIT')
      return { kind: 'in_progress', turnId: row.turn_id, retryAfterMs: Math.min(5_000, Math.max(250, remainingMs)) }
    }
    if (row.side_effect_started) {
      await client.query(
        `UPDATE chat_turn_replays
            SET state='indeterminate', terminal_code='lease_expired_after_effect',
                updated_at=$3, expires_at=$4
          WHERE user_email=$1 AND idempotency_key=$2::uuid`,
        [userEmail, idempotencyKey, new Date(nowMs), expiresAt],
      )
      await client.query('COMMIT')
      return { kind: 'indeterminate', turnId: row.turn_id, code: 'lease_expired_after_effect' }
    }

    const recoveredTurnId = randomUUID()
    await client.query(
      `UPDATE chat_turn_replays
          SET turn_id=$3::uuid, lease_token=$4::uuid, lease_expires_at=$5,
              updated_at=$6, expires_at=$7
        WHERE user_email=$1 AND idempotency_key=$2::uuid`,
      [userEmail, idempotencyKey, recoveredTurnId, leaseToken, leaseUntil, new Date(nowMs), expiresAt],
    )
    await client.query('COMMIT')
    return { kind: 'acquired', turnId: recoveredTurnId, leaseToken, recovered: true }
  } catch {
    if (client) await rollback(client)
    return { kind: 'unavailable' }
  } finally {
    client?.release()
  }
}

async function updateOwnedLease(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  effectStarted?: boolean
  nowMs?: number
}): Promise<boolean> {
  if (!config.databaseUrl || !UUID_RE.test(input.idempotencyKey) || !UUID_RE.test(input.leaseToken)) return false
  const nowMs = input.nowMs ?? Date.now()
  try {
    const result = await getPool().query(
      `UPDATE chat_turn_replays
          SET lease_expires_at=$4, updated_at=$5,
              side_effect_started=side_effect_started OR $6
        WHERE user_email=$1 AND idempotency_key=$2::uuid
          AND lease_token=$3::uuid AND state='running'`,
      [
        accountKey(input.userEmail),
        input.idempotencyKey.toLowerCase(),
        input.leaseToken.toLowerCase(),
        new Date(nowMs + LEASE_MS),
        new Date(nowMs),
        input.effectStarted === true,
      ],
    )
    return (result.rowCount ?? 0) === 1
  } catch {
    return false
  }
}

export function refreshChatTurnLease(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  nowMs?: number
}): Promise<boolean> {
  return updateOwnedLease(input)
}

/** Must succeed before invoking any non-idempotent external tool. */
export function markChatTurnEffectStarted(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  nowMs?: number
}): Promise<boolean> {
  return updateOwnedLease({ ...input, effectStarted: true })
}

/** Runs an external side effect only after the durable ambiguity marker is
 * owned by this lease. If storage cannot prove the marker, the callback is not
 * invoked. */
export async function executeChatSideEffect<T>(
  input: {
    userEmail: string
    idempotencyKey: string
    leaseToken: string
    nowMs?: number
  },
  effect: () => Promise<T>,
): Promise<T> {
  if (!await markChatTurnEffectStarted(input)) {
    throw new Error('turn_replay_store_unavailable')
  }
  // A browser/converter/provider operation may legitimately run longer than
  // the base lease. Keep ownership alive while this process is healthy; after
  // a crash the heartbeat stops and the tombstone becomes indeterminate.
  const heartbeat = setInterval(() => {
    void refreshChatTurnLease({
      userEmail: input.userEmail,
      idempotencyKey: input.idempotencyKey,
      leaseToken: input.leaseToken,
    })
  }, LEASE_REFRESH_MS)
  heartbeat.unref()
  try {
    return await effect()
  } finally {
    clearInterval(heartbeat)
  }
}

async function finishChatTurn(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  state: 'completed' | 'failed'
  text: string
  code: string
  httpStatus?: number
  nowMs?: number
}): Promise<boolean> {
  if (!config.databaseUrl || !UUID_RE.test(input.idempotencyKey) || !UUID_RE.test(input.leaseToken)) return false
  const nowMs = input.nowMs ?? Date.now()
  const text = truncateUtf8(input.text, MAX_RESULT_BYTES)
  const code = input.code.trim().slice(0, 80) || input.state
  const httpStatus = Number.isInteger(input.httpStatus) && input.httpStatus! >= 200 && input.httpStatus! <= 599
    ? input.httpStatus!
    : 200
  try {
    const result = await getPool().query(
      `UPDATE chat_turn_replays
          SET state=$4, result_text=$5, terminal_code=$6,
              terminal_http_status=$7, updated_at=$8, expires_at=$9
        WHERE user_email=$1 AND idempotency_key=$2::uuid
          AND lease_token=$3::uuid AND state='running'`,
      [
        accountKey(input.userEmail),
        input.idempotencyKey.toLowerCase(),
        input.leaseToken.toLowerCase(),
        input.state,
        text,
        code,
        httpStatus,
        new Date(nowMs),
        new Date(nowMs + REPLAY_TTL_MS),
      ],
    )
    return (result.rowCount ?? 0) === 1
  } catch {
    return false
  }
}

export function completeChatTurn(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  text: string
  code?: string
  nowMs?: number
}): Promise<boolean> {
  return finishChatTurn({ ...input, state: 'completed', code: input.code ?? 'completed', httpStatus: 200 })
}

export function failChatTurn(input: {
  userEmail: string
  idempotencyKey: string
  leaseToken: string
  text: string
  code: string
  httpStatus?: number
  nowMs?: number
}): Promise<boolean> {
  return finishChatTurn({ ...input, state: 'failed' })
}

/** Persists each visible chat role once for one durable request. A recovered
 * pre-effect turn can safely attempt the write again without duplicating the
 * user's or assistant's history row. */
export async function saveChatMessageOnce(input: {
  userEmail: string
  idempotencyKey: string
  role: 'user' | 'assistant'
  content: string
}): Promise<boolean> {
  const userEmail = accountKey(input.userEmail)
  const idempotencyKey = input.idempotencyKey.toLowerCase()
  if (!config.databaseUrl || !userEmail || !UUID_RE.test(idempotencyKey) || !input.content.trim()) return false
  try {
    await getPool().query(
      `INSERT INTO messages (user_email, role, content, chat_request_id)
       VALUES ($1,$2,$3,$4::uuid)
       ON CONFLICT ((lower(user_email)), chat_request_id, role)
         WHERE chat_request_id IS NOT NULL
       DO NOTHING`,
      [userEmail, input.role, input.content, idempotencyKey],
    )
    return true
  } catch {
    return false
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const data = Buffer.from(value, 'utf8')
  if (data.length <= maxBytes) return value
  return data.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '')
}

/** Collects only visible assistant text from raw writes. Delimited control
 * frames (audio, monitor state, tool metadata) are discarded even when split
 * across chunks, so terminal replay stays bounded and privacy-minimal. */
export function createChatReplayCapture(): { append(chunk: unknown): void; text(): string } {
  let visible = ''
  let control = ''
  let insideControl = false
  return {
    append(chunk: unknown): void {
      if (typeof chunk !== 'string' || chunk.length === 0) return
      let plain = ''
      for (const char of chunk) {
        if (char === CTRL) {
          insideControl = !insideControl
          control = ''
          continue
        }
        if (insideControl) {
          // A malformed/unclosed control cannot retain an unbounded audio blob.
          if (control.length < 65_536) control += char
          continue
        }
        plain += char
      }
      if (plain) visible = truncateUtf8(visible + plain, MAX_RESULT_BYTES)
    },
    text(): string {
      return visible
    },
  }
}

function sseEvent(id: number, payload: string): string {
  return `id: ${id}\n${payload.split('\n').map((line) => `data: ${line}`).join('\n')}\n\n`
}

/** Encodes a terminal replay as ordinary SSE. Replayed controls are limited to
 * the turn receipt and the two explicit ignored states; tool/audio payloads are
 * never reconstructed from retained data. */
export function encodeChatTerminalReplay(input: {
  turnId: string
  text: string
  code: string
}): string {
  if (!UUID_RE.test(input.turnId)) return ''
  const turnFrame = `${CTRL}${JSON.stringify({ turn: input.turnId, replayed: true })}${CTRL}`
  let output = sseEvent(1, turnFrame)
  if (
    input.code === 'text_gate_no_name'
    || input.code === 'turn_not_addressed'
    || input.code === 'voice_gate_false_negative'
  ) {
    output += sseEvent(2, `${CTRL}${JSON.stringify({ ignored: true, replayed: true })}${CTRL}`)
  } else if (input.text) {
    output += sseEvent(2, truncateUtf8(input.text, MAX_RESULT_BYTES))
  }
  return output
}
