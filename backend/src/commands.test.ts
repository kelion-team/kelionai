// ── THE COMMAND INTERPRETER'S TESTS (camera + monitor) ─────────────────────
//
// This module decides, BEFORE the brain and at no cost, whether a reply is a
// device command ("close the camera", "switch to the map") or real
// conversation that must reach Kelion. Its mistakes are instantly visible to
// the user: either it doesn't execute, or it executes over speech. Zero tests.
//
// The documented rules we guard (AI-HANDOFF, wave 4 / W4 #2):
//   • monitor operations start ONLY if the requested tab is really open —
//     otherwise the reply goes to the brain, so IT can open it;
//   • "close the map" when the map is NOT open must not close anything else.
import { describe, it, expect } from 'vitest'
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck } from './services/commands.js'

describe('commands — camera', () => {
  it('prinde pornirea și oprirea', () => {
    expect(interpretDeviceCommand('deschide camera')).toEqual({ camera: 'on' })
    expect(interpretDeviceCommand('închide camera')).toEqual({ camera: 'off' })
  })
  it('merge și în engleză', () => {
    expect(interpretDeviceCommand('turn on the camera')).toEqual({ camera: 'on' })
  })
  it('conversația obișnuită NU e comandă (ajunge la creier)', () => {
    expect(interpretDeviceCommand('ce mai faci?')).toBeNull()
    expect(interpretDeviceCommand('')).toBeNull()
    expect(interpretDeviceCommand('   ')).toBeNull()
  })
})

describe('commands — monitorul (doar pe tab-uri chiar deschise)', () => {
  const harta = [{ kind: 'map', title: 'Hartă', active: true }]

  it('comută pe un tab DESCHIS', () => {
    expect(interpretDeviceCommand('treci pe hartă', harta)).toEqual({ screen: { op: 'switchKind', kind: 'map' } })
  })
  it('fără niciun tab deschis, replica merge la creier (ca s-o DESCHIDĂ el)', () => {
    expect(interpretDeviceCommand('treci pe hartă', [])).toBeNull()
    expect(interpretDeviceCommand('treci pe hartă', null)).toBeNull()
  })
  it('W4 #2: „închide harta" când harta NU e deschisă nu închide ALTCEVA', () => {
    const video = [{ kind: 'video', title: 'Clip', active: true }]
    // The regression we guard: it must NOT return `close` (it would have closed the clip).
    expect(interpretDeviceCommand('închide harta', video)).toBeNull()
  })
  it('închide tab-ul numit, dacă e chiar deschis', () => {
    expect(interpretDeviceCommand('închide harta', harta)).toEqual({ screen: { op: 'closeKind', kind: 'map' } })
  })
  it('„închide tot" curăță monitorul', () => {
    expect(interpretDeviceCommand('închide tot', harta)).toEqual({ screen: { op: 'closeAll' } })
  })
})

describe('commands — confirmarea rostită', () => {
  it('camera confirmă în limba userului', () => {
    expect(deviceAck({ camera: 'off' }, true)).toMatch(/camera/i)
    expect(deviceAck({ camera: 'off' }, false)).toMatch(/camera/i)
    expect(deviceAck({ camera: 'off' }, true)).not.toBe(deviceAck({ camera: 'off' }, false))
  })
  it('operațiile pe monitor rămân TĂCUTE (acțiunea e feedback-ul)', () => {
    expect(deviceAck({ screen: { op: 'closeAll' } }, true)).toBe('')
  })
})

describe('commands — gesturile avatarului', () => {
  it('„dansează!" pornește dansul (bugul din 20 iul: \\b nu prindea diacriticul)', () => {
    expect(interpretGestureCommand('Dansează!')).toBe('dans')
    expect(interpretGestureCommand('danseaza')).toBe('dans')
  })
  it('o replică obișnuită nu declanșează niciun gest', () => {
    expect(interpretGestureCommand('spune-mi vremea')).toBeNull()
  })
  it('confirmarea gestului există în ambele limbi', () => {
    const ro = gestureAck('dans', true)
    const en = gestureAck('dans', false)
    expect(ro).toBeTruthy()
    expect(en).toBeTruthy()
    expect(ro).not.toBe(en)
  })
})
