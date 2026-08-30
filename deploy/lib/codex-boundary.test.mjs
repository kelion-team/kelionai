import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('Codex folosește exclusiv cheia project-scoped prin login CLI pe stdin', () => {
  const profile = read('deploy/codex-worker.profile.toml')
  const worker = read('deploy/codex-worker.mjs')
  const service = read('deploy/systemd/kelion-codex-worker.service')
  const loginWorkflow = read('.github/workflows/vps-codex-login.yml')
  const controlWorkflow = read('.github/workflows/vps-run.yml')

  assert.match(profile, /^approval_policy = "never"$/m)
  assert.match(profile, /^forced_login_method = "api"$/m)
  assert.match(profile, /^cli_auth_credentials_store = "file"$/m)
  assert.match(profile, /^\[permissions\.kelion-worker\.network\]\nenabled = false$/m)
  assert.match(worker, /const CODEX_API_AUTH_CONFIG_ARGS = Object\.freeze\(\[\s*'-c', 'forced_login_method="api"',\s*'-c', 'cli_auth_credentials_store="file"',\s*\]\)/)
  assert.match(worker, /return \[\.\.\.CODEX_API_AUTH_CONFIG_ARGS, 'login', '--with-api-key'\]/)
  assert.match(worker, /return \[\.\.\.CODEX_API_AUTH_CONFIG_ARGS, 'login', 'status'\]/)
  assert.match(worker, /input: projectKey[\s\S]{0,120}stdio: \['pipe', 'ignore', 'ignore'\]/)
  assert.match(worker, /projectKey\.fill\(0\)/)
  assert.match(worker, /createHash\('sha256'\)\.update\(projectKey\)\.digest\('hex'\)/)
  assert.match(worker, /renameSync\(temporary, target\)[\s\S]{0,80}fsyncPath\(AUTH_HOME\)/)
  assert.match(worker, /Logged in using an API key - sk-proj-/)
  assert.match(worker, /Cache-ul Codex auth\.json are owner sau permisiuni necanonice/)
  assert.match(service, /^LoadCredential=openai-project-key:\/root\/kelion\/secrets\/openai-project-key$/m)
  assert.doesNotMatch(service, /^Environment=.*OPENAI/m)
  assert.match(loginWorkflow, /^  login:\n(?: {4}.+\n)* {4}environment: production$/m)
  assert.match(loginWorkflow, /codex \\\n\s+-c 'forced_login_method="api"' \\\n\s+-c 'cli_auth_credentials_store="file"' \\\n\s+login --with-api-key \\\n\s+< "\$credential" >\/dev\/null 2>&1/)
  assert.match(loginWorkflow, /codex \\\n\s+-c 'forced_login_method="api"' \\\n\s+-c 'cli_auth_credentials_store="file"' \\\n\s+login status >\/dev\/null 2>&1/)
  assert.doesNotMatch(loginWorkflow, /\/codex login(?:\s|$)/)
  assert.doesNotMatch(loginWorkflow, /device-auth|--with-access-token|OPENAI_ADMIN_KEY|openai-admin-key|set -x/)
  assert.match(controlWorkflow, /codex \\\n\s+-c 'forced_login_method="api"' \\\n\s+-c 'cli_auth_credentials_store="file"' \\\n\s+login status 2>\/dev\/null/)
  assert.doesNotMatch(controlWorkflow, /\/codex login status/)
  assert.doesNotMatch(controlWorkflow, /codex --strict-config --profile kelion-worker login/)
  assert.match(controlWorkflow, /'Logged in using an API key - sk-proj-'\*\) echo 'codex-auth=ready'/)
  assert.doesNotMatch(controlWorkflow, /runuser -u kelion-codex -- env HOME=[^\n]+codex login status/)
  assert.doesNotMatch(worker, /--with-access-token|chatgptAuthTokens|--dangerously-bypass/)
  assert.doesNotMatch(worker, /app-server\s+--listen|ws:\/\//)

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
  assert.match(service, /^LoadCredential=openai-project-key:\/root\/kelion\/secrets\/openai-project-key$/m)
  assert.doesNotMatch(service, /host\.env|kelionai\.env|OPENAI_ADMIN|openai-admin|CODEX_ACCESS_TOKEN|^Environment=.*OPENAI/m)
})

test('backendul primește admin key numai ca fișier, niciodată cache-ul Codex', () => {
  const compose = read('deploy/compose.production.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const worker = read('deploy/codex-worker.mjs')
  const parentEnv = worker.slice(worker.indexOf('function codexParentEnv()'), worker.indexOf('function sandboxSupervisorEnv()'))
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
