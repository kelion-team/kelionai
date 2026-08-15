import { describe, it, expect } from 'vitest'
import { inceputStrain, aCerutAltaLimba } from './services/limbaRaspuns.js'

// ── GARDUL DETERMINIST DE LIMBĂ (9 aug — capturile „Dime, con…"/„Dime, ¿qué…"
// au dovedit că instrucțiunile nu țin). Funcții pure, probate pe replici REALE
// de pe banda ownerului, fără model și fără rețea. ──────────────────────────
describe('inceputStrain — răspunsul care începe străin se prinde determinist', () => {
  it('replicile spaniole REALE de pe banda ownerului se prind', () => {
    expect(inceputStrain('Dime, con quién hablo')).toBe('spaniolă')
    expect(inceputStrain('Dime, ¿qué necesitas?')).toBe('spaniolă')
    expect(inceputStrain('¡Hola! Claro que sí')).toBe('spaniolă')
  })

  it('dublurile românești NU se prind (hotfix „nu-i merge audio")', () => {
    // Astea începeau replici legitime și gardul le tăia — Kelion ieșea MUT.
    expect(inceputStrain('La ora 17 ai întâlnirea')).toBeNull()
    expect(inceputStrain('Ok, am facut ce ai cerut')).toBeNull()
    expect(inceputStrain('Le-am trimis pe amandoua')).toBeNull()
    expect(inceputStrain('No, hai ca se poate')).toBeNull()
    expect(inceputStrain('Una din probleme e rezolvata')).toBeNull()
  })

  it('româna NU se prinde — nici cu diacritice, nici fără', () => {
    expect(inceputStrain('Bună seara, Adrian. Ce facem azi?')).toBeNull()
    expect(inceputStrain('Sigur, iată nivelurile pe BTCUSDT')).toBeNull()
    expect(inceputStrain('Am verificat sistemul si totul e bine')).toBeNull()
    expect(inceputStrain('Da, pot face asta acum')).toBeNull()
  })

  it('engleza și germana la început se prind și ele', () => {
    expect(inceputStrain('Hello there, how can I help?')).toBe('engleză')
    expect(inceputStrain('Ich habe das verstanden')).toBe('germană')
  })

  it('PORTUGHEZA se prinde — bălăria REALĂ din captura ownerului (15 aug)', () => {
    // Pe banda de la V12.4 scria fix asta. „eu" e cuvânt românesc, deci nu el
    // e markerul — „não" (și ã/õ oriunde în primele 60 de litere) sunt.
    expect(inceputStrain('Eu não sei.')).toBe('portugheză')
    expect(inceputStrain('Não entendi o que você disse')).toBe('portugheză')
    expect(inceputStrain('Obrigado pela pergunta')).toBe('portugheză')
    expect(inceputStrain('Olá, tudo bem?')).toBe('portugheză')
    expect(inceputStrain('São Paulo é uma cidade grande')).toBe('portugheză')
  })

  it('dublurile portugheze NU mută româna: „eu", „sim", „voce" rămân ale noastre', () => {
    expect(inceputStrain('Eu am verificat sistemul acum')).toBeNull()
    expect(inceputStrain('Eu pot face asta acum')).toBeNull()
    // „SIM card" și „voce" fără accent — românești curate, gardul nu le atinge
    expect(inceputStrain('Sim cardul telefonului e activ')).toBeNull()
    expect(inceputStrain('Voce mai clara acum, am reglat volumul')).toBeNull()
  })

  it('gol / spații → null (nu inventăm verdict)', () => {
    expect(inceputStrain('')).toBeNull()
    expect(inceputStrain('   ')).toBeNull()
  })
})

describe('aCerutAltaLimba — cererea explicită deschide gardul', () => {
  it('cererile reale de comutare trec', () => {
    expect(aCerutAltaLimba('vorbește-mi în engleză te rog')).toBe(true)
    expect(aCerutAltaLimba('răspunde în spaniolă')).toBe(true)
    expect(aCerutAltaLimba('speak english please')).toBe(true)
  })

  it('vorbirea obișnuită NU deschide gardul', () => {
    expect(aCerutAltaLimba('Kelion, cât e bitcoinul?')).toBe(false)
    expect(aCerutAltaLimba('bună seara')).toBe(false)
    expect(aCerutAltaLimba('')).toBe(false)
  })
})
