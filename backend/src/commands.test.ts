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
import { interpretDeviceCommand, deviceAck, interpretGestureCommand, gestureAck, gestPentruSituatie } from './services/commands.js'

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
  it('„cameră" = ÎNCĂPERE nu deturnează tura (bug „prăjit la chat", 10 aug)', () => {
    // În română „cameră" e și „încăpere": aceste fraze firești despre o cameră-
    // încăpere NU trebuie să comute camera video, ci să ajungă la creier.
    expect(interpretDeviceCommand('stinge lumina din cameră')).toBeNull()
    expect(interpretDeviceCommand('închide ușa camerei')).toBeNull()
    expect(interpretDeviceCommand('deschide fereastra din cameră')).toBeNull()
    expect(interpretDeviceCommand('închide geamul din camera mea')).toBeNull()
  })
  it('dispozitivul numit explicit rămâne comandă', () => {
    expect(interpretDeviceCommand('închide webcam')).toEqual({ camera: 'off' })
    expect(interpretDeviceCommand('pornește camera video')).toEqual({ camera: 'on' })
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

// GESTUL PE SITUAȚIE (Adrian, 5 aug: „folosește gesturile greșit, fără logică —
// o logică clară pe subiect/situație"). O situație → un gest, determinist.
describe('commands — gestul pe situație (logică clară)', () => {
  const gol = { userText: '', replyText: '', aAratat: false }
  it('arată ceva pe ecran → arată cu mâna (cel mai obiectiv semn)', () => {
    expect(gestPentruSituatie({ ...gol, aAratat: true })).toBe('arata-inainte')
    // chiar dacă e și un salut, arătatul pe ecran are prioritate
    expect(gestPentruSituatie({ userText: 'salut', replyText: 'Bună!', aAratat: true })).toBe('arata-inainte')
  })
  it('salut de deschidere (om sau Kelion) → salut', () => {
    expect(gestPentruSituatie({ ...gol, userText: 'Bună, Kelion!' })).toBe('salut')
    expect(gestPentruSituatie({ ...gol, replyText: 'Bună, Adrian! Cu ce te ajut?' })).toBe('salut')
  })
  it('rămas-bun (om sau Kelion) → salut de mână', () => {
    expect(gestPentruSituatie({ ...gol, userText: 'la revedere' })).toBe('salut')
    expect(gestPentruSituatie({ ...gol, replyText: 'O zi bună! Ne auzim.' })).toBe('salut')
  })
  it('cere să aștepți → stai puțin', () => {
    expect(gestPentruSituatie({ ...gol, replyText: 'Stai puțin, verific imediat.' })).toBe('stai-putin')
  })
  it('a reușit → entuziasm; se scuză → dezamăgire', () => {
    expect(gestPentruSituatie({ ...gol, replyText: 'Gata, am terminat de trimis.' })).toBe('entuziasm')
    expect(gestPentruSituatie({ ...gol, replyText: 'Îmi pare rău, n-am reușit să găsesc.' })).toBe('dezamagire')
  })
  it('omul mulțumește (scurt) → mulțumire', () => {
    expect(gestPentruSituatie({ ...gol, userText: 'mulțumesc mult!' })).toBe('multumire')
  })
  it('replică neutră, informativă → NIMIC (gentleman compus)', () => {
    expect(gestPentruSituatie({ userText: 'cât e ceasul?', replyText: 'Este 14:20.', aAratat: false })).toBeNull()
    // „bună treabă" într-o cerere lungă nu declanșează salut (nu e deschidere scurtă)
    expect(
      gestPentruSituatie({ userText: 'am o listă de lucruri de făcut și vreau să le organizăm pe categorii clare', replyText: 'Sigur.', aAratat: false }),
    ).toBeNull()
  })
})
