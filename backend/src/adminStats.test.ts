import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { existsSync,readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { applyMigrationsAtomically,isDestructiveMigration,type MigrationSpec } from './migrate.js'
import { parseVisitorStats,startStatisticsPeriod } from '../../frontend/src/lib/adminStatistics'
import { formatLondonTimestamp } from '../../frontend/src/lib/versionEvidence'

// Exercise the actual frontend parsers against database-backed API bodies;
// only their transport is replaced, so no browser/native dependency or network.
vi.mock('../../frontend/src/lib/transport',()=>({
  apiFetch:(path:string,init?:RequestInit)=>fetch(path,init),
}))

// Real concurrency is opt-in only for the isolated container probe. Never use
// DATABASE_URL or production credentials. The ordinary suite uses PGlite.
const postgres = process.env.KELION_ADMIN_STATS_POSTGRES === '1'
if (postgres && !existsSync('/.dockerenv') && !existsSync('/run/.containerenv')) {
  throw new Error('admin_stats_postgres_test_requires_isolated_container')
}
let database: { query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}> }
let lite:PGlite | null = null
let pool:pg.Pool | null = null
let resetPid:number | null = null
let failAudit=false
vi.mock('./dbPool.js',()=>({
  getPool:()=>database,
  conexiuneDb:async()=>{
    const client=pool ? await pool.connect() : null
    resetPid=client?.processID ?? null
    return {
      query:(sql:string,params?:unknown[])=>{
        if(failAudit && sql.includes('INSERT INTO audit_log'))throw new Error('audit_fixture_failure')
        return (client ?? database).query(sql,params)
      },
      release:()=>client?.release(),
    }
  },
}))
vi.mock('./config.js',async()=>{
  const actual=await vi.importActual<typeof import('./config.js')>('./config.js')
  return {...actual,config:{...actual.config,databaseUrl:'postgres://fixture.invalid/admin_stats',adminEmail:'owner@example.test'}}
})
const stats=await import('./services/adminStats.js')
const db=await import('./db.js')
const email='stats@example.test'
const historical='2020-01-02T03:04:05.000Z'
function migration(version:string):MigrationSpec {
  const sql=readFileSync(new URL(`../migrations/${version}`,import.meta.url),'utf8')
  return {version,sql,digest:createHash('sha256').update(sql).digest('hex'),destructive:isDestructiveMigration(sql)}
}
const baseline=migration('20260915_admin_statistics_baseline.sql')
const boundary=migration('20260919_admin_stats_recording_boundary.sql')
async function apply(list:MigrationSpec[]) {
  const client=pool ? await pool.connect() : null
  // pg uses the simple-query protocol for migration bodies. PGlite.query
  // always prepares a statement, so use its equivalent exec for those bodies.
  const adapter=client ?? {query:async(sql:string,params?:unknown[])=>{
    if(lite && !params?.length && sql.includes(';')){
      return (await lite.exec(sql)).at(-1) ?? {rows:[]}
    }
    return database.query(sql,params)
  }}
  try {await applyMigrationsAtomically(adapter as Parameters<typeof applyMigrationsAtomically>[0],list,'postgres://fixture.invalid/admin_stats')}
  finally{client?.release()}
}
async function messagesSince():Promise<number> {
  const result=await db.citesteUtilizatori()
  expect(result.citit).toBe(true)
  return result.citit ? result.valoare.users.find(row=>row.email===email)?.count ?? 0 : -1
}
async function costSince():Promise<number> {
  const result=await db.citesteRezumatCost()
  expect(result.citit).toBe(true)
  return result.citit ? result.valoare.total : -1
}
beforeEach(async()=>{
  resetPid=null
  failAudit=false
  if(postgres){
    pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',database:'kelion_admin_stats_test',
      ssl:false,max:5,statement_timeout:8000,connectionTimeoutMillis:3000})
    const identity=await pool.query("SELECT current_database() AS db")
    if(identity.rows[0]?.db!=='kelion_admin_stats_test')throw new Error('wrong_test_database')
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    database=pool
  }else{
    lite=new PGlite()
    database=lite
  }
  const schema=`
    CREATE TABLE messages(id bigserial PRIMARY KEY,user_email text NOT NULL,role text NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE cost_events(id bigserial PRIMARY KEY,user_email text NOT NULL,kind text NOT NULL,cost_usd_micros bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE user_presence_daily(user_email text NOT NULL,day date NOT NULL,first_seen_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL,actions bigint NOT NULL,PRIMARY KEY(user_email,day));
    CREATE TABLE visit_daily(day date NOT NULL,path text NOT NULL,country_code text NOT NULL,views bigint NOT NULL,last_seen_at timestamptz NOT NULL,PRIMARY KEY(day,path,country_code));
    CREATE TABLE audit_log(actor text,actiune text,tabel text,cheie text,vechi text,nou text);
    CREATE TABLE blocked_users(email text);
    CREATE TABLE wallets(user_email text,balance_minor bigint);
    CREATE TABLE voiceprints(user_email text,audio_clip text);`
  if(lite)await lite.exec(schema)
  else await database.query(schema)
  const registry=readFileSync(new URL('../migrations/20260823_schema_migrations.sql',import.meta.url),'utf8')
  if(lite)await lite.exec(registry)
  else await database.query(registry)
  await apply([baseline])
  await database.query('INSERT INTO messages(user_email,role,content,created_at)VALUES($1,$2,$3,$4)',[email,'user','historical fixture',historical])
  await database.query('INSERT INTO cost_events(user_email,kind,cost_usd_micros,created_at)VALUES($1,$2,$3,$4)',[email,'fixture',2_000_000,historical])
  await database.query('INSERT INTO user_presence_daily VALUES($1,current_date,now(),now(),7)',[email])
  await database.query("INSERT INTO visit_daily VALUES(current_date,'/fixture','',9,now())")
  await apply([baseline,boundary])
},30_000)
afterEach(async()=>{
  vi.unstubAllGlobals()
  if(pool){await pool.end();pool=null}
  if(lite){await lite.close();lite=null}
})

