import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { policyErrors, releaseTrainErrors } from './release-train-preflight.mjs'

const policy = {
  schema: 1,
  baseBranch: 'master',
  mergeStrategy: 'rebase',
  fullGate: 'pr-verify / container-isolation',
  requiredPreflight: ['clean-worktree', 'base-is-current-master', 'whitespace', 'backend-typecheck', 'backend-test', 'frontend-build', 'frontend-lint', 'static-gates'],
}

test('acceptă un release train curat, bazat pe masterul curent', () => {
  assert.deepEqual(releaseTrainErrors({ policy, status: '', mergeBase: 'a'.repeat(40), targetHead: 'a'.repeat(40), whitespace: '' }), [])
})

test('blochează ramura stale înainte de CI-ul complet', () => {
  const errors = releaseTrainErrors({ policy, status: '', mergeBase: 'a'.repeat(40), targetHead: 'b'.repeat(40), whitespace: '' })
  assert.ok(errors.some((error) => error.includes('ultimul master')))
})

test('politica nu poate slăbi poarta completă sau strategia rebase', () => {
  const errors = policyErrors({ ...policy, mergeStrategy: 'merge', fullGate: 'lint', requiredPreflight: [] })
  assert.ok(errors.some((error) => error.includes('mergeStrategy=rebase')))
  assert.ok(errors.some((error) => error.includes('poarta completă')))
  assert.ok(errors.some((error) => error.includes('preflightul')))
})

test('CI blochează verificarea completă în spatele preflightului release train', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  assert.match(workflow, /merge_group:\s*\n\s+branches: \[master\]/)
  assert.match(workflow, /release-train-preflight:[\s\S]*node scripts\/release-train-preflight\.mjs/)
  assert.match(workflow, /verify:\s*\n\s+needs: release-train-preflight/)
})
