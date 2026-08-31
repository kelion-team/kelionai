#!/usr/bin/env node
// Poartă anti-regresie pentru GitHub Actions.
//
// Un workflow_dispatch este o interfață publică pentru orice colaborator care
// îl poate porni. Parolele, cheile și comenzile libere nu au voie să treacă
// prin acel formular: rămân în event payload/run history, iar interpolarea
// directă a unui input într-un `run:` devine injecție de shell.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RADACINA = fileURLToPath(new URL('..', import.meta.url))
const WORKFLOW_DIR = join(RADACINA, '.github', 'workflows')

const NUME_INTERZIS = /(?:^|[-_])(?:cmd|command|commands|comanda|comenzi|exec|script|shell|bash|powershell|args|payload|pass|passwd|password|parola|secret|token|api[-_]?key|key(?:b64)?|cheie(?:b64)?|credential|credentials|private|ssh|cvc|cvv|card|cert(?:b64)?|certificate|p12)(?:[-_]|$)/i
const DESCRIERE_INTERZISA = /(?:comand[ăa]|command|shell|bash|powershell|parol[ăa]|password|secret|token|cheie\s+privat[ăa]|private\s+key|cvc|cvv)/iu
const EXPRESIE_IN_RUN = /\$\{\{[^}\n]+\}\}/
const ACTIUNE_SHA = /^[^@\s]+@[0-9a-f]{40}$/i
const CONTAINER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i
const JOBURI_CU_GARDA_MASTER = new Map([
  ['constructor-desktop-release.yml', ['package-windows']],
  ['private-ai-constructor-proof.yml', ['prove-local-constructor']],
  ['vps-auto-merge-watchdog.yml', ['remediate-and-track']],
  ['vps-codex-login.yml', ['preflight']],
  ['vps-recovery.yml', ['classify', 'recover']],
])

function indentare(linie) {
  const spatii = linie.match(/^[ \t]*/)?.[0] ?? ''
  return spatii.replace(/\t/g, '  ').length
}

function faraComentariu(linie) {
  return linie.trimStart().startsWith('#') ? '' : linie
}

function blocJob(text, nume) {
  const inceput = text.indexOf(`\n  ${nume}:\n`)
  if (inceput < 0) return ''
  const urmatorul = text.slice(inceput + 1).search(/\n  [A-Za-z0-9_-]+:\n/)
  return urmatorul < 0
    ? text.slice(inceput)
    : text.slice(inceput, inceput + 1 + urmatorul)
}

function indexLinie(text, fragment) {
  const index = text.indexOf(fragment)
  return index < 0 ? 0 : text.slice(0, index).split('\n').length - 1
}

