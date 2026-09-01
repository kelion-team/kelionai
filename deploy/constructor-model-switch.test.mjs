import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./constructor-model-switch.sh', import.meta.url), 'utf8')

function shellFunction(name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(source)
  assert.ok(match, `funcția ${name} lipsește`)
  return match[1]
}

test('comutatorul acceptă numai fast și powerful și serializează schimbarea', () => {
  assert.match(source, /case "\$profile" in[\s\S]*"\$FAST_PROFILE"\|"\$POWERFUL_PROFILE"/)
  assert.match(source, /profil necunoscut; sunt permise numai fast și powerful/)
  assert.match(source, /readonly LOCK_FILE='\/run\/lock\/private-ai-model-switch[.]lock'/)
  assert.match(source, /flock -w 3600 9/)
  assert.match(source, /--prepare-lock/)
  assert.match(shellFunction('prepare_lock_file'), /root:privateai:660:1/)
  assert.equal(statSync(new URL('./constructor-model-switch.sh', import.meta.url)).mode & 0o111, 0o111)
})

test('122B este un override runtime exclusiv și rebootul revine la baza 35B', () => {
  const powerful = shellFunction('activate_powerful')
  assert.match(source, /readonly RUNTIME_DROPIN_DIR='\/run\/systemd\/system\/private-ai-llm[.]service[.]d'/)
  assert.match(source, /readonly LEGACY_DROPIN='\/etc\/systemd\/system\/private-ai-llm[.]service[.]d\/90-qwen35-122b-max[.]conf'/)
  assert.match(powerful, /systemctl stop "\$WEB_UNIT"/)
  assert.match(powerful, /expected_powerful_dropin > "\$candidate"/)
  assert.match(powerful, /systemctl restart "\$LLAMA_UNIT"/)
  assert.match(powerful, /wait_for_alias "\$POWERFUL_ALIAS" 3600/)
  assert.match(powerful, /\/proc\/\$pid\/maps/)
  assert.doesNotMatch(powerful, /systemctl (?:start|restart) "\$WEB_UNIT"/)

  const dropin = shellFunction('expected_powerful_dropin')
  assert.match(dropin, /--model \$POWERFUL_ROOT\/\$POWERFUL_FIRST/)
  assert.match(dropin, /--alias \$POWERFUL_ALIAS/)
  assert.match(dropin, /--host 127[.]0[.]0[.]1 --port 24080/)
  assert.match(dropin, /^Restart=no$/m)
  for (const forbidden of ['--batch-size', '--ubatch-size', '--load-mode', '--cache-ram', '--spec-type', '--no-mmproj']) {
    assert.doesNotMatch(dropin, new RegExp(forbidden))
  }
})

test('powerful este permis numai după receiptul final schema 2 complet', () => {
  const verify = shellFunction('verify_final_receipt')
  const artifacts = shellFunction('verify_powerful_artifacts')
  assert.match(artifacts, /^  verify_final_receipt$/m)
  assert.match(verify, /"\$\{#lines\[@\]\}" -eq 20/)
  assert.match(verify, /"\$\{lines\[0\]\}" = 'schema=2'/)
  assert.match(verify, /"\$\{lines\[13\]\}" =~ \^fast_model_path=\/srv\/private-ai\/models\//)
  assert.match(verify, /"\$\{lines\[19\]\}" =~ \^verified_at=/)
})

test('orice eșec powerful încearcă restaurarea fast înainte de ieșire', () => {
  const powerful = shellFunction('activate_powerful')
  const rollback = shellFunction('rollback_to_fast')
  assert.match(powerful, /trap 'rollback_to_fast \$[?]' ERR EXIT/)
  assert.match(powerful, /trap 'rollback_to_fast 129' HUP/)
  assert.match(powerful, /trap 'rollback_to_fast 130' INT/)
  assert.match(powerful, /trap 'rollback_to_fast 143' TERM/)
  assert.match(rollback, /activate_fast/)
  assert.match(rollback, /POWERFUL_ROLLBACK=passed DEFAULT=fast/)

  const fast = shellFunction('activate_fast')
  assert.match(fast, /rm -f -- "\$RUNTIME_DROPIN" "\$LEGACY_DROPIN"/)
  assert.match(fast, /wait_for_alias "\$FAST_ALIAS" 1800/)
  assert.match(fast, /ensure_web_active/)
  assert.match(fast, /publish_state "\$FAST_PROFILE" "\$FAST_ALIAS"/)
})

test('comutatorul nu conține provider cloud, chei sau listener public', () => {
  const retiredProvider = ['ANTH', 'ROPIC'].join('')
  assert.doesNotMatch(source, new RegExp(`OPENAI|${retiredProvider}|api[_-]?key|sk-proj-|Authorization:`, 'i'))
  assert.doesNotMatch(source, /0[.]0[.]0[.]0:24080|--host 0[.]0[.]0[.]0/)
  assert.doesNotMatch(source, /https?:\/\/(?!127[.]0[.]0[.]1)/)
})
