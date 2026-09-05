import { createHash } from 'node:crypto'
import type pg from 'pg'
import { getPool } from '../db.js'
import { curataTextJurnal } from './jurnalOperational.js'
import { releaseSideEffectsEnabled } from './releaseActivation.js'
import type { ExternalRemediationInput,ExternalRemediationView } from '../shared/constructorExternalRemediation.js'
import { withConstructorObservationTransaction } from './constructorMonitorStore.js'

const ACTIVE_MS=60_000 // A concrete event, not polling or a heartbeat, authorizes one minute.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH=/^[0-9a-f]{64}$/
const iso=(v:unknown):v is string=>typeof v==='string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v
const plain=(v:unknown,max:number):v is string=>typeof v==='string' && v.length>0 && v.length<=max && v.trim()===v && !/[\p{Cc}\p{Cs}]/u.test(v)
const exact=(v:object,keys:string[]):boolean=>Object.keys(v).length===keys.length && Object.keys(v).every(k=>keys.includes(k))
export function validateExternalRemediation(input: unknown,now=Date.now()): ExternalRemediationInput {
  const v=input as ExternalRemediationInput|null
  if(!v || typeof v!=='object' || !exact(v,['jobId','cycle','coordinator','executionId','kind','state','summary','nextAction','evidence'])
    || !Number.isSafeInteger(v.jobId) || v.jobId<1 || !Number.isSafeInteger(v.cycle) || v.cycle<0
    || !plain(v.coordinator,160) || !/^[A-Za-z][A-Za-z0-9_./-]+$/.test(v.coordinator) || !UUID.test(v.executionId)
    || !['edit','test','build','diagnostic','deploy'].includes(v.kind) || !['working','blocked','completed'].includes(v.state)
    || !plain(v.summary,240) || !plain(v.nextAction,300) || !v.evidence || typeof v.evidence!=='object'
    || curataTextJurnal(v.summary,240)!==v.summary || curataTextJurnal(v.nextAction,300)!==v.nextAction
    || !exact(v.evidence,['kind','digest','observedAt','sourceRef'])
    || !['artifact_changed','test_case_completed'].includes(v.evidence.kind) || !HASH.test(v.evidence.digest)
    || !iso(v.evidence.observedAt) || Date.parse(v.evidence.observedAt)>now
    || !plain(v.evidence.sourceRef,240) || !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+(?::[1-9][0-9]*)?$/.test(v.evidence.sourceRef)
    || v.evidence.sourceRef.split('/').some(part=>part==='.' || part==='..')) throw new Error('external_remediation_input_invalid')
  return v
}
interface OwnerRow {
  coordinator:string;execution_id:string;baseline_digest:string;state:ExternalRemediationInput['state'];evidence:ExternalRemediationInput;
  registered_at:Date;reported_at:Date;last_concrete_activity_at:Date|null;active_until:Date|null
}
function view(row:OwnerRow,now=Date.now(),allowActivity=true):ExternalRemediationView {
  const active=allowActivity && row.state==='working' && row.active_until!==null && row.active_until.getTime()>now
    && row.last_concrete_activity_at!==null && row.last_concrete_activity_at.getTime()<=now
  const input=row.evidence
  return {jobId:input.jobId,cycle:input.cycle,coordinator:input.coordinator,executionId:input.executionId,
    kind:input.kind,state:input.state,summary:input.summary,nextAction:input.nextAction,
    lastEvidenceAt:row.last_concrete_activity_at?.toISOString()??null,evidenceDigest:input.evidence.digest,sourceRef:input.evidence.sourceRef,
    activeExternalRemediation:active,activeUntil:active?row.active_until!.toISOString():null }
}
async function notifyExternal(sql:Pick<pg.PoolClient,'query'>,input:ExternalRemediationInput,title:string,message:string,hash:string):Promise<void> {
  await sql.query(`INSERT INTO admin_notifications(type,title,message,payload) VALUES('paznic',$1,$2,$3::jsonb)`,
    [title,message.slice(0,500),JSON.stringify({source:'constructor_external_remediation',jobId:input.jobId,cycle:input.cycle,
      executionId:input.executionId,coordinator:input.coordinator,eventHash:hash})])
}
const eventHash=(input:ExternalRemediationInput,type:string):string=>createHash('sha256').update(JSON.stringify([
  input.jobId,input.cycle,input.coordinator,input.executionId,type,input.kind,input.state,
  input.evidence.kind,input.evidence.digest,input.evidence.sourceRef,
])).digest('hex')

