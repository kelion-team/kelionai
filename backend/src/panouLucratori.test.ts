import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LUCRATORI } from './services/lucratori.js'

// ── PANOUL DE TREI ──────────────────────────────────────────────────────────
//
// Adrian, 31 iul: „trebuie pornite toate 3, fiecare independent, creierul ia
// care e cel mai bun rezultat propus de ei, după ce analizează propunerile".
//
// Și, imediat după, ordinul care schimbă felul în care e servit el:
//   „ai scris sute de linii ca escaladarea să fie automată, și tu tot manual mă
//   pui" · „să fie clar, manual eu nu fac, rămâi pe modele performante free" ·
//   „inclusiv la escaladări".
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const lucratori = sursa('./services/lucratori.ts')
const panou = sursa('./services/panouLucratori.ts')
const chat = sursa('./routes/chat.ts')
const docker = sursa('../../Dockerfile')

describe('sunt trei, și chiar sunt independenți', () => {
  it('exact trei lucrători, cu nume distincte', () => {
    expect(LUCRATORI.map((l) => l.nume).sort()).toEqual(['aider', 'cline', 'openhands'])
  })

  it('fiecare are comandă proprie de lucru și de verificare', () => {
    for (const l of LUCRATORI) {
      const [cmd, args] = l.comanda('repară ceva anume', 'model/x:free')
      expect(cmd).toBeTruthy()
      expect(args.join(' ')).toContain('repară ceva anume')
      expect(l.verificare[0]).toBeTruthy()
    }
  })

  it('fiecare rulează headless, fără om la tastatură', () => {
    const cmd = (n: string): string => {
      const l = LUCRATORI.find((x) => x.nume === n)!
      return l.comanda('sarcina', 'm').join(' ')
    }
    expect(cmd('aider')).toContain('--yes-always')
    expect(cmd('cline')).toContain('--auto-approve')
    expect(cmd('openhands')).toContain('--headless')
  })

  // Independența e literală: clonă proprie, ramură proprie, proces propriu.
  it('fiecare lucrează în clona LUI, pe ramura LUI', () => {
    expect(lucratori).toMatch(/mkdtemp\(path\.join\(tmpdir\(\), `\$\{lucrator\.nume\}-`\)\)/)
    expect(lucratori).toMatch(/panou\/\$\{lucrator\.nume\}-/)
  })

  it('modele DIFERITE — altfel n-ar fi trei păreri, ar fi una de trei ori', () => {
    const m = /const MODELE = \[([\s\S]*?)\]/.exec(panou)?.[1] ?? ''
    const ids = m.match(/'([^']+)'/g) ?? []
    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toContain(':free')
  })

  it('pornesc simultan, iar unul care crapă nu-i oprește pe ceilalți', () => {
    expect(panou).toMatch(/Promise\.allSettled/)
  })
})

describe('nimic nu se ia pe încredere de la unelte', () => {
  it('cât s-a schimbat se măsoară cu git, nu din ce povestesc ele', () => {
    expect(lucratori).toMatch(/'diff', '--shortstat'/)
  })

  it('testele le rulăm NOI, după modificare', () => {
    expect(lucratori).toMatch(/'npx', \['vitest', 'run'\]/)
    expect(lucratori).toMatch(/const testeTrec = t\.cod === 0/)
  })

  it('un rezultat nemăsurat rămâne null, nu devine „trec"', () => {
    // `testeTrec: null` = n-am ajuns să le rulăm. Nu e „au picat" și nu e
    // „au trecut" — regula 1, în tip.
    expect(lucratori).toMatch(/testeTrec: boolean \| null/)
  })
})

describe('judecata e a creierului, dar pe fapte', () => {
  it('primește cifrele și verdictul testelor, nu doar diff-ul', () => {
    expect(panou).toMatch(/TESTELE PROIECTULUI: \$\{teste\}/)
    expect(panou).toMatch(/Fișiere atinse/)
  })

  it('i se spune să nu aleagă o propunere care pică testele', () => {
    expect(panou).toMatch(/PICĂ testele nu se alege decât dacă toate pică/)
  })

  // Lecția zilei, pusă în instrucțiunea de judecată: pe 31 iul un fișier de
  // 1049 de rânduri a ajuns la 14 printr-o „reparație" care suna bine.
  it('e avertizat despre propunerile care taie mult și explică puțin', () => {
    expect(panou).toMatch(/1049 de rânduri a ajuns la 14/)
  })

  it('dacă creierul nu dă verdict, se cade pe o regulă SCRISĂ și se spune', () => {
    expect(panou).toMatch(/n-a dat un verdict în format — am ales după regula scrisă/)
  })

  it('deschide UN PR, niciodată merge', () => {
    expect(panou).toMatch(/repoOpenPR\(/)
    expect(panou).not.toMatch(/repoMergePR|merge_pull/)
    expect(panou).toMatch(/Nu s-a făcut merge — te uiți tu/)
  })
})

describe('producția are prioritate', () => {
  it('nu pornește dacă VPS-ul e deja încărcat sau fără memorie', () => {
    expect(panou).toMatch(/res\.incarcarePct >= PRAG_INCARCARE_PCT/)
    expect(panou).toMatch(/res\.liberGb < 2/)
  })

  it('un singur panou odată, cu „nu" clar la al doilea', () => {
    expect(panou).toMatch(/rulează deja un panou — unul singur odată/)
  })
})

describe('ordinul „manual eu nu fac"', () => {
  it('selecția salvată a ownerului se ignoră — aplicația ține implicitul', () => {
    expect(chat).toMatch(/ignoring the saved selection/)
    expect(chat).toMatch(/I don't do manual/)
  })

  it('escaladarea urcă automat de pe alegerea lui, și e SPUSĂ în jurnal', () => {
    // Bug-ul reclamat: `return` ieșea din funcție înainte de escaladare, deci
    // pe drumul ownerului — singurul cu sarcini grele — nu rula niciodată.
    expect(chat).toMatch(/const cereSusul = difficulty >= ESCALATE_TOP_AT/)
    expect(chat).toMatch(/heavy task \(\$\{difficulty\}\) → climbing from/)
  })

  it('regula rămâne pentru owner, nu pentru toți userii', () => {
    expect(chat).toMatch(/does NOT apply to anyone else/)
  })
})

describe('instalarea e verificată, nu presupusă', () => {
  it('git, aider și cline intră în imagine', () => {
    expect(docker).toMatch(/curl git/)
    expect(docker).toContain('aider-chat')
    expect(docker).toContain('npm install -g cline')
  })

  // Regula 1 aplicată la Dockerfile: n-am confirmat comanda care dă CLI-ul
  // headless de OpenHands, deci NU o pun. Panoul îl detectează lipsă și merge
  // mai departe cu ceilalți doi — în loc să instaleze „ceva" și să raportez
  // că merge.
  it('OpenHands NU e instalat orbește, iar motivul e scris', () => {
    expect(docker).not.toMatch(/install.*openhands/i)
    expect(docker).toMatch(/OpenHands NU e aici, INTENȚIONAT/)
  })

  it('lipsa unui lucrător nu oprește panoul', () => {
    expect(panou).toMatch(/lipsa\.length \? ` \(lipsesc/)
    expect(panou).toMatch(/niciun lucrător instalat/)
  })
})
