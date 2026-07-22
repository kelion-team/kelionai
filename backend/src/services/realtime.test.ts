import { describe, it, expect } from 'vitest'
import { realtimeInstructions } from './realtime.js'

describe('realtimeInstructions', () => {
  it('fixează limba persistată în instrucțiuni (blocaj absolut)', () => {
    const ro = realtimeInstructions('ro')
    expect(ro).toContain('Romanian')
    expect(ro).toContain('EXCLUSIV în Romanian')

    const en = realtimeInstructions('en-US')
    expect(en).toContain('English')
    expect(en).not.toContain('Romanian')
  })

  it('cade pe English pentru un tag necunoscut', () => {
    expect(realtimeInstructions('xx')).toContain('English')
  })

  it('include rolul (meseria) activ când e dat', () => {
    const withRole = realtimeInstructions('ro', 'Avocat')
    expect(withRole).toContain('Avocat')
    const noRole = realtimeInstructions('ro')
    expect(noRole).not.toContain('rolul activ')
  })

  it('impune ton scurt, vorbit, fără liste/markdown', () => {
    const t = realtimeInstructions('ro')
    expect(t).toContain('voce masculină')
    expect(t.toLowerCase()).toContain('fără markdown')
  })
})
