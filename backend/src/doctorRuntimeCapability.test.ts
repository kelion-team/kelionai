import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ raw:null as string | null,active:true,store:new Map<string,string>(),outage:false }))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual,readFileSync:(path: unknown, ...args: unknown[]) => {
    if (path instanceof URL && path.pathname.endsWith('/constructor-doctor-capability.json')) {
      if (fixture.raw === null) throw new Error('manifest absent')
      return fixture.raw
    }
    return Reflect.apply(actual.readFileSync,actual,[path,...args])
  } }
})
vi.mock('./db.js', () => ({
  loadKv:async (key:string) => { if (fixture.outage) throw new Error('private db detail'); return fixture.store.get(key) ?? null },
  saveKvStrict:async (key:string,value:string) => { if (fixture.outage) throw new Error('private db detail'); fixture.store.set(key,value) },
}))
vi.mock('./services/releaseActivation.js', () => ({ releaseSideEffectsEnabled:() => fixture.active }))
const { doctorRuntimeScopeVerified, isDoctorRuntimeCapability, recordDoctorRuntimeCapability, projectDoctorRuntimeCapability } = await import('./services/doctorRuntimeCapability.js')
const sha = 'a'.repeat(40)
const tuple = { protocol:2,guardSha256:'1'.repeat(64),workerSha256:'2'.repeat(64),publisherSha256:'3'.repeat(64) }
beforeEach(() => { fixture.raw=JSON.stringify(tuple);fixture.active=true;fixture.outage=false;fixture.store.clear();vi.stubEnv('GIT_COMMIT_SHA',sha) })
afterEach(() => vi.unstubAllEnvs())

async function measured() {
  await recordDoctorRuntimeCapability('worker',tuple)
  await recordDoctorRuntimeCapability('publisher',tuple)
}

describe('Doctor runtime trust anchor and exact authenticated measurements', () => {
  it('requires the image manifest and both fresh service measurements, not a heartbeat claim alone', async () => {
    expect(await doctorRuntimeScopeVerified()).toBe(false)
    await recordDoctorRuntimeCapability('worker',tuple)
    expect(await doctorRuntimeScopeVerified()).toBe(false)
    await measured()
    expect(await doctorRuntimeScopeVerified()).toBe(true)
    for (const raw of [null,'{}','not-json',JSON.stringify({ ...tuple,untrusted:true })]) {
      fixture.raw=raw
      expect(await doctorRuntimeScopeVerified()).toBe(false)
    }
  })
  it('checks every measured artifact and rejects stale, future, other-release or incomplete measurements', () => {
    const now = Date.now()
    const valid = { capability:tuple,receivedAt:new Date(now).toISOString(),releaseSha:sha }
    expect(projectDoctorRuntimeCapability(tuple,[valid,valid],sha,now)).toBe(true)
    const invalid = [null,{ ...valid,capability:null },{ ...valid,receivedAt:'invalid' },
      { ...valid,receivedAt:new Date(now-300_001).toISOString() },{ ...valid,receivedAt:new Date(now+1).toISOString() },
      { ...valid,releaseSha:'b'.repeat(40) },...['guardSha256','workerSha256','publisherSha256'].map((key) => ({ ...valid,capability:{ ...tuple,[key]:'9'.repeat(64) } }))]
    for (const bad of invalid) for (const pair of [[valid,bad],[bad,valid]]) expect(projectDoctorRuntimeCapability(tuple,pair,sha,now)).toBe(false)
  })
  it('requires the current claim tuple too; old worker/publisher requests cannot consume Doctor jobs', async () => {
    await measured()
    for (const service of ['worker','publisher'] as const) {
      for (const capability of [undefined,null,{ ...tuple,protocol:1 },{ ...tuple,workerSha256:'9'.repeat(64) }]) {
        expect(await doctorRuntimeScopeVerified({ service,capability })).toBe(false)
      }
      expect(await doctorRuntimeScopeVerified({ service,capability:tuple })).toBe(true)
    }
  })
  it('invalidates a prior tuple when an old or downgraded supervisor omits it', async () => {
    await measured()
    await recordDoctorRuntimeCapability('worker',undefined)
    expect(await doctorRuntimeScopeVerified()).toBe(false)
    await measured()
    await recordDoctorRuntimeCapability('publisher',null)
    expect(await doctorRuntimeScopeVerified()).toBe(false)
  })
  it('fails closed for candidate, unavailable DB and unidentified process revision', async () => {
    await measured()
    fixture.active=false
    expect(await doctorRuntimeScopeVerified()).toBe(false)
    fixture.active=true;fixture.outage=true
    expect(await doctorRuntimeScopeVerified()).toBe(false)
    fixture.outage=false;vi.stubEnv('GIT_COMMIT_SHA','unknown')
    expect(await doctorRuntimeScopeVerified()).toBe(false)
  })
  it('reuses an existing transaction instead of borrowing another pool connection', async () => {
    await measured();fixture.outage=true
    const query = vi.fn(async (_sql:string,params?:unknown[]) => ({ rows:[{ value:fixture.store.get(String(params?.[0])) }] }))
    expect(await doctorRuntimeScopeVerified(undefined,{ query })).toBe(true)
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('accepts no loose booleans, partial hashes or added authority', async () => {
    for (const bad of [true,[],{ ...tuple,protocol:'2' },{ ...tuple,protocol:1 },{ ...tuple,guardSha256:'1' },{ ...tuple,admin:true }]) {
      expect(isDoctorRuntimeCapability(bad)).toBe(false)
      await expect(recordDoctorRuntimeCapability('worker',bad)).rejects.toThrow('doctor_runtime_capability_invalid')
    }
    expect(fixture.store.size).toBe(0)
  })
})
