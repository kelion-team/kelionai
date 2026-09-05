import Fastify from 'fastify'
import { afterEach,describe,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({identity:'google' as string|null,fail:false}))
vi.mock('./session.js',()=>({cerAdmin:(_req:unknown,reply:{code:(n:number)=>{send:(v:unknown)=>unknown}})=>{
  if(!state.identity){reply.code(403).send({error:'forbidden'});return null}
  return {email:'owner@example.test',authProvider:state.identity}
}}))
vi.mock('./services/constructorMonitor.js',()=>({readConstructorMonitor:async()=>{
  if(state.fail)throw new Error('private error')
  return {checkedAt:null,lastSuccessfulCheck:null,state:'unknown',activeExecution:false,cases:[]}
}}))
const {constructorMonitorRoutes}=await import('./routes/constructorMonitor.js')
afterEach(()=>{state.identity='google';state.fail=false})
describe('admin-only measured monitor endpoint',()=>{
  it('requires Google admin and never caches',async()=>{
    const app=Fastify();await app.register(constructorMonitorRoutes)
    state.identity=null
    expect((await app.inject('/api/admin/constructor/monitor')).statusCode).toBe(403)
    state.identity='local'
    expect((await app.inject('/api/admin/constructor/monitor')).statusCode).toBe(403)
    state.identity='google'
    const response=await app.inject('/api/admin/constructor/monitor')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json()).toMatchObject({state:'unknown',activeExecution:false})
    await app.close()
  })
  it('DB error is 503 unknown, not empty healthy state',async()=>{
    const app=Fastify();await app.register(constructorMonitorRoutes);state.fail=true
    const response=await app.inject('/api/admin/constructor/monitor')
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({error:'constructor_monitor_unavailable',state:'unknown',activeExecution:false})
    expect(response.body).not.toContain('private error')
    await app.close()
  })
})
