import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { esteIPv4Public } from '../../scripts/verifica-hardcodari.mjs'

const installer = readFileSync(new URL('./install-private-ai.sh', import.meta.url), 'utf8')
const repair = readFileSync(new URL('../workflows/private-ai-repair.yml', import.meta.url), 'utf8')

function shellFunction(source, name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(source)
  assert.ok(match, `funcția shell ${name} lipsește`)
  return match[1]
}

test('instrucțiunile SSH folosesc exclusiv hostul configurat și validat', () => {
  const addresses = [...installer.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)]
    .map((match) => match[0])
    .filter(esteIPv4Public)
  assert.deepEqual(addresses, [])
  assert.match(installer, /root@\$\{private_ai_access_host\}/)
  assert.match(installer, /validate_access_host\(\)/)
  assert.match(installer, /PRIVATE_AI_ACCESS_HOST is required/)
  assert.match(installer, /--resume-model ACCESS_HOST/)
  assert.match(repair, /"\$remote_upload" "\$installer_sha" "\$VPS_HOST"/)
  assert.match(repair, /access_host=\$3/)
  assert.match(repair, /--resume-model \$access_host/)
  assert.doesNotMatch(repair, /--resume-model\s*\n/)
})

test('repair-ul bootstrap refuză fail-closed orice instalare Constructor existentă', () => {
  const guard = repair.slice(
    repair.indexOf('constructor_artifacts=('),
    repair.indexOf('state=$(systemctl show private-ai-install-resume.service', repair.indexOf('constructor_artifacts=(')),
  )
  for (const artifact of [
    'kelion-constructor-model-control.service',
    '/opt/kelion-constructor/constructor-model-control.mjs',
    '/opt/kelion-codex/codex-worker.mjs',
    '/root/kelion/config/codex-worker.env',
    'constructor-deploy-quiesce.journal',
    'constructor-upgrade.journal',
    'constructor-max-model.journal',
    'constructor-reactivation.journal',
    '/run/kelion/constructor-activation.pending',
  ]) assert.match(guard, new RegExp(artifact.replaceAll('.', '[.]')))
  assert.match(guard, /\[ ! -e "\$constructor_artifact" \] && \[ ! -L "\$constructor_artifact" \]/)
  assert.match(guard, /systemctl cat kelion-constructor-model-control[.]service/)
  assert.match(guard, /CONSTRUCTOR_INSTALLED_REPAIR_REFUSED/)
  assert.ok(repair.indexOf('constructor_artifacts=(') < repair.indexOf('systemctl stop private-ai-install-resume.service'))
})

test('installerul revalidează absența Constructorului sub lockul canonic pe toată mutația', () => {
  const acquire = shellFunction(installer, 'acquire_publication_lock')
  const verify = shellFunction(installer, 'verify_publication_lock_fd')
  const guard = shellFunction(installer, 'guard_constructor_absent_under_publication_lock')
  const main = shellFunction(installer, 'main')
  const resume = shellFunction(installer, 'resume_model_install')

  assert.match(installer, /readonly PUBLICATION_LOCK="\$\{KELION_ROOT\}\/publicare[.]lock"/)
  assert.match(acquire, /inherited=\$\{KELION_CUTOVER_LOCK_HELD:-0\}/)
  assert.match(acquire, /verify_publication_lock_fd[\s\S]*flock -n 9[\s\S]*verify_publication_lock_fd[\s\S]*publication_lock_held=1/)
  assert.match(acquire, /exec 9<>"\$PUBLICATION_LOCK"/)
  assert.match(acquire, /stat -Lc '%h' \/proc\/\$\$\/fd\/9/)
  assert.match(acquire, /fd_identity[\s\S]*stat -Lc '%d:%i' "\$PUBLICATION_LOCK"/)
  assert.match(verify, /stat -Lc '%u:%g:%a:%h' \/proc\/\$\$\/fd\/9[\s\S]*0:0:600:1/)
  assert.match(verify, /\[ ! -L "\$PUBLICATION_LOCK" \]/)
  assert.doesNotMatch(installer, /exec 9>&-/)

  for (const artifact of [
    '/etc/systemd/system/kelion-constructor-model-control.service',
    '/opt/kelion-constructor/constructor-model-control.mjs',
    '/opt/kelion-codex/codex-worker.mjs',
    '/root/kelion/config/codex-worker.env',
    'constructor-deploy-quiesce.journal',
    'constructor-upgrade.journal',
    'constructor-max-model.journal',
    'constructor-reactivation.journal',
    '/run/kelion/constructor-activation.pending',
  ]) assert.match(guard, new RegExp(artifact.replaceAll('.', '[.]')))
  assert.match(guard, /publication_lock_held[\s\S]*verify_publication_lock_fd/)
  assert.match(guard, /\[ -e "\$constructor_artifact" \] \|\| \[ -L "\$constructor_artifact" \]/)
  assert.match(guard, /systemctl cat kelion-constructor-model-control[.]service/)
  assert.match(guard, /CONSTRUCTOR_INSTALLED_REPAIR_REFUSED/)

  for (const entrypoint of [main, resume]) {
    const acquireAt = entrypoint.indexOf('acquire_publication_lock')
    const guardAt = entrypoint.indexOf('guard_constructor_absent_under_publication_lock')
    assert.ok(acquireAt >= 0 && acquireAt < guardAt)
  }
  assert.ok(main.indexOf('guard_constructor_absent_under_publication_lock') < main.indexOf('install_packages'))
  assert.ok(resume.indexOf('guard_constructor_absent_under_publication_lock') < resume.indexOf('rm -f -- "$PRIVATE_AI_COMPLETE"'))
})

test('validatorul hostului acceptă hostname/IPv4 și refuză argumente interpretabile', () => {
  const body = shellFunction(installer, 'validate_access_host')
  const probe = (host) => spawnSync('bash', ['-c', `
    fail() { exit 64; }
    validate_access_host() {
${body}
    }
    private_ai_access_host=$1
    validate_access_host
  `, 'validate-access-host', host], { encoding: 'utf8' })

  for (const host of ['164.68.120.87', 'vps.example.com', 'vps-01']) {
    assert.equal(probe(host).status, 0, host)
  }
  for (const host of ['', '-oProxyCommand=id', 'vps..example.com', 'vps.example.com:22', 'a'.repeat(254), 'bad\nhost']) {
    assert.equal(probe(host).status, 64, JSON.stringify(host))
  }
})
