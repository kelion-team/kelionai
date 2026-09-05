import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest'
import type { ConstructorHostSnapshot,ConstructorMonitorJob } from './shared/constructorMonitor.js'
import { classifyConstructorMonitor,constructorMonitorThresholds,validateConstructorHostSnapshot } from './services/constructorMonitorPolicy.js'
let db:PGlite
let active=true
vi.mock('./db.js',()=>({dbEnabled:()=>true,getPool:()=>({query:(sql:string,values?:unknown[])=>db.query(sql,values)}),
  conexiuneDb:async()=>({query:(sql:string,values?:unknown[])=>db.query(sql,values),release:()=>undefined}),
  loadKv:async()=>null,saveKvStrict:async()=>undefined}))
vi.mock('./services/releaseActivation.js',()=>({releaseSideEffectsEnabled:()=>active}))
vi.mock('./services/constructorWorker.js',()=>({getConstructorWorkerStatus:async()=>({worker:{state:'offline',lastHeartbeat:null}})}))
vi.mock('./services/constructorHostSnapshot.js',()=>({readConstructorHostSnapshot:async()=>{throw new Error('no real host in tests')}}))
const store=await import('./services/constructorMonitorStore.js')
const external=await import('./services/constructorExternalRemediation.js')
const {createConstructorMonitor}=await import('./services/constructorMonitor.js')
const limits=constructorMonitorThresholds({})
const now=Date.now()
const at=(ago=0)=>new Date(now-ago).toISOString()
const host=(changes:Partial<ConstructorHostSnapshot>={}):ConstructorHostSnapshot=>({
  schema:1,measuredAt:at(),worker:{timer:'active',service:'active',mainPid:123},intentionalPause:false,deployGate:false,...changes})
const job=(changes:Partial<ConstructorMonitorJob>={}):ConstructorMonitorJob=>({
  jobId:666,cycle:0,attempts:1,status:'running',stage:'working',createdAt:at(3_600_000),
  lastActivity:at(),lastRealProgress:at(10_000),heartbeatAt:at(),completedReceipt:false,...changes})
