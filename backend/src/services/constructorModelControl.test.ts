import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestInternalService } = vi.hoisted(() => ({ requestInternalService: vi.fn() }))

vi.mock('../config.js', () => ({
  config: {
    constructorModelControl: {
      enabled: true,
      socket: '/run/kelion-constructor-model-control/control.sock',
      secret: 'm'.repeat(32),
    },
  },
}))
vi.mock('./internalServiceRequest.js', () => ({ requestInternalService }))

const {
  ConstructorModelControlError,
  parseConstructorModelSnapshot,
  readConstructorModelSnapshot,
  requestConstructorModelSwitch,
} = await import('./constructorModelControl.js')

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000'
const PROFILES = [
  { id: 'powerful', label: 'Puternic', model: 'qwen3.5-122b-a10b-local', installed: true },
  { id: 'fast', label: 'Rapid', model: 'qwen3.6-35b-a3b-local', installed: true },
]

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'manual',
    defaultProfile: 'fast',
    profiles: PROFILES,
    activeProfile: 'fast',
    activeModel: 'qwen3.6-35b-a3b-local',
    state: 'ready',
    requestedProfile: null,
    requestId: null,
    verifiedAt: '2026-09-01T12:00:00.000Z',
    error: null,
    ...overrides,
  }
}

function controllerState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'manual',
    defaultProfile: 'fast',
    status: 'ready',
    activeProfile: 'fast',
    requestedProfile: null,
    requestId: null,
    installedProfiles: ['fast', 'powerful'],
    ...overrides,
  }
}

function measuredSnapshot() {
  const measured = parseConstructorModelSnapshot(snapshot())
  if (!measured) throw new Error('invalid test snapshot')
  return measured
}

