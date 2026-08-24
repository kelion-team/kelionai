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
