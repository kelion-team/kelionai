import { describe, it, expect } from 'vitest'
import { deflecteazaConstructor, aAlocatConstructie } from './services/deflectareConstructor.js'

// Gardul anti-deflectare (Adrian, 5 aug: „kelion nu alocă constructorului
// cererile — spune că echipa de dezvoltare repară. Care e echipa de
// dezvoltare?"). Amânarea spre o echipă inexistentă = marfă stricată;
// alocarea reală (o unealtă de construcție chemată) trece.
describe('deflectareConstructor — cablul, nu promptul', () => {
  it('prinde amânarea spre o „echipă" inexistentă (RO)', () => {
    expect(deflecteazaConstructor('Am transmis echipei de dezvoltare spre reparare.')).toBe(true)
    expect(deflecteazaConstructor('Voi raporta echipei ca să rezolve.')).toBe(true)
    expect(deflecteazaConstructor('Va fi reparat de echipă în curând.')).toBe(true)
    expect(deflecteazaConstructor('Se va ocupa un dezvoltator de asta.')).toBe(true)
    expect(deflecteazaConstructor('Echipa tehnică va prelua problema.')).toBe(true)
  })

  it('prinde amânarea (EN)', () => {
    expect(deflecteazaConstructor('The development team will fix this soon.')).toBe(true)
    expect(deflecteazaConstructor('The developers will handle it.')).toBe(true)
    expect(deflecteazaConstructor("I'll forward this to the team.")).toBe(true)
    expect(deflecteazaConstructor('This will be fixed by the team.')).toBe(true)
  })

  it('NU blochează execuția reală (Kelion construiește el însuși)', () => {
    expect(deflecteazaConstructor('Am dat ordin la constructor și am deschis PR-ul #123.')).toBe(false)
    expect(deflecteazaConstructor('Repar acum: modific fișierul chat.ts, linia 200.')).toBe(false)
    expect(deflecteazaConstructor('Gata, am făcut merge; se publică în câteva minute.')).toBe(false)
    expect(deflecteazaConstructor('')).toBe(false)
  })

  it('alocarea e reală doar dacă o unealtă de construcție a fost chemată', () => {
    expect(aAlocatConstructie(['web_search', 'get_weather'])).toBe(false)
    expect(aAlocatConstructie(['build_software'])).toBe(true)
    expect(aAlocatConstructie(['repo_write', 'repo_open_pr'])).toBe(true)
    expect(aAlocatConstructie(['request_repair'])).toBe(true)
    expect(aAlocatConstructie([])).toBe(false)
  })
})
