import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const installer = readFileSync(
  new URL('./upgrade-private-ai-max-model.sh', import.meta.url),
  'utf8',
)
const switchHelper = readFileSync(
  new URL('../../deploy/constructor-model-switch.sh', import.meta.url),
  'utf8',
)
const unblockWorkflow = readFileSync(
  new URL('../workflows/private-ai-max-model-unblock.yml', import.meta.url),
  'utf8',
)
const constructorInstaller = readFileSync(
  new URL('../../deploy/instaleaza-constructor.sh', import.meta.url),
  'utf8',
)
const constructorUpgrade = readFileSync(
  new URL('../../deploy/upgrade-constructor.sh', import.meta.url),
  'utf8',
)
const modelController = readFileSync(
  new URL('../../deploy/constructor-model-control.mjs', import.meta.url),
  'utf8',
)

function shellFunction(source, name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(source)
  assert.ok(match, `funcția shell ${name} lipsește`)
  return match[1]
}

function ordered(source, entries) {
  let previous = -1
  for (const [label, fragment] of entries) {
    const index = source.indexOf(fragment, previous + 1)
    assert.ok(index >= 0, `${label} lipsește`)
    assert.ok(index > previous, `${label} nu este în ordinea fail-closed`)
    previous = index
  }
}

function maxModelExecStart(source, modelNeedle) {
  const lines = source
    .split('\n')
    .filter((line) => line.includes('ExecStart=') && line.includes(modelNeedle))
  assert.equal(lines.length, 1, 'trebuie să existe un singur ExecStart 122B')
  return lines[0]
}

test('122B pornește cu baseline-ul verificat, fără tunările neverificate din 9450', () => {
  const installerExec = maxModelExecStart(switchHelper, '$POWERFUL_ALIAS')
  const baseline =
    '--ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1 --jinja ' +
    `--chat-template-kwargs '{"enable_thinking":false}'`

  assert.ok(installerExec.endsWith(baseline), 'installerul nu folosește baseline-ul 122B')

  for (const flag of [
    '--batch-size',
    '--ubatch-size',
    '--load-mode',
    '--cache-ram',
    '--spec-type',
    '--no-mmproj',
  ]) {
    assert.doesNotMatch(installerExec, new RegExp(flag))
  }
})

test('llama și orchestratoarele fac o singură încercare înainte de rollback', () => {
  for (const [name, source] of [
    ['installer', installer],
    ['helper switch', switchHelper],
    ['workflow manual deblocare', unblockWorkflow],
  ]) {
    assert.doesNotMatch(source, /^\s*Restart=on-failure$/m, `${name} reintroduce restart loop`)
    assert.doesNotMatch(source, /^\s*RestartSec=/m, `${name} reintroduce restart loop`)
  }

  const installerDropin = shellFunction(switchHelper, 'expected_powerful_dropin')
  assert.match(installerDropin, /^Restart=no$/m)

  for (const source of [unblockWorkflow]) {
    const unitStart = source.indexOf('Description=Kelion private AI maximum stable model upgrade')
    const unitEnd = source.indexOf('\n          UNIT', unitStart)
    assert.ok(unitStart >= 0 && unitEnd > unitStart, 'unitatea upgrade lipsește')
    const unit = source.slice(unitStart, unitEnd)
    assert.match(unit, /^\s*Restart=no$/m)
    assert.doesNotMatch(unit, /^\s*RestartSec=/m)
  }
})

