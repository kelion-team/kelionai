import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listBuildJobs } = vi.hoisted(() => ({ listBuildJobs: vi.fn() }))

vi.mock('../db.js', () => ({ listBuildJobs }))
vi.mock('../session.js', () => ({
  cerAdmin: (req: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (req.headers['x-test-admin'] === 'yes') return { email: 'admin@example.invalid' }
    reply.code(401).send({ error: 'unauthorized' })
    return null
  },
}))

const { default: deployRoutes } = await import('./deploy.js')

const BASE_JOB = {
  id: 7,
  orderedBy: 'admin@example.invalid',
  orderText: 'deploy',
  status: 'running',
  attempts: 1,
  branch: null,
  prUrl: null,
  tokens: 0,
  log: null,
  progress: 'rulează porțile',
  ci: null,
  brain: 'OpenCode + Qwen local (llama.cpp)',
  costUsd: null,
  constructorTaskId: 'codex-task',
  constructorStage: 'working',
  commit: null,
  liveVersion: null,
  createdAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:01:00.000Z',
}

describe('deploy progress is a read-only projection of durable Constructor jobs', () => {
  beforeEach(() => listBuildJobs.mockReset())

  it('does not disclose progress without an admin session', async () => {
    const app = Fastify()
    await app.register(deployRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/deploy/progress' })
    expect(response.statusCode).toBe(401)
    expect(listBuildJobs).not.toHaveBeenCalled()
    await app.close()
  })

  it('fails visibly when durable state cannot be read', async () => {
    listBuildJobs.mockResolvedValue(null)
    const app = Fastify()
    await app.register(deployRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/deploy/progress', headers: { 'x-test-admin': 'yes' } })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ ok: false, error: 'deploy_state_unavailable' })
    await app.close()
  })

  it('derives running progress from the signed job instead of accepting a write endpoint', async () => {
    listBuildJobs.mockResolvedValue([BASE_JOB])
    const app = Fastify()
    await app.register(deployRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/deploy/progress', headers: { 'x-test-admin': 'yes' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().state).toMatchObject({
      status: 'running', jobId: '7', step: 'working', message: 'rulează porțile', commit: null, liveVersion: null,
    })
    const retiredWriter = await app.inject({ method: 'POST', url: '/api/deploy/progress', headers: { 'x-test-admin': 'yes' }, payload: {} })
    expect(retiredWriter.statusCode).toBe(404)
    await app.close()
  })

  it('reports success only with deployed stage, commit and live version', async () => {
    listBuildJobs.mockResolvedValue([{
      ...BASE_JOB,
      status: 'done',
      constructorStage: 'deployed',
      progress: 'live verificat',
      commit: 'a'.repeat(40),
      liveVersion: 'a'.repeat(40),
    }])
    const app = Fastify()
    await app.register(deployRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/deploy/progress', headers: { 'x-test-admin': 'yes' } })
    expect(response.json().state).toMatchObject({ status: 'success', percent: 100, commit: 'a'.repeat(40), liveVersion: 'a'.repeat(40) })
    await app.close()
  })
})
