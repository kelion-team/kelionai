import { describe, expect, it } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'
import {
  SESSION_COOKIE,
  clearSession,
  createNativeSession,
  getSessionUser,
  hydrateSession,
  sessionRoleFor,
  setSession,
  trustedMutationOrigin,
  validateWebSocketSession,
  webSocketSessionUser,
} from './session.js'

function request(
  cookie = '',
  method = 'GET',
  origin?: string,
  extraHeaders: Record<string, string> = {},
): FastifyRequest {
  return {
    method,
    headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...(origin ? { origin } : {}), ...extraHeaders },
    cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
  } as unknown as FastifyRequest
}

function replyCapture(): {
  reply: FastifyReply
  cookie: () => string
  cleared: () => boolean
} {
  let value = ''
  let wasCleared = false
  return {
    reply: {
      setCookie: (_name: string, token: string) => { value = token },
      clearCookie: () => { wasCleared = true },
    } as unknown as FastifyReply,
    cookie: () => value,
    cleared: () => wasCleared,
  }
}

function validationReplyCapture(): {
  reply: FastifyReply
  status: () => number | undefined
  payload: () => unknown
} {
  let responseStatus: number | undefined
  let responsePayload: unknown
  const reply = {
    code(value: number) {
      responseStatus = value
      return reply
    },
    send(value: unknown) {
      responsePayload = value
      return reply
    },
  }
  return {
    reply: reply as unknown as FastifyReply,
    status: () => responseStatus,
    payload: () => responsePayload,
  }
}

describe('opaque and revocable sessions', () => {
  it('stores only an opaque random handle in the cookie', async () => {
    const capture = replyCapture()
    await setSession(capture.reply, {
      email: 'customer@example.com',
      name: 'Customer',
      picture: '',
      role: 'customer',
      authProvider: 'local',
      locale: 'en',
    })
    const token = capture.cookie()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain('.')
    expect(token).not.toContain('customer')

    const req = request(token)
    await hydrateSession(req)
    expect(getSessionUser(req)?.email).toBe('customer@example.com')
  })

  it('rejects historical JWT cookies and test-auth headers', async () => {
    const legacy = request('header.payload.signature', 'GET', undefined, {
      'x-test-auth': 'irrelevant',
    })
    await hydrateSession(legacy)
    expect(getSessionUser(legacy)).toBeNull()
  })

  it('revokes the server-side session on logout', async () => {
    const capture = replyCapture()
    await setSession(capture.reply, {
      email: 'customer@example.com',
      name: 'Customer',
      picture: '',
      role: 'customer',
      authProvider: 'local',
      locale: 'en',
    })
    const req = request(capture.cookie())
    await hydrateSession(req)
    await clearSession(req, capture.reply)
    expect(capture.cleared()).toBe(true)

    const replay = request(capture.cookie())
    await hydrateSession(replay)
    expect(getSessionUser(replay)).toBeNull()
  })

  it('does not rotate a handle during concurrent ordinary reads', async () => {
    const capture = replyCapture()
    await setSession(capture.reply, {
      email: 'customer@example.com',
      name: 'Customer',
      picture: '',
      role: 'customer',
      authProvider: 'local',
      locale: 'en',
    })
    const token = capture.cookie()
    const [first, second] = [request(token), request(token)]
    await Promise.all([hydrateSession(first), hydrateSession(second)])
    expect(getSessionUser(first)?.email).toBe('customer@example.com')
    expect(getSessionUser(second)?.email).toBe('customer@example.com')
    expect(capture.cookie()).toBe(token)
  })

  it('separates native bearer sessions from browser cookies', async () => {
    const native = await createNativeSession({
      email: 'native@example.com', name: 'Native', picture: '', role: 'customer',
      authProvider: 'google', locale: 'en',
    }, '4c974ca2-9d0a-4d8f-99ce-e9381b941123')
    const nativeOrigin = config.product.nativeOrigins[0]
    const bearer = request('', 'POST', nativeOrigin, { authorization: `Bearer ${native.accessToken}` })
    await hydrateSession(bearer)
    expect(getSessionUser(bearer)?.email).toBe('native@example.com')
    expect(trustedMutationOrigin(bearer)).toBe(true)

    const ambientCookie = request(native.accessToken, 'GET', nativeOrigin)
    await hydrateSession(ambientCookie)
    expect(getSessionUser(ambientCookie)).toBeNull()

    const browserCapture = replyCapture()
    await setSession(browserCapture.reply, {
      email: 'browser@example.com', name: 'Browser', picture: '', role: 'customer',
      authProvider: 'local', locale: 'en',
    })
    const browserAsBearer = request('', 'GET', nativeOrigin, {
      authorization: `Bearer ${browserCapture.cookie()}`,
    })
    await hydrateSession(browserAsBearer)
    expect(getSessionUser(browserAsBearer)).toBeNull()
  })

  it('requires the exact canonical Origin on cookie-authenticated mutations', async () => {
    const capture = replyCapture()
    await setSession(capture.reply, {
      email: 'customer@example.com',
      name: 'Customer',
      picture: '',
      role: 'customer',
      authProvider: 'local',
      locale: 'en',
    })
    const expected = config.publicOrigin || config.frontendOrigin
    const accepted = request(capture.cookie(), 'POST', expected)
    await hydrateSession(accepted)
    expect(trustedMutationOrigin(accepted)).toBe(true)

    const missing = request(capture.cookie(), 'POST')
    await hydrateSession(missing)
    expect(trustedMutationOrigin(missing)).toBe(false)

    const foreign = request(capture.cookie(), 'POST', 'https://attacker.invalid')
    await hydrateSession(foreign)
    expect(trustedMutationOrigin(foreign)).toBe(false)
  })
})

