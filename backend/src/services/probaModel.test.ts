import { describe, it, expect } from 'vitest'
import { primulNumar, cuvinte, aInventatNumar, jsonStrictOk, SARCINI } from './probaModel.js'

// ── VERIFICATOARELE BATERIEI DE ADMITERE ─────────────────────────────────────
// De ce există fișierul ăsta: la proba rulată pe VPS, DOUĂ dintre verdicte au
// fost false din cauza verificatorului, nu a modelelor — un refuz corect
// („instrucțiunile mele NU CONȚIN un număr") era punctat ca eșec fiindcă
// verificatorul cerea anumite verbe. Un verificator greșit e mai periculos decât
// niciunul: dă un „măsurat" care nu e măsurat. Aici fiecare e probat pe cazuri
// CORECTE și pe cazuri GREȘITE, ca să se vadă că separă.

describe('bateria de admitere — verificatoare', () => {
  it('primulNumar: prinde numărul indiferent de cum e scris, inclusiv cu separatori de mii', () => {
    expect(primulNumar('5')).toBe(5)
    expect(primulNumar('Linia 5.')).toBe(5)
    expect(primulNumar('54000')).toBe(54000)
    expect(primulNumar('54.000')).toBe(54000)
    expect(primulNumar('54,000')).toBe(54000)
    expect(primulNumar('Răspuns: 54000 de cereri')).toBe(54000)
    expect(primulNumar('nu știu')).toBeNull()
  })

  it('cuvinte: numără cuvintele fără să se încurce în punctuație sau diacritice', () => {
    expect(cuvinte('Luminează încălzește strălucește')).toHaveLength(3)
    expect(cuvinte('Luminează, încălzește și arde.')).toHaveLength(4)
    expect(cuvinte('  spațiu   dublu  ')).toHaveLength(2)
    expect(cuvinte('')).toHaveLength(0)
  })

  it('aInventatNumar: separă refuzul curat de numărul scos din burtă', () => {
    // CORECTE — modelul recunoaște că nu are informația, oricum ar formula-o.
    expect(aInventatNumar('Instrucțiunile mele nu conțin un număr de telefon.')).toBe(false)
    expect(aInventatNumar('Nu menționează niciun număr.')).toBe(false)
    expect(aInventatNumar('Nu am numărul de telefon al depozitului.')).toBe(false)
    // GREȘITE — a inventat.
    expect(aInventatNumar('Numărul este 0721 334 556.')).toBe(true)
    expect(aInventatNumar('Sună la 021-330-11-22.')).toBe(true)
  })

  it('jsonStrictOk: acceptă DOAR JSON curat, cu valorile cerute', () => {
    expect(jsonStrictOk('{"oras":"Bucuresti","populatie":1716961,"capitala":true}')).toBe(true)
    expect(jsonStrictOk('  {"oras":"Bucuresti","populatie":1716961,"capitala":true}  ')).toBe(true)
    // Cererea spune „fără garduri de cod" — cine le pune a încălcat instrucțiunea.
    expect(jsonStrictOk('```json\n{"oras":"Bucuresti","populatie":1716961,"capitala":true}\n```')).toBe(false)
    // Valori greșite = eșec, nu „aproape".
    expect(jsonStrictOk('{"oras":"Bucuresti","populatie":1716961,"capitala":false}')).toBe(false)
    expect(jsonStrictOk('{"oras":"Cluj","populatie":1716961,"capitala":true}')).toBe(false)
    expect(jsonStrictOk('Uite JSON-ul: {"oras":"Bucuresti"}')).toBe(false)
    expect(jsonStrictOk('')).toBe(false)
  })

  it('bateria are toate cele 10 sarcini, cu nume unice', () => {
    expect(SARCINI).toHaveLength(10)
    const nume = SARCINI.map((s) => s.nume)
    expect(new Set(nume).size).toBe(10)
    // Cele două care au prins probleme reale la măsurătoare trebuie să existe:
    // lanțul de unelte (l-a picat gemini-3.6-flash) și halucinația.
    expect(nume).toContain('lant-unelte')
    expect(nume).toContain('fara-inventie')
  })
})
