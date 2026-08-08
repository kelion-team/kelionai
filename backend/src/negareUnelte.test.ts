import { describe, it, expect } from 'vitest'
import { neagaUneltele } from './services/negareUnelte.js'

// Gardul DETERMINIST anti-negare (Adrian, 5 aug: „kelion îmi zice că nu are
// unelte" + „asta e un soft — ce cablezi, aia face"). Negarea uneltelor e
// marfă stricată care nu pleacă la om; folosirea lor cinstită trece.
describe('negareUnelte — cablajul, nu predica', () => {
  it('prinde negările românești', () => {
    expect(neagaUneltele('Îmi pare rău, nu am unelte de căutare.')).toBe(true)
    expect(neagaUneltele('Nu dispun de unelte pentru asta.')).toBe(true)
    expect(neagaUneltele('Din păcate nu am acces la internet.')).toBe(true)
    expect(neagaUneltele('Nu pot căuta pe internet informații live.')).toBe(true)
    expect(neagaUneltele('Nu am capacitatea de a naviga pe web.')).toBe(true)
    expect(neagaUneltele('Sunt doar un model de limbaj și nu pot face asta.')).toBe(true)
  })

  it('prinde negările englezești', () => {
    expect(neagaUneltele("I don't have tools to search the web.")).toBe(true)
    expect(neagaUneltele('I cannot browse the internet.')).toBe(true)
    expect(neagaUneltele('As an AI language model, I cannot access live data.')).toBe(true)
    expect(neagaUneltele('I do not have access to the internet.')).toBe(true)
  })

  it('NU blochează folosirea cinstită a uneltelor sau alte negări legitime', () => {
    expect(neagaUneltele('Am căutat pe web și nu am găsit nimic despre asta.')).toBe(false)
    expect(neagaUneltele('Nu am acces la acel document privat — nu mi l-ai partajat.')).toBe(false)
    expect(neagaUneltele('Cursul BNR de azi este 5.2497 lei (sursa: cursbnr.ro).')).toBe(false)
    expect(neagaUneltele('Nu pot verifica cifra asta — sursa nu răspunde.')).toBe(false)
    expect(neagaUneltele('')).toBe(false)
  })
})
