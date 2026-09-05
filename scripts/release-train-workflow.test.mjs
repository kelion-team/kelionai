import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, lstat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('../backend/node_modules/typescript')

const STATIC_GATE_TESTS = [
  '.github/private-ai/constructor-status-proof.test.mjs',
  'scripts/verifica-butoane.test.mjs',
  'scripts/verifica-exporturi.test.mjs',
  'scripts/verifica-hardcodari.test.mjs',
  'scripts/verifica-migrari.test.mjs',
  'scripts/inventar-audit.test.mjs',
  'scripts/verifica-contract-deploy.test.mjs',
  'scripts/release-train-preflight.test.mjs',
  'scripts/release-train-workflow.test.mjs',
  'scripts/vps-recovery-workflow.test.mjs',
  'scripts/vps-pr-remediator.test.mjs',
  'scripts/vps-release-verifier.test.mjs',
  'ios/appstore-build.test.mjs',
  'deploy/constructor-model-control.test.mjs',
  'deploy/constructor-model-switch.test.mjs',
  'deploy/codex-worker-timeout.test.mjs',
  'deploy/lib/create-migration-proof.test.mjs',
  'deploy/lib/backup-schedule.test.mjs',
  'deploy/lib/restore-verified-backup.test.mjs',
  'deploy/lib/caddy-security.test.mjs',
  'deploy/lib/codex-boundary.test.mjs',
  'deploy/lib/constructor-publication.test.mjs',
  'deploy/lib/network-config.test.mjs',
  'deploy/lib/compose-security.test.mjs',
  'deploy/lib/release-rollback.test.mjs',
  'deploy/lib/security-policy.test.mjs',
]

function staticGateTests(source) {
  return [...source.matchAll(/[.A-Za-z0-9_/-]+[.]test[.]mjs/g)].map((match) => match[0])
}

const CRITICAL_APP_SUITES = [
  {
    id: 'release-proof',
    path: 'backend/src/services/releaseActivation.test.ts',
    tests: [
      'activează numai markerul release-ului exact',
      'refuză drept release activ orice combinație parțială sau contradictorie',
      'permite release-proof numai pentru readiness activ și commit complet valid',
    ],
  },
  {
    id: 'openai-status-redaction',
    path: 'backend/src/services/openaiHealth.test.ts',
    tests: [
      'classifies %s without exposing provider content',
      'turns transport failures into a safe code without exposing the thrown message',
      'fails closed when a successful billable probe cannot be durably metered',
    ],
  },
  {
    id: 'openai-durable-metering',
    path: 'backend/src/services/openaiMetering.test.ts',
    tests: [
      'fails health closed when a 2xx response omits core usage',
      'fails health closed on a bounded deadline when durable metering never settles',
      'rejects incoherent provider usage instead of persisting it: %j',
    ],
  },
  {
    id: 'provider-usage-db-boundary',
    path: 'backend/src/providerUsageDb.test.ts',
    tests: [
      'bounds the durable insert inside a server-limited transaction',
      'rolls back and releases the client when the bounded insert fails',
    ],
  },
  {
    id: 'database-session-deadlines',
    path: 'backend/src/dbPool.test.ts',
    tests: [
      'conexiunile se reciclează și au timeout-uri (nu trăiesc la infinit)',
    ],
  },
  {
    id: 'credit-status-truth',
    path: 'backend/src/creditAI.test.ts',
    tests: [
      'un health check verde sau o cotă epuizată decid numai când soldul real nu există',
      'nu prezintă %s drept lipsă de credit',
    ],
  },
  {
    id: 'openai-admin-status',
    path: 'backend/src/openaiAdminStatus.test.ts',
    tests: [
      'brain-credit reports the health probe instead of key presence',
      'a non-serving provider never renders a success check and shows the safe class',
    ],
  },
  {
    id: 'voice-usage-status-tools',
    path: 'backend/src/vocalLive.test.ts',
    tests: [
      'respinge usage-ul Realtime fără toate contoarele core valide',
      'arată un response.failed rate-limit cu un cod sigur',
      'nu execută unelte când statusul response.done lipsește',
      'nu execută unelte înainte de response.completed și le aruncă pe incomplete',
      'reduce erorile terminale ale providerului la coduri publice fără mesajul lui liber',
      'semnalează barge-in și acceptă numai tool calls structurate valid',
      'rearmează 60s de la fiecare ACK și anulează tickul vechi',
    ],
  },
  {
    id: 'voice-billing-transport-gate',
    path: 'backend/src/vocalLiveBillingSafety.test.ts',
    tests: [
      'ține audio, anunț, ancoră și răspunsul uneltei în coadă până la succes durabil',
      'închide terminal la debit blocat și nu varsă coada după timeout',
      'ține intrarea pre-ready în poarta inițială și închide fără flush dacă rezervarea eșuează',
      'anulează și termină dacă ACK-ul post-send rămâne blocat',
      'nu confirmă debitul dacă scrierea provider-bound eșuează asincron',
      'nu confirmă debitul dacă scrierea provider-bound depășește deadline-ul',
      'nu pornește debitul nou înainte ca usage-ul turei anulate să fie durabil',
      'închide fără debit nou dacă tura activă nu livrează usage după cancel',
      'reîncearcă false/reject cu aceeași referință și o șterge numai după succes',
      'păstrează referința după toate eșecurile și nu propagă reject',
      'serializează apelurile concurente într-o singură scriere',
      'rulează la startup și periodic cu deadline și timer unref',
    ],
  },
  {
    id: 'voice-billing-restart-reconciliation',
    path: 'backend/src/voiceBillingReconciliationDb.test.ts',
    tests: [
      'bounds the atomic debit transaction at the PostgreSQL boundary',
      'bounds both refund phases and the reconciliation selector at the PostgreSQL boundary',
      'refunds a debit committed after the first close-time lookup and remains idempotent after restart',
      'resumes a refund_pending intent left by a crashed worker without double crediting',
      'binds consume and acknowledgement replays to one handoff token',
      'enforces one operation for each session tick at the database boundary',
      'ignores legacy voice references and never adopts them into the v1 outbox',
    ],
  },
  {
    id: 'frontend-retry',
    path: 'frontend/src/vocalLiveAvailability.test.ts',
    tests: [
      'nu permite reluare automată pentru cheia invalidă, cotă sau accesul la model',
      'oprește reluările tranzitorii după seria finită 1/2/4/8/15 secunde',
    ],
  },
  {
    id: 'frontend-abort',
    path: 'frontend/src/vocalLiveBehavior.test.ts',
    tests: [
      'ține aceeași limită de retry după ready și invalidează pornirile stale înainte de await',
      'nu pornește nicio resursă pentru o tentativă deja anulată',
      'deschiderea socketului curăță timeoutul; abortul ignoră un open întârziat',
    ],
  },
]

