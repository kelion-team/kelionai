import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('PR verification checks the actual pull-request head and runs release-train tests', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.match(workflow, /scripts\/release-train-preflight\.test\.mjs/)
  assert.match(workflow, /scripts\/release-train-workflow\.test\.mjs/)
})

test('every static gate invokes both release-train regression suites', async () => {
  for (const path of ['../deploy/gates/run-gates.sh', '../deploy/porti-pr.sh']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /scripts\/release-train-preflight\.test\.mjs/, path)
    assert.match(source, /scripts\/release-train-workflow\.test\.mjs/, path)
  }
})
