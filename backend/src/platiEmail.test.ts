// Parserul care scoate suma + referința din emailul de încasare Revolut.
// Structura e luată de pe un email REAL Revolut (bloc cu „Sumă …" și „Referință").
import { describe, it, expect, vi } from 'vitest'

// Izolăm parserul pur — nu vrem să pornim IMAP/DB/Google la import.
vi.mock('../config.js', () => ({ config: { adminEmail: 'adrianenc11@gmail.com' } }))
vi.mock('../db.js', () => ({
  getGoogleRefreshToken: async () => '',
  loadKv: async () => null,
  saveKv: async () => {},
}))
vi.mock('./google.js', () => ({ refreshGoogleAccessToken: async () => null }))
vi.mock('./mailbox.js', () => ({ htmlToText: (h: string) => h }))
vi.mock('./openBanking.js', () => ({ proceseazaIntrare: async () => ({ fel: 'vechi' }) }))

const { esteIncasare, numarDinText, extragePlata } = await import('./services/platiEmail.js')

describe('emailul Revolut: încasare vs trimitere', () => {
  it('„Ai primit" e încasare', () => {
    expect(esteIncasare('Ai primit 20 GBP de la Ion Popescu 💸')).toBe(true)
  })
  it('„Ai trimis" NU e încasare (e o ieșire)', () => {
    expect(esteIncasare('Ai trimis 625 RON către EMILIAN Bogdan Vasile 💸')).toBe(false)
  })
  it('emailurile care nu-s de bani nu-s încasări', () => {
    expect(esteIncasare('ADRIAN, cardul a fost trimis 🚚')).toBe(false)
    expect(esteIncasare('Parola ta a fost actualizată ✅')).toBe(false)
  })
})

describe('numărul din text (RO și EN)', () => {
  it('virgulă zecimală RO', () => expect(numarDinText('249,82')).toBe(249.82))
  it('întreg simplu', () => expect(numarDinText('625')).toBe(625))
  it('mii cu virgulă + punct zecimal EN', () => expect(numarDinText('1,234.56')).toBe(1234.56))
  it('mii cu punct + virgulă zecimală RO', () => expect(numarDinText('1.234,56')).toBe(1234.56))
  it('gol → null', () => expect(numarDinText('fără cifre')).toBeNull())
})

describe('extragerea plății din email real', () => {
  // Corpul așa cum iese din htmlToText pe blocul Revolut (etichetă pe un rând,
  // valoarea pe rândul următor).
  const corpPrimit =
    'Salut, ADRIAN,\n\nAi primit 20 GBP de la Ion Popescu. Găsești detaliile mai jos:\n' +
    'Expeditor\nIon Popescu\n\nSumă primită\n20 GBP\n\nReferință\nKEL-7F3A9\n\nData\nAstăzi'

  it('scoate suma, valuta și codul din referință', () => {
    const p = extragePlata('Ai primit 20 GBP de la Ion Popescu 💸', corpPrimit)
    expect(p).not.toBeNull()
    expect(p!.amount).toBe(20)
    expect(p!.currency).toBe('GBP')
    expect(p!.referinta).toBe('KEL-7F3A9')
  })

  it('sumă cu zecimale', () => {
    const corp = 'Ai primit\n\nSumă primită\n249,82 GBP\n\nReferință\nKEL-ABC'
    const p = extragePlata('Ai primit 249,82 GBP de la X', corp)
    expect(p!.amount).toBe(249.82)
    expect(p!.currency).toBe('GBP')
  })

  it('un email de TRIMITERE nu produce nicio plată', () => {
    const corpTrimis = 'Ai trimis 625 RON către EMILIAN\n\nSumă trimisă\n625 RON\n\nReferință\nTrimis prin Revolut'
    expect(extragePlata('Ai trimis 625 RON către EMILIAN 💸', corpTrimis)).toBeNull()
  })
})