function testTitles(source, path) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const titles = new Set()
  const rootCall = (expression) => {
    if (ts.isIdentifier(expression)) return expression.text
    if (ts.isPropertyAccessExpression(expression)) return rootCall(expression.expression)
    if (ts.isCallExpression(expression)) return rootCall(expression.expression)
    return ''
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && ['it', 'test'].includes(rootCall(node.expression))) {
      const title = node.arguments[0]
      if (title && ts.isStringLiteralLike(title)) titles.add(title.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return titles
}

function rootCallName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return rootCallName(expression.expression)
  if (ts.isCallExpression(expression)) return rootCallName(expression.expression)
  return ''
}

function criticalDeclarationIsSafe(call, file) {
  const callee = call.expression.getText(file)
  if (/\.(?:skip|only|todo|fails|skipIf|runIf)\b/.test(callee)) return false
  if (call.arguments.length < 2 || call.arguments.length > 3) return false
  const callback = call.arguments[1]
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
  if (call.arguments[2] && !ts.isNumericLiteral(call.arguments[2])) return false
  for (let ancestor = call.parent; ancestor && !ts.isSourceFile(ancestor); ancestor = ancestor.parent) {
    if (ts.isIfStatement(ancestor)
      || ts.isConditionalExpression(ancestor)
      || ts.isForStatement(ancestor)
      || ts.isForInStatement(ancestor)
      || ts.isForOfStatement(ancestor)
      || ts.isWhileStatement(ancestor)
      || ts.isDoStatement(ancestor)
      || ts.isSwitchStatement(ancestor)
      || ts.isTryStatement(ancestor)
      || ts.isFunctionDeclaration(ancestor)
      || ts.isMethodDeclaration(ancestor)
      || ts.isBinaryExpression(ancestor)) return false
    if (ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor)) {
      const parentCall = ancestor.parent
      if (!ts.isCallExpression(parentCall)
        || !parentCall.arguments.includes(ancestor)
        || !['describe', 'suite'].includes(rootCallName(parentCall.expression))) return false
    }
  }
  return true
}

