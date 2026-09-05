import { afterAll,beforeEach,expect,it,vi } from 'vitest'
import type { FastifyRequest } from 'fastify'

const state = vi.hoisted(() => ({ record:{} as Record<string,unknown> }))
vi.mock('./db.js',() => ({
  readAndTouchAuthSession:vi.fn(async () => state.record),
  consumeNativeChannelTicket:vi.fn(async () => state.record),
  createAuthSession:vi.fn(),revokeAuthSession:vi.fn(),
}))
const { config } = await import('./config.js')
const originalAdmin = config.adminEmail
afterAll(() => { config.adminEmail = originalAdmin })
const { SESSION_COOKIE,hydrateSession,hydrateSessionFromChannelTicket,getSessionUser,sessionTokenHash,isNativeBearerSession } = await import('./session.js')
const token = 'x'.repeat(43)
const request = (headers:Record<string,string> = {}): FastifyRequest => ({ method:'GET',headers } as FastifyRequest)

beforeEach(() => {
  config.adminEmail = 'owner@example.test'
  state.record = { email:config.adminEmail,name:'Fixture',picture:'',authProvider:'google',locale:'ro',
    authenticatedAt:Date.now(),sessionKind:'browser',deviceId:null }
})

it('rejects local and legacy owner records on cookie, native bearer and channel-ticket hydration',async () => {
  for (const provider of ['local',undefined]) {
    state.record.authProvider = provider
    state.record.email = ` ${config.adminEmail.toUpperCase()} `
    state.record.sessionKind = 'browser'
    const browser = request({ cookie:`${SESSION_COOKIE}=${token}` })
    await hydrateSession(browser)
    expect(getSessionUser(browser)).toBeNull()
    expect(sessionTokenHash(browser)).toBeNull()
    state.record.sessionKind = 'native'
    const bearer = request({ authorization:`Bearer ${token}` })
    await hydrateSession(bearer)
    expect(getSessionUser(bearer)).toBeNull()
    expect(isNativeBearerSession(bearer)).toBe(false)
    const channel = request({ 'sec-websocket-protocol':`kelion-native, kelion-ticket.${token}` })
    expect(await hydrateSessionFromChannelTicket(channel,'vocal-live')).toBe(false)
    expect(getSessionUser(channel)).toBeNull()
    expect(isNativeBearerSession(channel)).toBe(false)
  }
})

it('keeps a verified Google owner usable on browser and native channel',async () => {
  const browser = request({ cookie:`${SESSION_COOKIE}=${token}` })
  await hydrateSession(browser)
  expect(getSessionUser(browser)).toMatchObject({ email:config.adminEmail,authProvider:'google',role:'admin' })
  expect(sessionTokenHash(browser)).toMatch(/^[0-9a-f]{64}$/)
  state.record.sessionKind = 'native'
  const channel = request({ 'sec-websocket-protocol':`kelion-native, kelion-ticket.${token}` })
  expect(await hydrateSessionFromChannelTicket(channel,'apel')).toBe(true)
  expect(getSessionUser(channel)?.role).toBe('admin')
})

it('keeps legitimate local, legacy and Google customer records as customer identities',async () => {
  for (const provider of ['local',undefined,'google']) {
    state.record.authProvider = provider
    state.record.email = 'customer@example.test'
    const browser = request({ cookie:`${SESSION_COOKIE}=${token}` })
    await hydrateSession(browser)
    expect(getSessionUser(browser)).toMatchObject({ email:'customer@example.test',role:'customer' })
  }
})
