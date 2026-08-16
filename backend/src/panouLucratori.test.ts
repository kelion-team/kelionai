import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LUCRATORI } from './services/lucratori.js'

// ── THE PANEL OF THREE ─────────────────────────────────────────────────────
//
// Adrian, Jul 31: "all 3 must be started, each independent, the brain takes
// the best result proposed by them, after analyzing the proposals".
//
// And, immediately after, the order that changes how he is served:
//   "you wrote hundreds of lines so escalation is automatic, and you still
//   put me on manual" · "to be clear, manual I don't do, stay on performant
//   free models" · "including at escalations".
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const lucratori = sursa('./services/lucratori.ts')
const panou = sursa('./services/panouLucratori.ts')
const chat = sursa('./routes/chat.ts')
const docker = sursa('../../Dockerfile')

describe('sunt patru, și chiar sunt independenți', () => {
  it('exact patru lucrători, cu nume distincte — inclusiv agentul OFICIAL Google', () => {
    // Adrian, 3 aug: „dă-mi... și suita oficială de la Google" → Gemini CLI
    // intră ca al 4-lea lucrător, nativ pe cheia Gemini a ownerului.
    expect(LUCRATORI.map((l) => l.nume).sort()).toEqual(['aider', 'cline', 'gemini-cli', 'openhands'])
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
    // Gemini CLI: -p = prompt non-interactiv, --yolo = uneltele rulează singure.
    expect(cmd('gemini-cli')).toContain('--yolo')
    expect(cmd('gemini-cli')).toContain('-p')
  })

  // Independence is literal: own clone, own branch, own process.
  it('fiecare lucrează în clona LUI, pe ramura LUI', () => {
    expect(lucratori).toMatch(/mkdtemp\(path\.join\(tmpdir\(\), `\$\{lucrator\.nume\}-`\)\)/)
    expect(lucratori).toMatch(/panou\/\$\{lucrator\.nume\}-/)
  })

  it('modelele vin din CONFIG-UL VIU, deduplicate — nu dintr-o listă scrisă de mână', () => {
    // LEGEA ANTI-HARDCODARE (16 aug): aici stătea `const MODELE = [...]` pe
    // generația 2.5, PENSIONATĂ — poarta R2 a prins-o abia când ownerul a
    // întrebat „nu ai scos hardcodul de ce?". Acum treptele se citesc din
    // config la fiecare rulare (profund + unic + rapid), în forma LiteLLM.
    expect(panou).not.toMatch(/const MODELE = \[/)
    expect(panou).toMatch(/\[config\.modelCreierProfund, modelUnicCod\(\), modelRapidCod\(\)\]/)
    expect(panou).toMatch(/new Set\(trepte\)/)
    expect(panou).toContain('`gemini/${m}`')
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
    // `testeTrec: null` = we never got to run them. It's not "they failed" and not
    // "they passed" — rule 1, in the type.
    expect(lucratori).toMatch(/testeTrec: boolean \| null/)
  })
})

describe('judecata e a creierului, dar pe fapte', () => {
  it('primește cifrele și verdictul testelor, nu doar diff-ul', () => {
    expect(panou).toMatch(/TESTELE PROIECTULUI: \$\{teste\}/)
    expect(panou).toMatch(/Fișiere atinse/)
  })

  // ÎNTĂRIT 14 aug (PR-urile goale #1082-1084: teste picate + o linie în
  // .gitignore → tot PR, „deși nu rezolvă sarcina" — bani arși + zgomot):
  // o propunere cu testele ROȘII nu mai e „ultima opțiune", e ZERO opțiune.
  it('o propunere care PICĂ testele nu ajunge nici la judecată, nici la PR', () => {
    expect(panou).toMatch(/p\.testeTrec !== false/)
    expect(panou).toMatch(/NU deschid PR pe produs picat/)
    expect(panou).toMatch(/PICĂ testele nu ajung la tine deloc/)
  })

  // The lesson of the day, put into the judging instruction: on Jul 31 a
  // 1049-line file ended up at 14 through a "fix" that sounded good.
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
    // The reported bug: `return` exited the function before escalation, so on
    // the owner's path — the only one with heavy tasks — it never ran.
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

  // Rule 1 applied to the Dockerfile: I haven't confirmed the command that
  // provides the headless OpenHands CLI, so I do NOT put it in. The panel
  // detects it missing and moves on with the other two — instead of
  // installing "something" and reporting that it works.
  it('OpenHands NU e instalat orbește, iar motivul e scris', () => {
    expect(docker).not.toMatch(/install.*openhands/i)
    expect(docker).toMatch(/OpenHands NU e aici, INTENȚIONAT/)
  })

  it('lipsa unui lucrător nu oprește panoul', () => {
    expect(panou).toMatch(/lipsa\.length \? ` \(lipsesc/)
    expect(panou).toMatch(/niciun lucrător instalat/)
  })
})