export function verificaWorkflow(text, numeFisier = '<memorie>') {
  const linii = text.replace(/\r\n/g, '\n').split('\n')
  const abateri = []
  const caleNormala = numeFisier.replace(/\\/g, '/')
  let dispatchIndent = null
  let inputsIndent = null
  let inputIndent = null
  let inputCurent = null

  const abatere = (linie, regula, detaliu) => {
    abateri.push(`${numeFisier}:${linie + 1} [${regula}] ${detaliu}`)
  }

  const permisiuni = linii.findIndex((linie) => /^permissions\s*:/.test(linie))
  if (permisiuni < 0) {
    abatere(0, 'permisiuni-implicite', 'lipsește `permissions`; tokenul automat trebuie restrâns explicit.')
  } else if (/^permissions\s*:\s*(?:read-all|write-all)\s*$/.test(linii[permisiuni])) {
    abatere(permisiuni, 'permisiuni-largi', '`read-all`/`write-all` nu este privilegiu minim.')
  }

  linii.forEach((linie, index) => {
    const curata = faraComentariu(linie)
    const write = curata.match(/^\s{2}([A-Za-z-]+)\s*:\s*write\s*$/)?.[1]
    const writeAprobat = (caleNormala.endsWith('/sentinel.yml') && write === 'issues')
      || (caleNormala.endsWith('/build-images.yml') && ['packages', 'id-token'].includes(write))
      // Watchdog-ul primește capabilitățile numai în jobul dependent de guardul
      // master fail-closed. Guardul rulează fără drepturi de scriere și leagă
      // checkout-ul pin-uit de repo/ref/GITHUB_SHA înainte de codul remediatorului.
      || (caleNormala.endsWith('/vps-auto-merge-watchdog.yml')
        && ['actions', 'contents', 'issues', 'pull-requests'].includes(write))
      // Verifierul independent nu modifică repo-ul sau producția: scrie numai
      // verdictul GitHub verificabil și incidentul fail-closed.
      || (caleNormala.endsWith('/vps-release-verifier.yml')
        && ['checks', 'issues'].includes(write))
    if (write && !writeAprobat) {
      abatere(index, 'token-write', `permisiunea \`${write}: write\` nu este aprobată explicit pentru acest workflow.`)
    }

    if (/\bpull_request_target\s*:/.test(curata)) {
      abatere(index, 'trigger-privilegiat', '`pull_request_target` este interzis pentru cod din PR-uri.')
    }
    if (/(?:curl|wget)[^\n|]*\|\s*(?:ba)?sh\b/i.test(curata)) {
      abatere(index, 'download-executat', 'un răspuns de rețea este executat direct în shell.')
    }
    if (/StrictHostKeyChecking\s*=\s*no|UserKnownHostsFile\s*=\s*\/dev\/null/i.test(curata)) {
      abatere(index, 'ssh-neverificat', 'verificarea cheii SSH de gazdă este dezactivată.')
    }
    if (/\bset\s+-[^\n]*x|\bcat\s+[^\n]*GITHUB_EVENT_PATH|\bdocker\s+logs\b/.test(curata)) {
      abatere(index, 'jurnal-sensibil', 'comanda poate publica secrete sau date de producție în jurnalul Actions.')
    }

    const uses = curata.match(/^\s*-\s*uses\s*:\s*([^\s#]+)/)?.[1]
    if (uses && !uses.startsWith('./')) {
      const fixata = uses.startsWith('docker://') ? CONTAINER_DIGEST.test(uses) : ACTIUNE_SHA.test(uses)
      if (!fixata) abatere(index, 'acțiune-mobilă', `\`${uses}\` trebuie fixată la SHA/digest integral.`)
    }
  })

  if (/uses\s*:\s*actions\/checkout@[0-9a-f]{40}/i.test(text) && !/persist-credentials\s*:\s*false/i.test(text)) {
    abatere(0, 'checkout-token', '`actions/checkout` trebuie să aibă `persist-credentials: false`.')
  }

  const numeScurt = caleNormala.split('/').at(-1)
  const joburiProtejate = JOBURI_CU_GARDA_MASTER.get(numeScurt)
  if (joburiProtejate) {
    const guard = blocJob(text, 'guard-source')
    const guardValid = guard
      && /\n    if: always\(\)\n/.test(guard)
      && /actions\/checkout@[0-9a-f]{40}/i.test(guard)
      && /persist-credentials\s*:\s*false/.test(guard)
      && guard.includes('[ "$GITHUB_REPOSITORY" = kelion-team/kelionai ]') // hardcod-permis: ancora verifică repository-ul canonic privilegiat
      && guard.includes('[ "$GITHUB_REF" = refs/heads/master ]')
      && guard.includes('[ "$GITHUB_REF_NAME" = master ]')
      && guard.includes('[ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]')
    if (!guardValid) {
      abatere(indexLinie(text, '\n  guard-source:\n'), 'guard-source',
        'workflow-ul privilegiat cere guard always-run cu checkout pin-uit și repo/ref/ref_name/HEAD legate exact de master.')
    }
    for (const job of joburiProtejate) {
      const bloc = blocJob(text, job)
      const depindeDeGarda = /\n    needs: guard-source\n/.test(bloc)
        || /\n    needs:\s*\[[^\]\n]*\bguard-source\b[^\]\n]*\]\n/.test(bloc)
      if (!depindeDeGarda) {
        abatere(indexLinie(text, `\n  ${job}:\n`), 'guard-necesar',
          `jobul \`${job}\` trebuie să depindă de \`guard-source\` înainte să primească drepturi sau secrete.`)
      }
    }
  }

  if (numeScurt === 'vps-auto-merge-chore-prs.yml') {
    const guard = blocJob(text, 'guard-source')
    const policy = blocJob(text, 'merge-policy')
    const guardValid = guard
      && /\n    if: always\(\)\n/.test(guard)
      && /actions\/checkout@[0-9a-f]{40}/i.test(guard)
      && /persist-credentials\s*:\s*false/.test(guard)
      && guard.includes('[ "$GITHUB_REPOSITORY" = kelion-team/kelionai ]') // hardcod-permis: ancora verifică repository-ul canonic privilegiat
      && guard.includes('[ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]')
      && policy.includes('needs: guard-source')
    if (!guardValid) {
      abatere(indexLinie(text, '\n  guard-source:\n'), 'guard-source',
        'merge-policy cere guard always-run cu checkout pin-uit și HEAD legat exact de eveniment.')
    }
    const dispatchLegat = [guard, policy].every((bloc) =>
      bloc.includes('.head.repo.full_name')
      && bloc.includes('.head.sha')
      && bloc.includes('[ "$GITHUB_REF" = "refs/heads/$head_ref" ]')
      && bloc.includes('[ "$GITHUB_REF_NAME" = "$head_ref" ]'))
    if (!dispatchLegat) {
      abatere(indexLinie(text, 'workflow_dispatch:'), 'dispatch-pr-binding',
        'dispatch-ul merge-policy trebuie să lege repo-ul, SHA-ul și ref/ref_name de head-ul aceluiași PR.')
    }
  }

  linii.forEach((linie, index) => {
    const curata = faraComentariu(linie)
    const textScurt = curata.trim()
    const indent = indentare(curata)

    if (/toJSON\s*\(\s*secrets\s*\)/i.test(curata)) {
      abatere(index, 'secrete-bulk', 'serializarea integrală a secretelor este interzisă; folosește un allowlist explicit.')
    }

    if (textScurt && dispatchIndent !== null && indent <= dispatchIndent) {
      dispatchIndent = null
      inputsIndent = null
      inputIndent = null
      inputCurent = null
    }

    if (/^workflow_dispatch\s*:\s*(?:\{\s*\})?\s*$/.test(textScurt)) {
      dispatchIndent = indent
      inputsIndent = null
      inputIndent = null
      inputCurent = null
      return
    }

    if (dispatchIndent !== null && inputsIndent === null && /^inputs\s*:\s*$/.test(textScurt) && indent > dispatchIndent) {
      inputsIndent = indent
      return
    }

    if (inputsIndent !== null) {
      if (textScurt && indent <= inputsIndent) {
        inputsIndent = null
        inputIndent = null
        inputCurent = null
      } else if (textScurt) {
        const cheie = textScurt.match(/^([A-Za-z0-9_-]+)\s*:\s*(?:#.*)?$/)?.[1]
        if (cheie && inputIndent === null) inputIndent = indent
        if (cheie && indent === inputIndent) {
          inputCurent = cheie
          if (NUME_INTERZIS.test(cheie)) {
            abatere(index, 'input-sensibil', `inputul \`${cheie}\` poate transporta comandă, parolă, cheie sau alt secret.`)
          }
        } else if (inputCurent && /^description\s*:/.test(textScurt)) {
          const descriere = textScurt.replace(/^description\s*:\s*/, '').replace(/^['"]|['"]$/g, '')
          if (DESCRIERE_INTERZISA.test(descriere)) {
            abatere(index, 'descriere-sensibilă', `inputul \`${inputCurent}\` descrie date sensibile sau o comandă liberă.`)
          }
        }
      }
    }
  })

  // Chiar și un input cu nume inofensiv devine injecție dacă expresia GitHub
  // este pusă direct în shell. Maparea prin `env:` și citirea variabilei este
  // singura formă acceptată pentru inputurile nesensibile (de ex. boolean).
  for (let i = 0; i < linii.length; i += 1) {
    const linie = faraComentariu(linii[i])
    const mRun = linie.match(/^(\s*)(?:-\s+)?run\s*:\s*(.*)$/)
    if (!mRun) continue
    const runIndent = indentare(linie)
    const valoare = mRun[2]
    if (EXPRESIE_IN_RUN.test(valoare)) {
      abatere(i, 'injecție-run', 'o expresie GitHub este interpolată direct în `run:`; mapeaz-o prin `env:`.')
    }
    if (!/^[>|][-+]?\s*(?:#.*)?$/.test(valoare)) continue
    for (let j = i + 1; j < linii.length; j += 1) {
      const copil = faraComentariu(linii[j])
      if (copil.trim() && indentare(copil) <= runIndent) break
      if (EXPRESIE_IN_RUN.test(copil)) {
        abatere(j, 'injecție-run', 'o expresie GitHub este interpolată direct în blocul shell; mapeaz-o prin `env:`.')
      }
    }
  }

  return abateri
}

function autoTest() {
  const sigur = `
on:
  workflow_dispatch:
    inputs:
      restart:
        description: Repornește aplicația?
        type: boolean
permissions: {}
jobs:
  test:
    steps:
      - env:
          RESTART: \${{ inputs.restart }}
        run: echo "$RESTART"
`
  const periculos = `
on:
  pull_request_target:
  workflow_dispatch:
    inputs:
      cmd:
        description: Comanda bash de rulat
      keyb64:
        description: cheie privată
      target:
        description: destinație
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - run: |
          echo \${{ inputs.target }}
      - env:
          TOT: \${{ __SECRETE_BULK__ }}
        run: echo test
`.replace('__SECRETE_BULK__', ['toJSON', '(secrets)'].join(''))
  const gardaIncompleta = `
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  guard-source:
    if: always()
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - run: |
          [ "$GITHUB_REPOSITORY" = kelion-team/kelionai ] # hardcod-permis: fixture pentru repository-ul canonic privilegiat
          [ "$GITHUB_REF" = refs/heads/master ]
  preflight:
    needs: guard-source
    steps:
      - run: echo guardul-nu-leaga-ref-name-sau-head
`
  const jobSareGarda = `
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  guard-source:
    if: always()
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - run: |
          [ "$GITHUB_REPOSITORY" = kelion-team/kelionai ] # hardcod-permis: fixture pentru repository-ul canonic privilegiat
          [ "$GITHUB_REF" = refs/heads/master ]
          [ "$GITHUB_REF_NAME" = master ]
          [ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]
  preflight:
    steps:
      - run: echo never-trust-a-skipped-ref
`
  const dispatchPrNelegat = `
on:
  workflow_dispatch:
    inputs:
      pr_number:
        type: string
permissions:
  contents: read
  pull-requests: read
jobs:
  guard-source:
    if: always()
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - run: |
          [ "$GITHUB_REPOSITORY" = kelion-team/kelionai ] # hardcod-permis: fixture pentru repository-ul canonic privilegiat
          [ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]
  merge-policy:
    needs: guard-source
    steps:
      - run: echo pr-nelegat
`
  const aSigur = verificaWorkflow(sigur, 'sigur.yml')
  const aPericulos = verificaWorkflow(periculos, 'periculos.yml')
  const aGardaIncompleta = verificaWorkflow(gardaIncompleta, '.github/workflows/vps-codex-login.yml')
  const aJobSareGarda = verificaWorkflow(jobSareGarda, '.github/workflows/vps-codex-login.yml')
  const aDispatchPrNelegat = verificaWorkflow(dispatchPrNelegat, '.github/workflows/vps-auto-merge-chore-prs.yml')
  const reguliPrinse = [
    'inputul `cmd`',
    'inputul `keyb64`',
    '[descriere-sensibilă]',
    '[injecție-run]',
    '[secrete-bulk]',
  ].every((fragment) => aPericulos.join('\n').includes(fragment))
    && aGardaIncompleta.some((abatere) => abatere.includes('[guard-source]'))
    && !aGardaIncompleta.some((abatere) => abatere.includes('[guard-necesar]'))
    && aJobSareGarda.some((abatere) => abatere.includes('[guard-necesar]'))
    && !aJobSareGarda.some((abatere) => abatere.includes('[guard-source]'))
    && aDispatchPrNelegat.some((abatere) => abatere.includes('[dispatch-pr-binding]'))
  if (aSigur.length !== 0 || !reguliPrinse) {
    console.error('Autotest poartă workflow-uri: PICĂ')
    for (const a of [
      ...aSigur,
      ...aPericulos,
      ...aGardaIncompleta,
      ...aJobSareGarda,
      ...aDispatchPrNelegat,
    ]) console.error('  ' + a)
    process.exit(1)
  }
  console.log('Autotest poartă workflow-uri: TRECE')
}

function main() {
  if (process.argv.includes('--self-test')) return autoTest()
  const abateri = []
  for (const nume of readdirSync(WORKFLOW_DIR).sort()) {
    if (!/\.ya?ml$/i.test(nume)) continue
    const cale = join(WORKFLOW_DIR, nume)
    abateri.push(...verificaWorkflow(readFileSync(cale, 'utf8'), relative(RADACINA, cale)))
  }
  if (abateri.length) {
    console.error(`Workflow-uri nesigure (${abateri.length}):`)
    for (const a of abateri) console.error('  ' + a)
    process.exit(1)
  }
  console.log('Workflow-uri sigure: surse privilegiate legate exact, fără inputuri sensibile/comenzi libere, interpolări shell sau secrete bulk.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
