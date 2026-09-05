import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import Fastify, { type FastifyInstance } from 'fastify'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authorized:true,record:vi.fn(async () => undefined),
  workerStatus:vi.fn(async () => undefined),serviceStatus:vi.fn(async () => undefined),
  workerClaim:vi.fn(async () => ({ state:'no_claimable_job',job:null })),publisherClaim:vi.fn(async () => null) }))
vi.mock('./services/constructorServiceAuth.js', async () => {
  const actual = await vi.importActual<typeof import('./services/constructorServiceAuth.js')>('./services/constructorServiceAuth.js')
  const verify = async () => state.authorized ? 'authorized' : 'unauthorized'
  return { ...actual,verifyConstructorWorkerRequest:verify,verifyPublisherRequest:verify }
})
vi.mock('./services/constructorWorker.js', async () => ({
  ...await vi.importActual<typeof import('./services/constructorWorker.js')>('./services/constructorWorker.js'),recordConstructorWorkerStatus:state.workerStatus,
}))
vi.mock('./services/constructorChainStatus.js', async () => ({
  ...await vi.importActual<typeof import('./services/constructorChainStatus.js')>('./services/constructorChainStatus.js'),recordConstructorServiceHeartbeat:state.serviceStatus,
}))
vi.mock('./services/constructorModelControl.js', () => ({ readConstructorModelSnapshot:async () => ({ state:'ready',activeProfile:'fast' }) }))
vi.mock('./services/doctorRuntimeCapability.js', async () => ({
  ...await vi.importActual<typeof import('./services/doctorRuntimeCapability.js')>('./services/doctorRuntimeCapability.js'),recordDoctorRuntimeCapability:state.record,
}))
vi.mock('./db.js', async () => ({ ...await vi.importActual<typeof import('./db.js')>('./db.js'),claimNextBuildJob:state.workerClaim }))
vi.mock('./services/constructorPipeline.js', async () => ({
  ...await vi.importActual<typeof import('./services/constructorPipeline.js')>('./services/constructorPipeline.js'),claimPublisherJob:state.publisherClaim,
}))
const { constructorRoutes } = await import('./routes/constructor.js')
const tuple = { protocol:2,guardSha256:'1'.repeat(64),workerSha256:'2'.repeat(64),publisherSha256:'3'.repeat(64) }
beforeEach(() => { state.authorized=true;vi.clearAllMocks();state.record.mockReset() })
async function app() { const server = Fastify();await server.register(constructorRoutes);return server }