describe('Constructor model control client', () => {
  beforeEach(() => requestInternalService.mockReset())

  it('accepts only a coherent measured snapshot and canonicalizes profile order', () => {
    expect(parseConstructorModelSnapshot(snapshot())).toMatchObject({
      mode: 'manual',
      defaultProfile: 'fast',
      profiles: [
        expect.objectContaining({ id: 'fast' }),
        expect.objectContaining({ id: 'powerful' }),
      ],
      activeProfile: 'fast',
      state: 'ready',
    })
    expect(parseConstructorModelSnapshot({ ...snapshot(), surprise: true })).toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({ activeModel: 'qwen3.5-122b-a10b-local' }))).toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({ verifiedAt: null }))).toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({ profiles: [PROFILES[0], PROFILES[0]] }))).toBeNull()
  })

  it('validates switching, failed and unavailable state invariants', () => {
    expect(parseConstructorModelSnapshot(snapshot({
      state: 'switching', requestedProfile: 'powerful', requestId: REQUEST_ID,
    }))).not.toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({
      state: 'switching', requestedProfile: 'powerful', requestId: null,
    }))).toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({ state: 'failed', error: 'activation_failed' }))).not.toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({
      state: 'unavailable', activeProfile: null, activeModel: null, verifiedAt: null,
      error: 'model_unreachable',
    }))).not.toBeNull()
    expect(parseConstructorModelSnapshot(snapshot({ state: 'unavailable', error: 'model_unreachable' }))).toBeNull()
  })

  it('reads state only through the bounded signed Unix-socket transport', async () => {
    requestInternalService.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(controllerState())) })
    await expect(readConstructorModelSnapshot(new Date('2026-09-01T12:00:00.000Z'))).resolves.toMatchObject({
      activeProfile: 'fast',
      activeModel: 'qwen3.6-35b-a3b-local',
      verifiedAt: '2026-09-01T12:00:00.000Z',
      profiles: [
        expect.objectContaining({ id: 'fast', installed: true }),
        expect.objectContaining({ id: 'powerful', installed: true }),
      ],
    })
    expect(requestInternalService).toHaveBeenCalledWith({
      socketPath: '/run/kelion-constructor-model-control/control.sock',
      secret: 'm'.repeat(32),
      path: '/v1/model/state',
      body: Buffer.from('{}'),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxResponseBytes: 32 * 1024,
    })
  })

  it('accepts only a correlated 202 switch snapshot', async () => {
    requestInternalService.mockResolvedValueOnce({
      status: 202,
      body: Buffer.from(JSON.stringify({ accepted: true, requestId: REQUEST_ID, profile: 'powerful' })),
    }).mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(JSON.stringify(controllerState({
        status: 'switching', requestedProfile: 'powerful', requestId: REQUEST_ID,
      }))),
    })
    await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, measuredSnapshot())).resolves.toMatchObject({
      statusCode: 202,
      snapshot: { state: 'switching', requestedProfile: 'powerful', requestId: REQUEST_ID },
    })
    const body = requestInternalService.mock.calls[0][0].body as Buffer
    expect(JSON.parse(body.toString('utf8'))).toEqual({ requestId: REQUEST_ID, profile: 'powerful' })

    requestInternalService.mockResolvedValueOnce({
      status: 202,
      body: Buffer.from(JSON.stringify({
        accepted: true,
        requestId: '223e4567-e89b-42d3-a456-426614174000',
        profile: 'powerful',
      })),
    })
    await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, measuredSnapshot())).rejects.toMatchObject({
      statusCode: 503,
      publicCode: 'constructor_model_control_unavailable',
    })
  })

  it.each(['switching', 'failed', 'unavailable'])(
    'refuses service-level switch from %s without contacting the controller',
    async (state) => {
      const before = parseConstructorModelSnapshot(snapshot({
        state,
        ...(state === 'switching'
          ? { requestedProfile: 'powerful', requestId: REQUEST_ID }
          : state === 'failed'
            ? { error: 'activation_failed' }
            : { activeProfile: null, activeModel: null, verifiedAt: null, error: 'model_unreachable' }),
      }))
      expect(before).not.toBeNull()
      await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, before!)).rejects.toMatchObject({
        statusCode: 503,
        publicCode: 'constructor_model_control_unavailable',
      })
      expect(requestInternalService).not.toHaveBeenCalled()
    },
  )

  it('accepts a switch completed between the 202 ACK and the measured reread', async () => {
    requestInternalService.mockResolvedValueOnce({
      status: 202,
      body: Buffer.from(JSON.stringify({ accepted: true, requestId: REQUEST_ID, profile: 'powerful' })),
    }).mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(JSON.stringify(controllerState({
        activeProfile: 'powerful',
      }))),
    })
    await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, measuredSnapshot())).resolves.toMatchObject({
      statusCode: 200,
      snapshot: { state: 'ready', activeProfile: 'powerful', requestedProfile: null, requestId: null },
    })

    requestInternalService.mockResolvedValueOnce({
      status: 202,
      body: Buffer.from(JSON.stringify({ accepted: true, requestId: REQUEST_ID, profile: 'powerful' })),
    }).mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(JSON.stringify(controllerState({ activeProfile: 'fast' }))),
    })
    await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, measuredSnapshot())).resolves.toMatchObject({
      statusCode: 202,
      snapshot: { state: 'switching', requestedProfile: 'powerful', requestId: REQUEST_ID },
    })

    requestInternalService.mockResolvedValueOnce({
      status: 202,
      body: Buffer.from(JSON.stringify({ accepted: true, requestId: REQUEST_ID, profile: 'powerful' })),
    }).mockRejectedValueOnce(new Error('reread timeout after durable ACK'))
    await expect(requestConstructorModelSwitch('powerful', REQUEST_ID, measuredSnapshot())).resolves.toMatchObject({
      statusCode: 202,
      snapshot: { state: 'switching', requestedProfile: 'powerful', requestId: REQUEST_ID },
    })
  })

  it('projects only known conflicts and rejects malformed controller output', async () => {
    requestInternalService.mockResolvedValueOnce({
      status: 409,
      body: Buffer.from('{"error":"worker_active"}'),
    })
    await expect(requestConstructorModelSwitch('fast', REQUEST_ID, measuredSnapshot())).rejects.toEqual(
      new ConstructorModelControlError(409, 'constructor_busy'),
    )

    requestInternalService.mockResolvedValueOnce({ status: 200, body: Buffer.from('{"activeProfile":"fast"}') })
    await expect(readConstructorModelSnapshot()).rejects.toMatchObject({ statusCode: 503 })

    requestInternalService.mockRejectedValueOnce(new Error('socket down'))
    await expect(readConstructorModelSnapshot()).rejects.toMatchObject({
      statusCode: 503,
      publicCode: 'constructor_model_control_unavailable',
    })
  })
})
