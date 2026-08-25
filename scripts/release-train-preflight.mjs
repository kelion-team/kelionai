#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_PATH = resolve(ROOT, 'config/release-train-policy.json')
const REQUIRED = [
  'clean-worktree',
  'base-is-current-master',
  'whitespace',
  'backend-typecheck',
  'backend-test',
  'frontend-build',
  'frontend-lint',
  'static-gates',
]

function git(args, run = execFileSync) {
  return run('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function policyErrors(policy) {
  const errors = []
  if (!policy || policy.schema !== 1) errors.push('schema release-train invalidă')
  if (policy?.baseBranch !== 'master') errors.push('release train trebuie să țintească master')
  if (policy?.mergeStrategy !== 'rebase') errors.push('release train cere mergeStrategy=rebase pentru a evita CI duplicat')
  if (policy?.fullGate !== 'pr-verify / container-isolation') errors.push('poarta completă obligatorie lipsește')
  if (!Array.isArray(policy?.requiredPreflight) || REQUIRED.some((step) => !policy.requiredPreflight.includes(step))) {
    errors.push('preflightul nu conține toate porțile obligatorii')
  }
  return errors
}

export function releaseTrainErrors({ policy, status, mergeBase, targetHead, whitespace }) {
  const errors = policyErrors(policy)
  if (status) errors.push('worktree murdar: finalizează sau elimină schimbările înainte de preflight')
  if (mergeBase !== targetHead) errors.push('ramura nu pornește din ultimul master; actualizeaz-o o singură dată înainte de CI complet')
  if (whitespace) errors.push('git diff --check a găsit erori de spațiere')
  return errors
}

export function inspectReleaseTrain(run = execFileSync) {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  const base = `origin/${policy.baseBranch}`
  const status = git(['status', '--porcelain'], run)
  const mergeBase = git(['merge-base', 'HEAD', base], run)
  const targetHead = git(['rev-parse', base], run)
  let whitespace = ''
  try {
    whitespace = git(['diff', '--check', `${base}...HEAD`], run)
  } catch (error) {
    whitespace = String(error.stderr ?? error.message).trim() || 'git diff --check a eșuat'
  }
  return releaseTrainErrors({ policy, status, mergeBase, targetHead, whitespace })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const errors = inspectReleaseTrain()
  if (errors.length) {
    process.stderr.write(`Release train preflight blocat (${errors.length}):\n- ${errors.join('\n- ')}\n`)
    process.exit(1)
  }
  process.stdout.write('Release train preflight: ramură curată din masterul curent; pregătită pentru o singură poartă CI completă.\n')
}
