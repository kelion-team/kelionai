import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('workerul folosește direct OpenCode 1.18.25 cu Qwen local și acces complet prin sudo', () => {
  const worker = read('deploy/codex-worker.mjs')
  const service = read('deploy/systemd/kelion-codex-worker.service')
  const sudoers = read('deploy/sudoers/kelion-codex-full-access')
  const execution = worker.slice(worker.indexOf('const stopExecLease'), worker.indexOf('const stopGateLease'))

  assert.match(worker, /const OPENCODE_VERSION = '1\.18\.25'/)
  assert.match(worker, /const OPENCODE_MODEL = process\.env\.OPENCODE_MODEL \?\? 'llama\.cpp\/qwen3\.6-35b-a3b-local'/)
  assert.match(worker, /const OPENCODE_BASE_URL = process\.env\.OPENCODE_BASE_URL \?\? 'http:\/\/127\.0\.0\.1:24080\/v1'/)
  assert.match(worker, /enabled_providers[\s\S]{0,180}'llama\.cpp'/)
  assert.match(worker, /local\.options\?\.baseURL !== OPENCODE_BASE_URL/)
  assert.match(worker, /'OPENCODE_DISABLE_MODELS_FETCH=true'/)
  assert.match(worker, /return \[\s*'--pure',\s*'run',\s*'--dir', worktree,\s*'--model', OPENCODE_MODEL,\s*'--auto',\s*'--file', order/)
  assert.match(worker, /return \[\s*'-n', '-u', 'root', '--',\s*'\/usr\/bin\/env', '-i',[\s\S]*OPENCODE_BIN/)
  assert.match(execution, /runLogged\(\s*REQUIRED_LAYOUT\.sudo,\s*rootOpenCodeArgs\(openCodeExecArgs\(jobDir, orderPath\), jobDir\),\s*jobStateDir,\s*logPath,\s*openCodeParentEnv\(\),\s*null,[\s\S]*stopExecLease\.signal,\s*true/)
  assert.match(execution, /restoreJobOwnership\(jobStateDir, ownershipScope\)/)
  assert.match(worker, /'GIT_CONFIG_KEY_0=safe\.directory',[\s\S]*`GIT_CONFIG_VALUE_0=\$\{worktree\}`/)
  assert.match(worker, /repairSupervisorOwnership\(\)[\s\S]*const podmanPath/)
  assert.match(worker, /\[jobs, repoGit\],[\s\S]*supervisorOwner\(\)/)
  assert.doesNotMatch(worker, /takeRootExecutorOwnership|chownAsRoot\([^)]*['"]0:0['"]/) 
  assert.match(worker, /rootGitStatus\(smokeDir, smokeStateDir\)[\s\S]*OPENCODE_EXECUTOR_GIT_VERIFIED status=porcelain-v1/)
  assert.match(worker, /detached: true[\s\S]*signalGroup\('SIGTERM'\)[\s\S]*signalGroup\('SIGKILL'\)/)
  assert.doesNotMatch(execution, /CODEX_BIN|codexExecArgs|codex-real|wrapper/)
  assert.match(service, /^Environment=OPENCODE_BIN=\/opt\/private-ai\/bin\/opencode$/m)
  assert.match(service, /^Requires=private-ai-llm\.service kelion-constructor-sync\.service$/m)
  assert.match(service, /^NoNewPrivileges=false$/m)
  assert.match(service, /^ProtectSystem=false$/m)
  assert.match(sudoers, /^kelion-codex ALL=\(ALL:ALL\) NOPASSWD: ALL$/m)
  assert.doesNotMatch(worker, /codexApiLogin|projectKey|sk-proj-|CODEX_BIN|codex-real/)
  assert.doesNotMatch(service, /openai-project-key|OPENAI|codex-real/)

  const result = spawnSync(process.execPath, [resolve(ROOT, 'deploy/codex-worker.mjs'), '--self-test'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'codex-worker self-test: TRECE')
})

test('jurnalul workerului este bounded, iar timeoutul, abortul și overflow-ul nu pot publica handoff', () => {
  const worker = read('deploy/codex-worker.mjs')
  const tail = worker.slice(worker.indexOf('export function tailText'), worker.indexOf('/** Clasifică local jurnalul privat'))
  const success = worker.slice(worker.indexOf('export function runSucceeded'), worker.indexOf('function runLogged'))
  const runLogged = worker.slice(worker.indexOf('function runLogged'), worker.indexOf('function canonicalDirectory'))
  const runOnce = worker.slice(worker.indexOf('async function runOnce'), worker.indexOf('async function executorSmoke'))

  assert.match(tail, /openSync\(logPath, 'r'\)[\s\S]*fstatSync\(descriptor\)[\s\S]*const start = info\.size - byteCount[\s\S]*readSync\(descriptor, buffer, offset, byteCount - offset, start \+ offset\)/)
  assert.doesNotMatch(tail, /readFileSync/)
  assert.match(success, /result\?\.code === 0[\s\S]*result\.signal === null[\s\S]*result\.timedOut === false[\s\S]*result\.aborted === false[\s\S]*result\.outputExceeded === false/)
  assert.match(runLogged, /WORKER_LOG_MAX_BYTES[\s\S]*fstatSync\(fd\)[\s\S]*ftruncateSync\(fd, maxLogBytes\)/)
  assert.match(runLogged, /stdio: \[stdin === null \? 'ignore' : 'pipe', 'pipe', 'pipe'\]/)
  assert.match(runLogged, /child\.stdout\.on\('data', appendOutput\)[\s\S]*child\.stderr\.on\('data', appendOutput\)/)
  assert.match(runLogged, /accepted = Math\.min\(chunk\.length, maxLogBytes - logBytes\)[\s\S]*outputExceeded = true[\s\S]*terminate\(\)/)
  assert.match(runLogged, /done\(outputExceeded[\s\S]*\{ code: 1, signal: null, timedOut, aborted, outputExceeded: true \}[\s\S]*\{ code: code \?\? 1, signal: exitSignal, timedOut, aborted, outputExceeded: false \}/)

  const executorReject = runOnce.indexOf('if (!runSucceeded(result))')
  const gateStart = runOnce.indexOf('const stopGateLease')
  const gateReject = runOnce.indexOf('if (!runSucceeded(gate))')
  const handoff = runOnce.indexOf('const handoff = publishHandoff')
  assert.ok(executorReject >= 0 && gateStart > executorReject)
  assert.ok(gateReject > gateStart && handoff > gateReject)
  assert.doesNotMatch(runOnce, /if \((?:result|gate)\.code (?:===|!==) 0\)/)
})

test('activarea Constructorului este dublu fail-closed', () => {
  const runtimeExample = read('deploy/kelionai.env.example')
  const workerExample = read('deploy/codex-worker.env.example')
  const workflow = read('.github/workflows/vps-set-env.yml')
  const service = read('deploy/systemd/kelion-codex-worker.service')

  assert.match(runtimeExample, /^CODEX_WORKER_ENABLED=0$/m)
  assert.match(workerExample, /^CODEX_WORKER_EXEC_ENABLED=0$/m)
  assert.match(workflow, /CODEX_WORKER_ENABLED:\s*\$\{\{ vars\.CODEX_WORKER_ENABLED \|\| '0' \}\}/)
  assert.match(service, /^ConditionPathExists=\/etc\/kelion\/codex-worker\.enabled$/m)
  assert.match(service, /^EnvironmentFile=\/root\/kelion\/config\/codex-worker\.env$/m)
  assert.match(service, /^LoadCredential=codex-worker-secret:\/root\/kelion\/secrets\/codex-worker-secret$/m)
  assert.match(service, /^Requires=private-ai-llm\.service /m)
  assert.doesNotMatch(service, /host\.env|kelionai\.env|OPENAI_ADMIN|openai-admin|CODEX_ACCESS_TOKEN|^Environment=.*OPENAI/m)
})

test('backendul primește admin key numai ca fișier, niciodată mediul OpenCode', () => {
  const compose = read('deploy/compose.production.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const worker = read('deploy/codex-worker.mjs')
  const parentEnv = worker.slice(worker.indexOf('export function openCodeParentEnv()'), worker.indexOf('function podmanSupervisorEnv()'))
  const workerService = read('deploy/systemd/kelion-codex-worker.service')
  const loginWorkflow = read('.github/workflows/vps-codex-login.yml')
  const loginGuard = loginWorkflow.slice(loginWorkflow.indexOf('  guard-source:'), loginWorkflow.indexOf('  preflight:'))
  const loginPreflight = loginWorkflow.slice(loginWorkflow.indexOf('  preflight:'))

  for (const forbidden of [
    '/var/lib/kelion-codex-auth',
    '/var/lib/kelion-codex/jobs',
    'auth.json',
    'CODEX_ACCESS_TOKEN',
  ]) {
    assert.doesNotMatch(compose, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(compose, /^\s+OPENAI_ADMIN_KEY_FILE: \/run\/secrets\/openai-admin-key$/m)
  assert.equal(compose.match(/OPENAI_ADMIN_KEY_FILE/g)?.length, 1)
  assert.equal(compose.match(/target: \/run\/secrets\/openai-admin-key/g)?.length, 1)
  assert.doesNotMatch(compose, /^\s+OPENAI_ADMIN_KEY:/m)
  assert.doesNotMatch(provision, /CODEX_ACCESS_TOKEN|chatgptAuthTokens/)
  assert.doesNotMatch(parentEnv, /OPENAI_ADMIN|OPENAI_API_KEY|CREDENTIALS_DIRECTORY/)
  assert.doesNotMatch(workerService, /OPENAI_ADMIN|openai-admin-key/)
  assert.doesNotMatch(loginWorkflow, /OPENAI_ADMIN|openai-admin-key/)
  assert.match(loginWorkflow, /^name: VPS Constructor Local Preflight$/m)
  assert.match(loginGuard, /if: always\(\)[\s\S]*actions\/checkout@11d5960a326750d5838078e36cf38b85af677262[\s\S]*persist-credentials: false/)
  assert.match(loginGuard, /\[ "\$GITHUB_REPOSITORY" = kelion-team\/kelionai \][\s\S]*\[ "\$GITHUB_REF" = refs\/heads\/master \][\s\S]*\[ "\$GITHUB_REF_NAME" = master \][\s\S]*\[ "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA" \]/)
  assert.match(loginWorkflow, /preflight:\s*\n\s+needs: guard-source/)
  assert.doesNotMatch(loginPreflight, /^\s+if:\s*github\./m)
  assert.match(loginPreflight, /\[ "\$GITHUB_REPOSITORY" = 'kelion-team\/kelionai' \][\s\S]*\[ "\$GITHUB_REF" = 'refs\/heads\/master' \][\s\S]*\[ "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA" \]/)
  assert.match(loginWorkflow, /expected_worker_sha=\$\(sha256sum deploy\/codex-worker\.mjs/)
  assert.match(loginWorkflow, /\/opt\/private-ai\/bin\/opencode/)
  assert.match(loginWorkflow, /llama\.cpp\/qwen3\.6-35b-a3b-local/)
  assert.match(loginWorkflow, /enabled_providers == \["llama\.cpp"\]/)
  assert.match(loginWorkflow, /has\("apiKey"\) \| not/)
  assert.match(loginWorkflow, /all\(\.\[\]; \$config\.permission\[\.\] == "allow"\)/)
  assert.doesNotMatch(loginWorkflow, /all\(\. as \$permission;/)
  assert.match(loginWorkflow, /kelion-codex ALL=\(ALL:ALL\) NOPASSWD: ALL/)
  assert.match(loginWorkflow, /sudo -n -u root -- \/usr\/bin\/id -u/)
  assert.match(loginWorkflow, /LOCAL_CONSTRUCTOR_PREFLIGHT=passed/)
  assert.doesNotMatch(loginWorkflow, /codex\s+login|login\s+--with-api-key|@openai\/codex|npm\s+(?:install|update)|apt(?:-get)?\s+install|OPENAI_(?:API_KEY|ADMIN_KEY)|sk-proj-/i)
  assert.doesNotMatch(loginWorkflow, /systemctl\s+(?:start|restart|stop|enable|disable)\b/)
  assert.match(compose, /^\s+CODEX_WORKER_SECRET_FILE: \/run\/secrets\/codex-worker-secret$/m)
})

test('imaginea de porți autorizează numai worktree-ul copiat', () => {
  const gates = read('deploy/gates/run-gates.sh')

  assert.match(gates, /^WORK=\/work\/repo$/m)
  assert.match(gates, /^export GIT_CONFIG_COUNT=1$/m)
  assert.match(gates, /^export GIT_CONFIG_KEY_0=safe\.directory$/m)
  assert.match(gates, /^export GIT_CONFIG_VALUE_0="\$WORK"$/m)
  assert.doesNotMatch(gates, /safe\.directory\s*[=*]\s*\*/)
})

test('imaginea de porți include runtime-urile cerute de testele de publicare și recovery', () => {
  const dockerfile = read('Dockerfile.gates')
  const appRuntime = read('Dockerfile').split('FROM ${NODE_IMAGE} AS runtime').at(-1)
  const gates = read('deploy/gates/run-gates.sh')

  assert.match(dockerfile, /apt-get install -y --no-install-recommends bash git jq openssh-client python3/)
  assert.doesNotMatch(appRuntime, /\bjq\b/)
  assert.match(gates, /deploy\/lib\/constructor-publication\.test\.mjs/)
  assert.match(gates, /deploy\/lib\/release-rollback\.test\.mjs/)
})

test('controlul Constructorului arhivează numai intrările versionate, cu preflight fail-closed', () => {
  const workflow = read('.github/workflows/vps-run.yml')

  assert.match(workflow, /for input in AGENTS\.md deploy; do\s+git cat-file -e "HEAD:\$input"/)
  assert.match(workflow, /git archive --format=tar HEAD AGENTS\.md deploy \| gzip -n > "\$RUNNER_TEMP\/constructor-bundle\.tar\.gz"/)
  assert.match(workflow, /tar -tzf "\$RUNNER_TEMP\/constructor-bundle\.tar\.gz" > "\$RUNNER_TEMP\/constructor-bundle\.entries"/)
  assert.match(workflow, /grep -qx 'AGENTS\.md' "\$RUNNER_TEMP\/constructor-bundle\.entries"/)
  assert.match(workflow, /grep -q '\^deploy\/' "\$RUNNER_TEMP\/constructor-bundle\.entries"/)
  assert.doesNotMatch(workflow, /tar -tzf [^\n]+\|\s*grep -q/)
  assert.doesNotMatch(workflow, /tar --sort=name --owner=0 --group=0 --numeric-owner -czf "\$RUNNER_TEMP\/constructor-bundle\.tar\.gz"/)
})

test('metadatele TypeScript rămân în worktree-ul temporar, nu în dependențele read-only', () => {
  const ignore = read('.gitignore')
  const frontendPackage = JSON.parse(read('frontend/package.json'))
  const viteConfig = read('frontend/vite.config.ts')

  for (const path of ['frontend/tsconfig.app.json', 'frontend/tsconfig.node.json']) {
    const buildInfo = read(path).match(/"tsBuildInfoFile"\s*:\s*"([^"]+)"/)?.[1]

    assert.equal(typeof buildInfo, 'string')
    assert.match(buildInfo, /^\.\/\.tmp\/[^/]+\.tsbuildinfo$/)
    assert.doesNotMatch(buildInfo, /node_modules/)
  }

  assert.match(ignore, /^frontend\/\.tmp\/$/m)
  assert.match(frontendPackage.scripts.build, /vite build --configLoader native/)
  assert.match(frontendPackage.scripts.test, /vitest run --configLoader native/)
  assert.match(viteConfig, /cacheDir:\s*['"]\.tmp\/vite-cache['"]/)
  assert.doesNotMatch(frontendPackage.scripts.build, /--configLoader bundle/)
  assert.doesNotMatch(frontendPackage.scripts.test, /--configLoader bundle/)
})

test('finalizarea one-shot are roll-forward persistent și receipt complet legat de sursă', () => {
  const script = read('.github/private-ai/finalize-private-ai-constructor.sh')
  const workflow = read('.github/workflows/private-ai-finalize.yml')
  const proof = read('.github/workflows/private-ai-constructor-proof.yml')

  assert.match(script, /FINALIZER_MAIN_BASHPID=\$BASHPID/)
  assert.match(script, /trap rollback ERR EXIT[\s\S]*trap 'rollback 129' HUP[\s\S]*trap 'rollback 143' TERM/)
  assert.match(script, /if ! systemctl is-active --quiet private-ai-web\.service; then[\s\S]*systemctl start private-ai-web\.service/)
  assert.match(workflow, /durable_parent=\/root\/private-ai-finalize[\s\S]*private-ai-constructor-finalize\.service/)
  assert.match(workflow, /Restart=on-failure[\s\S]*WantedBy=multi-user\.target/)
  assert.match(workflow, /RestartPreventExitStatus=75/)
  assert.match(workflow, /ExecStartPost=\/usr\/bin\/systemctl disable private-ai-constructor-finalize\.service/)
  assert.match(script, /'schema=3'[\s\S]*llama_cpp_ref=[\s\S]*model_file_sha256=[\s\S]*worker_unit_sha256=[\s\S]*sudoers_sha256=[\s\S]*instructions_sha256=[\s\S]*web_dropin_sha256=/)
  assert.match(proof, /\[ "\$\{#final_lines\[@\]\}" -eq 28 \][\s\S]*schema=3/)
  assert.match(script, /FragmentPath --value[\s\S]*DropInPaths --value/)
  assert.match(script, /MODEL_FILE_SHA256=671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7/)
  assert.match(script, /LLAMA_SERVER_SHA256=bc27b0436ccf37e04135acede4acb25c0cb377272bc52219b9c0df2f1211dbc0/)
  assert.match(script, /OPENCODE_BIN_SHA256=d91e0d33676d0839f7cde87924cd4127ea88c9d6784eea9f009a7d08bdc60eeb/)
  assert.match(script, /finalizer-attempts[\s\S]*attempt_count[\s\S]*-ge 3[\s\S]*exit 75/)
  assert.match(script, /runuser -u privateai[\s\S]*git -C "\$LLAMA_SOURCE" rev-parse HEAD/)
  assert.match(script, /awk -v target="\$model_file_path"[\s\S]*"\/proc\/\$llm_pid\/maps"/)
  assert.match(proof, /origin\/master\^\{commit\}[\s\S]*expected_source_sha[\s\S]*org\.opencontainers\.image\.revision/)
  assert.match(proof, /\.baseCommit == \$base/)
  assert.match(proof, /awk '\/\^Uid:\/ \{ print \$2 \}'[\s\S]*expected_opencode_argv[\s\S]*\/proc\/\$pid\/cwd/)
})

test('release-ul desktop cere CI-ul latest și Authenticode public-trust cu timestamp', () => {
  const workflow = read('.github/workflows/constructor-desktop-release.yml')
  assert.match(workflow, /RELEASE_SHA -ne \$env:GITHUB_SHA/)
  assert.match(workflow, /Sort-Object \{\[DateTimeOffset\]\$_\.created_at\} -Descending/)
  assert.match(workflow, /\$latest\.status -ne 'completed'[\s\S]*\$latest\.conclusion -ne 'success'/)
  for (const job of ['release-train-preflight', 'verify', 'container-isolation']) {
    assert.match(workflow, new RegExp(job))
  }
  assert.match(workflow, /WINDOWS_AUTHENTICODE_PFX_BASE64/)
  assert.match(workflow, /signtool[\s\S]*\/tr 'http:\/\/timestamp\.digicert\.com'[\s\S]*Get-AuthenticodeSignature/)
  assert.match(workflow, /Status -ne 'Valid'[\s\S]*TimeStamperCertificate/)
  assert.match(workflow, /AUTHENTICODE_EXPECTED_THUMBPRINT[\s\S]*SignerCertificate\.Thumbprint/)
  assert.doesNotMatch(workflow, /id-token:\s*write/)
  const jobEnv = workflow.match(/    env:\n([\s\S]*?)    steps:/)?.[1] ?? ''
  assert.doesNotMatch(jobEnv, /AUTHENTICODE_PFX/)
})
