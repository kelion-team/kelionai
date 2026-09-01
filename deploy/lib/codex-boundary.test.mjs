import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('Constructorul folosește exclusiv OpenCode cu Qwen local, fără autentificare AI cloud', () => {
  const worker = read('deploy/codex-worker.mjs')
  const service = read('deploy/systemd/kelion-codex-worker.service')
  const localPreflightWorkflow = read('.github/workflows/vps-codex-login.yml')
  const controlWorkflow = read('.github/workflows/vps-run.yml')
  const recoveryWorkflow = read('.github/workflows/vps-recovery.yml')
  const config = read('deploy/opencode-constructor.json')
  const instructions = read('deploy/opencode-constructor-instructions.md')

  assert.match(worker, /^const OPENCODE_VERSION = '1\.18\.25'$/m)
  assert.match(worker, /^const OPENCODE_MODEL_ID = 'qwen3\.6-35b-a3b-local'$/m)
  assert.match(worker, /^const POWERFUL_OPENCODE_MODEL_ID = 'qwen3\.5-122b-a10b-local'$/m)
  assert.match(worker, /const OPENCODE_MODEL = process\.env\.OPENCODE_MODEL \?\? 'llama\.cpp\/qwen3\.6-35b-a3b-local'/)
  assert.match(worker, /function openCodeExecArgs\(jobDir, orderPath, model/)
  assert.match(worker, /\[FAST_OPENCODE_MODEL, POWERFUL_OPENCODE_MODEL\]\.includes\(model\)/)
  assert.match(worker, /const CONSTRUCTOR_MODEL_PROFILES = Object\.freeze\(\{[\s\S]*fast:[\s\S]*powerful:/)
  assert.match(worker, /\.\.\.modelArgs/)
  assert.match(worker, /function activeConstructorProfile\(\)/)
  assert.doesNotMatch(worker, /switchConstructorModel|modelSwitchArgs|CONSTRUCTOR_TURNS/)
  assert.match(worker, /'-n', '-u', 'root', '--'/)
  assert.match(worker, /function openCodeParentEnv\(\)/)
  assert.match(worker, /function openCodeRootEnvironmentArgs\(/)
  assert.doesNotMatch(worker, /codexApiLogin|projectKey|sk-proj-|CODEX_BIN|codex-real|--with-api-key|login status/)

  assert.match(service, /^LoadCredential=codex-worker-secret:\/root\/kelion\/secrets\/codex-worker-secret$/m)
  assert.doesNotMatch(service, /^Requires=.*private-ai-llm\.service/m)
  assert.match(service, /^Requires=kelion-constructor-sync\.service kelion-constructor-model-control\.service$/m)
  assert.match(service, /^Wants=.*private-ai-llm\.service$/m)
  assert.match(service, /^Environment=OPENCODE_BIN=\/opt\/private-ai\/bin\/opencode$/m)
  assert.match(service, /^Environment=OPENCODE_MODEL=llama\.cpp\/qwen3\.6-35b-a3b-local$/m)
  assert.doesNotMatch(service, /^Environment=OPENCODE_POWERFUL_MODEL=/m)
  assert.doesNotMatch(service, /^ExecStopPost=.*constructor-model-switch/m)
  assert.match(service, /^SupplementaryGroups=kelion-handoff privateai$/m)
  assert.match(service, /^ExecStart=\/usr\/bin\/flock --exclusive --wait 9000 \/run\/lock\/private-ai-model-switch\.lock \/usr\/bin\/node \/opt\/kelion-codex\/codex-worker\.mjs --once$/m)
  assert.match(service, /^NoNewPrivileges=false$/m)
  assert.match(service, /^ProtectSystem=false$/m)
  assert.doesNotMatch(service, /openai-project-key|OPENAI|codex-real|CODEX_HOME/)

  const parsedConfig = JSON.parse(config)
  assert.equal(parsedConfig.autoupdate, false)
  assert.equal(parsedConfig.share, 'disabled')
  assert.equal(parsedConfig.model, 'llama.cpp/qwen3.6-35b-a3b-local')
  assert.deepEqual(
    Object.keys(parsedConfig.provider['llama.cpp'].models).sort(),
    ['qwen3.5-122b-a10b-local', 'qwen3.6-35b-a3b-local'],
  )
  assert.deepEqual(parsedConfig.enabled_providers, ['llama.cpp'])
  assert.deepEqual(Object.keys(parsedConfig.provider), ['llama.cpp'])
  assert.equal(Object.hasOwn(parsedConfig.provider['llama.cpp'].options, 'apiKey'), false)
  assert.match(instructions, /Never use a paid or external AI provider/)

  assert.match(localPreflightWorkflow, /OpenCode\/Qwen/)
  assert.match(localPreflightWorkflow, /OPENCODE_VERSION = '1\.18\.25'/)
  assert.match(localPreflightWorkflow, /qwen3\.6-35b-a3b-local/)
  assert.match(controlWorkflow, /local-repair-executor/)
  assert.match(controlWorkflow, /opencode-qwen-local=ready/)
  assert.match(recoveryWorkflow, /\/opt\/private-ai\/bin\/opencode --version/)
  assert.match(recoveryWorkflow, /\)" = '1\.18\.25' \]/)
  assert.match(recoveryWorkflow, /\.enabled_providers == \["llama\.cpp"\]/)
  assert.match(recoveryWorkflow, /\.model == "llama\.cpp\/qwen3\.6-35b-a3b-local"/)
  assert.match(recoveryWorkflow, /has\("apiKey"\) \| not/)
  assert.doesNotMatch(localPreflightWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME=\/|login status|sk-proj-|kelion-worker\.config\.toml|codex-auth=/)
  assert.match(localPreflightWorkflow, /! grep -Eqi '[^']*login\[\[:space:\]\]\+--with-api-key\|openai-project-key[^']*' "\$unit_snapshot"/)
  assert.doesNotMatch(controlWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME|login status|--with-api-key|sk-proj-|kelion-worker\.config\.toml|codex-auth=/)
  assert.doesNotMatch(recoveryWorkflow, /@openai\/codex|forced_login_method|CODEX_HOME|login status|--with-api-key|sk-proj-|kelion-worker\.config\.toml|codex-auth=|openai-project-key/)

  const result = spawnSync(process.execPath, [resolve(ROOT, 'deploy/codex-worker.mjs'), '--self-test'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
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
  assert.match(service, /^Wants=.*private-ai-llm\.service$/m)
  assert.doesNotMatch(service, /^ExecStopPost=.*constructor-model-switch/m)
  assert.doesNotMatch(service, /host\.env|kelionai\.env|OPENAI_ADMIN|openai-admin|CODEX_ACCESS_TOKEN|openai-project-key|^Environment=.*OPENAI/m)
})

test('backendul primește admin key numai ca fișier, niciodată executorul Constructor', () => {
  const compose = read('deploy/compose.production.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const worker = read('deploy/codex-worker.mjs')
  const parentEnv = worker.slice(worker.indexOf('export function openCodeParentEnv()'), worker.indexOf('function openCodeRootEnvironmentArgs('))
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
  assert.match(localPreflightWorkflow, /! grep -Eqi '[^']*login\[\[:space:\]\]\+--with-api-key\|openai-project-key[^']*' "\$unit_snapshot"/)
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