test('diagnosticul identifică etapa și starea LLM înainte de orice restaurare', () => {
  const diagnostic = shellFunction(installer, 'diagnose_failure')
  const rollback = shellFunction(installer, 'rollback')
  const redaction = shellFunction(installer, 'redact_diagnostic_stream')

  assert.match(diagnostic, /MAX_MODEL_FAILURE_STAGE/)
  assert.match(diagnostic, /MAX_MODEL_FAILURE_EXIT/)
  assert.match(diagnostic, /systemctl show private-ai-llm[.]service/)
  for (const property of [
    'ActiveState',
    'SubState',
    'Result',
    'MainPID',
    'ExecMainStatus',
    'NRestarts',
  ]) {
    assert.match(diagnostic, new RegExp(`-p ${property}`))
  }
  assert.match(diagnostic, /journalctl[\s\S]*private-ai-llm[.]service/)
  assert.match(diagnostic, /redact_diagnostic_stream/)
  assert.match(diagnostic, /llm_cutover_attempted/)
  assert.match(redaction, /Authorization/)
  assert.ok(redaction.includes('api[_-]?key'))
  assert.match(redaction, /token/)
  assert.match(redaction, /secret/)
  assert.match(redaction, /gh\[pousr\]_/)
  assert.doesNotMatch(diagnostic, /systemctl (?:cat|status)|-p Environment|printenv|\/proc\/[^\s]+\/cmdline/)

  ordered(rollback, [
    ['dezactivarea trapurilor recursive', 'trap - ERR EXIT HUP INT TERM'],
    ['diagnosticul înainte de rollback', 'diagnose_failure "$status"'],
    ['prima restaurare', '"$rollback_root/opencode.json"'],
    ['reîncărcarea systemd', 'systemctl daemon-reload'],
    ['markerul rollbackului', 'MAX_MODEL_ROLLBACK=yes'],
  ])
})

test('etapele avansează înaintea fiecărui punct de cutover riscant', () => {
  const cutover = installer.slice(installer.indexOf("set_stage 'quiesce-constructor'"))
  ordered(cutover, [
    ['quiesce', "set_stage 'quiesce-constructor'"],
    ['publicare runtime canonic', "set_stage 'publish-canonical-fast-runtime'"],
    ['verificare runtime canonic', "set_stage 'verify-canonical-fast-runtime'"],
    ['etapa de pornire 122B', "set_stage 'activate-powerful-profile'"],
    ['armarea restaurării LLM', 'llm_cutover_attempted=1'],
    ['proba de inferență', "set_stage 'probe-qwen-122b-inference'"],
    ['restaurarea explicită 35B', "set_stage 'restore-fast-profile'"],
    ['proba implicită 35B', "set_stage 'probe-qwen-35b-inference'"],
    ['dovada stării implicite', "set_stage 'verify-fast-steady-state'"],
    ['receipt-ul final', "set_stage 'write-max-model-receipt'"],
  ])
})

test('workflow-ul temporar de deblocare poate fi pornit numai manual', () => {
  assert.match(unblockWorkflow, /^on:\n\s+workflow_dispatch:\s*$/m)
  assert.doesNotMatch(unblockWorkflow, /^\s+push:\s*$/m)
  assert.match(unblockWorkflow, /^\s+ref: refs\/heads\/master$/m)
  assert.match(unblockWorkflow, /\[ "\$GITHUB_REF" = refs\/heads\/master \]/)
  assert.match(unblockWorkflow, /git rev-parse origin\/master/)
  assert.doesNotMatch(unblockWorkflow, /ops\/private-ai-install-20260830/)
  assert.match(unblockWorkflow, /^concurrency:\n\s+group: production-release\n\s+cancel-in-progress: false$/m)
})

test('workflow-ul max-model serializează restage-ul și serviciul pe același lock host', () => {
  assert.match(unblockWorkflow, /publication_lock=\/run\/lock\/private-ai-max-model-upgrade[.]lock/)
  const lock = unblockWorkflow.indexOf('exec 8<>"$publication_lock"')
  const acquired = unblockWorkflow.indexOf('flock -n 8', lock)
  const firstMutation = unblockWorkflow.indexOf('systemctl stop private-ai-max-model-upgrade.service', acquired)
  const unlock = unblockWorkflow.indexOf('flock -u 8', firstMutation)
  const start = unblockWorkflow.indexOf('systemctl start private-ai-max-model-upgrade.service', unlock)
  assert.ok(lock >= 0 && acquired > lock && firstMutation > acquired && unlock > firstMutation && start > unlock)
  assert.match(unblockWorkflow,
    /ExecStart=\/usr\/bin\/flock --exclusive --wait 0 \$publication_lock \/usr\/bin\/bash \$script/)
})

