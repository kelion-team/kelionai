import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const finalizer = readFileSync(
  new URL('./finalize-private-ai-constructor.sh', import.meta.url),
  'utf8',
)
const runtimeCutover = readFileSync(
  new URL('../../deploy/lib/runtime-config-cutover.sh', import.meta.url),
  'utf8',
)

function shellFunction(name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(finalizer)
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

test('repair-ul acceptă numai incidentul runtime committed cu exact cele trei gate-uri', () => {
  const repair = shellFunction('repair_stale_committed_gate_journal')

  assert.match(repair, /runtime-config-cutover[.]journal/)
  assert.match(repair, /root:root:600|0:0:600/)
  assert.match(repair, /[.]schema == 1/)
  assert.match(repair, /[.]phase == "committed"/)
  assert.match(repair, /runtime-config-txn/)
  assert.match(repair, /root:root:700|0:0:700/)
  assert.match(repair, /rollback-manifest/)

  for (const logical of [
    'constructor-config.codex-worker.env',
    'constructor-config.constructor-publisher.env',
    'constructor-config.constructor-release.env',
  ]) {
    assert.match(repair, new RegExp(logical.replaceAll('.', '[.]')))
  }

  assert.match(
    repair,
    /manifest[\s\S]*exact|exact[\s\S]*manifest|unexpected[\s\S]*logical|logical[\s\S]*unexpected|manifest[\s\S]*nepermis/i,
    'manifestul trebuie restrâns explicit la allowlist-ul celor trei gate-uri',
  )
  assert.match(
    repair,
    /cmp -s --[^\n]*(?:backup|backups)[^\n]*|cmp -s --[^\n]*(?:WORKER_ENV|PUBLISHER_ENV|RELEASE_ENV)[^\n]*/,
    'live-ul trebuie dovedit byte-for-byte față de generația autentificată',
  )
  assert.match(
    repair,
    /cmp -s -- "\$target" "\$backup" \|\| cmp -s -- "\$target" "\$candidate"/,
    'retry-ul trebuie să accepte fiecare rename deja ajuns exact în forward',
  )
})

test('repair-ul validează toți candidații înaintea primei publicări atomice', () => {
  const repair = shellFunction('repair_stale_committed_gate_journal')
  const validation = repair.indexOf('--validate-env-file')
  const firstRename = repair.indexOf('mv -f --')

  assert.ok(validation >= 0, 'validarea semantică prin helper lipsește')
  assert.ok(firstRename > validation, 'un fișier live este publicat înaintea validării')
  assert.match(repair, /KELION_CODEX_GATE_IMAGE/)
  assert.match(repair, /EXPECTED_GATE_IMAGE/)
  assert.match(repair, /sync -f/)
  assert.match(repair, /cmp -s --/)
  assert.match(
    repair,
    /if \[ "\$index" -lt 2 \]; then\s+\[ "\$\(grep -c '\^KELION_CODEX_GATE_IMAGE='/,
    'gate field este permis numai în worker/publisher; validatorul release îl interzice',
  )

  const beforeMutation = repair.slice(0, firstRename)
  for (const logical of [
    'constructor-config.codex-worker.env',
    'constructor-config.constructor-publisher.env',
    'constructor-config.constructor-release.env',
  ]) {
    assert.match(
      beforeMutation,
      new RegExp(`--validate-env-file[\\s\\S]*${logical.replaceAll('.', '[.]')}|${logical.replaceAll('.', '[.]')}[\\s\\S]*--validate-env-file`),
      `${logical} nu este acoperit de validarea pre-mutație`,
    )
  }
})

test('journalul committed este consumat quiesced înainte de rebasarea rollbackului', () => {
  const repair = shellFunction('repair_stale_committed_gate_journal')

  assert.match(
    repair,
    /--recover-only[\s\\]*\n?[\s\S]*--leave-constructor-quiesced/,
    'recovery-ul generic trebuie apelat explicit în modul quiesced',
  )
  assert.doesNotMatch(
    repair.slice(0, repair.indexOf('--recover-only')),
    /rm -f --[^\n]*(?:runtime[_-]journal|RUNTIME_JOURNAL|JOURNAL)/,
    'repair-ul nu are voie să șteargă singur journalul committed',
  )

  ordered(repair, [
    ['recovery-ul generic', '--recover-only'],
    ['dovada consumării journalului', 'recovered runtime journal was not consumed'],
    ['rebasarea worker_env', 'worker_env'],
    ['rebasarea publisher_env', 'publisher_env'],
    ['rebasarea release_env', 'release_env'],
    ['markerul final al repair-ului', 'STALE_RUNTIME_COMMITTED_GATE_REPAIRED=yes'],
  ])
})

test('repair-ul rulează înaintea cutover-ului gate normal', () => {
  const definition = finalizer.indexOf('repair_stale_committed_gate_journal() {')
  const invocation = finalizer.indexOf('\nrepair_stale_committed_gate_journal\n', definition)
  const normalStage = finalizer.indexOf('\ngate_cutover_stage=$(mktemp -d', invocation)
  const normalCutover = finalizer.indexOf(
    '"$gate_cutover_stage" "$COMPOSE_SOURCE" --leave-constructor-quiesced',
    normalStage,
  )

  assert.ok(definition >= 0 && invocation > definition, 'repair-ul nu este invocat')
  assert.ok(normalStage > invocation, 'staging-ul normal începe înainte de repair')
  assert.ok(normalCutover > normalStage, 'cutover-ul normal nu urmează staging-ului')
})

test('unitatea de recovery rămâne enabled pentru validatorul ambelor cutover-uri', () => {
  const repair = shellFunction('repair_stale_committed_gate_journal')
  const repairRecovery = repair.indexOf('--recover-only')
  const recoveryReset = finalizer.indexOf('systemctl reset-failed kelion-runtime-config-recovery.service')
  const recoverySnapshot = finalizer.indexOf(
    'RECOVERY_SERVICE_STATE=$(unit_state kelion-runtime-config-recovery.service)',
  )
  const normalCutover = finalizer.indexOf(
    '"$gate_cutover_stage" "$COMPOSE_SOURCE" --leave-constructor-quiesced',
  )

  assert.ok(
    recoveryReset >= 0 && recoverySnapshot > recoveryReset,
    'starea failed trebuie normalizată înainte de snapshotul folosit la rollback',
  )
  assert.match(
    finalizer.slice(Math.max(0, recoveryReset - 200), recoverySnapshot),
    /enabled:failed[\s\S]*systemctl reset-failed[\s\S]*enabled:inactive/,
  )
  assert.doesNotMatch(
    finalizer,
    /systemctl disable[^\n]*kelion-runtime-config-recovery[.]service/,
    'runtime-config-cutover validează explicit că unitatea de recovery este enabled',
  )
  assert.doesNotMatch(
    finalizer,
    /systemctl stop[^\n]*kelion-runtime-config-recovery[.]service/,
    'oprirea unui recovery active ar face rollbackul să îl pornească sub lockul FD9',
  )
  assert.match(
    repair.slice(0, repairRecovery),
    /systemctl is-enabled --quiet ["']?kelion-runtime-config-recovery[.]service/,
    'repair-ul trebuie să dovedească unitatea enabled înainte de recover-only',
  )
  assert.ok(normalCutover >= 0, 'apelul cutover normal lipsește')
  const normalPrelude = finalizer.slice(Math.max(0, normalCutover - 1200), normalCutover)
  assert.match(
    normalPrelude,
    /systemctl is-enabled --quiet ["']?kelion-runtime-config-recovery[.]service/,
    'cutover-ul normal trebuie să dovedească unitatea enabled',
  )
})

test('helperul persistent fail-closed este comis durabil înainte de repair', () => {
  const installHelper = shellFunction('install_persistent_runtime_helper')
  const helperInstall = finalizer.indexOf('\ninstall_persistent_runtime_helper\n')
  const repair = finalizer.indexOf('\nrepair_stale_committed_gate_journal\n')

  assert.ok(helperInstall >= 0 && repair > helperInstall)
  assert.match(finalizer, /snapshot_file runtime_cutover_helper "\$RUNTIME_CUTOVER_TARGET"/)
  assert.match(finalizer, /restore_file runtime_cutover_helper "\$RUNTIME_CUTOVER_TARGET"/)
  for (const predecessor of [
    'db72ef1d9c92660adfb656330efb4e651c16d0439643c7fd944c2dd56ee1c9de',
    'ce136f70aa3c9672f14916055644b1e0eedf9a95944bb30066689dcaa68c318e',
    '4730d9f189770fafd23b4dec1807e889a62bbe357fc8e8b3f153e216bf71eaad',
    '9911772ecf8507ead236255d6b1d342ce855f478ed80c73d0ec2019e16ccb153',
  ]) {
    assert.match(finalizer, new RegExp(predecessor))
  }
  ordered(installHelper, [
    ['validarea sursei', 'bash -n'],
    ['fsync candidat', 'sync -f "$runtime_helper_candidate"'],
    ['rename helper', 'mv -f --'],
    ['fsync helper live', 'sync -f "$RUNTIME_CUTOVER_TARGET"'],
    ['dovada bytes live', 'cmp -s --'],
  ])
})

test('rollbackul tratează atomic țintele absente și artefactele legacy', () => {
  const restore = shellFunction('restore_file')
  const restoreLegacy = shellFunction('restore_legacy_path')

  assert.match(
    restore,
    /\[ ! -L "\$parent" \] && \{ \[ ! -e "\$parent" \] \|\| \[ -d "\$parent" \]; \}/,
    'un părinte deja absent nu trebuie raportat ca rollback incomplet',
  )
  assert.match(restore, /mv -f -- "\$candidate" "\$target"/)
  assert.match(restore, /sync -f "\$parent"/)
  assert.doesNotMatch(
    restoreLegacy,
    /rm -f -- "\$target"\s+if \[ ! -f/,
    'un artefact legacy prezent nu poate fi șters înainte de candidatul de rollback',
  )
  ordered(restoreLegacy, [
    ['candidatul sibling', 'mktemp "$parent/.$base.rollback.XXXXXX"'],
    ['copierea fără dereference', 'cp -a --no-dereference'],
    ['rename atomic', 'mv -f -- "$candidate" "$target"'],
    ['fsync director', 'sync -f "$parent"'],
  ])
})

test('recovery-ul persistent refuză orice pereche worker/publisher mixtă', () => {
  const contract = new RegExp(
    'worker_gate_image=\\$\\(sed[\\s\\S]*publisher_gate_image=\\$\\(sed[\\s\\S]*' +
      '\\[ -n "\\$worker_gate_image" \\] && \\[ "\\$worker_gate_image" = "\\$publisher_gate_image" \\]',
  )
  assert.match(runtimeCutover, contract)
})


test('transportul HMAC eșuează rapid cu diagnostic înaintea executorului scump', () => {
  const transport = finalizer.indexOf('transport_unit="kelion-opencode-transport-')
  const executor = finalizer.indexOf('executor_smoke=$(')

  assert.ok(transport >= 0 && executor > transport)
  const block = finalizer.slice(transport, executor)
  assert.match(block, /127[.]0[.]0[.]1:18079/)
  assert.match(block, /WorkingDirectory=\/var\/lib\/kelion-codex/)
  assert.match(block, /2>&1/)
  assert.match(block, /PRIVATE_AI_TRANSPORT_SMOKE_FAILED/)
  assert.match(block, /PRIVATE_AI_TRANSPORT_SMOKE_MARKER_MISMATCH/)
})

test('rollbackul identifică pasul eșuat și restaurează enabled-runtime exact', () => {
  const rollback = shellFunction('rollback')
  const restoreUnitState = shellFunction('restore_unit_state')

  assert.match(rollback, /PRIVATE_AI_ROLLBACK_SNAPSHOT/)
  assert.match(rollback, /PRIVATE_AI_ROLLBACK_STEP_FAILED=line-/)
  assert.match(restoreUnitState, /enabled-runtime[\s\S]*enable --runtime/)
})
