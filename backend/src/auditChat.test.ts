// ── P20: AUDITUL MULTI-AGENT PE TOT LANȚUL CHATULUI (15 aug 2026) ───────────
// (owner, verbatim: „deci atentie maxima, vreau tu si toti agenti sa faca un
// audit si reparatie pe tot chatul, nu mai vreau sa mai vad balari in chat sau
// vocea lui sa lipseasca" + „folosesti tot ce ai la dispozitie, inclusiv la
// verificare toti agenti")
//
// 24 de constatări găsite de 6 auditori, 23 CONFIRMATE adversarial de câte un
// verificator care a încercat să le respingă pe cod. Lacătele de aici țin
// reparațiile confirmate pe loc — fiecare `it` numește constatarea lui.
//
// VOCE SCOASĂ (clean-slate 21 aug — owner: „surd, mut, nu scrie"): lacătele
// despre ruta vocală (routes/vocalLive.ts), motorul (services/vocalLive.ts) și
// clientul/banda din frontend au fost RETRASE odată cu codul lor. Rămân aici
// DOAR lacătele care apără calea SCRISĂ (chat.ts) și memoria — neatinse de
// teardown. Când se reconstruiește vocea (§2, PROIECT-CHAT-VOCE.md) se scriu
// lacăte noi pentru ea.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { memorieUnificata } from './services/memorieUnificata.js'

const aici = dirname(fileURLToPath(import.meta.url))
const chat = readFileSync(join(aici, 'routes/chat.ts'), 'utf8')

describe('P20 — calea scrisă (chat.ts)', () => {
  it('gardul determinist de limbă există și pe scris, cu notă cinstită la suprimare', () => {
    expect(chat).toMatch(/limbaScrisaSuprimata = true/)
    expect(chat).toMatch(/replică scrisă suprimată \(începe în/)
    expect(chat).toMatch(/const NOTA_LIMBA = 'Mi-a scăpat începutul răspunsului în altă limbă/)
  })

  it('replica suprimată NU intră în istoric — se salvează nota, nu r.text-ul străin', () => {
    expect(chat).toMatch(/if \(limbaScrisaSuprimata\) assistantText = NOTA_LIMBA/)
  })

  it('ușa creierului nu mai dublează istoricul și nu mai scapă ture suprimate în el', () => {
    expect(chat).toMatch(/const eUsaCreierului = req\.body\?\.usaCreierului === true/)
    expect(chat).toMatch(/lastTurn\?\.role === 'user' && !eUsaCreierului/)
    expect(chat).toMatch(/if \(assistantText && !eUsaCreierului\) \{/)
  })

  it('sentinela <TAC/> se prinde și în variante („<tac/>", „<TAC />") — nu se mai emite și rostește', () => {
    expect(chat).toMatch(/\.toUpperCase\(\)\s*\n\s*if \(SENTINELA_TAC\.startsWith\(capat\)\)/)
    expect(chat).toMatch(/<\\s\*tac\\s\*\\\/\?\\s\*>/)
  })
})

describe('P20 — memoria', () => {
  it('memoria unificată sare replicile străine ale lui Kelion sub lacătul românesc (comportament)', () => {
    const db = [
      { role: 'user', content: 'Kelion, ce ora e?' },
      { role: 'assistant', content: 'Eu não sei o que dizer agora' },
      { role: 'assistant', content: 'Este ora 14:30, Adrian.' },
    ]
    const cuLacat = memorieUnificata(db, [], 12, true)
    expect(cuLacat).not.toContain('não')
    expect(cuLacat).toContain('ora 14:30')
    expect(cuLacat).toContain('Kelion, ce ora e?') // rândurile omului trec mereu
    // fără lacăt (user pe altă limbă) — nimic nu se filtrează
    const faraLacat = memorieUnificata(db, [], 12, false)
    expect(faraLacat).toContain('não')
  })
})
