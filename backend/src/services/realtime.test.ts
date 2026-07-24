import { describe, it, expect } from 'vitest'
import { realtimeInstructions } from './realtime.js'

describe('realtimeInstructions', () => {
  it('limbă CUNOSCUTĂ (persistată): o menține consecvent', () => {
    const ro = realtimeInstructions('ro')
    expect(ro).toContain('Romanian')
    expect(ro).toContain('consecvent')

    // Tag lung — ruta normalizează la 2 litere înainte; aici primim deja 'en'.
    const en = realtimeInstructions('en')
    expect(en).toContain('English')
    expect(en).not.toContain('Romanian')
  })

  it('limbă NEcunoscută (user nou): începe în engleză și OGLINDEȘTE limba vorbită', () => {
    const t = realtimeInstructions('')
    expect(t).toContain('ENGLEZĂ')
    expect(t).toContain('Detectează limba')
    // Nu comută pe cuvinte scurte/ambigue — stabilitate.
    expect(t).toContain('propoziție clară')
  })

  it('include rolul (meseria) activ când e dat', () => {
    const withRole = realtimeInstructions('ro', 'Avocat')
    expect(withRole).toContain('Avocat')
    const noRole = realtimeInstructions('ro')
    expect(noRole).not.toContain('rolul activ')
  })

  it('impune ton scurt, vorbit, fără liste/markdown + gentleman', () => {
    const t = realtimeInstructions('ro')
    expect(t).toContain('voce masculină')
    expect(t.toLowerCase()).toContain('fără markdown')
    expect(t).toContain('gentleman')
  })
})
