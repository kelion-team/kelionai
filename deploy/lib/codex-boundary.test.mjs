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