test('workflow-ul ține coada Actions până la terminarea serviciului și receiptul final', () => {
  assert.match(unblockWorkflow, /timeout-minutes: 360/)
  assert.match(unblockWorkflow, /TimeoutStartSec=20400s/)
  assert.doesNotMatch(unblockWorkflow, /systemctl start --no-block private-ai-max-model-upgrade[.]service/)
  ordered(unblockWorkflow.slice(unblockWorkflow.indexOf('systemctl reset-failed')), [
    ['start blocant', 'systemctl start private-ai-max-model-upgrade.service'],
    ['rezultat systemd', '--property=Result --value'],
    ['receipt final', '/etc/private-ai/.max-model-complete'],
    ['jurnal max retras', '/root/kelion/runtime/constructor-max-model.journal'],
    ['sentinel retras', '/run/kelion/constructor-activation.pending'],
    ['controller activ', 'systemctl is-active --quiet kelion-constructor-model-control.service'],
    ['raport terminal', 'MAX_MODEL_UPGRADE_COMPLETED=yes'],
  ])
  const controllerPreflight = unblockWorkflow.indexOf('controllerul manual trebuie instalat înainte de max-model')
  const serviceMutation = unblockWorkflow.indexOf('systemctl stop private-ai-max-model-upgrade.service')
  assert.ok(controllerPreflight >= 0 && serviceMutation > controllerPreflight)
})

test('preflightul de spațiu scade cache-ul parțial validat și păstrează headroom', () => {
  const arithmetic = shellFunction(installer, 'remaining_bytes_after_cache')
  const calculate = shellFunction(installer, 'calculate_remaining_model_bytes')
  const probe = spawnSync(
    'bash',
    ['-c', `remaining_bytes_after_cache() {\n${arithmetic}}\nremaining_bytes_after_cache 1000 400 100`],
    { encoding: 'utf8' },
  )
  assert.equal(probe.status, 0, probe.stderr)
  assert.equal(probe.stdout.trim(), '500')

  const invalid = spawnSync(
    'bash',
    ['-c', `remaining_bytes_after_cache() {\n${arithmetic}}\nremaining_bytes_after_cache 1000 800 201`],
    { encoding: 'utf8' },
  )
  assert.notEqual(invalid.status, 0)
  assert.match(calculate, /partial_size/)
  assert.match(calculate, /cached_range_bytes/)
  assert.match(calculate, /total_remaining=.*shard_remaining/)
  assert.match(installer, /required_model_free_bytes=\$\(\(remaining_model_bytes \+ RANGE_FREE_MARGIN_BYTES\)\)/)
  assert.doesNotMatch(installer, /-ge 90000000000/)
})

test('assembly shard2 nu concurează cu shard3 și un SHA invalid retrage întreg cache-ul', () => {
  const downloads = installer.slice(
    installer.indexOf('download_shard 0'),
    installer.indexOf('\nsum=0', installer.indexOf('download_shard 0')),
  )
  ordered(downloads, [
    ['shard 1', 'download_shard 0'],
    ['assembly shard 2', 'download_shard_parallel_ranges 1'],
    ['shard 3 după cleanup', 'download_shard 2'],
  ])
  assert.doesNotMatch(downloads, /download_shard(?:_parallel_ranges)? [12] &/)
  assert.doesNotMatch(downloads, /download_pids|download_status/)

  const ranged = shellFunction(installer, 'download_shard_parallel_ranges')
  const mismatch = ranged.slice(ranged.indexOf('if [ "$actual_sha" != "$sha" ]'))
  const removeRanges = mismatch.indexOf('rm -f -- "$range_path"')
  const removePrefix = mismatch.indexOf('rm -f -- "$partial"', removeRanges)
  const directorySync = mismatch.indexOf('sync -f "$MODEL_ROOT"', removePrefix)
  const failure = mismatch.indexOf("fail 'SHA-256 invalid", directorySync)
  assert.ok(removeRanges >= 0 && removePrefix > removeRanges && directorySync > removePrefix && failure > directorySync)
  assert.doesNotMatch(mismatch, /prefixul [.]part a fost păstrat/)

  const sequential = shellFunction(installer, 'download_shard')
  const sequentialMismatch = sequential.slice(sequential.indexOf('if [ "$(sha256sum'))
  ordered(sequentialMismatch, [
    ['ștergerea .part neautentificat', 'rm -f -- "$partial"'],
    ['fsync director model', 'sync -f "$MODEL_ROOT"'],
    ['eșec după retragere', 'SHA-256 invalid după descărcare; cache retras'],
  ])
})

