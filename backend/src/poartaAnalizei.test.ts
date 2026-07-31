import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── „ANALIZEZ" NU MAI E O VORBĂ ─────────────────────────────────────────────
//
// Adrian, 31 iul: „când spune că o să analizez, trebuie FAPTIC să deschidă
// monitorul și să arate ce face!"
//
// Poarta faptei (27 iul) prindea „AM făcut" — o faptă declarată fără să fi
// fost chemată vreo unealtă. Dar promisiunea de a te UITA la ceva trecea
// nestingherită: „analizez", „mă uit", „verific" încheiau tura, sunau a
// muncă, și nu se întâmpla nimic. Omul rămânea în fața unui ecran gol,
// așteptând o analiză care nu începuse.
//
// Acum sunt DOUĂ porți, iar a doua nu cere doar execuție — cere ca munca să
// se VADĂ pe monitor în timp ce se face.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const orch = sursa('./services/orchestrator.ts')
const chat = sursa('./routes/chat.ts')

describe('poarta analizei există și e separată de poarta faptei', () => {
  it('are propriul tipar de cuvinte și propriul întrerupător de o-singură-dată', () => {
    expect(orch).toMatch(/const ANALIZA_CLAIM_RE\s*=/)
    expect(orch).toMatch(/let analizaGateUsed = false/)
    expect(orch).toMatch(/!analizaGateUsed &&\s*\n\s*!anyToolCalled/)
  })

  it('nu o înlocuiește pe cea veche — amândouă rămân active', () => {
    expect(orch).toMatch(/DEED_CLAIM_RE\.test/)
    expect(orch).toMatch(/ANALIZA_CLAIM_RE\.test/)
    expect(orch).toMatch(/POARTA FAPTEI/)
    expect(orch).toMatch(/POARTA ANALIZEI/)
  })

  it('se declanșează DOAR când n-a chemat nicio unealtă', () => {
    // Dacă a chemat ceva, chiar s-a uitat — nu-l mai batem la cap.
    const bloc = /POARTA ANALIZEI[\s\S]*?continue\n/.exec(orch)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
  })
})

describe('cuvintele care erau vorbă goală sunt prinse', () => {
  // Reconstruim tiparul din sursă și-l probăm PE BUNE — nu verificăm doar că
  // regexul există, ci că prinde exact frazele cu care murea o tură.
  const linia = /const ANALIZA_CLAIM_RE\s*=\s*\n?\s*(\/[\s\S]*?\/i)/.exec(orch)?.[1] ?? ''
  const re = new RegExp(linia.slice(1, linia.lastIndexOf('/')), 'i')

  const prinse = [
    'Bun, o să analizez fișierul și revin.',
    'Mă uit acum peste cod.',
    'Verific ce se întâmplă acolo.',
    'Investighez cauza.',
    'Let me look into it.',
    "I'll check the logs.",
    'Arunc o privire în jurnale.',
  ]
  for (const f of prinse) {
    it(`prinde: „${f}"`, () => expect(re.test(f)).toBe(true))
  }

  // Nu trebuie să sară pe orice. Un răspuns care CHIAR livrează ceva, sau o
  // constatare la trecut, n-are ce căuta în poartă.
  const libere = [
    'Gata, am reparat și am pus PR-ul #612.',
    'Am analizat deja — cauza e la linia 218.',
    'Nu pot face asta: nu am acces la facturare.',
    'Rezultatul e 804.',
  ]
  for (const f of libere) {
    it(`NU prinde: „${f}"`, () => expect(re.test(f)).toBe(false))
  }
})

describe('cererea e să DESCHIDĂ MONITORUL, nu doar să execute', () => {
  it('mesajul porții cere explicit show_document', () => {
    expect(orch).toMatch(/PUNE PE MONITOR[\s\S]{0,60}show_document/)
    expect(orch).toMatch(/fișier și linie/)
  })

  it('cere și sinceritate dacă n-are cu ce să analizeze', () => {
    expect(orch).toMatch(/Dacă nu ai cu ce să analizezi, spune clar asta/)
  })

  it('regula e și în promptul lui, nu doar în poartă', () => {
    // Poarta e plasa. Promptul e ca să nu se ajungă la plasă.
    expect(chat).toMatch(/IF YOU SAY YOU WILL ANALYSE, ANALYSE — ON SCREEN/)
    expect(chat).toMatch(/call show_document FIRST/)
    expect(chat).toMatch(/call show_document AGAIN with what you FOUND/)
    expect(chat).toMatch(/Never announce an analysis you do not immediately perform and display/)
  })
})