const classify=(j:ConstructorMonitorJob=job(),h=host())=>classifyConstructorMonitor(j,h,now,limits)
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`CREATE TABLE build_jobs(id bigint PRIMARY KEY,execution_cycle int DEFAULT 0,attempts int DEFAULT 1,
    status text DEFAULT 'running',constructor_stage text DEFAULT 'working',created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),progress_at timestamptz,arhivat boolean DEFAULT false,ci text,commit_sha text,live_version text);
    CREATE TABLE constructor_pipeline(job_id bigint,release_target_sha text,release_receipt_sha256 text);
    CREATE TABLE constructor_activity_catalog(activity_key text PRIMARY KEY,sequence_no int);
    CREATE TABLE constructor_activity_events(id bigserial,job_id bigint,execution_cycle int,activity_key text,created_at timestamptz);
    CREATE TABLE admin_notifications(id bigserial,type text,title text,message text,payload jsonb);
    INSERT INTO constructor_activity_catalog VALUES ('queued',0),('working',3),('gates_passed',4);`)
  await db.exec(readFileSync(new URL('../migrations/20260917_constructor_monitor.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../migrations/20260918_constructor_external_remediation.sql',import.meta.url),'utf8'))
},30_000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
  active=true
  await db.exec(`TRUNCATE constructor_monitor_events,constructor_monitor_cases,admin_notifications,constructor_pipeline,constructor_activity_events,build_jobs RESTART IDENTITY CASCADE;
    UPDATE constructor_monitor_state SET lease_owner=NULL,lease_until=NULL,checked_at=NULL,last_successful_check=NULL,last_error=NULL;
    INSERT INTO build_jobs(id) VALUES(666);`)
  await db.query('UPDATE build_jobs SET created_at=$1',[at(3_600_000)])
})
describe('deterministic monitor, no action authority',()=>{
  it('queued + stopped worker is a measured incident after grace',()=>{
    expect(classify(job({status:'queued',stage:'queued',lastRealProgress:at(300_000)}),
      host({worker:{timer:'inactive',service:'inactive',mainPid:0}}))).toMatchObject({code:'worker_stopped',fault:true,activeExecution:false})
  })
  it('fresh logs and heartbeat never reset old stage progress',()=>{
    expect(classify(job({lastRealProgress:at(1_000_000),lastActivity:at(),heartbeatAt:at()}))).toMatchObject({code:'stage_stall',activeExecution:false})
  })
  it('active PID needs a fresh concrete milestone, not generic running status',()=>{
    expect(classify()).toMatchObject({activeExecution:true,code:'executing'})
    expect(classify(job({lastRealProgress:at(130_000)}))).toMatchObject({activeExecution:false,code:'executing'})
    expect(classify(job(),host({worker:{timer:'active',service:'inactive',mainPid:0}}))).toMatchObject({code:'process_missing',activeExecution:false})
  })
  it('terminal failure is preserved even with fresh process/heartbeat',()=>{
    expect(classify(job({status:'failed',stage:'failed'}))).toMatchObject({code:'terminal_failure',fault:true,activeExecution:false,responsible:'owner'})
  })
  it('intentional pause and deployment barrier never authorize recovery or indicate a fault',()=>{
    expect(classify(job(),host({intentionalPause:true,worker:{timer:'inactive',service:'inactive',mainPid:0}})))
      .toMatchObject({code:'intentional_pause',fault:false,activeExecution:false})
    expect(classify(job(),host({deployGate:true,worker:null,intentionalPause:null}))).toMatchObject({code:'deploy_gate',fault:false,activeExecution:false})
  })
  it('stale heartbeat is distinct from missing process; downstream never requires worker PID',()=>{
    expect(classify(job({heartbeatAt:at(400_000)}))).toMatchObject({code:'heartbeat_stale'})
    expect(classify(job({stage:'pr_opened',lastRealProgress:at(10_000)}),host({worker:{timer:'active',service:'inactive',mainPid:0}})))
      .toMatchObject({code:'executing',responsible:'publisher',activeExecution:false})
  })
  it('unknown, future, stale or malformed host cannot become healthy',()=>{
    for(const input of [null,{},host({measuredAt:at(100_000)}),host({measuredAt:at(-1)}),host({intentionalPause:true}),host({worker:{timer:'active',service:'inactive',mainPid:3}}),{...host(),unexpected:true}])
      expect(()=>validateConstructorHostSnapshot(input,now,limits.hostMaxAgeMs)).toThrow()
    expect(()=>constructorMonitorThresholds({CONSTRUCTOR_MONITOR_STAGE_STALL_MS:'NaN'})).toThrow()
  })
  it('explicit cancellation is not an unknown fault',()=>{
    expect(classify(job({status:'cancelled',stage:'cancelled'}))).toMatchObject({code:'cancelled',fault:false,activeExecution:false})
  })
  it('a done label without receipt is unverified',()=>{
    expect(classify(job({status:'done',stage:'deployed'}))).toMatchObject({code:'unverified',activeExecution:false})
  })
})
describe('real durable SQL observer',()=>{
  it('migration is inert and unmeasured state is unknown',async()=>{
    expect(await store.constructorMonitorSnapshot(limits)).toMatchObject({state:'unknown',checkedAt:null,lastSuccessfulCheck:null,activeExecution:false,cases:[]})
  })
  it('repeated working events are activity but first milestone alone is real progress',async()=>{
    await db.query("INSERT INTO constructor_activity_events(job_id,execution_cycle,activity_key,created_at) VALUES(666,0,'working',$1),(666,0,'working',$2)",[at(1_000_000),at()])
    await db.query('UPDATE build_jobs SET progress_at=$1',[at()])
    const rows=await store.readMonitorJobs(at())
    expect(rows[0]).toMatchObject({lastActivity:at(),lastRealProgress:at(1_000_000)})
    expect(classify(rows[0])).toMatchObject({code:'stage_stall'})
  })
  it('leases fence another process and transitions survive restart without duplicate notification',async()=>{
    const before=(await db.query('SELECT * FROM build_jobs')).rows
    const first=await store.acquireMonitorLease()
    expect(await store.acquireMonitorLease()).toBeNull()
    await store.finishMonitorCheck(first!,[classify(job({status:'failed',stage:'failed'}))])
    const second=await store.acquireMonitorLease()
    await store.finishMonitorCheck(second!,[classify(job({status:'failed',stage:'failed'}))])
    expect((await db.query('SELECT * FROM constructor_monitor_events')).rows).toHaveLength(1)
    const notices=(await db.query<{message:string}>('SELECT message FROM admin_notifications')).rows
    expect(notices).toHaveLength(1)
    expect(notices[0].message).toContain('responsabil: owner')
    expect(notices[0].message).toContain('numai Reia explicit')
    expect((await db.query('SELECT * FROM build_jobs')).rows).toEqual(before)
    expect(await store.constructorMonitorSnapshot(limits)).toMatchObject({state:'attention',activeExecution:false})
  })
  it('recovery emits exactly once, and pause is only a state change',async()=>{
    const observe=async(e:ReturnType<typeof classify>)=>store.finishMonitorCheck((await store.acquireMonitorLease())!,[e])
    await observe(classify(job({lastRealProgress:at(1_000_000)})))
    await observe(classify())
    await observe(classify())
    expect((await db.query("SELECT kind FROM constructor_monitor_events ORDER BY id")).rows).toEqual([{kind:'incident'},{kind:'recovery'}])
    await observe(classify(job({lastRealProgress:at(1_000_000)})))
    await observe(classify(job(),host({intentionalPause:true,worker:{timer:'inactive',service:'inactive',mainPid:0}})))
    expect((await db.query('SELECT kind FROM constructor_monitor_events ORDER BY id DESC LIMIT 1')).rows).toEqual([{kind:'state_change'}])
    await observe(classify())
    expect((await db.query('SELECT kind FROM constructor_monitor_events ORDER BY id DESC LIMIT 1')).rows).toEqual([{kind:'recovery'}])
  })
  it('a measured held gate is durable but never a fabricated monitor failure or useful execution',async()=>{
    const before=(await db.query('SELECT * FROM build_jobs')).rows
    const gate=host({deployGate:true,worker:null,intentionalPause:null})
    for(let i=0;i<2;i++) await store.finishMonitorCheck((await store.acquireMonitorLease())!,[classify(job(),gate)])
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(0)
    expect((await db.query('SELECT kind FROM constructor_monitor_events')).rows).toEqual([{kind:'state_change'}])
    const snapshot=await store.constructorMonitorSnapshot(limits)
    expect(snapshot).toMatchObject({error:null,activeExecution:false,cases:[{code:'deploy_gate',fault:false,host:gate}]})
    expect(snapshot.lastSuccessfulCheck).not.toBeNull()
    expect((await db.query('SELECT * FROM build_jobs')).rows).toEqual(before)
    expect(classify(job({status:'failed',stage:'failed'}),gate)).toMatchObject({code:'terminal_failure',fault:true})
  })
  it('monitor failure retains last success and deduplicates error and recovery notifications',async()=>{
    await store.finishMonitorCheck((await store.acquireMonitorLease())!,[classify()])
    const success=(await store.constructorMonitorSnapshot(limits)).lastSuccessfulCheck
    for(let i=0;i<2;i++) await store.finishMonitorCheck((await store.acquireMonitorLease())!,null)
    expect(await store.constructorMonitorSnapshot(limits)).toMatchObject({state:'unknown',lastSuccessfulCheck:success,error:'constructor_monitor_check_failed',activeExecution:false})
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(1)
    await store.finishMonitorCheck((await store.acquireMonitorLease())!,[classify()])
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(2)
  })
  it('expired lease and inactive release never write observations',async()=>{
    const lease=(await store.acquireMonitorLease())!
    await db.exec("UPDATE constructor_monitor_state SET lease_until=now()-interval '1 second'")
    await expect(store.finishMonitorCheck(lease,[classify()])).rejects.toThrow('constructor_monitor_lease_lost')
    active=false
    expect(await store.acquireMonitorLease()).toBeNull()
    expect((await db.query('SELECT * FROM constructor_monitor_cases')).rows).toHaveLength(0)
  })
  it('fresh UI requests cannot keep activeExecution true after its evidence deadline',async()=>{
    await store.finishMonitorCheck((await store.acquireMonitorLease())!,[classify()])
    expect(await store.constructorMonitorSnapshot(limits,now+130_000)).toMatchObject({activeExecution:false,cases:[{activeExecution:false,activeExecutionUntil:null}]})
    const checkedAt=(await store.constructorMonitorSnapshot(limits)).checkedAt!
    expect(await store.constructorMonitorSnapshot(limits,Date.parse(checkedAt)+limits.tickMs*2+1)).toMatchObject({state:'unknown',activeExecution:false})
  })
  it('independent monitor tick stores a host error without invoking worker/AI',async()=>{
    const monitor=createConstructorMonitor({active:()=>true,now:()=>now,host:async()=>{throw new Error('host detail must not leak')},
      heartbeat:async()=>at(),store,thresholds:limits})
    await monitor.tick()
    expect(await store.constructorMonitorSnapshot(limits)).toMatchObject({state:'unknown',error:'constructor_monitor_check_failed',activeExecution:false})
    const payloads=JSON.stringify((await db.query('SELECT * FROM admin_notifications')).rows)
    expect(payloads).not.toContain('host detail')
    expect((await db.query('SELECT attempts,execution_cycle FROM build_jobs')).rows).toEqual([{attempts:1,execution_cycle:0}])
  })
})

