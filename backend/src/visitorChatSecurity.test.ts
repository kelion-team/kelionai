import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from 'jsonwebtoken'
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const capturat = vi.hoisted(() => ({
  scrise: [] as Array<{ conv: string; role: string; text: string }>,
  citit: '',
  vizita: [] as unknown[],
  lead: [] as unknown[],
}))

vi.mock('./config.js', () => ({ config: { sessionSecret: 's'.repeat(64), isProd: false, visitor: { chatTtlSeconds: 3_600 } } }))
vi.mock('./session.js', () => ({ getSessionUser: () => null }))
vi.mock('./db.js', () => ({
  logVisit: vi.fn(async (...args: unknown[]) => { capturat.vizita = args }),
  touchVisit: vi.fn(async () => true),
  addLead: vi.fn(async (...args: unknown[]) => { capturat.lead = args; return true }),
  addVisitorMessage: vi.fn(async (conv: string, role: string, text: string) => {
    capturat.scrise.push({ conv, role, text })
    return capturat.scrise.length
  }),
  getVisitorMessages: vi.fn(async (conv: string) => {
    capturat.citit = conv
    return []
  }),
}))

const { demoRoutes } = await import('./routes/demo.js')

async function aplicatie() {
  const app = Fastify()
  await app.register(cookie)
  await app.register(demoRoutes)
  return app
}

function numaiCookie(header: string): string { return header.split(';')[0] ?? '' }

beforeEach(() => { capturat.scrise = []; capturat.citit = ''; capturat.vizita = []; capturat.lead = [] })

describe('visitor chat — handle emis de server', () => {
  it('presence ping anonim este 401', async () => {
    const app = await aplicatie()
    expect((await app.inject({ method: 'POST', url: '/api/visit/ping', payload: { path: 'app' } })).statusCode).toBe(401)
  })

  it('send/poll fără cookie semnat sunt refuzate', async () => {
    const app = await aplicatie()
    expect((await app.inject({ method: 'POST', url: '/api/visitor-chat/send', payload: { text: 'salut' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/visitor-chat/poll?after=0' })).statusCode).toBe(401)
  })

  it('conversation id este criptografic, doar în cookie HttpOnly și nu poate fi ales din body/query', async () => {
    const app = await aplicatie()
    const start = await app.inject({ method: 'POST', url: '/api/visitor-chat/session' })
    expect(start.statusCode).toBe(200)
    const set = String(start.headers['set-cookie'] ?? '')
    expect(set).toMatch(/HttpOnly/i)
    const c = numaiCookie(set)
    const trimis = await app.inject({
      method: 'POST', url: '/api/visitor-chat/send', headers: { cookie: c },
      payload: { text: 'salut', conv: 'A'.repeat(40) },
    })
    expect(trimis.statusCode).toBe(200)
    expect(capturat.scrise[0]?.conv).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(capturat.scrise[0]?.conv).not.toBe('A'.repeat(40))
    const poll = await app.inject({ method: 'GET', url: `/api/visitor-chat/poll?after=0&conv=${'B'.repeat(40)}`, headers: { cookie: c } })
    expect(poll.statusCode).toBe(200)
    expect(capturat.citit).toBe(capturat.scrise[0]?.conv)
  })

  it('cookie expirat primește 410, iar token arbitrar 401', async () => {
    const app = await aplicatie()
    const key = createHmac('sha256', 's'.repeat(64)).update('kelion:visitor-chat-cookie:v1').digest()
    const expirat = jwt.sign({ scope: 'visitor-chat', conv: 'A'.repeat(43) }, key, { expiresIn: -1 })
    expect((await app.inject({ method: 'GET', url: '/api/visitor-chat/poll?after=0', headers: { cookie: `kelion_visitor_chat=${expirat}` } })).statusCode).toBe(410)
    expect((await app.inject({ method: 'GET', url: '/api/visitor-chat/poll?after=0', headers: { cookie: 'kelion_visitor_chat=fals' } })).statusCode).toBe(401)
  })

  it('refresh-ul reutilizează cookie-ul valid și păstrează conversația', async () => {
    const app = await aplicatie()
    const first = await app.inject({ method: 'POST', url: '/api/visitor-chat/session' })
    const cookie = numaiCookie(String(first.headers['set-cookie'] ?? ''))
    const second = await app.inject({ method: 'POST', url: '/api/visitor-chat/session', headers: { cookie } })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toMatchObject({ ok: true, reused: true })
    expect(second.headers['set-cookie']).toBeUndefined()
  })

  it('beacon-ul păstrează numai path sigur și țară internă validă', async () => {
    const app = await aplicatie()
    await app.inject({
      method: 'POST', url: '/api/visit',
      headers: { 'x-kelion-country': 'gb', 'user-agent': 'private-device' },
      payload: { path: '/app', ref: 'https://private.example/person' },
    })
    expect(capturat.vizita).toEqual(['GB', '/app'])
  })

  it('lead-ul cere UUID v4 submissionSession și nu acceptă fp', async () => {
    const app = await aplicatie()
    expect((await app.inject({ method: 'POST', url: '/api/lead', payload: { email: 'a@example.com', fp: 'legacy' } })).statusCode).toBe(400)
    const submissionSession = '550e8400-e29b-41d4-a716-446655440000'
    expect((await app.inject({ method: 'POST', url: '/api/lead', payload: { email: 'a@example.com', note: 'salut', submissionSession } })).statusCode).toBe(200)
    expect(capturat.lead).toEqual(['a@example.com', 'salut', submissionSession])
  })

  it('after și text sunt strict plafonate', async () => {
    const app = await aplicatie()
    const start = await app.inject({ method: 'POST', url: '/api/visitor-chat/session' })
    const c = numaiCookie(String(start.headers['set-cookie'] ?? ''))
    expect((await app.inject({ method: 'GET', url: '/api/visitor-chat/poll?after=-1', headers: { cookie: c } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/visitor-chat/send', headers: { cookie: c }, payload: { text: 'x'.repeat(2001) } })).statusCode).toBe(400)
  })
})
