import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CAPABILITIES } from './services/brainCapabilities.js'

// ── VOCE = SCRIS COMPLET (owner, 19 aug) + COMUTAREA SURSEI din chat/voce ─────
//
// „vreau să-i cer în chat vorbit sau scris să comute pe free creier și free
//  constructor sau combinații, sau când eu nu sunt să decidă autonom. Trebuie
//  egalizate drepturile chat audio cu chat scris." + „doar owner are drepturi pe
//  admin."
//
// Pinuiește pe SURSĂ contractul: (1) tura VOCALĂ a ownerului capătă tot inventarul
// + instrucțiunile de lucru, ca la scris; (2) ne-owner/oaspete pe voce NU capătă
// drepturi; (3) unealta comuta_sursa e cablată (definiție + listă admin + executor
// admin-only). Un test pe cod, ca paritatea să nu se piardă tăcut la o refactorare.

const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('paritatea vocii cu scrisul — DOAR pentru owner (admin)', () => {
  it('tura vocală a ownerului primește TOT inventarul (nu tura ușoară)', () => {
    // turaUsoara (unelte puține) nu se aplică pe frază rostită de owner.
    expect(chat).toMatch(/const turaUsoara = incarcatura\.faza === 'vorbire' && !\(isAdmin && !!audio\)/)
  })

  it('tura vocală a ownerului primește instrucțiunile de lucru (nu „curată")', () => {
    // turaCurata false pe voce owner → blocurile OWNER-ACT / NO-CONFIRMATIONS intră.
    expect(chat).toMatch(/const turaCurata = !incarcatura\.instructiuniDeLucru && !\(user\.role === 'admin' && !!audio\)/)
  })

  it('oaspetele pe voce NU capătă drepturi de owner — isAdmin exclude oaspetele', () => {
    // isAdmin = rol admin ȘI nu oaspete; deci `isAdmin && audio` e fals pe o tură
    // de oaspete, iar blocurile de lucru sunt oricum gardate de !turaDeOaspete.
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin' && !guestMatch/)
    expect(chat).toMatch(/user\.role === 'admin' && !turaDeOaspete/)
  })
})

describe('unealta comuta_sursa e cablată cap-coadă', () => {
  it('e definită ca Tool cu numele comuta_sursa', () => {
    expect(chat).toMatch(/const COMUTA_SURSA_TOOL: Tool = \{/)
    expect(chat).toMatch(/name: 'comuta_sursa'/)
  })
  it('e în lista de unelte a adminului (nu în cea a userului public)', () => {
    expect(chat).toMatch(/CONSTRUCTOR_COMMAND_TOOL, COMUTA_SURSA_TOOL/)
  })
  it('are executor, admin-only, care scrie config-ul viu și raportează măsurat', () => {
    const idx = chat.indexOf("case 'comuta_sursa':")
    expect(idx).toBeGreaterThanOrEqual(0)
    const bloc = chat.slice(idx, idx + 2200)
    expect(bloc).toMatch(/if \(!isAdmin\) return JSON\.stringify\(\{ error: 'admin_only' \}\)/)
    expect(bloc).toMatch(/setConfigCreier/)
    expect(bloc).toMatch(/rezumaComutare/)
    // decizia autonomă când ownerul lipsește (auto)
    expect(bloc).toMatch(/decideSursaAutonoma/)
    expect(bloc).toMatch(/esteOnline\(config\.adminEmail\)/)
  })
  it('promptul îi spune că „comută pe free" e chiar comuta_sursa + auto când lipsește', () => {
    expect(chat).toMatch(/SOURCE SWITCHING \(comuta_sursa\)/)
    expect(chat).toMatch(/comuta_sursa auto:true/)
  })
})

describe('registrul de capabilități știe unealta, pe voce', () => {
  it('comuta_sursa e în registru, admin, ajunge pe voce prin creier (ca tot restul)', () => {
    const c = CAPABILITIES.find((x) => x.name === 'comuta_sursa')
    expect(c, 'comuta_sursa lipsește din registrul unic').toBeTruthy()
    expect(c!.admin).toBe(true)
    expect(c!.chat).toBe(true)
    // Convenția registrului: lista de voce DIRECTĂ e goală by design; totul ajunge
    // pe voce prin creierul unic (voiceViaBrain). Paritatea reală a vocii owner-ului
    // e livrată în rută (turaUsoara/turaCurata), nu prin flagul `voice`.
    expect(c!.voice).toBe(false)
    expect(c!.voiceViaBrain).toBe(true)
  })
})
