import { describe, it, expect } from 'vitest'
import { realtimeInstructions } from './realtime.js'

describe('realtimeInstructions', () => {
  it('limbă CUNOSCUTĂ (persistată): o menține consecvent', () => {
    const ro = realtimeInstructions('ro')
    expect(ro).toContain('Romanian')
    expect(ro).toContain('consecvent')

    // Long tag — the route normalizes to 2 letters first; here we already
    // receive 'en'.
    // NOTE (Jul 25): "Romanian" LEGITIMATELY appears for English users too —
    // in the language guard's LIST of allowed languages ("only in: English,
    // Romanian, ..."). What matters is the user's ESTABLISHED language, not
    // the word's absence from the guard.
    const en = realtimeInstructions('en')
    expect(en).toContain('limba stabilită a utilizatorului este English')
    expect(en).not.toContain('limba stabilită a utilizatorului este Romanian')
  })

  it('limbă NEcunoscută (user nou): începe în engleză și OGLINDEȘTE limba vorbită', () => {
    const t = realtimeInstructions('')
    expect(t).toContain('ENGLEZĂ')
    expect(t).toContain('Detectează limba')
    // It doesn't switch on short/ambiguous words — stability.
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

// GPS ON DEMAND (the Jul 26 outage: without a permanent stream, voice was
// left with no path to the position and said "I don't have GPS access"). The
// get_location tool MUST exist in the voice session — its regression would
// blind voice to location again.
describe('realtimeTools', () => {
  it('include get_location (citirea GPS la cerere, executată în browser)', async () => {
    const { realtimeTools } = await import('./realtime.js')
    const names = realtimeTools().map((t) => t.name)
    expect(names).toContain('get_location')
    expect(names).toContain('get_weather')
    expect(names).toContain('show_on_screen')
  })
})
