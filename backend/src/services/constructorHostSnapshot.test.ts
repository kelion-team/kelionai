import { beforeEach, describe, expect, it, vi } from 'vitest'
const { requestInternalService } = vi.hoisted(() => ({ requestInternalService: vi.fn() }))
vi.mock('../config.js', () => ({ config: { constructorModelControl: {
  enabled: true, socket: '/run/kelion-constructor-model-control/control.sock', secret: 'h'.repeat(32),
} } }))
vi.mock('./internalServiceRequest.js', () => ({ requestInternalService }))
import { parseConstructorHostSnapshot, readConstructorHostSnapshot } from './constructorHostSnapshot.js'

const now = Date.parse('2026-09-05T12:00:00.000Z')
const state = { schema: 1, measuredAt: new Date(now).toISOString(), intentionalPause: true,
  deployGate: false, worker: { timer: 'inactive', service: 'inactive', mainPid: 0 } }
describe('read-only independent worker host observation', () => {
  beforeEach(() => { requestInternalService.mockReset() })
  it('accepts a fresh measured pause without inventing process activity', () => {
    expect(parseConstructorHostSnapshot(state, now)).toEqual(state)
  })
  it.each([
    { measuredAt: new Date(now - 15001).toISOString() },
    { measuredAt: new Date(now + 1).toISOString() }, { measuredAt: 'yesterday' },
    { schema: 2 }, { secret: 'not-allowed' }, { intentionalPause: 'true' },
    { worker: { timer: 'inactive', service: 'active', mainPid: 123 } },
    { worker: { timer: 'inactive', service: 'inactive', mainPid: 123 } },
    { worker: { timer: 'unknown', service: 'inactive', mainPid: 0 } },
    { worker: { timer: 'inactive', service: 'inactive', mainPid: '0' } },
  ])('rejects stale, malformed or contradictory snapshots %j', (change) => {
    expect(() => parseConstructorHostSnapshot({ ...state, ...change }, now)).toThrow()
  })
  it('uses the authenticated fixed socket and bounded response', async () => {
    const fresh = { ...state, measuredAt: new Date().toISOString() }
    requestInternalService.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(fresh)) })
    expect(await readConstructorHostSnapshot()).toEqual(fresh)
    expect(requestInternalService).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/worker/state', maxResponseBytes: 2048, timeoutMs: 5000,
    }))
  })
  it('keeps failed transport, legacy missing endpoint and corrupt JSON unverified', async () => {
    for (const result of [{ status: 404, body: Buffer.from('{}') },
      { status: 503, body: Buffer.from('{}') }, { status: 200, body: Buffer.from('bad-json') }]) {
      requestInternalService.mockResolvedValue(result)
      await expect(readConstructorHostSnapshot()).rejects.toThrow('constructor_host_unavailable')
    }
    requestInternalService.mockRejectedValue(new Error('private-path'))
    await expect(readConstructorHostSnapshot()).rejects.toThrow('constructor_host_unavailable')
  })
})