/** No HTTP or AI tool exposes this writer. Only the root VPS reporter imports it.
 * This is an attestation of its measurement, not a backend file read. */
export async function registerExternalRemediation(raw:unknown,expectedExecutionId?:string,now=Date.now()):Promise<ExternalRemediationView> {
  if(!releaseSideEffectsEnabled())throw new Error('external_remediation_release_inactive')
  const input=validateExternalRemediation(raw,now)
  if(expectedExecutionId!==undefined && !UUID.test(expectedExecutionId))throw new Error('external_remediation_owner_invalid')
  return withConstructorObservationTransaction(async sql=>{
    if(!releaseSideEffectsEnabled())throw new Error('external_remediation_release_inactive')
    const job=await sql.query<{execution_cycle:number;status:string}>('SELECT execution_cycle,status FROM build_jobs WHERE id=$1 AND arhivat=false FOR UPDATE',[input.jobId])
    if(job.rows[0]?.execution_cycle!==input.cycle || ['done','cancelled'].includes(job.rows[0]?.status))throw new Error('external_remediation_job_stale')
    const found=await sql.query<OwnerRow>('SELECT * FROM constructor_external_owners WHERE job_id=$1 AND execution_cycle=$2 FOR UPDATE',[input.jobId,input.cycle])
    const old=found.rows[0]
    if(old?.execution_id===input.executionId && old.coordinator===input.coordinator)return view(old,now)
    if(now-Date.parse(input.evidence.observedAt)>ACTIVE_MS)throw new Error('external_remediation_evidence_stale')
    if(old && (old.execution_id!==expectedExecutionId || old.baseline_digest===input.evidence.digest || old.evidence.evidence.digest===input.evidence.digest))throw new Error('external_remediation_owner_conflict')
    if(!old && expectedExecutionId!==undefined)throw new Error('external_remediation_owner_conflict')
    const reused=await sql.query('SELECT id FROM constructor_external_events WHERE execution_id=$1::uuid LIMIT 1',[input.executionId])
    if(reused.rows.length)throw new Error('external_remediation_owner_conflict')
    // Baseline registration never asserts active execution, even with a fresh digest.
    const type=old?'takeover':'registration'
    await sql.query(`INSERT INTO constructor_external_owners(job_id,execution_cycle,coordinator,execution_id,baseline_digest,state,evidence)
      VALUES($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)
      ON CONFLICT(job_id,execution_cycle) DO UPDATE SET coordinator=EXCLUDED.coordinator,execution_id=EXCLUDED.execution_id,
        baseline_digest=EXCLUDED.baseline_digest,state=EXCLUDED.state,evidence=EXCLUDED.evidence,
        registered_at=now(),reported_at=now(),last_concrete_activity_at=NULL,active_until=NULL`,
    [input.jobId,input.cycle,input.coordinator,input.executionId,input.evidence.digest,input.state,JSON.stringify(input)])
    await sql.query(`INSERT INTO constructor_external_events(job_id,execution_cycle,execution_id,coordinator,event_hash,evidence_digest,event_type,payload)
      VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8::jsonb)`,[input.jobId,input.cycle,input.executionId,input.coordinator,eventHash(input,type),input.evidence.digest,type,JSON.stringify(input)])
    await notifyExternal(sql,input,'Coordonator atribuit pentru #'+input.jobId,
      input.coordinator+'. Execuție încă neconfirmată. '+input.nextAction,eventHash(input,type))
    const saved=await sql.query<OwnerRow>('SELECT * FROM constructor_external_owners WHERE job_id=$1 AND execution_cycle=$2',[input.jobId,input.cycle])
    return view(saved.rows[0],now)
  })
}
export async function recordExternalRemediation(raw:unknown,now=Date.now()):Promise<ExternalRemediationView> {
  if(!releaseSideEffectsEnabled())throw new Error('external_remediation_release_inactive')
  const input=validateExternalRemediation(raw,now)
  return withConstructorObservationTransaction(async sql=>{
    if(!releaseSideEffectsEnabled())throw new Error('external_remediation_release_inactive')
    const job=await sql.query<{execution_cycle:number;status:string}>('SELECT execution_cycle,status FROM build_jobs WHERE id=$1 AND arhivat=false FOR UPDATE',[input.jobId])
    if(job.rows[0]?.execution_cycle!==input.cycle || ['done','cancelled'].includes(job.rows[0]?.status))throw new Error('external_remediation_job_stale')
    const found=await sql.query<OwnerRow>('SELECT * FROM constructor_external_owners WHERE job_id=$1 AND execution_cycle=$2 FOR UPDATE',[input.jobId,input.cycle])
    const old=found.rows[0]
    if(!old || old.execution_id!==input.executionId || old.coordinator!==input.coordinator)throw new Error('external_remediation_owner_conflict')
    const hash=eventHash(input,'report')
    const duplicate=await sql.query('SELECT id FROM constructor_external_events WHERE event_hash=$1',[hash])
    if(duplicate.rows.length)return view(old,now)
    if(now-Date.parse(input.evidence.observedAt)>ACTIVE_MS)throw new Error('external_remediation_evidence_stale')
    if(old.state==='completed')throw new Error('external_remediation_terminal')
    const seen=await sql.query('SELECT id FROM constructor_external_events WHERE execution_id=$1::uuid AND evidence_digest=$2 LIMIT 1',[input.executionId,input.evidence.digest])
    if(input.state==='working' && (seen.rows.length || input.evidence.digest===old.baseline_digest))return view(old,now)
    const concrete=input.state==='working'
    const observed=Date.parse(input.evidence.observedAt)
    if(old.last_concrete_activity_at && concrete && observed<=old.last_concrete_activity_at.getTime())throw new Error('external_remediation_evidence_out_of_order')
    const activity=concrete?input.evidence.observedAt:old.last_concrete_activity_at?.toISOString()??null
    const until=input.state!=='working'?null:concrete?new Date(observed+ACTIVE_MS).toISOString():old.active_until?.toISOString()??null
    await sql.query(`INSERT INTO constructor_external_events(job_id,execution_cycle,execution_id,coordinator,event_hash,evidence_digest,event_type,payload)
      VALUES($1,$2,$3::uuid,$4,$5,$6,'report',$7::jsonb)`,[input.jobId,input.cycle,input.executionId,input.coordinator,hash,input.evidence.digest,JSON.stringify(input)])
    await sql.query(`UPDATE constructor_external_owners SET state=$3,evidence=$4::jsonb,reported_at=now(),last_concrete_activity_at=$5::timestamptz,
      active_until=$6::timestamptz WHERE job_id=$1 AND execution_cycle=$2`,[input.jobId,input.cycle,input.state,JSON.stringify(input),activity,until])
    if(old.state!==input.state || (concrete && (old.last_concrete_activity_at===null || old.evidence.kind!==input.kind))) {
      await notifyExternal(sql,input,'Remediere externă #'+input.jobId+': '+input.state,
        input.coordinator+'. '+input.state+'. '+input.nextAction+' '+input.summary,hash)
    }
    const saved=await sql.query<OwnerRow>('SELECT * FROM constructor_external_owners WHERE job_id=$1 AND execution_cycle=$2',[input.jobId,input.cycle])
    return view(saved.rows[0],now)
  })
}
export async function readExternalRemediations(now=Date.now(),sql:Pick<pg.PoolClient,'query'>=getPool()):Promise<ExternalRemediationView[]> {
  const result=await sql.query<OwnerRow & {job_status:string}>(`SELECT o.*,b.status AS job_status FROM constructor_external_owners o JOIN build_jobs b
    ON b.id=o.job_id AND b.execution_cycle=o.execution_cycle WHERE b.arhivat=false ORDER BY o.reported_at DESC LIMIT 1001`)
  if(result.rows.length>1000)throw new Error('external_remediation_snapshot_incomplete')
  return result.rows.map(row=>view(row,now,!['done','cancelled'].includes(row.job_status)))
}
