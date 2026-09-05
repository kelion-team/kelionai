import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('Constructorul folosește exclusiv modelul gratuit aprobat în executor code-only anonim', () => {
  const worker = read('deploy/codex-worker.mjs')
  const service = read('deploy/systemd/kelion-codex-worker.service')
  const localPreflightWorkflow = read('.github/workflows/vps-codex-login.yml')
  const controlWorkflow = read('.github/workflows/vps-run.yml')
  const recoveryWorkflow = read('.github/workflows/vps-recovery.yml')
  const config = read('deploy/opencode-constructor.json')
  const instructions = read('deploy/opencode-constructor-instructions.md')
  const gates = read('deploy/gates/run-gates.sh')
  const buildWorkflow = read('.github/workflows/build-images.yml')

  assert.match(worker, /^const OPENCODE_VERSION = '1\.18\.25'$/m)
  assert.match(worker, /^const OPENCODE_MODEL_ID = 'big-pickle'$/m)
  assert.doesNotMatch(worker, /POWERFUL_OPENCODE_MODEL|llama\.cpp|qwen3/)
  assert.match(worker, /const OPENCODE_MODEL = process\.env\.OPENCODE_MODEL \?\? 'opencode-free\/big-pickle'/)
  assert.match(worker, /function openCodeExecArgs\(jobDir, orderPath, model/)
  assert.match(worker, /model !== FAST_OPENCODE_MODEL/)
  assert.match(worker, /const CONSTRUCTOR_MODEL_PROFILES = Object\.freeze\(\{\s*fast:/)
  assert.match(worker, /\.\.\.modelArgs/)
  assert.match(worker, /function activeConstructorProfile\(\)/)
  assert.match(worker, /mkdtempSync\(join\(tmpdir\(\), 'kelion-worker-gate-classification-'\)\)/)
  assert.match(worker, /mkdtempSync\(join\(tmpdir\(\), 'kelion-worker-run-logged-self-test-'\)\)/)
  assert.doesNotMatch(worker, /mkdtempSync\('\/tmp\//)
  assert.doesNotMatch(worker, /switchConstructorModel|modelSwitchArgs|CONSTRUCTOR_TURNS/)
  assert.doesNotMatch(worker, /'-n', '-u', 'root', '--'/)
  assert.match(worker, /function openCodeParentEnv\(\)/)
  assert.match(worker, /function openCodeEnvironmentArgs\(/)
  assert.match(worker, /function openCodeContainerArgs\(/)
  assert.match(worker, /--security-opt=no-new-privileges/)
  assert.match(worker, /stopExecutorContainer\(jobDir\)/)
  assert.doesNotMatch(worker, /codexApiLogin|projectKey|sk-proj-|CODEX_BIN|codex-real|--with-api-key|login status/)

  assert.match(service, /^LoadCredential=codex-worker-secret:\/root\/kelion\/secrets\/codex-worker-secret$/m)
  assert.doesNotMatch(service, /^Requires=.*private-ai-llm\.service/m)
  assert.match(service, /^Requires=kelion-constructor-sync\.service kelion-constructor-model-control\.service$/m)
  assert.match(service, /^Wants=network-online\.target$/m)
  assert.match(service, /^Environment=OPENCODE_BIN=\/opt\/private-ai\/bin\/opencode$/m)
  assert.match(service, /^Environment=OPENCODE_MODEL=opencode-free\/big-pickle$/m)
  assert.doesNotMatch(service, /^Environment=OPENCODE_POWERFUL_MODEL=/m)
  assert.doesNotMatch(service, /^ExecStopPost=.*constructor-model-switch/m)
  assert.match(service, /^SupplementaryGroups=kelion-handoff privateai$/m)
  assert.match(service, /^ExecStart=\/usr\/bin\/node \/opt\/kelion-codex\/codex-worker\.mjs --once$/m)
  assert.match(service, /^NoNewPrivileges=false$/m)
  assert.match(service, /^ProtectSystem=false$/m)
  assert.doesNotMatch(service, /openai-project-key|OPENAI|codex-real|CODEX_HOME/)

  const parsedConfig = JSON.parse(config)
  assert.equal(parsedConfig.autoupdate, false)
  assert.equal(parsedConfig.share, 'disabled')
  assert.equal(parsedConfig.model, 'opencode-free/big-pickle')
  assert.deepEqual(
    Object.keys(parsedConfig.provider['opencode-free'].models),
    ['big-pickle'],
  )
  assert.deepEqual(parsedConfig.enabled_providers, ['opencode-free'])
  assert.deepEqual(Object.keys(parsedConfig.provider), ['opencode-free'])
  assert.equal(Object.hasOwn(parsedConfig.provider['opencode-free'].options, 'apiKey'), false)
  assert.match(instructions, /Never switch model, use a paid fallback/)
  assert.match(instructions, /You have no sudo or host access/)
  assert.match(gates, /^mkdir -p \/work\/tmp "\$WORK"$/m)
  assert.match(gates, /^export TMPDIR=\/work\/tmp$/m)
  assert.match(buildWorkflow, /docker run --rm --network none --read-only --cap-drop ALL/)
  assert.match(buildWorkflow, /--tmpfs \/work:rw,nosuid,nodev,size=6g,uid=1000,gid=1000/)
  assert.doesNotMatch(buildWorkflow, /--tmpfs \/tmp(?:[:\s])/)

  assert.match(localPreflightWorkflow, /OpenCode/)
  assert.doesNotMatch(localPreflightWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME=\/|login status|sk-proj-|kelion-worker\.config\.toml|codex-auth=/)
  assert.doesNotMatch(controlWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME|login status|--with-api-key|sk-proj-|kelion-worker\.config\.toml|codex-auth=/)
  assert.doesNotMatch(recoveryWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME|login status|--with-api-key|sk-proj-|kelion-worker\.config\.toml|codex-auth=|openai-project-key/)

  const result = spawnSync(process.execPath, [resolve(ROOT, 'deploy/codex-worker.mjs'), '--self-test'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'codex-worker self-test: TRECE')
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
  assert.doesNotMatch(service, /^Requires=.*private-ai-llm\.service/m)
  assert.match(service, /^Wants=network-online\.target$/m)
  assert.doesNotMatch(service, /^ExecStopPost=.*constructor-model-switch/m)
  assert.doesNotMatch(service, /host\.env|kelionai\.env|OPENAI_ADMIN|openai-admin|CODEX_ACCESS_TOKEN|openai-project-key|^Environment=.*OPENAI/m)
})

test('pollingul Constructor nu repornește direct sau tranzitiv modelul oprit de administrator', () => {
  const unitDirectory = resolve(ROOT, 'deploy/systemd')
  const units = new Map(readdirSync(unitDirectory)
    .filter((name) => /\.(?:service|timer)$/.test(name))
    .map((name) => [name, read(`deploy/systemd/${name}`)]))
  const startupDependencies = (source) => {
    let section = ''
    const directives = new Map()
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.startsWith('[')) section = line
      const match = /^([A-Za-z]+)=(.*)$/.exec(line)
      if (!match) continue
      const [, name, value] = match
      const startsUnit = section === '[Unit]' && ['Wants', 'Requires', 'BindsTo', 'Upholds'].includes(name)
      const timerTarget = section === '[Timer]' && name === 'Unit'
      if (!startsUnit && !timerTarget) continue
      if (!value.trim() || timerTarget) directives.set(name, [])
      directives.set(name, [...(directives.get(name) ?? []), ...value.trim().split(/\s+/).filter(Boolean)])
    }
    return [...directives.values()].flat()
  }
  const startedBy = (root, graph = units) => {
    const visited = new Set()
    const pending = [root]
    while (pending.length) {
      const name = pending.pop()
      if (visited.has(name)) continue
      visited.add(name)
      pending.push(...startupDependencies(graph.get(name) ?? ''))
    }
    return visited
  }
  const scheduledStart = startedBy('kelion-codex-worker.timer')
  for (const required of ['kelion-codex-worker.service', 'kelion-constructor-sync.service', 'kelion-constructor-model-control.service']) {
    assert.equal(scheduledStart.has(required), true, `${required} must still be started by the queue timer`)
  }
  for (const modelService of ['private-ai-llm.service', 'private-ai-web.service']) {
    assert.equal(scheduledStart.has(modelService), false, `queue polling must not activate ${modelService}`)
  }
  // Detect either old path independently, including the indirect path through
  // the required controller. Ordering via After= must not count as activation.
  for (const unit of ['kelion-codex-worker.service', 'kelion-constructor-model-control.service']) {
    const previousGraph = new Map(units)
    previousGraph.set(unit, units.get(unit).replace('[Unit]', '[Unit]\nWants=private-ai-llm.service'))
    assert.equal(startedBy('kelion-codex-worker.timer', previousGraph).has('private-ai-llm.service'), true)
  }
})

test('backendul primește admin key numai ca fișier, niciodată executorul Constructor', () => {
  const compose = read('deploy/compose.production.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const worker = read('deploy/codex-worker.mjs')
  const parentEnv = worker.slice(worker.indexOf('export function openCodeParentEnv()'), worker.indexOf('function openCodeEnvironmentArgs('))
  const workerService = read('deploy/systemd/kelion-codex-worker.service')
  const localPreflightWorkflow = read('.github/workflows/vps-codex-login.yml')
  const recoveryWorkflow = read('.github/workflows/vps-recovery.yml')

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
  assert.doesNotMatch(localPreflightWorkflow, /OPENAI_ADMIN|openai-admin-key|login status/)
  assert.doesNotMatch(recoveryWorkflow, /OPENAI_ADMIN|openai-admin-key|login status/)
  assert.match(compose, /^\s+CODEX_WORKER_SECRET_FILE: \/run\/secrets\/codex-worker-secret$/m)
})

test('imaginea de porți autorizează numai worktree-ul copiat', () => {
  const gates = read('deploy/gates/run-gates.sh')
  const publisher = read('deploy/constructor-publisher.mjs')
  const worker = read('deploy/codex-worker.mjs')

  assert.match(gates, /^WORK=\/work\/repo$/m)
  assert.match(gates, /^export GIT_CONFIG_COUNT=1$/m)
  assert.match(gates, /^export GIT_CONFIG_KEY_0=safe\.directory$/m)
  assert.match(gates, /^export GIT_CONFIG_VALUE_0="\$WORK"$/m)
  assert.doesNotMatch(gates, /safe\.directory\s*[=*]\s*\*/)
  assert.match(publisher, /'--runtime', '\/usr\/bin\/crun'/)
  assert.match(worker, /ociRuntime: '\/usr\/bin\/crun'/)
  for (const source of [publisher, worker]) {
    assert.match(source, /--cgroups=disabled/)
    assert.doesNotMatch(source, /--(?:pids-limit|memory|cpus)=/)
  }
  for (const name of ['kelion-codex-worker', 'kelion-constructor-publisher']) {
    const unit = read(`deploy/systemd/${name}.service`)
    assert.match(unit, /^CPUQuota=200%$/m)
    assert.match(unit, /^MemoryMax=6G$/m)
    assert.match(unit, /^TasksMax=512$/m)
    assert.match(unit, /^KillMode=control-group$/m)
  }
})

test('entrypointul porților emite verdictul măsurat folosit de clasificarea workerului', () => {
  const gates = read('deploy/gates/run-gates.sh')
  const worker = read('deploy/codex-worker.mjs')

  assert.match(gates, /trap gate_verdict EXIT/)
  assert.match(gates, /codex-gates: START schema=1/)
  assert.match(gates, /codex-gates: VERDICT schema=1 exit=%s/)
  assert.match(worker, /measuredGateVerdict/)
  assert.match(worker, /\[125, 126, 127, 137\]\.includes\(result\.code\)/)
  assert.match(worker, /GATE_INFRASTRUCTURE_FAILURE/)
})

test('imaginea de porți include runtime-urile cerute de testele de publicare și recovery', () => {
  const dockerfile = read('Dockerfile.gates')
  const appRuntime = read('Dockerfile').split('FROM ${NODE_IMAGE} AS runtime').at(-1)
  const gates = read('deploy/gates/run-gates.sh')

  assert.match(dockerfile, /apt-get install -y --no-install-recommends bash git jq openssh-client python3/)
  const vendorCopy = 'COPY backend/vendor/node-domexception ./backend/vendor/node-domexception'
  assert.ok(dockerfile.indexOf(vendorCopy) >= 0 && dockerfile.indexOf(vendorCopy) < dockerfile.indexOf('RUN cd backend && npm ci'))
  assert.match(dockerfile, /COPY --from=dependencies \/opt\/kelion\/backend\/vendor \/opt\/kelion\/backend\/vendor/)
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
