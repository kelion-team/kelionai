// ── TESTELE INTERPRETORULUI DE COMENZI (cameră + monitor) ───────────────────
//
// Modulul ăsta decide, ÎNAINTE de creier și fără niciun cost, dacă o replică e o
// comandă de dispozitiv („închide camera", „treci pe hartă") sau conversație
// adevărată care trebuie să ajungă la Kelion. Greșelile lui sunt vizibile
// instant pentru user: ori nu execută, ori execută peste vorbă. Zero teste.
//
// Regulile documentate pe care le apărăm (AI-HANDOFF, valul 4 / W4 #2):
//   • operațiile pe monitor pornesc DOAR dacă tab-ul cerut e chiar deschis —
//     altfel replica merge la creier, ca el să-l DESCHIDĂ;
//   • „închide harta" când harta NU e deschisă nu are voie să închidă altceva.
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
    // Regresia pe care o apărăm: să NU întoarcă `close` (ar fi închis clipul).
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
