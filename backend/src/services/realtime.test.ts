import { describe, it, expect } from 'vitest'
import { realtimeInstructions } from './realtime.js'

describe('realtimeInstructions', () => {
  it('limbă CUNOSCUTĂ (persistată): o menține consecvent', () => {
    const ro = realtimeInstructions('ro')
    expect(ro).toContain('Romanian')
    expect(ro).toContain('consecvent')

    // Tag lung — ruta normalizează la 2 litere înainte; aici primim deja 'en'.
    // NOTĂ (25 iul): „Romanian" apare LEGITIM și la userii englezi — în LISTA
    // gărzii de limbi permise („only in: English, Romanian, ..."). Ce contează
    // e limba STABILITĂ a userului, nu absența cuvântului din gardă.
    const en = realtimeInstructions('en')
    expect(en).toContain('limba stabilită a utilizatorului este English')
    expect(en).not.toContain('limba stabilită a utilizatorului este Romanian')
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

// GPS LA CERERE (pana din 26 iul: fără flux permanent, vocea rămânea fără nicio
// cale spre poziție și zicea „nu am acces la GPS"). Unealta get_location TREBUIE
// să existe în sesiunea de voce — regresia ei ar orbi din nou vocea la locație.
describe('realtimeTools', () => {
  it('include get_location (citirea GPS la cerere, executată în browser)', async () => {
    const { realtimeTools } = await import('./realtime.js')
    const names = realtimeTools().map((t) => t.name)
    expect(names).toContain('get_location')
    expect(names).toContain('get_weather')
    expect(names).toContain('show_on_screen')
  })
})