const execution='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const replacement='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function report(digest='a'.repeat(64),changes:Record<string,unknown>={}) {
  return {jobId:666,cycle:0,coordinator:'Codex/maintenance',executionId:execution,kind:'edit',state:'working',
    summary:'Corecție verificabilă în candidatul VPS.',nextAction:'Rulează testul focalizat.',
    evidence:{kind:'artifact_changed',digest,observedAt:at(),sourceRef:'backend/src/parser.ts'},...changes}
}
describe('root reporter ownership and concrete evidence, no worker simulation',()=>{
  it('inactive release cannot register or append evidence through direct imports',async()=>{
    active=false
    await expect(external.registerExternalRemediation(report(),undefined,now)).rejects.toThrow('release_inactive')
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(0)
    active=true
    await external.registerExternalRemediation(report(),undefined,now)
    const before=(await db.query('SELECT * FROM constructor_external_owners')).rows
    active=false
    await expect(external.recordExternalRemediation(report('b'.repeat(64)),now)).rejects.toThrow('release_inactive')
    expect((await db.query('SELECT * FROM constructor_external_owners')).rows).toEqual(before)
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(1)
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(1)
  })
  it('registration and unchanged baseline never light the hourglass',async()=>{
    expect(await external.registerExternalRemediation(report(),undefined,now)).toMatchObject({activeExternalRemediation:false,lastEvidenceAt:null,activeUntil:null})
    expect(await external.recordExternalRemediation(report(),now)).toMatchObject({activeExternalRemediation:false,lastEvidenceAt:null})
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(1)
  })
  it('only a new concrete digest activates for at most60s; GET and duplicate do not refresh it',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    const evidence=report('b'.repeat(64))
    const first=await external.recordExternalRemediation(evidence,now)
    expect(first).toMatchObject({activeExternalRemediation:true,lastEvidenceAt:at(),activeUntil:new Date(now+60_000).toISOString()})
    const later=report('b'.repeat(64),{evidence:{kind:'artifact_changed',digest:'b'.repeat(64),observedAt:new Date(now+30_000).toISOString(),sourceRef:'backend/src/parser.ts'}})
    expect(await external.recordExternalRemediation(later,now+30_000)).toMatchObject({activeUntil:first.activeUntil,lastEvidenceAt:first.lastEvidenceAt})
    expect((await external.readExternalRemediations(now+60_001))[0]).toMatchObject({activeExternalRemediation:false,activeUntil:null})
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(2)
    // Network-delay replay is idempotent even after its freshness window expired.
    expect(await external.recordExternalRemediation(evidence,now+70_000)).toMatchObject({activeExternalRemediation:false,activeUntil:null})
  })
  it('rejects a second owner without explicit CAS and requires a changed takeover proof',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    const next=report('c'.repeat(64),{coordinator:'Codex/replacement',executionId:replacement})
    await expect(external.registerExternalRemediation(next,undefined,now)).rejects.toThrow('owner_conflict')
    await expect(external.registerExternalRemediation(next,replacement,now)).rejects.toThrow('owner_conflict')
    await expect(external.registerExternalRemediation({...next,evidence:report().evidence},execution,now)).rejects.toThrow('owner_conflict')
    expect(await external.registerExternalRemediation(next,execution,now)).toMatchObject({executionId:replacement,activeExternalRemediation:false,lastEvidenceAt:null})
    await expect(external.recordExternalRemediation(report('d'.repeat(64)),now)).rejects.toThrow('owner_conflict')
    expect((await db.query('SELECT event_type FROM constructor_external_events ORDER BY id')).rows).toEqual([{event_type:'registration'},{event_type:'takeover'}])
    await expect(external.registerExternalRemediation(report('e'.repeat(64)),replacement,now)).rejects.toThrow('owner_conflict')
  })
  it('blocked and completed always extinguish activity, terminal cannot self-resume',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    await external.recordExternalRemediation(report('b'.repeat(64)),now)
    expect(await external.recordExternalRemediation(report('b'.repeat(64),{state:'blocked'}),now)).toMatchObject({activeExternalRemediation:false,activeUntil:null})
    expect(await external.recordExternalRemediation(report('c'.repeat(64),{state:'completed'}),now)).toMatchObject({activeExternalRemediation:false,activeUntil:null})
    await expect(external.recordExternalRemediation(report('d'.repeat(64)),now)).rejects.toThrow('terminal')
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(4)
  })
  it('different summaries, kind or timestamps with an old digest cannot fabricate activity',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    await external.recordExternalRemediation(report('b'.repeat(64)),now)
    const previous=(await external.readExternalRemediations(now))[0]
    const again=await external.recordExternalRemediation(report('b'.repeat(64),{kind:'diagnostic',summary:'Alt text fără dovadă nouă.'}),now+5_000)
    expect(again).toEqual(previous)
  })
  it('notifies assignment, first concrete work and a new kind, never every edit',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    await external.registerExternalRemediation(report(),undefined,now)
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(1)
    await external.recordExternalRemediation(report('b'.repeat(64)),now)
    const later=(digest:string,kind:string,offset:number)=>report(digest,{kind,evidence:{...report().evidence,digest,observedAt:new Date(now+offset).toISOString()}})
    await external.recordExternalRemediation(later('c'.repeat(64),'edit',1000),now+1000)
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(2)
    await external.recordExternalRemediation(later('d'.repeat(64),'test',2000),now+2000)
    expect((await db.query('SELECT * FROM admin_notifications')).rows).toHaveLength(3)
  })
  it('stale/future/invalid proofs and unsafe paths do not write history',async()=>{
    for(const changes of [
      {evidence:{...report().evidence,sourceRef:'../secret'}},
      {evidence:{...report().evidence,sourceRef:'https://host/path?token=secret'}},
      {evidence:{...report().evidence,sourceRef:'/etc/secret'}},
      {evidence:{...report().evidence,digest:'invented'}},
      {evidence:{...report().evidence,observedAt:at(-1)}},
      {summary:'line\nsecret'}, {coordinator:'owner@example.test'}, {summary:'secret='+'x'.repeat(40)}, {nextAction:'password='+'fixture-only'},
    ]) expect(()=>external.validateExternalRemediation(report('a'.repeat(64),changes),now)).toThrow('input_invalid')
    await expect(external.registerExternalRemediation(report('a'.repeat(64),{evidence:{...report().evidence,observedAt:at(60_001)}}),undefined,now)).rejects.toThrow('evidence_stale')
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(0)
  })
  it('never changes the job or cycle, and the explicit next cycle fences old reporters',async()=>{
    const before=(await db.query('SELECT * FROM build_jobs')).rows
    await external.registerExternalRemediation(report(),undefined,now)
    await external.recordExternalRemediation(report('b'.repeat(64)),now)
    expect((await db.query('SELECT * FROM build_jobs')).rows).toEqual(before)
    await db.exec("UPDATE build_jobs SET status='done'")
    expect((await external.readExternalRemediations(now))[0]).toMatchObject({activeExternalRemediation:false,activeUntil:null})
    await db.exec("UPDATE build_jobs SET status='queued',execution_cycle=1")
    await expect(external.recordExternalRemediation(report('c'.repeat(64)),now)).rejects.toThrow('job_stale')
    expect(await external.readExternalRemediations(now)).toEqual([])
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(2)
  })
  it('GET returns one durable snapshot with server time and does not refresh evidence',async()=>{
    await external.registerExternalRemediation(report(),undefined,now)
    const {readConstructorMonitor}=await import('./services/constructorMonitor.js')
    const snapshot=await readConstructorMonitor()
    expect(Number.isFinite(Date.parse(snapshot.servedAt))).toBe(true)
    expect(snapshot.externalRemediations).toHaveLength(1)
    expect(snapshot.externalRemediations[0]).toMatchObject({jobId:666,activeExternalRemediation:false,lastEvidenceAt:null})
    expect(snapshot.activeExecution).toBe(false)
    expect((await db.query('SELECT * FROM constructor_external_events')).rows).toHaveLength(1)
  })
})