describe('admin reporting registration boundary',()=>{
  it('requires the real PostgreSQL regression in CI without production namespaces or credentials',()=>{
    const workflow=readFileSync(new URL('../../.github/workflows/pr-verify.yml',import.meta.url),'utf8')
    const step=workflow.split('      - name: Reset statistici concurent în PostgreSQL real\n')[1]?.split('      - name: ')[0]
    expect(step).toBeTruthy()
    expect(step).toContain('KELION_ADMIN_STATS_POSTGRES=1')
    expect(step).toContain('run src/adminStats.test.ts --maxWorkers=1')
    expect(step).toContain('--network none')
    expect(step).toContain('--network "container:$stats_probe"')
    expect(step).toContain('postgres:16-bookworm@sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537')
    expect(step).toContain('POSTGRES_DB=kelion_admin_stats_test')
    expect(step).toContain('kelion.stats-audit')
    expect(step).not.toMatch(/continue-on-error|kelion-proxy|docker compose|--network host|--publish|--privileged|--env-file/)
  })
  it('preserves the null historical baseline through the actual visitor parser',async()=>{
    expect(await stats.readAdminStatsBaseline()).toMatchObject({statsSince:null})
    const response=JSON.parse(JSON.stringify(await db.getDemoStats()))
    expect(parseVisitorStats(response)).toMatchObject({statsSince:null,visitsTotal:9,visitsToday:9})
  })
  it('read and reset return identical UTC ISO accepted by the actual frontend acknowledgement and visitor parser',async()=>{
    const reply=JSON.parse(JSON.stringify(await db.resetCostCounters()))
    expect(reply).toMatchObject({ok:true,sterse:0})
    const raw=(await database.query('SELECT stats_since::text AS raw FROM admin_stats_baselines ORDER BY id DESC LIMIT 1')).rows[0].raw
    expect(formatLondonTimestamp(raw)).toBeNull()
    expect(formatLondonTimestamp(reply.statsSince)).not.toBeNull()
    expect(reply.statsSince).toBe(new Date(raw).toISOString())
    expect((await stats.readAdminStatsBaseline()).statsSince).toBe(reply.statsSince)
    const request=vi.fn(async()=>new Response(JSON.stringify(reply),{status:200,headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',request)
    await expect(startStatisticsPeriod()).resolves.toBe(reply.statsSince)
    expect(request).toHaveBeenCalledWith('/api/admin/reset-counters',expect.objectContaining({method:'POST'}))
    const response=JSON.parse(JSON.stringify(await db.getDemoStats()))
    expect(parseVisitorStats(response)).toMatchObject({statsSince:reply.statsSince,visitsTotal:0,visitsToday:0})
  })
  it('display precision never rounds the SQL boundary or includes records earlier in the same millisecond',async()=>{
    const exact='2026-09-05T12:34:56.123456Z'
    await database.query('INSERT INTO admin_stats_baselines(stats_since)VALUES($1)',[exact])
    for(const instant of ['2026-09-05T12:34:56.123400Z','2026-09-05T12:34:56.123456Z','2026-09-05T12:34:56.123500Z']){
      await database.query("INSERT INTO messages(user_email,role,content,stats_recorded_at)VALUES($1,'user','precision fixture',$2)",[email,instant])
      await database.query("INSERT INTO cost_events(user_email,kind,cost_usd_micros,stats_recorded_at)VALUES($1,'fixture',1000000,$2)",[email,instant])
    }
    const read=await stats.readAdminStatsBaseline()
    expect(read.statsSince).toBe('2026-09-05T12:34:56.123Z')
    expect((await database.query('SELECT stats_since=$1::timestamptz AS unchanged FROM admin_stats_baselines WHERE id=$2',[exact,read.id])).rows[0].unchanged).toBe(true)
    expect(await messagesSince()).toBe(2)
    expect(await costSince()).toBe(2)
    const costs=await db.citesteRezumatCost()
    expect(costs.citit && costs.valoare.byKind.fixture).toBe(2)
    expect((await db.getUserActivity())?.users.find(row=>row.email===email)).toMatchObject({messages:2,consumedUsd:2})
    expect(await db.citesteUtilizatori()).toMatchObject({citit:true,valoare:{statsSince:read.statsSince}})
  })
  it.each(['infinity','-infinity'])('refuses an invalid %s baseline instead of inventing a null/zero period',async(value)=>{
    await database.query('INSERT INTO admin_stats_baselines(stats_since)VALUES($1::timestamptz)',[value])
    await expect(stats.readAdminStatsBaseline()).rejects.toThrow('admin_stats_baseline_invalid')
    expect(await db.getDemoStats()).toBeNull()
    expect(await db.citesteRezumatCost()).toMatchObject({citit:false})
    expect(await db.citesteUtilizatori()).toMatchObject({citit:false})
  })
  it('backfills historical registration without changing event time; canonical migration replay is inert',async()=>{
    const oldMessages=(await database.query('SELECT * FROM messages ORDER BY id')).rows
    const oldCosts=(await database.query('SELECT * FROM cost_events ORDER BY id')).rows
    expect(new Date(oldMessages[0].created_at).toISOString()).toBe(historical)
    expect(oldMessages[0].stats_recorded_at).toEqual(oldMessages[0].created_at)
    expect(oldCosts[0].stats_recorded_at).toEqual(oldCosts[0].created_at)
    await apply([baseline,boundary])
    expect((await database.query('SELECT * FROM messages ORDER BY id')).rows).toEqual(oldMessages)
    expect((await database.query('SELECT * FROM cost_events ORDER BY id')).rows).toEqual(oldCosts)
    expect((await database.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(2)
    expect(await messagesSince()).toBe(1)
    expect(await costSince()).toBe(2)
  })
  it('reset excludes committed history while retaining every raw row and original event date',async()=>{
    const beforeMessages=(await database.query('SELECT * FROM messages')).rows
    const beforeCosts=(await database.query('SELECT * FROM cost_events')).rows
    const boundary=await stats.resetAdminStatsBaseline()
    expect(boundary.statsSince).toBeTruthy()
    expect(await messagesSince()).toBe(0)
    expect(await costSince()).toBe(0)
    expect((await database.query('SELECT * FROM messages')).rows).toEqual(beforeMessages)
    expect((await database.query('SELECT * FROM cost_events')).rows).toEqual(beforeCosts)
    expect((await database.query('SELECT sum(actions)::int AS n FROM admin_presence_since($1)',[boundary.id])).rows[0].n).toBe(0)
    expect((await database.query('SELECT sum(views)::int AS n FROM admin_visits_since($1)',[boundary.id])).rows[0].n).toBe(0)
  })
  it('an offline message registered after reset is counted without rewriting its original timestamp',async()=>{
    await stats.resetAdminStatsBaseline()
    await db.saveMessage(email,'user','offline fixture',Date.parse(historical))
    await db.recordCost(email,'fixture',1)
    expect(await messagesSince()).toBe(1)
    expect(await costSince()).toBe(1)
    const users=await db.getUserActivity()
    expect(users?.users.find(row=>row.email===email)).toMatchObject({messages:1,consumedUsd:1})
    const rows=(await database.query('SELECT created_at,stats_recorded_at FROM messages ORDER BY id DESC LIMIT 1')).rows
    expect(new Date(rows[0].created_at).toISOString()).toBe(historical)
    expect(new Date(rows[0].stats_recorded_at).getTime()).toBeGreaterThan(Date.parse(historical))
  })
  it('failed audit rolls the entire baseline and aggregate snapshots back',async()=>{
    const before=await stats.readAdminStatsBaseline()
    failAudit=true
    await expect(stats.resetAdminStatsBaseline()).rejects.toThrow('audit_fixture_failure')
    expect(await stats.readAdminStatsBaseline()).toEqual(before)
    expect((await database.query('SELECT count(*)::int AS n FROM admin_stats_presence_baseline')).rows[0].n).toBe(0)
    expect((await database.query('SELECT count(*)::int AS n FROM admin_stats_visits_baseline')).rows[0].n).toBe(0)
    expect(await messagesSince()).toBe(1)
    expect(await costSince()).toBe(2)
  })
})

describe.runIf(postgres)('real PostgreSQL concurrent reset',()=>{
  for(const table of ['messages','cost_events'] as const){
    it(`waits for an in-flight ${table} insert before taking the boundary`,async()=>{
      const writer=await pool!.connect()
      let resetting:Promise<{baseline?:Awaited<ReturnType<typeof stats.resetAdminStatsBaseline>>,error?:unknown}> | undefined
      let finished=false
      try{
        await writer.query('BEGIN')
        await writer.query(table==='messages'
          ? "INSERT INTO messages(user_email,role,content)VALUES($1,'user','in-flight fixture')"
          : "INSERT INTO cost_events(user_email,kind,cost_usd_micros)VALUES($1,'fixture',1000000)",[email])
        resetting=stats.resetAdminStatsBaseline().then(baseline=>({baseline}),error=>({error})).finally(()=>{finished=true})
        let waiting=false
        const deadline=Date.now()+3000
        while(!finished && Date.now()<deadline){
          if(resetPid){
            const lock=await pool!.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
              WHERE pid=$1 AND relation=$2::regclass AND mode='ShareLock' AND NOT granted) AS waiting`,[resetPid,table])
            waiting=lock.rows[0].waiting
            if(waiting)break
          }
          await delay(10)
        }
        expect(waiting,'reset must actually wait on the writer table lock').toBe(true)
        expect(finished).toBe(false)
        await writer.query('COMMIT')
        const outcome=await resetting
        expect(outcome.error).toBeUndefined()
        expect(outcome.baseline?.statsSince).toBeTruthy()
        expect(await messagesSince()).toBe(0)
        expect(await costSince()).toBe(0)
        expect((await database.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(2)
      }finally{
        await writer.query('ROLLBACK')
        writer.release()
        if(resetting)await resetting
      }
    })
  }
  it('BEGIN before reset then INSERT after reset uses registration time, not transaction-start now()',async()=>{
    const writer=await pool!.connect()
    try{
      await writer.query('BEGIN')
      const started=(await writer.query('SELECT now()::text AS at')).rows[0].at
      await delay(5)
      const baseline=await stats.resetAdminStatsBaseline()
      await writer.query("INSERT INTO messages(user_email,role,content)VALUES($1,'user','older transaction fixture')",[email])
      await writer.query("INSERT INTO cost_events(user_email,kind,cost_usd_micros)VALUES($1,'fixture',1000000)",[email])
      await writer.query('COMMIT')
      expect(Date.parse(started)).toBeLessThan(Date.parse(baseline.statsSince!))
      for(const table of ['messages','cost_events']){
        const row=(await database.query(`SELECT created_at::text,stats_recorded_at::text FROM ${table} ORDER BY id DESC LIMIT 1`)).rows[0]
        expect(row.created_at).toBe(started)
        expect(Date.parse(row.stats_recorded_at)).toBeGreaterThanOrEqual(Date.parse(baseline.statsSince!))
      }
      expect(await messagesSince()).toBe(1)
      expect(await costSince()).toBe(1)
    }finally{await writer.query('ROLLBACK');writer.release()}
  })
})
