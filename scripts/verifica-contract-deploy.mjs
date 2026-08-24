#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(REPO, path), 'utf8')
const contract = JSON.parse(read('config/runtime-contract.json'))

function setOf(values) {
  return new Set(values.map(String))
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function productionRequirements(source = read('backend/src/config.ts')) {
  const names = new Set(['ADMIN_EMAIL', 'PUBLIC_APP_ORIGIN', 'OPENAI_REALTIME_MODEL'])
  for (const regex of [
    /required\(\s*'([A-Z][A-Z0-9_]*)'/g,
    /configuredModel\(\s*'([A-Z][A-Z0-9_]*)'/g,
    /positiveInteger\(\s*'([A-Z][A-Z0-9_]*)'/g,
  ]) {
    for (const match of source.matchAll(regex)) names.add(match[1])
  }
  names.add('DATABASE_URL')
  names.add('OPENAI_API_KEY')
  return names
}

export function contractErrors() {
  const errors = []
  const workflow = read('.github/workflows/vps-set-env.yml')
  const compose = read('deploy/compose.production.yml')
  const example = read('deploy/kelionai.env.example')
  const backendExample = read('backend/.env.example')
  const deploy = read('deploy/deploy.sh')
  const prVerify = read('.github/workflows/pr-verify.yml')
  const requiredNonSecret = setOf(contract.requiredNonSecret)
  const secretFiles = new Map(Object.entries(contract.secretFiles))
  const hostOnly = new Map(Object.entries(contract.hostOnlySecretFiles))
  const covered = new Set([...requiredNonSecret, ...secretFiles.keys()])

  for (const name of productionRequirements()) {
    if (!covered.has(name)) errors.push(`cerință backend neclasificată: ${name}`)
  }
  for (const name of requiredNonSecret) {
    if (!workflow.includes(`${name}: \${{ vars.`)) errors.push(`workflow nu citește variabila: ${name}`)
    if (!new RegExp(`['\"]${name}=`).test(workflow)) errors.push(`workflow nu scrie configul: ${name}`)
    if (!new RegExp(`^${name}=`, 'm').test(example)) errors.push(`exemplul runtime omite: ${name}`)
    if (!new RegExp(`\\b${name}\\b`).test(deploy)) errors.push(`deployerul nu validează/allowlistează: ${name}`)
    if (!new RegExp(`^\\s*${name}=`, 'm').test(prVerify)) errors.push(`proba de container CI omite: ${name}`)
  }
  for (const [name, file] of secretFiles) {
    if (!workflow.includes(`encode ${file} \"$${name}\"`)) errors.push(`workflow nu provision-ează secretul: ${name}`)
    if (!compose.includes(`/run/secrets/${file}`)) errors.push(`compose nu montează secretul: ${name}`)
    if (!compose.includes(`${name}_FILE: /run/secrets/${file}`)) errors.push(`compose nu setează ${name}_FILE`)
    if (!prVerify.includes(file)) errors.push(`proba de container CI omite secret-file: ${file}`)
    const readOnlyMount = new RegExp(
      `source:\\s*[^\\n]*/${escapeRegex(file)}\\s*\\n\\s*target:\\s*/run/secrets/${escapeRegex(file)}\\s*\\n\\s*read_only:\\s*true`,
    )
    if (!readOnlyMount.test(compose)) errors.push(`compose nu montează read-only secretul: ${name}`)
  }
  for (const [_name, file] of hostOnly) {
    if (!workflow.includes(`/root/kelion/secrets/${file}`)) errors.push(`workflow nu creează secretul host-only: ${file}`)
    if (compose.includes(`/run/secrets/${file}`)) errors.push(`secret host-only expus aplicației: ${file}`)
  }
  if (!compose.includes('${KELION_CONFIG_FILE:?') || compose.includes('kelionai.env')) {
    errors.push('compose nu cere config runtime dedicat fail-closed')
  }
  if (!workflow.includes('/root/kelion/config/runtime.env')) errors.push('workflow nu scrie configul dedicat')
  if (/toJSON\(secrets\)|OPENAI_ADMIN_KEY|kelionai\.env/.test(workflow)) errors.push('workflow conține secret bulk/admin sau env legacy')
  if (![workflow, compose, example, backendExample, deploy, prVerify].every((source) => !/\bBILLING_CURRENCY\b/.test(source))) {
    errors.push('BILLING_CURRENCY este configurație stale; moneda vine numai din politica versionată')
  }
  if (!workflow.includes("REVOLUT_MERCHANT_API_VERSION || '2026-04-20'")) {
    errors.push('workflow nu fixează versiunea Merchant API implicită')
  }
  if (!workflow.includes('disabled-placeholder-$(openssl rand -hex 32)')) {
    errors.push('workflow nu generează placeholder sigur când plățile sunt dezactivate')
  }
  if (!/sandbox\|production[\s\S]*PAYMENT_CONTRACT_VERIFIED[\s\S]*REVOLUT_MERCHANT_SECRET_KEY/.test(workflow)) {
    errors.push('workflow nu validează fail-closed activarea Revolut Merchant')
  }
  if (!/payment_mode[\s\S]*sandbox\|production[\s\S]*payment_contract_verified/.test(deploy)) {
    errors.push('deployerul nu validează modul și contractul Revolut Merchant')
  }
  return errors
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const errors = contractErrors()
  if (errors.length) {
    process.stderr.write(`Contract deploy invalid (${errors.length}):\n- ${errors.join('\n- ')}\n`)
    process.exit(1)
  }
  process.stdout.write('Contract deploy: config backend, provision, compose și secret files sunt aliniate.\n')
}
