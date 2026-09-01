import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('./benchmark-active-model.py', import.meta.url), 'utf8')
const workflow = readFileSync(
  new URL('../workflows/private-ai-active-model-benchmark.yml', import.meta.url),
  'utf8',
)
const productionWorkflows = [
  'private-ai-active-model-benchmark.yml',
  'private-ai-finalize.yml',
  'private-ai-repair.yml',
  'private-ai-status-proof.yml',
].map((name) => [name, readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8')])
const mutatingWorkflows = [
  'private-ai-finalize.yml',
  'private-ai-repair.yml',
  'private-ai-max-model-unblock.yml',
].map((name) => [name, readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8')])

test('workflow-urile private AI cu acces la producție acceptă numai dispatch manual de pe masterul canonic', () => {
  for (const [name, source] of productionWorkflows) {
    assert.match(source, /^on:\n\s+workflow_dispatch:\s*$/m, `${name}: dispatch manual`)
    assert.doesNotMatch(source, /^\s+push:\s*$/m, `${name}: push interzis`)
    assert.doesNotMatch(source, /ops\/private-ai-install-20260830/, `${name}: ramură operațională retrasă`)
    assert.match(source, /^\s+ref: refs\/heads\/master$/m, `${name}: checkout master`)
    assert.match(source, /\[ "\$GITHUB_REF" = refs\/heads\/master \]/, `${name}: guard ref`)
    assert.match(source, /\[ "\$GITHUB_REF_NAME" = master \]/, `${name}: guard ref_name`)
    assert.match(source, /git rev-parse origin\/master/, `${name}: commit canonic`)
  }
})

test('toate workflow-urile private AI care mută Contabo folosesc aceeași coadă de producție', () => {
  for (const [name, source] of mutatingWorkflows) {
    assert.match(source, /^concurrency:\n\s+group: production-release\n\s+cancel-in-progress: false$/m, name)
    assert.doesNotMatch(source, /group: private-ai-(?:constructor-finalize|install-repair)/, name)
  }
})

test('benchmarkul măsoară modelul activ fără mutații de serviciu sau fișiere', () => {
  assert.match(script, /API_HOST = "127\.0\.0\.1"/)
  assert.match(script, /COMPLETION_PATH = "\/completion"/)
  assert.match(script, /WARMUP_COUNT = 1/)
  assert.match(script, /SAMPLE_COUNT = 3/)
  assert.match(script, /"stream": True/)
  assert.match(script, /"timings": timings/)
  assert.match(script, /"generated_content_recorded": False/)
  assert.match(script, /range\(1, SAMPLE_COUNT \+ 1\)/)
  assert.doesNotMatch(script, /systemctl\("(?:start|stop|restart|reload|enable|disable|mask|unmask|daemon-reload)"/)
  assert.doesNotMatch(script, /\b(?:unlink|remove|rmdir|mkdir|makedirs|rename|replace)\s*\(/)
  assert.doesNotMatch(script, /\bopen\([^\n]+["'](?:a|w|x)\b/)
  assert.doesNotMatch(script, /https?:\/\/[A-Za-z0-9.-]+/)
})

test('workflowul folosește SSH-ul existent, host key fixat și publică dovada măsurată', () => {
  assert.match(workflow, /VPS_HOST: \$\{\{ vars\.VPS_HOST \}\}/)
  assert.match(workflow, /VPS_HOST_KEY: \$\{\{ vars\.VPS_HOST_KEY \}\}/)
  assert.match(workflow, /SSH_KEY: \$\{\{ secrets\.VPS_SSH_KEY \}\}/)
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  assert.match(workflow, /python3 - < \.github\/private-ai\/benchmark-active-model\.py/)
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(workflow, /private-ai-active-model-benchmark\.json/)
  assert.doesNotMatch(workflow, /\bscp\b/)
  assert.doesNotMatch(workflow, /systemctl\s+(?:start|stop|restart|reload|enable|disable|mask|unmask)/)
})
