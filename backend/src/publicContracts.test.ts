import { describe,expect,it } from 'vitest'
import { publicHealthPayload,publicVersionPayload } from './services/publicRuntimeContract.js'
import { publicAgentRoster } from './services/publicAgentContract.js'
import { constructorAutomationAuthority,doctorExecutionScope } from './services/doctorPolicy.js'

describe('public contract formatters preserve existing HTTP semantics', () => {
  it('returns health and exactly the supplied live version without an invented SHA', () => {
    expect(publicHealthPayload()).toEqual({ status:'ok' })
    expect(publicVersionPayload('abc1234','2026-09-05T00:00:00.000Z')).toEqual({ v:'abc1234',ver:'abc1234',at:'2026-09-05T00:00:00.000Z' })
  })
  it('maps only already authorized agents and never serializes arbitrary fields', () => {
    const rows = [{ id:'translator',nume:'Traducător',rol:'Traduce',privateKey:'not-public' }]
    expect(publicAgentRoster(rows)).toEqual({ count:1,agents:[{ id:'translator',nume:'Traducător',rol:'Traduce',url:'/api/a2a/translator' }] })
    expect(publicAgentRoster([])).toEqual({ count:0,agents:[] })
  })
})

describe('canonical Constructor automation metadata', () => {
  it('rejects absent, broadened, reordered, unknown and injected scopes', () => {
    const scope = doctorExecutionScope('public_health')!
    expect(constructorAutomationAuthority('doctor',scope)).toEqual({ automationOrigin:'doctor',repairScope:scope })
    expect(constructorAutomationAuthority('admin',null)).toEqual({ automationOrigin:'admin',repairScope:null })
    for (const invalid of [null,{ ...scope,allowedPaths:['backend/src/session.ts'] },
      { ...scope,allowedPaths:[...scope.allowedPaths].reverse() },{ ...scope,extra:true },
      { code:'chat_output_missing',allowedPaths:scope.allowedPaths }]) {
      expect(() => constructorAutomationAuthority('doctor',invalid)).toThrow('constructor_automation_scope_invalid')
    }
    expect(() => constructorAutomationAuthority('admin',scope)).toThrow()
    expect(() => constructorAutomationAuthority(undefined,null)).toThrow()
  })
})
