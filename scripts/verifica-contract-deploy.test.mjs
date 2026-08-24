import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contractErrors, productionRequirements } from './verifica-contract-deploy.mjs'

test('extrage cerințele fail-closed din configul de producție', () => {
  const source = `required('A_SECRET'); configuredModel('A_MODEL', []); positiveInteger('A_TTL', raw, 1)`
  assert.deepEqual([...productionRequirements(source)].sort(), [
    'ADMIN_EMAIL', 'A_MODEL', 'A_SECRET', 'A_TTL', 'DATABASE_URL', 'OPENAI_API_KEY', 'OPENAI_REALTIME_MODEL', 'PUBLIC_APP_ORIGIN',
  ].sort())
})

test('contractul real backend-provision-compose este complet', () => {
  assert.deepEqual(contractErrors(), [])
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
    /readiness=\$\(curl --fail --silent --show-error --max-time 12 "\$origin\/readyz"\)[\s\S]{0,200}jq -e '\.ready == true and \.release\.sideEffectsActive == true' <<<"\$readiness"/,
  )
  assert.doesNotMatch(workflow, /readiness=.*--write-out '%\{http_code\}'/)

  assert.match(sentinel, /ready=\$\(curl --fail --silent --show-error --max-time 15 "\$PUBLIC_APP_ORIGIN\/readyz" \|\| true\)/)
  assert.match(sentinel, /jq -e '\.ready == true and \.release\.sideEffectsActive == true' <<<"\$ready"/)
  assert.match(sentinel, /\[ "\$live" = 200 \] && \[ "\$ready_active" = 1 \]/)
  assert.doesNotMatch(sentinel, /ready=.*--write-out '%\{http_code\}'.*\/readyz/)

  assert.match(e2eMonitor, /r\.body\?\.ready === true && r\.body\?\.release\?\.sideEffectsActive === true/)
  assert.match(e2eMonitor, /const fail = !r\.ok \|\| falseOk \|\| inactiveReadiness/)
})