describe('WebSocket session boundary', () => {
  it('accepts a hydrated session only at the canonical origin', async () => {
    const browser = replyCapture()
    await setSession(browser.reply, {
      email: 'socket@example.com', name: 'Socket', picture: '', role: 'customer',
      authProvider: 'local', locale: 'en',
    })
    const expected = config.publicOrigin || config.frontendOrigin
    const accepted = request(browser.cookie(), 'GET', expected)
    await hydrateSession(accepted)
    const acceptedReply = validationReplyCapture()
    expect(await validateWebSocketSession(accepted, acceptedReply.reply, 'apel')).toBeUndefined()
    expect(acceptedReply.status()).toBeUndefined()
    let closed = false
    expect(webSocketSessionUser(accepted, { close: () => { closed = true } })?.email)
      .toBe('socket@example.com')
    expect(closed).toBe(false)

    const foreign = request(browser.cookie(), 'GET', 'https://attacker.invalid')
    await hydrateSession(foreign)
    const denied = validationReplyCapture()
    expect(await validateWebSocketSession(foreign, denied.reply, 'vocal-live')).toBe(denied.reply)
    expect(denied.status()).toBe(403)
    expect(denied.payload()).toEqual({ error: 'origin_forbidden' })
  })

  it('rejects and closes an anonymous upgraded handler fail-closed', async () => {
    const anonymous = request('', 'GET', config.publicOrigin || config.frontendOrigin)
    const denied = validationReplyCapture()
    expect(await validateWebSocketSession(anonymous, denied.reply, 'apel')).toBe(denied.reply)
    expect(denied.status()).toBe(401)
    expect(denied.payload()).toEqual({ error: 'unauthorized' })
    let closeFrame: [number, string] | null = null
    expect(webSocketSessionUser(anonymous, {
      close: (code, reason) => { closeFrame = [code, reason] },
    })).toBeNull()
    expect(closeFrame).toEqual([1008, 'unauthorized'])
  })
})

describe('central admin identity', () => {
  it('never grants admin to local or legacy identities', () => {
    expect(sessionRoleFor(config.adminEmail, 'local')).toBe('customer')
    expect(sessionRoleFor(config.adminEmail, undefined)).toBe('customer')
  })

  it('grants admin only to configured Google identity', () => {
    expect(sessionRoleFor(config.adminEmail, 'google')).toBe('admin')
  })
})