test('max-model deține publication lock și poarta controllerului înainte de orice mutație', () => {
  const publication = shellFunction(installer, 'acquire_canonical_publication_lock')
  assert.match(publication, /exec 9<>"\$PUBLICATION_LOCK"/)
  assert.match(publication, /stat -Lc '%u:%g:%a:%h'.*0:0:600:1/)
  assert.match(publication, /flock -n 9/)

  const main = installer.slice(installer.indexOf('acquire_canonical_publication_lock \\'))
  ordered(main, [
    ['publication lock', 'acquire_canonical_publication_lock \\'],
    ['refuz conflicte', 'guard_conflicting_runtime_transactions'],
    ['jurnal persistent', "publish_max_model_journal || fail"],
    ['sentinel volatil', "publish_activation_pending || fail"],
    ['stop + drain controller', "quiesce_model_controller || fail"],
    ['revalidare conflicte', 'guard_conflicting_runtime_transactions'],
    ['prima mutație model', 'install -d -o privateai -g privateai -m 0700 "$MODEL_ROOT"'],
  ])
  const conflicts = shellFunction(installer, 'guard_conflicting_runtime_transactions')
  for (const path of [
    'constructor-deploy-quiesce.journal',
    'constructor-upgrade.journal',
    'runtime-config-cutover.journal',
    'constructor-activation.journal',
    'constructor-gate-refresh.journal',
    'constructor-unit-migration.pending',
    'destructive-cutover-recovery.json',
  ]) assert.match(conflicts, new RegExp(path.replace('.', '[.]')))
})

test('commitul max-model retrage jurnalul persistent ultimul și pornește controllerul numai după receipt', () => {
  const commit = shellFunction(installer, 'commit_max_model_gate_and_start_controller')
  ordered(commit, [
    ['validare ambele bariere', 'validate_max_model_journal && validate_activation_pending'],
    ['retragere sentinel', 'rm -f -- "$ACTIVATION_PENDING"'],
    ['restaurare ready', 'publish_runtime_ready_stamp'],
    ['commit jurnal persistent', 'rm -f -- "$MAX_MODEL_JOURNAL"'],
    ['pornire controller', 'systemctl start "$MODEL_CONTROL_UNIT"'],
  ])
  const receiptStart = installer.indexOf("set_stage 'write-max-model-receipt'")
  const commitStart = installer.indexOf('commit_max_model_gate_and_start_controller \\', receiptStart)
  assert.ok(receiptStart >= 0 && commitStart > receiptStart)

  const rollback = shellFunction(installer, 'rollback')
  ordered(rollback, [
    ['republicare jurnal', 'publish_max_model_journal'],
    ['republicare sentinel', 'publish_activation_pending'],
    ['oprire controller', 'systemctl stop "$MODEL_CONTROL_UNIT"'],
    ['diagnostic', 'diagnose_failure "$status"'],
  ])
  assert.doesNotMatch(rollback, /systemctl (?:enable|restart) kelion-codex-worker[.]timer/)
})

test('reluarea committed păstrează profilul ownerului și download failure rămâne fail-closed reluabil', () => {
  const existing = shellFunction(installer, 'validate_existing_complete_install')
  assert.match(existing, /"\$FAST_MODEL_ALIAS"\)[\s\S]*active_profile=fast/)
  assert.match(existing, /"\$MODEL_ALIAS"\)[\s\S]*active_profile=powerful/)
  assert.match(existing, /max_model_existing_active_profile=\$active_profile/)

  const receiptBranch = installer.slice(
    installer.indexOf('if [ -e "$RECEIPT" ]'),
    installer.indexOf('remaining_model_bytes=', installer.indexOf('if [ -e "$RECEIPT" ]')),
  )
  ordered(receiptBranch, [
    ['validare instalare completă', 'validate_existing_complete_install'],
    ['retragere gate + controller', 'commit_max_model_gate_and_start_controller'],
    ['raport profil curent', 'MAX_MODEL_ALREADY_INSTALLED=yes'],
    ['ieșire fără download', 'exit 0'],
  ])
  assert.doesNotMatch(receiptBranch, /download_shard|"\$SWITCH_BIN" (?:fast|powerful)/)

  const gate = installer.indexOf("publish_max_model_journal || fail")
  const firstDownload = installer.indexOf('download_shard 0', gate)
  const rollbackArmed = installer.indexOf('rollback_armed=1', firstDownload)
  const liveCutover = installer.indexOf("set_stage 'quiesce-constructor'", rollbackArmed)
  assert.ok(gate >= 0 && firstDownload > gate && rollbackArmed > firstDownload && liveCutover > rollbackArmed)
  assert.match(installer.slice(gate, firstDownload), /Eșecurile de download\/cache păstrează/)
})