async function runRealPublisherOnce(server: FastifyInstance, doctorCapability: typeof tuple | null) {
  const source = readFileSync(new URL('../../deploy/constructor-publisher.mjs', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('constructor-publisher.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'runOnce')
  expect(declarations).toHaveLength(1)
  const calls: { path: string; body: Record<string, unknown>; status: number }[] = []
  // Execute the actual production function. All filesystem, credential and Git
  // dependencies are stubs; only the real Fastify routes receive its payloads.
  // In particular, the test does not create or repair the heartbeat's detail.
  const run = runInNewContext(`${declarations[0].getText(parsed)}\nrunOnce()`, {
    process: { env: {} },
    STATE: 'unused-state', API: 'http://unused.invalid', PREFIX: 'x-constructor-publisher', ASKPASS: 'unused-askpass',
    loadSystemdCredential: () => ({ value: 'unused-test-secret' }),
    assertEnabledLayout: () => undefined,
    mkdirSync: () => undefined,
    tokenPath: () => ({ value: 'unused-test-token', path: 'unused-token-file' }),
    prepareCommitSigning: () => ({}),
    publisherUpstreamPreflight: async () => undefined,
    reportPublisherPreflightFailure: async () => { throw new Error('unexpected_preflight_failure') },
    gitEnv: (env: unknown) => env,
    measureDoctorCapability: () => doctorCapability,
    postInternal: async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
      const response = await server.inject({ method: 'POST', url: path, payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
      calls.push({ path, body, status: response.statusCode })
      if (response.statusCode >= 400) throw new Error(`publisher_http_${response.statusCode}`)
      return response.statusCode === 204 ? null : response.json()
    },
  }) as Promise<void>
  return { run, calls }
}

describe('Doctor capability travels only across existing signed service routes', () => {
  it.each([tuple, null])('accepts the real publisher runOnce heartbeat before reading the queue (capability %j)', async (doctorCapability) => {
    const server = await app()
    try {
      const { run, calls } = await runRealPublisherOnce(server, doctorCapability)
      await run
      expect(calls.map(({ path, status }) => ({ path, status }))).toEqual([
        { path: '/api/internal/constructor-publisher/heartbeat', status: 200 },
        { path: '/api/internal/constructor-publisher/jobs/claim', status: 204 },
      ])
      expect(state.record).toHaveBeenCalledWith('publisher', doctorCapability)
      expect(state.serviceStatus).toHaveBeenNthCalledWith(1, 'publisher', 'ready', calls[0].body.detail)
      expect(state.publisherClaim).toHaveBeenCalledExactlyOnceWith(undefined, doctorCapability)
    } finally { await server.close() }
  })
  it('does not claim a job when the real publisher heartbeat cannot be persisted', async () => {
    const server = await app()
    try {
      state.record.mockRejectedValueOnce(new Error('private persistence diagnostic'))
      const { run, calls } = await runRealPublisherOnce(server, tuple)
      await expect(run).rejects.toThrow('publisher_http_503')
      expect(calls.map(({ path, status }) => ({ path, status }))).toEqual([
        { path: '/api/internal/constructor-publisher/heartbeat', status: 503 },
      ])
      expect(state.publisherClaim).not.toHaveBeenCalled()
      expect(state.serviceStatus).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('authenticates before persisting capabilities or attempting either claim', async () => {
    const server = await app();state.authorized=false
    try {
      for (const [url,payload] of [
        ['/api/internal/codex/status',{ status:'ready',doctorCapability:tuple }],
        ['/api/internal/codex/jobs/claim',{ profile:'fast',doctorCapability:tuple }],
        ['/api/internal/constructor-publisher/heartbeat',{ state:'ready',detail:'verified',doctorCapability:tuple }],
        ['/api/internal/constructor-publisher/jobs/claim',{ doctorCapability:tuple }],
      ] as const) expect((await server.inject({ method:'POST',url,payload })).statusCode).toBe(401)
      expect(state.record).not.toHaveBeenCalled();expect(state.workerClaim).not.toHaveBeenCalled();expect(state.publisherClaim).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('records exact measurements but refuses path-only protocol and added authority', async () => {
    const server = await app()
    try {
      for (const [url,base,service] of [
        ['/api/internal/codex/status',{ status:'ready' },'worker'],
        ['/api/internal/constructor-publisher/heartbeat',{ state:'ready',detail:'verified' },'publisher'],
      ] as const) {
        for (const doctorCapability of [{ ...tuple,protocol:1 },{ ...tuple,override:true }]) {
          expect((await server.inject({ method:'POST',url,payload:{ ...base,doctorCapability } })).statusCode).toBe(400)
        }
        expect((await server.inject({ method:'POST',url,payload:{ ...base,doctorCapability:tuple } })).statusCode).toBe(200)
        expect(state.record).toHaveBeenCalledWith(service,tuple)
      }
    } finally { await server.close() }
  })
  it('propagates claim capability unchanged and keeps old admin wire accepted without inventing one', async () => {
    const server = await app()
    try {
      for (const doctorCapability of [undefined,tuple]) {
        const field = doctorCapability ? { doctorCapability } : {}
        expect((await server.inject({ method:'POST',url:'/api/internal/codex/jobs/claim',payload:{ profile:'fast',...field } })).statusCode).toBe(200)
        expect(state.workerClaim).toHaveBeenLastCalledWith(expect.stringMatching(/^codex-/),'fast',doctorCapability)
        expect((await server.inject({ method:'POST',url:'/api/internal/constructor-publisher/jobs/claim',payload:field })).statusCode).toBe(204)
        expect(state.publisherClaim).toHaveBeenLastCalledWith(undefined,doctorCapability)
      }
    } finally { await server.close() }
  })
  it('returns non-success if the capability measurement cannot be persisted', async () => {
    const server = await app()
    try {
      state.record.mockRejectedValueOnce(new Error('private credential'))
      const response = await server.inject({ method:'POST',url:'/api/internal/codex/status',payload:{ status:'ready',doctorCapability:tuple } })
      expect(response.statusCode).toBe(503)
      expect(response.body).not.toContain('private credential')
      expect(state.workerStatus).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
})
