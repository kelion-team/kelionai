import { beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./lib/transport', () => ({ apiFetch: transport.apiFetch }))
vi.mock('./lib/workspace', () => ({
  getMonitorContent: () => null,
  getStareTranzactii: () => null,
}))
vi.mock('./lib/retea', () => ({ getTeava: () => 'wifi' }))

import { streamChat } from './lib/chat'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const TURN_ID = '22222222-2222-4222-8222-222222222222'
const CTRL = String.fromCharCode(31)

function terminalSse(text: string, replayed = false): Response {
  const body = [
    `id: 1\ndata: ${CTRL}${JSON.stringify({ turn: TURN_ID, ...(replayed ? { replayed: true } : {}) })}${CTRL}\n\n`,
    `id: 2\ndata: ${text}\n\n`,
  ].join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function brokenSse(partial: string): Response {
  const encoder = new TextEncoder()
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(encoder.encode([
          `id: 1\ndata: ${CTRL}{"turn":"${TURN_ID}"}${CTRL}\n\n`,
          `id: 2\ndata: ${partial}\n\n`,
        ].join('')))
        return
      }
      controller.error(new Error('stream broken'))
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function readTurn(onRestart = vi.fn()): Promise<string> {
  let output = ''
  for await (const chunk of streamChat(
    [{ role: 'user', content: 'trimite emailul' }],
    undefined,
    undefined,
    (control) => {
      if (control.replayRestarted) {
        output = ''
        onRestart()
      }
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    REQUEST_ID,
  )) output += chunk
  return output
}

describe('frontend chat retry identity', () => {
  beforeEach(() => {
    transport.apiFetch.mockReset()
    vi.stubGlobal('window', globalThis)
  })

  it('reuses the exact durable UUID for a retried logical turn', async () => {
    transport.apiFetch.mockImplementation(async () => terminalSse('gata'))
    await expect(readTurn()).resolves.toBe('gata')
    await expect(readTurn()).resolves.toBe('gata')

    const keys = transport.apiFetch.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { idempotencyKey: string }
      return body.idempotencyKey
    })
    expect(keys).toEqual([REQUEST_ID, REQUEST_ID])
  })

  it('polls an in-flight claim with the same UUID until terminal replay is available', async () => {
    transport.apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'turn_in_progress',
        retryAfterMs: 1,
      }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(terminalSse('replay terminal'))

    await expect(readTurn()).resolves.toBe('replay terminal')
    const keys = transport.apiFetch.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { idempotencyKey: string }
      return body.idempotencyKey
    })
    expect(keys).toEqual([REQUEST_ID, REQUEST_ID])
  })

  it('propagates a pre-stream unavailable brain as its stable configuration code', async () => {
    transport.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'brain_not_configured',
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(readTurn()).rejects.toThrow('brain_not_configured')
  })

  it('recovers a broken partial stream from terminal storage without duplicating its prefix', async () => {
    transport.apiFetch
      .mockResolvedValueOnce(brokenSse('Email tr'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'turn_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(terminalSse('Email trimis o singură dată.', true))

    await expect(readTurn()).resolves.toBe('Email trimis o singură dată.')
    const calls = transport.apiFetch.mock.calls
    expect(calls.map(([url]) => String(url))).toEqual([
      '/api/chat',
      `/api/chat/resume?turn=${TURN_ID}`,
      '/api/chat',
    ])
    const first = JSON.parse(String((calls[0][1] as RequestInit).body)) as { idempotencyKey: string }
    const retry = JSON.parse(String((calls[2][1] as RequestInit).body)) as { idempotencyKey: string }
    expect(retry.idempotencyKey).toBe(first.idempotencyKey)
  })

  it('replaces abandoned partial text when a pre-effect crash is safely re-executed', async () => {
    const restarted = vi.fn()
    transport.apiFetch
      .mockResolvedValueOnce(brokenSse('Răspuns vechi parțial'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'turn_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(terminalSse('Răspuns refăcut complet.'))

    await expect(readTurn(restarted)).resolves.toBe('Răspuns refăcut complet.')
    expect(restarted).toHaveBeenCalledTimes(1)
  })
})
