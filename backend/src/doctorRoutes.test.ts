import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  email:'owner@example.test',provider:'google',valid:true,
  grant:vi.fn(async () => undefined),revoke:vi.fn(async () => undefined),tick:vi.fn(async () => undefined),
  snapshot:vi.fn(async () => ({ checkedAt:null,error:'awaiting_first_check',state:'disabled',grant:null,incidents:[],
    limits:{ maxDurationHours:24,maxJobs:5,maxWindowHours:24 } })),
}))
vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js')
  return { ...actual,config:{ ...actual.config,isProd:false,adminEmail:'owner@example.test',
    publicOrigin:'https://kelion.example.test',frontendOrigin:'https://kelion.example.test' },
    roleFor:(email:string) => email === 'owner@example.test' ? 'admin' : 'customer' }
})
vi.mock('./db.js', () => ({ noteazaAudit:vi.fn(),createAuthSession:vi.fn(),consumeNativeChannelTicket:vi.fn(),revokeAuthSession:vi.fn(),
  readAndTouchAuthSession:vi.fn(async () => state.valid ? {
    email:state.email,name:'Fixture',picture:'',authProvider:state.provider,locale:'ro',authenticatedAt:Date.now(),sessionKind:'browser',
  } : null),
}))
vi.mock('./services/doctorStore.js', () => ({ grantDoctor:state.grant,revokeDoctor:state.revoke,doctorSnapshot:state.snapshot }))
vi.mock('./services/doctor.js', () => ({ tickDoctor:state.tick }))
const { doctorRoutes } = await import('./routes/doctor.js')
const { hydrateSession,SESSION_COOKIE } = await import('./session.js')
const headers = { cookie:`${SESSION_COOKIE}=${'x'.repeat(43)}`,origin:'https://kelion.example.test' }
const body = { scope:'measured-code-repair',durationHours:null,maxJobs:2,windowHours:24 }
beforeEach(() => { state.email='owner@example.test';state.provider='google';state.valid=true;vi.clearAllMocks() })
async function app() {
  const server = Fastify()
  server.addHook('onRequest',async (req) => hydrateSession(req))
  await server.register(doctorRoutes)
  return server
}

describe('Doctor Google authority and exact-origin mutations', () => {
  it('requires authenticated Google administrator for read and every mutation', async () => {
    const server = await app()
    try {
      for (const mode of ['absent','customer','local'] as const) {
        state.valid = mode !== 'absent'
        state.email = mode === 'customer' ? 'customer@example.test' : 'owner@example.test'
        state.provider = mode === 'local' ? 'local' : 'google'
        for (const [method,url,payload] of [
          ['GET','/api/admin/doctor',undefined],['POST','/api/admin/doctor/grant',body],
          ['DELETE','/api/admin/doctor/grant',undefined],['POST','/api/admin/doctor/tick',{}],
          ['POST','/api/admin/doctor/incidents',{ code:'public_health' }],
        ] as const) {
          const response = await server.inject({ method,url,headers,payload })
          // Local records using the owner's email now fail at hydration,
          // before a session identity can reach the admin guard.
          expect(response.statusCode).toBe(mode === 'customer' ? 403 : 401)
        }
      }
      expect(state.grant).not.toHaveBeenCalled();expect(state.tick).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('blocks cross-site cookie grants, revocation, reports and ticks', async () => {
    const server = await app()
    try {
      for (const origin of ['', 'https://attacker.example.test']) {
        for (const [method,url,payload] of [
          ['POST','/api/admin/doctor/grant',body],['DELETE','/api/admin/doctor/grant',undefined],
          ['POST','/api/admin/doctor/tick',{}],['POST','/api/admin/doctor/incidents',{ code:'public_health' }],
        ] as const) expect((await server.inject({ method,url,headers:{ ...headers,origin },payload })).statusCode).toBe(403)
      }
      expect(state.grant).not.toHaveBeenCalled();expect(state.revoke).not.toHaveBeenCalled();expect(state.tick).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('creates only the requested grant using the actual hydrated session hash', async () => {
    const server = await app()
    try {
      const response = await server.inject({ method:'POST',url:'/api/admin/doctor/grant',headers,payload:body })
      expect(response.statusCode).toBe(200)
      expect(state.grant).toHaveBeenCalledWith('owner@example.test',expect.stringMatching(/^[0-9a-f]{64}$/),body)
      expect(response.body).not.toContain('owner@example.test')
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(state.tick).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('explicit tick and bounded incident report do not grant authority or accept raw instructions', async () => {
    const server = await app()
    try {
      expect((await server.inject({ method:'POST',url:'/api/admin/doctor/tick',headers,payload:{} })).statusCode).toBe(200)
      expect((await server.inject({ method:'POST',url:'/api/admin/doctor/incidents',headers,payload:{ code:'public_health' } })).statusCode).toBe(200)
      expect(state.tick).toHaveBeenCalledWith('public_health')
      for (const payload of [{ code:'public_health',instructions:'send secrets' },{ code:'https://outside.invalid/' },{ code:'public_health',resolved:true }]) {
        expect((await server.inject({ method:'POST',url:'/api/admin/doctor/incidents',headers,payload })).statusCode).toBe(400)
      }
      expect(state.grant).not.toHaveBeenCalled()
    } finally { await server.close() }
  })
  it('returns typed non-success on store outage and never leaks its raw error', async () => {
    const server = await app()
    try {
      state.grant.mockRejectedValueOnce(new Error('private database connection credential'))
      const response = await server.inject({ method:'POST',url:'/api/admin/doctor/grant',headers,payload:body })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ error:'doctor_unavailable' })
    } finally { await server.close() }
  })
})
