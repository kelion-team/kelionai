import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  contractErrors,
  cutoverRuntimeNames,
  exampleRuntimeNames,
  productionRequirements,
  runtimeContractNames,
  workflowRuntimeNames,
} from './verifica-contract-deploy.mjs'

test('extrage cerințele fail-closed din configul de producție', () => {
  const source = `required('A_SECRET'); configuredModel('A_MODEL', []); positiveInteger('A_TTL', raw, 1)`
  assert.deepEqual([...productionRequirements(source)].sort(), [
    'ADMIN_EMAIL', 'A_MODEL', 'A_SECRET', 'A_TTL', 'DATABASE_URL', 'OPENAI_API_KEY', 'OPENAI_REALTIME_MODEL', 'PUBLIC_APP_ORIGIN',
  ].sort())
})

test('contractul real backend-provision-compose este complet', () => {
  assert.deepEqual(contractErrors(), [])
})

test('contractul declară exact schema runtime și toate intrările de control ale provisioning-ului', () => {
  const contract = JSON.parse(readFileSync(new URL('../config/runtime-contract.json', import.meta.url), 'utf8'))
  const expected = [...runtimeContractNames(contract)].sort()
  assert.equal(expected.length, 86)
  assert.deepEqual([...workflowRuntimeNames()].sort(), expected)
  assert.deepEqual([...cutoverRuntimeNames()].sort(), expected)
  const example = exampleRuntimeNames()
  assert.ok(expected.every((name) => example.has(name)))
  assert.deepEqual(contract.secretFiles.GITHUB_RELEASE_OAUTH_TOKEN, {
    actionsSecret: 'RELEASE_GITHUB_TOKEN',
    file: 'github-release-oauth-token',
  })
  assert.deepEqual(contract.hostProvisionedSecretFiles.CONSTRUCTOR_GHCR_READ_TOKEN, {
    environment: 'GHCR_READ_TOKEN',
    file: 'github-ghcr-read-token',
    target: '/root/kelion/gate-secrets/github-ghcr-read-token',
  })
  assert.deepEqual(contract.workflowControlSecrets, ['VPS_SSH_KEY'])
})

test('Revolut Merchant este clasificat complet și moneda nu mai este env', () => {
  const contract = JSON.parse(readFileSync(new URL('../config/runtime-contract.json', import.meta.url), 'utf8'))
  assert.ok(contract.requiredNonSecret.includes('PAYMENT_MODE'))
  assert.ok(contract.requiredNonSecret.includes('PAYMENT_CONTRACT_VERIFIED'))
  assert.ok(contract.requiredNonSecret.includes('REVOLUT_MERCHANT_API_VERSION'))
  assert.ok(contract.requiredNonSecret.includes('REVOLUT_ORDER_EXPIRY'))
  assert.equal(contract.secretFiles.REVOLUT_MERCHANT_SECRET_KEY, 'revolut-merchant-secret-key')
  assert.equal(contract.secretFiles.REVOLUT_WEBHOOK_SIGNING_SECRET, 'revolut-webhook-signing-secret')
  for (const path of ['../backend/.env.example', '../deploy/kelionai.env.example', '../deploy/deploy.sh', '../.github/workflows/vps-set-env.yml']) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /\bBILLING_CURRENCY\b/)
  }
})

