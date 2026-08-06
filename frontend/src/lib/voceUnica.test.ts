import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  judecaMesajVoce,
  inimaAMurit,
  potRostiVoce,
  idTabVoce,
  INIMA_MOARTA_MS,
  emiteTakeover,
  emiteInima,
  emiteRamasBun,
  CHEIE_TAB_ACTIV_VOCE,
  CHEIE_ULTIMA_INIMA_VOCE,
  type MesajVoce,
} from './voceUnica'

describe('voceUnica - reguli pure zăvor voce între taburi', () => {
  const eu = 'tab-123'
  const altul = 'tab-456'

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  afterEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('generează un id unic de tab', () => {
    const id1 = idTabVoce()
    const id2 = idTabVoce()
    expect(id1).toMatch(/^tab-\d+-[a-z0-9]+$/)
    expect(id1).not.toBe(id2)
  })

  it('ignoră mesajele nule sau proprii', () => {
    expect(judecaMesajVoce(null, eu, false)).toBe('nimic')
    expect(judecaMesajVoce({ takeover: eu }, eu, false)).toBe('nimic')
    expect(judecaMesajVoce({ inima: eu }, eu, false)).toBe('nimic')
    expect(judecaMesajVoce({ ramasBun: eu }, eu, true)).toBe('nimic')
  })

  it('zăvorăște tabul dacă primește takeover de la alt tab', () => {
    const m: MesajVoce = { takeover: altul }
    expect(judecaMesajVoce(m, eu, false)).toBe('zavoraste')
    expect(judecaMesajVoce(m, eu, true)).toBe('zavoraste')
  })

  it('zăvorăște tabul ne-zăvorât dacă aude inima altui tab', () => {
    const m: MesajVoce = { inima: altul }
    // Dacă noi credeam că suntem activi dar auzim alt tab bătând inima, ne zăvorâm
    expect(judecaMesajVoce(m, eu, false)).toBe('zavoraste')
  })

  it('înregistrează inima dacă tabul era deja zăvorât', () => {
    const m: MesajVoce = { inima: altul }
    expect(judecaMesajVoce(m, eu, true)).toBe('inima')
  })

  it('reia vocea când tabul activ transmite rămas-bun și noi eram zăvorâți', () => {
    const m: MesajVoce = { ramasBun: altul }
    expect(judecaMesajVoce(m, eu, true)).toBe('reia')
    expect(judecaMesajVoce(m, eu, false)).toBe('nimic')
  })

  it('evaluează corect când inima e moartă (>25s)', () => {
    const acum = 100_000
    expect(inimaAMurit(acum - INIMA_MOARTA_MS + 100, acum)).toBe(false)
    expect(inimaAMurit(acum - INIMA_MOARTA_MS - 1, acum)).toBe(true)
  })

  it('evaluează corect dreptul de a rosti voce', () => {
    expect(potRostiVoce(eu, eu, false)).toBe(true)
    expect(potRostiVoce(eu, null, false)).toBe(true)
    expect(potRostiVoce(eu, altul, false)).toBe(false)
    expect(potRostiVoce(eu, eu, true)).toBe(false)
  })

  it('trimite mesaje pe broadcast channel și sincronizează localStorage', () => {
    const msgs: unknown[] = []
    const fakeBc = { postMessage: (m: unknown) => msgs.push(m) } as unknown as BroadcastChannel
    emiteTakeover(fakeBc, 't1')
    expect(localStorage.getItem(CHEIE_TAB_ACTIV_VOCE)).toBe('t1')

    emiteInima(fakeBc, 't1')
    expect(localStorage.getItem(CHEIE_TAB_ACTIV_VOCE)).toBe('t1')

    emiteRamasBun(fakeBc, 't1')
    expect(localStorage.getItem(CHEIE_TAB_ACTIV_VOCE)).toBeNull()

    expect(msgs).toEqual([
      { takeover: 't1' },
      { inima: 't1' },
      { ramasBun: 't1' },
    ])
  })
})

