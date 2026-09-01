import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StoredRow {
  request_hash: string
  turn_id: string
  state: 'running' | 'completed' | 'failed' | 'indeterminate'
  lease_token: string
  lease_expires_at: Date
  side_effect_started: boolean
  result_text: string | null
  terminal_code: string | null
  terminal_http_status: number | null
  expires_at: Date
}

const fake = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  messages: new Map<string, { role: string; content: string }>(),
}))

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://unit-test',
    sessionSecret: 'unit-test-chat-replay-hmac-secret',
  },
}))

vi.mock('./dbPool.js', () => {
  const key = (email: unknown, id: unknown): string => `${String(email)}:${String(id).toLowerCase()}`
  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: StoredRow[]; rowCount: number }> => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 }
    if (sql.includes("terminal_code='replay_result_expired'")) {
      const now = params[0] as Date
      let changed = 0
      for (const row of fake.rows.values()) {
        if (row.expires_at <= now && (row.state === 'completed' || row.state === 'failed')) {
          row.state = 'indeterminate'
          row.result_text = null
          row.terminal_code = 'replay_result_expired'
          row.terminal_http_status = 409
          changed += 1
        }
      }
      return { rows: [], rowCount: changed }
    }
    if (sql.includes('INSERT INTO chat_turn_replays')) {
      const id = key(params[0], params[1])
      if (fake.rows.has(id)) return { rows: [], rowCount: 0 }
      const row: StoredRow = {
        request_hash: String(params[2]),
        turn_id: String(params[3]),
        state: 'running',
        lease_token: String(params[4]),
        lease_expires_at: params[5] as Date,
        side_effect_started: false,
        result_text: null,
        terminal_code: null,
        terminal_http_status: null,
        expires_at: params[6] as Date,
      }
      fake.rows.set(id, row)
      return { rows: [row], rowCount: 1 }
    }
    if (sql.includes('FROM chat_turn_replays') && sql.includes('FOR UPDATE')) {
      const row = fake.rows.get(key(params[0], params[1]))
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
    }
    if (sql.includes("SET state='indeterminate'")) {
      const row = fake.rows.get(key(params[0], params[1]))
      if (!row) return { rows: [], rowCount: 0 }
      row.state = 'indeterminate'
      row.terminal_code = 'lease_expired_after_effect'
      row.expires_at = params[3] as Date
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('SET turn_id=$3::uuid')) {
      const row = fake.rows.get(key(params[0], params[1]))
      if (!row) return { rows: [], rowCount: 0 }
      row.turn_id = String(params[2])
      row.lease_token = String(params[3])
      row.lease_expires_at = params[4] as Date
      row.expires_at = params[6] as Date
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('side_effect_started=side_effect_started OR $6')) {
      const row = fake.rows.get(key(params[0], params[1]))
      if (!row || row.lease_token !== params[2] || row.state !== 'running') return { rows: [], rowCount: 0 }
      row.lease_expires_at = params[3] as Date
      row.side_effect_started ||= params[5] === true
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('SET state=$4, result_text=$5')) {
      const row = fake.rows.get(key(params[0], params[1]))
      if (!row || row.lease_token !== params[2] || row.state !== 'running') return { rows: [], rowCount: 0 }
      row.state = params[3] as StoredRow['state']
      row.result_text = String(params[4])
      row.terminal_code = String(params[5])
      row.terminal_http_status = Number(params[6])
      row.expires_at = params[8] as Date
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO messages')) {
      const id = `${String(params[0])}:${String(params[3])}:${String(params[1])}`
      if (!fake.messages.has(id)) {
        fake.messages.set(id, { role: String(params[1]), content: String(params[2]) })
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    throw new Error(`SQL neașteptat în test: ${sql}`)
  }
  const client = { query, release: vi.fn() }
  return {
    conexiuneDb: vi.fn(async () => client),
    getPool: vi.fn(() => ({ query })),
  }
})

import {
  claimChatTurn,
  completeChatTurn,
  createChatReplayCapture,
  encodeChatTerminalReplay,
  expireChatReplayResults,
  executeChatSideEffect,
  hashChatReplayRequest,
  markChatTurnEffectStarted,
  saveChatMessageOnce,
} from './services/chatTurnReplay.js'

const ACCOUNT_A = 'a@example.test'
const ACCOUNT_B = 'b@example.test'
const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const TURN_ID = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)