test('SEALED_RECEIPT are exact schema de 9 linii fără câmpuri duplicate', () => {
  const start = installer.indexOf("printf 'schema=1\\n'", installer.indexOf('sealed_candidate='))
  const end = installer.indexOf('} > "$sealed_candidate"', start)
  assert.ok(start >= 0 && end > start)
  const sealed = installer.slice(start, end)
  assert.equal((sealed.match(/printf 'model_revision=/g) ?? []).length, 1)
  assert.equal((sealed.match(/printf 'model_quant=/g) ?? []).length, 1)
  assert.equal((sealed.match(/printf 'model_total_bytes=/g) ?? []).length, 1)
  assert.equal((installer.match(/set_stage 'probe-qwen-122b-model-list'/g) ?? []).length, 1)
  assert.match(installer, /sealed_lines\[@\]\}" -eq 9/)
})

test('receiptul schema 2 are același contract de 20 linii la producer și toți consumerii', () => {
  const receiptStart = installer.indexOf("set_stage 'write-max-model-receipt'")
  const receiptEnd = installer.indexOf('\nrollback_armed=0', receiptStart)
  assert.ok(receiptStart >= 0 && receiptEnd > receiptStart)
  const receipt = installer.slice(receiptStart, receiptEnd)
  ordered(receipt, [
    ['schema', "printf 'schema=2\\n'"],
    ['model implicit', "printf 'default_model=%s\\n'"],
    ['model puternic', "printf 'powerful_model=%s\\n'"],
    ['profil verificat', "printf 'active_profile=fast\\n'"],
    ['repo', "printf 'model_repo=%s\\n'"],
    ['revision', "printf 'model_revision=%s\\n'"],
    ['quant', "printf 'model_quant=%s\\n'"],
    ['bytes 122B', "printf 'model_total_bytes=%s\\n'"],
    ['hashuri sharduri', "printf 'shard_%s_sha256=%s\\n'"],
    ['bytes fast', "printf 'fast_model_bytes=%s\\n'"],
    ['hash fast', "printf 'fast_model_sha256=%s\\n'"],
    ['cale fast', "printf 'fast_model_path=%s\\n'"],
    ['hash installer', "printf 'installer_sha256=%s\\n'"],
    ['hash worker', "printf 'worker_source_sha256=%s\\n'"],
    ['hash config', "printf 'config_source_sha256=%s\\n'"],
    ['hash unit', "printf 'worker_unit_source_sha256=%s\\n'"],
    ['hash helper', "printf 'switch_source_sha256=%s\\n'"],
    ['timestamp', "printf 'verified_at=%s\\n'"],
  ])

  for (const [name, source] of [
    ['installer Constructor', constructorInstaller],
    ['upgrade Constructor', constructorUpgrade],
  ]) {
    const validator = shellFunction(source, 'validate_max_model_complete_receipt')
    assert.match(validator, /\[ "\$\{#lines\[@\]\}" -eq 20 \]/, `${name}: count`)
    assert.match(validator, /lines\[0\].*schema=2/, `${name}: schema`)
    assert.match(validator, /lines\[12\].*fast_model_sha256=/, `${name}: hash fast`)
    assert.match(validator, /lines\[13\].*fast_model_path=\$expected_fast_path/, `${name}: path fast`)
    assert.match(validator, /lines\[14\].*installer_sha256=/, `${name}: hashuri după path`)
    assert.match(validator, /lines\[19\].*verified_at=/, `${name}: timestamp final`)
    assert.match(validator, /realpath -e -- "\$expected_fast_path"/, `${name}: path canonic`)
  }
  assert.match(modelController, /lines\.length !== 20/)
  assert.match(modelController, /lines\[13\]\?\.startsWith\('fast_model_path='\)/)
  assert.match(modelController, /installer_sha256=.*lines\[14\]/)
  assert.match(modelController, /switch_source_sha256=.*lines\[18\]/)
  assert.match(modelController, /verified_at=.*lines\[19\]/)
})
