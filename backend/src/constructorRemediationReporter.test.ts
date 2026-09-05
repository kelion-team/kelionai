import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const source=readFileSync(new URL('./constructorRemediationReporter.ts',import.meta.url),'utf8')
const compile=(text:string)=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const entry=compile(source).replace('void main();','globalThis.completion = main();')
const activation=compile(readFileSync(new URL('./services/releaseActivation.ts',import.meta.url),'utf8'))
const sha='a'.repeat(40)
const live={NODE_ENV:'production',RELEASE_CANDIDATE_MODE:'1',GIT_COMMIT_SHA:sha,RELEASE_ID:sha,RELEASE_ACTIVATION_FILE:'/run/kelion-release/active'}
type Options={uid?:number;euid?:number;operation?:string;extraArg?:boolean;env?:Record<string,string>;marker?:string;missingMarker?:boolean;
 input?:string|Buffer;timeout?:boolean;writerFailure?:boolean;database?:boolean;deactivate?:boolean}
async function run(options:Options={}) {
  const stdin=new PassThrough()
  const calls:string[]=[]
  const payloads:unknown[][]=[]
  const stdout:string[]=[]
  const stderr:string[]=[]
  const env={...live,...options.env}
  let marker=options.marker??sha
  const config={release:{candidateMode:env.RELEASE_CANDIDATE_MODE==='1',id:env.RELEASE_ID,activationFile:env.RELEASE_ACTIVATION_FILE}}
  const activationExports:Record<string,unknown>={}
  vm.runInNewContext(activation,{exports:activationExports,require:(id:string)=>{
    if(id==='../config.js')return {config}
    if(id==='node:fs')return {readFileSync:()=>{calls.push('marker');if(options.missingMarker)throw new Error('private marker path');return marker}}
    throw new Error('unexpected activation dependency')
  }})
  const processMock={platform:'linux',getuid:()=>options.uid??0,geteuid:()=>options.euid??0,
    argv:['node','/app/backend/dist/constructorRemediationReporter.js',options.operation??'register',...(options.extraArg?['unsafe']:[])],
    env,stdin,stdout:{write:(text:string)=>stdout.push(text)},stderr:{write:(text:string)=>stderr.push(text)},exitCode:0}
  const context:Record<string,unknown>={process:processMock,Buffer,TextDecoder,
    clearTimeout,setTimeout:(callback:()=>void,ms:number)=>{
      expect(ms).toBe(5000)
      return setTimeout(callback,options.timeout?1:ms)
    },
    require:(id:string)=>{
      calls.push(id)
      if(id==='./config.js')return {config}
      if(id==='./services/releaseActivation.js')return activationExports
      if(id==='./db.js')return {dbEnabled:()=>options.database!==false,inchidePool:async()=>{calls.push('close')}}
      if(id==='./services/constructorExternalRemediation.js') {
        if(options.deactivate)marker='b'.repeat(40)
        const write=(operation:string)=>async(...args:unknown[])=>{
          calls.push(operation);payloads.push(args)
          if(options.writerFailure)throw new Error('secret=private-database-payload')
          return {jobId:666,cycle:0,activeExternalRemediation:false}
        }
        return {registerExternalRemediation:write('register'),recordExternalRemediation:write('report')}
      }
      throw new Error('unexpected entry dependency')
    },
  }
  vm.runInNewContext(entry,context)
  if(!options.timeout)stdin.end(options.input??JSON.stringify({input:{jobId:666}}))
  await context.completion
  return {calls,payloads,stdout,stderr,exitCode:processMock.exitCode}
}
describe('delivered root-only remediation reporter, actual entrypoint body',()=>{
  it('registers only after canonical config and real activation guard, then closes pool',async()=>{
    const result=await run()
    expect(result.exitCode).toBe(0)
    expect(result.calls.indexOf('./config.js')).toBeLessThan(result.calls.indexOf('marker'))
    expect(result.calls.indexOf('marker')).toBeLessThan(result.calls.indexOf('register'))
    expect(result.calls.slice(-2)).toEqual(['register','close'])
    expect(result.payloads).toEqual([[{jobId:666},undefined]])
    expect(JSON.parse(result.stdout.join(''))).toMatchObject({ok:true,result:{activeExternalRemediation:false}})
  })
  it('reports via the canonical writer and preserves explicit takeover CAS only on register',async()=>{
    expect((await run({operation:'report'})).calls).toContain('report')
    const takeover=await run({input:JSON.stringify({input:{jobId:666},expectedExecutionId:'opaque-cas'})})
    expect(takeover.payloads).toEqual([[{jobId:666},'opaque-cas']])
    expect((await run({operation:'report',input:'{"input":{},"expectedExecutionId":"x"}'})).exitCode).toBe(1)
  })
  it.each([{uid:1000},{euid:1000}])('refuses non-root before reading configuration: %j',async options=>{
    const result=await run(options)
    expect(result.calls).toEqual([])
    expect(result.exitCode).toBe(1)
  })
  it.each([{operation:'deploy'},{extraArg:true}])('refuses arbitrary operations/arguments: %j',async options=>{
    expect((await run(options)).calls).toEqual([])
  })
  it.each([{NODE_ENV:'test'},{RELEASE_CANDIDATE_MODE:'0'},{RELEASE_ID:'b'.repeat(40)},
    {GIT_COMMIT_SHA:'a32'},{RELEASE_ACTIVATION_FILE:'/tmp/invented'}])('never enables a process without exact live environment: %j',async env=>{
    const result=await run({env})
    expect(result.calls).toEqual([])
    expect(result.exitCode).toBe(1)
  })
  it.each([{marker:'b'.repeat(40)},{missingMarker:true},{deactivate:true}])('real release guard rejects inactive or lost markers: %j',async options=>{
    const result=await run(options)
    expect(result.calls).not.toContain('register')
    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('')).not.toContain('private marker path')
  })
  it.each(['', '{}','[]','{"input":{},"other":1}','{"input":{},"expectedExecutionId":7}',Buffer.from([0xff])])('rejects malformed stdin without any writer call: %s',async input=>{
    const result=await run({input})
    expect(result.calls).not.toContain('register')
    expect(result.exitCode).toBe(1)
  })
  it('limits bytes and read time, never importing a DB writer on either failure',async()=>{
    for(const options of [{input:'x'.repeat(8193)},{timeout:true}]){
      const result=await run(options)
      expect(result.calls).not.toContain('./db.js')
      expect(result.exitCode).toBe(1)
    }
  })
  it('closes the pool and emits no sensitive error or success on a writer failure',async()=>{
    const result=await run({writerFailure:true})
    expect(result.calls.at(-1)).toBe('close')
    expect(result.stdout).toEqual([])
    expect(result.stderr.join('')).not.toContain('private-database')
    expect(result.exitCode).toBe(1)
  })
  it('refuses a missing database without invoking the writer',async()=>{
    const result=await run({database:false})
    expect(result.calls.at(-1)).toBe('close')
    expect(result.calls).not.toContain('register')
  })
  it('is an independent shipped graph root, not a function-name exemption',()=>{
    const scanner=readFileSync(new URL('../../scripts/verifica-exporturi.mjs',import.meta.url),'utf8')
    expect(scanner).toContain("'backend/src/constructorRemediationReporter.ts'")
    expect(scanner).not.toContain("'registerExternalRemediation'")
    expect(scanner).not.toContain("'recordExternalRemediation'")
    expect(readFileSync(new URL('../../Dockerfile',import.meta.url),'utf8')).toContain('/build/backend/dist ./backend/dist')
    expect(readFileSync(new URL('../tsconfig.json',import.meta.url),'utf8')).toContain('"include": ["src"]')
    const compose=readFileSync(new URL('../../deploy/compose.production.yml',import.meta.url),'utf8')
    expect(compose).toContain('RELEASE_ACTIVATION_FILE: /run/kelion-release/active')
  })
})