describe('chat turn exact-once/replay registry', () => {
  beforeEach(() => {
    fake.rows.clear()
    fake.messages.clear()
  })

  it('replays a completed result for the same account without acquiring twice and isolates another account', async () => {
    const first = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    expect(first).toMatchObject({ kind: 'acquired', turnId: TURN_ID, recovered: false })
    if (first.kind !== 'acquired') throw new Error('claim expected')

    expect(await markChatTurnEffectStarted({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      nowMs: 2_000,
    })).toBe(true)
    expect(await completeChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      text: 'Email trimis o singură dată.',
      nowMs: 3_000,
    })).toBe(true)

    await expect(claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 4_000,
    })).resolves.toMatchObject({
      kind: 'replay',
      state: 'completed',
      text: 'Email trimis o singură dată.',
    })
    await expect(claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: 'b'.repeat(64),
      nowMs: 4_000,
    })).resolves.toEqual({ kind: 'conflict' })
    await expect(claimChatTurn({
      userEmail: ACCOUNT_B,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 4_000,
    })).resolves.toMatchObject({ kind: 'acquired' })
  })

  it('grants only one active lease to concurrent deliveries of the same request', async () => {
    const claims = await Promise.all([
      claimChatTurn({
        userEmail: ACCOUNT_A,
        idempotencyKey: REQUEST_ID,
        requestHash: HASH,
        turnId: TURN_ID,
        nowMs: 1_000,
      }),
      claimChatTurn({
        userEmail: ACCOUNT_A,
        idempotencyKey: REQUEST_ID,
        requestHash: HASH,
        nowMs: 1_000,
      }),
    ])
    expect(claims.filter((claim) => claim.kind === 'acquired')).toHaveLength(1)
    expect(claims.filter((claim) => claim.kind === 'in_progress')).toHaveLength(1)
  })

  it('fails closed after a crash whose lease expires after an external effect started', async () => {
    const first = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    if (first.kind !== 'acquired') throw new Error('claim expected')
    await markChatTurnEffectStarted({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      nowMs: 1_000,
    })

    const afterCrash = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 15 * 60 * 1_000 + 1_001,
    })
    expect(afterCrash).toEqual({
      kind: 'indeterminate',
      turnId: TURN_ID,
      code: 'lease_expired_after_effect',
    })
    await expect(claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 15 * 60 * 1_000 + 2_000,
    })).resolves.toMatchObject({ kind: 'indeterminate' })
  })

  it('expires retained text but never forgets the idempotency tombstone', async () => {
    const first = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    if (first.kind !== 'acquired') throw new Error('claim expected')
    await markChatTurnEffectStarted({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      nowMs: 2_000,
    })
    await completeChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      text: 'Conținutul personal expiră.',
      nowMs: 3_000,
    })

    const afterResultTtl = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 8 * 24 * 60 * 60 * 1_000,
    })
    expect(afterResultTtl).toEqual({
      kind: 'indeterminate',
      turnId: TURN_ID,
      code: 'replay_result_expired',
    })
    expect(fake.rows).toHaveLength(1)
    expect([...fake.rows.values()][0]).toMatchObject({
      state: 'indeterminate',
      result_text: null,
      terminal_code: 'replay_result_expired',
    })

    await expect(claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 30 * 24 * 60 * 60 * 1_000,
    })).resolves.toMatchObject({ kind: 'indeterminate', code: 'replay_result_expired' })
    expect(fake.rows).toHaveLength(1)
  })

  it('expires replay text from the background retention path without a new claim', async () => {
    const first = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    if (first.kind !== 'acquired') throw new Error('claim expected')
    await completeChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: first.leaseToken,
      text: 'Rezultat temporar.',
      nowMs: 2_000,
    })

    await expect(expireChatReplayResults(8 * 24 * 60 * 60 * 1_000)).resolves.toBe(1)
    expect([...fake.rows.values()][0]).toMatchObject({
      state: 'indeterminate',
      result_text: null,
      terminal_code: 'replay_result_expired',
    })
  })

  it('keeps a long external effect lease alive while this process is healthy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    try {
      const first = await claimChatTurn({
        userEmail: ACCOUNT_A,
        idempotencyKey: REQUEST_ID,
        requestHash: HASH,
        turnId: TURN_ID,
        nowMs: 1_000,
      })
      if (first.kind !== 'acquired') throw new Error('claim expected')
      let releaseEffect!: () => void
      let announceStarted!: () => void
      const started = new Promise<void>((resolve) => { announceStarted = resolve })
      const effectDone = new Promise<void>((resolve) => { releaseEffect = resolve })
      const running = executeChatSideEffect({
        userEmail: ACCOUNT_A,
        idempotencyKey: REQUEST_ID,
        leaseToken: first.leaseToken,
        nowMs: 2_000,
      }, async () => {
        announceStarted()
        await effectDone
        return 'done'
      })
      await started
      const before = [...fake.rows.values()][0].lease_expires_at.getTime()
      await vi.advanceTimersByTimeAsync(31_000)
      const after = [...fake.rows.values()][0].lease_expires_at.getTime()
      expect(after).toBeGreaterThan(before)
      releaseEffect()
      await expect(running).resolves.toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers an expired crash only when no external effect had started', async () => {
    const first = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    const recovered = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      nowMs: 15 * 60 * 1_000 + 1_001,
    })
    expect(first).toMatchObject({ kind: 'acquired', turnId: TURN_ID, recovered: false })
    expect(recovered).toMatchObject({ kind: 'acquired', recovered: true })
    if (recovered.kind === 'acquired') expect(recovered.turnId).not.toBe(TURN_ID)
  })

  it('never invokes an external effect unless its durable marker is owned', async () => {
    const effect = vi.fn(async () => 'sent')
    await expect(executeChatSideEffect({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: TURN_ID,
    }, effect)).rejects.toThrow('turn_replay_store_unavailable')
    expect(effect).not.toHaveBeenCalled()

    const claim = await claimChatTurn({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      requestHash: HASH,
      turnId: TURN_ID,
      nowMs: 1_000,
    })
    if (claim.kind !== 'acquired') throw new Error('claim expected')
    await expect(executeChatSideEffect({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      leaseToken: claim.leaseToken,
      nowMs: 2_000,
    }, effect)).resolves.toBe('sent')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('stores each chat role once per account/request across a recovery retry', async () => {
    await expect(saveChatMessageOnce({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      role: 'user',
      content: 'trimite emailul',
    })).resolves.toBe(true)
    await expect(saveChatMessageOnce({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      role: 'user',
      content: 'trimite emailul',
    })).resolves.toBe(true)
    await saveChatMessageOnce({
      userEmail: ACCOUNT_B,
      idempotencyKey: REQUEST_ID,
      role: 'user',
      content: 'cererea contului B',
    })
    await saveChatMessageOnce({
      userEmail: ACCOUNT_A,
      idempotencyKey: REQUEST_ID,
      role: 'assistant',
      content: 'gata',
    })

    expect(fake.messages).toHaveLength(3)
    expect([...fake.messages.values()]).toEqual(expect.arrayContaining([
      { role: 'user', content: 'trimite emailul' },
      { role: 'user', content: 'cererea contului B' },
      { role: 'assistant', content: 'gata' },
    ]))
  })
})

