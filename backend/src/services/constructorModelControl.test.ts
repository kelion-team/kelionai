import { beforeEach, describe, expect, it, vi } from 'vitest'
const { requestInternalService } = vi.hoisted(() => ({ requestInternalService: vi.fn() }))
vi.mock('../config.js', () => ({ config: { constructorModelControl: {
  enabled: true, socket: '/run/kelion-constructor-model-control/control.sock', secret: 'm'.repeat(32),
} } }))
vi.mock('./internalServiceRequest.js', () => ({ requestInternalService }))
const { parseConstructorModelSnapshot, readConstructorModelSnapshot } = await import('./constructorModelControl.js')
const model = { id: 'fixture/engine', label: 'Configured engine', provider: 'fixture' }
const state = {
  mode: 'manual', defaultProfile: 'fast', model, status: 'ready', activeProfile: 'fast',
  requestedProfile: null, requestId: null, installedProfiles: ['fast'],
}
const response = (value: unknown, status = 200) => ({ status, body: Buffer.from(JSON.stringify(value)) })
const measuredAt = new Date('2026-09-05T05:00:00.000Z')
describe('configured Constructor engine contract', () => {
  beforeEach(() => { requestInternalService.mockReset() })
  it('projects model metadata from the controller, not an old local profile catalog', async () => {
    requestInternalService.mockResolvedValue(response(state))
    const snapshot = await readConstructorModelSnapshot(measuredAt)
    expect(snapshot).toEqual({
      mode: 'manual', defaultProfile: 'fast', model, activeProfile: 'fast', activeModel: model.id,
      profiles: [{ id: 'fast', label: model.label, model: model.id, installed: true }],
      state: 'ready', requestedProfile: null, requestId: null, verifiedAt: measuredAt.toISOString(), error: null,
    })
    expect(requestInternalService).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/model/state', socketPath: '/run/kelion-constructor-model-control/control.sock',
      timeoutMs: 10_000, maxResponseBytes: 32768,
    }))
  })
  it.each([
    { status: 'switching' }, { activeProfile: 'powerful' }, { installedProfiles: ['fast', 'powerful'] },
    { requestedProfile: 'fast' }, { requestId: '123e4567-e89b-42d3-a456-426614174000' },
    { model: null }, { model: { ...model, provider: 'another' } }, { secret: 'unexpected' },
    { model: { ...model, label: 'engine\ninjected' } }, { installedProfiles: [] },
    { model: null, status: 'unavailable', activeProfile: null, installedProfiles: ['fast'] },
  ])('refuses contradictory or unsafe controller state %j', async (overrides) => {
    requestInternalService.mockResolvedValue(response({ ...state, ...overrides }))
    await expect(readConstructorModelSnapshot()).rejects.toThrow('constructor_model_control_unavailable')
  })
  it('keeps configuration distinct from availability and never assumes the engine is active', async () => {
    requestInternalService.mockResolvedValue(response({ ...state, status: 'unavailable', activeProfile: null }))
    expect(await readConstructorModelSnapshot()).toMatchObject({
      model, state: 'unavailable', activeProfile: null, activeModel: null, verifiedAt: null,
      profiles: [{ id: 'fast', installed: true }], error: 'constructor_model_unavailable',
    })
    requestInternalService.mockResolvedValue(response({ ...state, model: null, status: 'unavailable', activeProfile: null, installedProfiles: [] }))
    expect(await readConstructorModelSnapshot()).toMatchObject({ model: null, profiles: [], state: 'unavailable' })
  })
  it('rejects response failures and malformed JSON without leaking private error details', async () => {
    requestInternalService.mockResolvedValue(response({}, 503))
    await expect(readConstructorModelSnapshot()).rejects.toThrow('constructor_model_control_unavailable')
    requestInternalService.mockResolvedValue({ status: 200, body: Buffer.from('invalid') })
    await expect(readConstructorModelSnapshot()).rejects.toThrow('constructor_model_control_unavailable')
    requestInternalService.mockRejectedValue(new Error('/private/token-detail'))
    await expect(readConstructorModelSnapshot()).rejects.toThrow('constructor_model_control_unavailable')
  })
  it('validates its public projection strictly', async () => {
    requestInternalService.mockResolvedValue(response(state))
    const snapshot = await readConstructorModelSnapshot(measuredAt)
    expect(parseConstructorModelSnapshot(snapshot)).toEqual(snapshot)
    for (const change of [{ activeModel: 'another/model' }, { verifiedAt: 'yesterday' },
      { state: 'unavailable' }, { profiles: [] }, { command: 'shell' }]) {
      expect(parseConstructorModelSnapshot({ ...snapshot, ...change })).toBeNull()
    }
  })
})
