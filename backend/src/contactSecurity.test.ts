import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  stored: null as null | { id: number; emailed: boolean },
  sent: [] as Array<Record<string, unknown>>,
  marked: [] as number[],
  mailEnabled: true,
}))

vi.mock('./config.js', () => ({
  config: { mail: { forwardTo: 'internal@example.com' } },
}))
vi.mock('./db.js', () => ({
  saveContactMessage: vi.fn(async () => state.stored),
  marcheazaContactEmailat: vi.fn(async (id: number) => { state.marked.push(id) }),
}))
vi.mock('./services/mail.js', () => ({
  mailEnabled: () => state.mailEnabled,
  sendMail: vi.fn(async (message: Record<string, unknown>) => { state.sent.push(message); return true }),
}))

const { contactRoutes } = await import('./routes/contact.js')
const ID = '123e4567-e89b-42d3-a456-426614174000'
const payload = {
  submissionId: ID,
  department: 'Support',
  name: 'Customer',
  email: 'customer@example.net',
  subject: 'Question',
  message: 'Please help',
  lang: 'en',
}

beforeEach(() => {
  state.stored = { id: 7, emailed: false }
  state.sent = []
  state.marked = []
  state.mailEnabled = true
})

describe('public contact boundary', () => {
  it('requires a retry-stable UUID and durable storage', async () => {
    const app = Fastify()
    await app.register(contactRoutes)
    expect((await app.inject({ method: 'POST', url: '/api/contact', payload: { ...payload, submissionId: '' } })).statusCode).toBe(400)
    state.stored = null
    expect((await app.inject({ method: 'POST', url: '/api/contact', payload })).statusCode).toBe(503)
  })

  it('never sends an acknowledgement to an unverified anonymous address', async () => {
    const app = Fastify()
    await app.register(contactRoutes)
    const response = await app.inject({ method: 'POST', url: '/api/contact', payload })
    expect(response.statusCode).toBe(200)
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.to).toBe('internal@example.com')
    expect(state.sent.some((entry) => entry.to === payload.email)).toBe(false)
    expect(state.marked).toEqual([7])
    expect(response.json()).toMatchObject({ stored: true, delivered: true })
  })

  it('does not re-send an already forwarded idempotent submission', async () => {
    state.stored = { id: 7, emailed: true }
    const app = Fastify()
    await app.register(contactRoutes)
    const response = await app.inject({ method: 'POST', url: '/api/contact', payload })
    expect(response.statusCode).toBe(200)
    expect(state.sent).toHaveLength(0)
    expect(response.json()).toMatchObject({ stored: true, delivered: true })
  })
})