describe('chat replay minimisation', () => {
  it('hashes stable request semantics, not timestamps, coordinates or network state', () => {
    const one = hashChatReplayRequest({
      messages: [{ role: 'user', content: 'trimite emailul', ts: 1 }],
      coords: { lat: 1, lon: 2 },
      retea: 'wifi',
      now: '2026-01-01T00:00:00Z',
    })
    const retry = hashChatReplayRequest({
      messages: [{ role: 'user', content: 'trimite emailul', ts: 9 }],
      coords: { lat: 8, lon: 9 },
      retea: '4g',
      now: '2026-01-02T00:00:00Z',
    })
    expect(retry).toBe(one)
    expect(hashChatReplayRequest({ messages: [{ role: 'user', content: 'alt email' }] })).not.toBe(one)
  })

  it('binds the UUID to the complete conversation and media sequence', () => {
    const base = hashChatReplayRequest({
      messages: [
        { role: 'user', content: 'Destinatarul este A.' },
        { role: 'assistant', content: 'Am înțeles.' },
        { role: 'user', content: 'Trimite-l.' },
      ],
      images: ['data:image/jpeg;base64,one', 'data:image/jpeg;base64,two'],
    })
    expect(hashChatReplayRequest({
      messages: [
        { role: 'user', content: 'Destinatarul este B.' },
        { role: 'assistant', content: 'Am înțeles.' },
        { role: 'user', content: 'Trimite-l.' },
      ],
      images: ['data:image/jpeg;base64,one', 'data:image/jpeg;base64,two'],
    })).not.toBe(base)
    expect(hashChatReplayRequest({
      messages: [
        { role: 'user', content: 'Destinatarul este A.' },
        { role: 'assistant', content: 'Am înțeles.' },
        { role: 'user', content: 'Trimite-l.' },
      ],
      images: ['data:image/jpeg;base64,two', 'data:image/jpeg;base64,one'],
    })).not.toBe(base)
  })

  it('keeps visible text while dropping split control/audio frames', () => {
    const ctrl = String.fromCharCode(31)
    const capture = createChatReplayCapture()
    capture.append(`Rezultat ${ctrl}{"audio":"AAAA`)
    capture.append(`BBBB","monitor":{"url":"secret"}}${ctrl}final.`)
    expect(capture.text()).toBe('Rezultat final.')
  })

  it('replays only the turn receipt and visible terminal text as SSE', () => {
    const replay = encodeChatTerminalReplay({
      turnId: TURN_ID,
      text: 'Email trimis.\nConfirmare păstrată.',
      code: 'completed',
    })
    expect(replay).toContain(`{"turn":"${TURN_ID}","replayed":true}`)
    expect(replay).toContain('data: Email trimis.\ndata: Confirmare păstrată.')
    expect(replay).not.toContain('audio')
  })
})