test('deploy-ul validează separat familia video Sora de modelele GPT', () => {
  const deploy = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8')
  const prVerify = readFileSync(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  const genericLoop = /for name in ([^;]+); do\n\s*\[\[ "\$\(config_value "\$name"\)" =~ \^gpt-/.exec(deploy)?.[1] ?? ''
  assert.ok(genericLoop)
  assert.doesNotMatch(genericLoop, /OPENAI_VIDEO_MODEL/)
  assert.match(deploy, /config_value OPENAI_VIDEO_MODEL\)" =~ \^sora-/)
  assert.match(prVerify, /^\s*OPENAI_VIDEO_MODEL=sora-ci-video$/m)
})

test('provisionarea runtime transportă și decodează exact fiecare valoare base64', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vps-set-env.yml', import.meta.url), 'utf8')
  assert.match(workflow, /encode\(\) \{ printf '%s:%s\\n'/)
  assert.doesNotMatch(workflow, /while IFS="=" read -r name encoded/)
  assert.match(workflow, /awk -F: -v wanted="\$name" '\$1 == wanted \{ count\+\+ \}/)
  assert.match(workflow, /substr\(\$0, index\(\$0, ":"\) \+ 1\)/)
  const cleanupArm = workflow.indexOf("systemd-run --quiet --unit='$cleanup_unit'")
  const payloadUpload = workflow.indexOf("cat > '$remote_payload'", cleanupArm)
  assert.ok(cleanupArm >= 0 && payloadUpload > cleanupArm,
    'timerul de ștergere trebuie armat într-un SSH separat înainte de upload')
  assert.match(workflow.slice(cleanupArm, payloadUpload), /systemctl is-active --quiet '\$cleanup_unit\.timer'/)
  assert.match(workflow, /\[ -f "\$payload" \] && \[ ! -L "\$payload" \]/)
  assert.match(workflow, /GITHUB_RUN_ID" =~ \^\[1-9\]\[0-9\]\*\$[\s\S]*GITHUB_RUN_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$/)
  assert.match(workflow, /runtime-cutover-bundle\.\$\{GITHUB_RUN_ID\}\.\$\{GITHUB_RUN_ATTEMPT\}\.tar\.gz/)
  assert.match(workflow, /systemd-run --quiet --unit='\$cleanup_unit' --on-active=15m \/usr\/bin\/rm -f -- '\$remote_payload'; systemctl is-active --quiet '\$cleanup_unit\.timer'/)
  assert.match(workflow, /systemctl stop "\$cleanup_unit\.timer" "\$cleanup_unit\.service"/)
  assert.match(workflow, /kelion-runtime-payload-cleanup-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/)
  assert.ok(workflow.includes("pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)"))
  assert.ok(workflow.includes("key not in {'host', 'port'} or key in query"))
  assert.ok(workflow.includes("url.hostname != 'localhost'"))
  assert.ok(workflow.includes("query.get('host') != '/var/run/postgresql'"))
  assert.doesNotMatch(workflow, /case "\$DATABASE_URL" in/)
})

test('rerunurile controlului Constructor folosesc payloaduri și unități distincte pe attempt', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vps-run.yml', import.meta.url), 'utf8')
  assert.match(workflow, /GITHUB_RUN_ID" =~ \^\[1-9\]\[0-9\]\*\$[\s\S]*GITHUB_RUN_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$/)
  assert.match(workflow, /constructor-bundle\.\$\{GITHUB_RUN_ID\}\.\$\{GITHUB_RUN_ATTEMPT\}\.tar\.gz/)
  assert.match(workflow, /constructor-payload\.\$\{GITHUB_RUN_ID\}\.\$\{GITHUB_RUN_ATTEMPT\}/)
  assert.match(workflow, /payload-cleanup-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/)
  const cleanupArm = workflow.indexOf("systemd-run --quiet --unit='$cleanup_unit'")
  const payloadUpload = workflow.indexOf("cat > '$remote_payload'", cleanupArm)
  assert.ok(cleanupArm >= 0 && payloadUpload > cleanupArm)
  assert.match(workflow.slice(cleanupArm, payloadUpload), /systemctl is-active --quiet '\$cleanup_unit\.timer'/)
  assert.match(workflow, /systemctl stop "\$cleanup_unit\.timer" "\$cleanup_unit\.service"/)
})

test('dovezile publice de deploy validează semantic readiness-ul activ', () => {
  const deploy = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const sentinel = readFileSync(new URL('../.github/workflows/sentinel.yml', import.meta.url), 'utf8')
  const e2eMonitor = readFileSync(new URL('./e2e-monitor.mjs', import.meta.url), 'utf8')

  assert.match(
    deploy,
    /live_ready=\$\(curl --fail --silent --show-error --max-time 12 "\$PRODUCT_ORIGIN\/readyz" \|\| true\)[\s\S]{0,300}jq -e '\.ready == true and \.release\.sideEffectsActive == true' <<<"\$live_ready"/,
  )
  assert.doesNotMatch(deploy, /live_ready=.*--write-out '%\{http_code\}'/)

  assert.match(
    workflow,
    /proof=\$\(curl --fail --silent --show-error --max-time 12 "\$origin\/api\/release-proof"\)[\s\S]{0,300}\.ready == true and \.release\.sideEffectsActive == true and \.activeCommit == \$expected/,
  )
  assert.doesNotMatch(workflow, /proof=.*--write-out '%\{http_code\}'/)

  assert.match(sentinel, /ready=\$\(curl --fail --silent --show-error --max-time 15 "\$PUBLIC_APP_ORIGIN\/readyz" \|\| true\)/)
  assert.match(sentinel, /jq -e '\.ready == true and \.release\.sideEffectsActive == true' <<<"\$ready"/)
  assert.match(sentinel, /\[ "\$live" = 200 \] && \[ "\$ready_active" = 1 \]/)
  assert.doesNotMatch(sentinel, /ready=.*--write-out '%\{http_code\}'.*\/readyz/)

  assert.match(e2eMonitor, /r\.body\?\.ready === true && r\.body\?\.release\?\.sideEffectsActive === true/)
  assert.match(e2eMonitor, /const fail = !r\.ok \|\| falseOk \|\| inactiveReadiness/)
})

test('semnarea și verificarea OCI folosesc sintaxa Cosign v3 pentru annotations', () => {
  const build = readFileSync(new URL('../.github/workflows/build-images.yml', import.meta.url), 'utf8')
  const deploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const semnari = build.match(/cosign sign --yes --annotations "git_sha=\$RELEASE_SHA"/g) ?? []
  const verificare = /- name: Verifică manifestul și semnăturile keyless([\s\S]*?)\n\s+- name: Release blue-green/.exec(deploy)?.[1] ?? ''

  assert.equal(semnari.length, 2)
  assert.doesNotMatch(build, /--annotation(?:\s|=)/)
  assert.match(deploy, /cosign verify[\s\S]*--annotations "git_sha=\$CANDIDATE_SHA"/)
  assert.match(verificare, /docker login ghcr\.io --username "\$GITHUB_ACTOR" --password-stdin/)
  assert.match(verificare, /trap cleanup_registry EXIT/)
  assert.match(verificare, /docker logout ghcr\.io/)
  assert.ok(verificare.indexOf('docker login ghcr.io') < verificare.indexOf('cosign verify'))
})