function criticalDeclarations(source, path) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const declarations = new Map()
  const visit = (node) => {
    if (ts.isCallExpression(node) && ['it', 'test'].includes(rootCallName(node.expression))) {
      const title = node.arguments[0]
      if (title && ts.isStringLiteralLike(title)) {
        const current = declarations.get(title.text) ?? []
        current.push(criticalDeclarationIsSafe(node, file))
        declarations.set(title.text, current)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return declarations
}

function titlePattern(title) {
  const escaped = title.split(/(%[sdifjoO])/).map((part) => {
    if (/^%[sdifjoO]$/.test(part)) return '.+'
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return new RegExp('^' + escaped + '$')
}

function runSealedSuites(packageName, suites) {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
  const packageRoot = resolve(repositoryRoot, packageName)
  const vitest = resolve(packageRoot, 'node_modules/vitest/vitest.mjs')
  const paths = suites.map((suite) => suite.path.slice(packageName.length + 1))
  const run = spawnSync(process.execPath, [vitest, 'run', ...paths, '--reporter=json', '--configLoader=runner'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(run.status, 0, packageName + ' sealed suites failed: ' + String(run.stderr).slice(-2000))
  const report = JSON.parse(run.stdout)
  assert.equal(report.success, true, packageName + ' sealed suites did not succeed')
  assert.equal(report.numPendingTests, 0, packageName + ' sealed suites contain pending/skipped tests')
  assert.equal(report.numTodoTests, 0, packageName + ' sealed suites contain todo tests')
  const byPath = new Map(report.testResults.map((result) => [
    packageName + '/' + relative(packageRoot, result.name),
    result.assertionResults,
  ]))
  for (const suite of suites) {
    const assertions = byPath.get(suite.path) ?? []
    for (const expected of suite.tests) {
      const matching = assertions.filter((assertion) => titlePattern(expected).test(assertion.title))
      assert.ok(matching.length > 0, suite.path + ' nu a executat testul sigilat: ' + expected)
      assert.ok(matching.every((assertion) => assertion.status === 'passed'), suite.path + ' nu a trecut testul sigilat: ' + expected)
    }
  }
}

test('PR verification checks the actual pull-request head and runs release-train tests', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.match(workflow, /scripts\/release-train-preflight\.test\.mjs/)
  assert.match(workflow, /scripts\/release-train-workflow\.test\.mjs/)
})

test('PR CI sigilează proba root a publication lock fără a rupe gate-ul non-root', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  const stepStart = workflow.indexOf('      - name: Teste pentru porțile statice')
  const stepEnd = workflow.indexOf('\n      - name:', stepStart + 1)
  assert.ok(stepStart >= 0 && stepEnd > stepStart)
  const staticStep = workflow.slice(stepStart, stepEnd)
  assert.match(
    staticStep,
    /\n\s+env:\n\s+KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE: '1'\n\s+run:/,
  )

  const probe = await readFile(new URL('../deploy/constructor-model-control.test.mjs', import.meta.url), 'utf8')
  assert.match(probe, /process\.env\.KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE/)
  assert.match(probe, /spawnSync\('\/usr\/bin\/sudo',[\s\S]*'--non-interactive'[\s\S]*'--user=root'[\s\S]*process\.execPath/)
  assert.match(probe, /KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE=0/)
  assert.match(probe, /KELION_ROOT_PUBLICATION_BARRIER_PROBE_CHILD=1/)
  assert.match(probe, /assert\.equal\(uid, 0, 'publication barrier subprocess did not cross the sudo root boundary'\)/)

  const controller = await readFile(new URL('../deploy/constructor-model-control.mjs', import.meta.url), 'utf8')
  assert.match(controller, /descriptor\.uid !== 0[\s\S]*descriptor\.gid !== 0[\s\S]*0o600/)
})

test('every static gate invokes both release-train regression suites', async () => {
  for (const path of ['../deploy/gates/run-gates.sh', '../deploy/porti-pr.sh']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /scripts\/release-train-preflight\.test\.mjs/, path)
    assert.match(source, /scripts\/release-train-workflow\.test\.mjs/, path)
  }
})

test('canonical CI and both local mirrors execute the exact same static test manifest', async () => {
  for (const path of [
    '../.github/workflows/pr-verify.yml',
    '../deploy/gates/run-gates.sh',
    '../deploy/porti-pr.sh',
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.deepEqual(staticGateTests(source), STATIC_GATE_TESTS, path)
  }
})

test('critical App regressions remain present, executable and unskipped', async () => {
  const manifestUrl = new URL('../config/regression-seal-v1.json', import.meta.url)
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.deepEqual(Object.keys(manifest).sort(), ['contract', 'schema', 'suites'])
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.contract, 'kelion-app-critical-regressions')
  assert.deepEqual(manifest.suites, CRITICAL_APP_SUITES)

  for (const suite of manifest.suites) {
    assert.match(suite.id, /^[a-z][a-z0-9-]{2,63}$/)
    assert.match(suite.path, /^(?:backend|frontend)\/src\/[A-Za-z0-9_./-]+\.test\.tsx?$/)
    assert.ok(Array.isArray(suite.tests) && suite.tests.length > 0, suite.id)
    assert.equal(new Set(suite.tests).size, suite.tests.length, suite.id)

    const url = new URL(`../${suite.path}`, import.meta.url)
    const stat = await lstat(url)
    assert.equal(stat.isFile(), true, suite.path)
    assert.equal(stat.isSymbolicLink(), false, suite.path)
    const source = await readFile(url, 'utf8')
    assert.doesNotMatch(
      source,
      /\b(?:describe|it|test)\s*\.\s*(?:skip|only|todo|fails|skipIf|runIf)\b|\.\s*(?:skip|only|todo|fails)\s*\(/,
      `${suite.path} nu poate dezactiva regresiile sigilate`,
    )
    const declared = testTitles(source, suite.path)
    const declarations = criticalDeclarations(source, suite.path)
    for (const title of suite.tests) {
      assert.ok(declared.has(title), `${suite.path} nu mai execută testul: ${title}`)
      assert.ok(declarations.get(title)?.every(Boolean), `${suite.path} poate dezactiva testul sigilat: ${title}`)
    }
  }
})

test('critical App regressions execute and pass at runtime', () => {
  for (const packageName of ['backend', 'frontend']) {
    runSealedSuites(packageName, CRITICAL_APP_SUITES.filter((suite) => suite.path.startsWith(packageName + '/')))
  }
})

test('regression seal rejects expected failures, disabled options and unreachable declarations', () => {
  const hidden = [
    "it.fails('sealed', () => undefined)",
    "it('sealed', { skip: true }, () => undefined)",
    "const options = { fails: true }; it('sealed', options, () => { throw new Error('expected') })",
    "const options = { fails: true }; it('sealed', { ...options }, () => { throw new Error('expected') })",
    "const brokenCallback = () => { throw new Error('expected') }; it('sealed', false ? brokenCallback : () => undefined)",
    "const callback = () => undefined; it('sealed', callback)",
    "if (false) { it('sealed', () => undefined) }",
    "false && it('sealed', () => undefined)",
    "function hiddenTest() { it('sealed', () => undefined) }",
    "beforeEach(() => { it('sealed', () => undefined) })",
  ]
  for (const source of hidden) {
    assert.equal(criticalDeclarations(source, 'synthetic.test.ts').get('sealed')?.every(Boolean), false, source)
  }
  for (const source of [
    "it('sealed', () => undefined)",
    "it('sealed', () => undefined, 30_000)",
    "describe('group', () => { it('sealed', () => undefined) })",
  ]) {
    assert.equal(criticalDeclarations(source, 'synthetic.test.ts').get('sealed')?.every(Boolean), true, source)
  }
})

test('required PR chain runs both App suites before container isolation', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  const verifyStart = workflow.indexOf('\n  verify:')
  const isolationStart = workflow.indexOf('\n  container-isolation:')
  assert.ok(verifyStart > 0 && isolationStart > verifyStart)
  const verify = workflow.slice(verifyStart, isolationStart)
  const isolation = workflow.slice(isolationStart)

  assert.match(verify, /needs:\s*release-train-preflight/)
  assert.match(verify, /cd backend[\s\S]*npm run typecheck[\s\S]*npm test[\s\S]*oxlint --deny no-unused-vars/)
  assert.match(verify, /cd frontend[\s\S]*npm run build[\s\S]*npm run lint[\s\S]*npm test/)
  assert.match(verify, /scripts\/release-train-workflow\.test\.mjs/)

  assert.match(isolation, /^\n  container-isolation:\n\s+needs:\s*verify/m)
  assert.match(isolation, /docker build --tag kelion-ci-app:\$\{GITHUB_SHA\} \./)
  assert.match(isolation, /docker compose[\s\S]*up[\s\S]*--wait/)
  assert.match(isolation, /\.release\.candidate == true and \.release\.sideEffectsActive == false/)
  assert.match(isolation, /api\/version[\s\S]*GITHUB_SHA:0:7/)
})
