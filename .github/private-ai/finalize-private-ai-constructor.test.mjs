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
const worker = readFileSync(
  new URL('../../deploy/codex-worker.mjs', import.meta.url),
  'utf8',
)
const syncWorker = readFileSync(
  new URL('../../deploy/constructor-sync-worker.sh', import.meta.url),
  'utf8',
)
const syncUnit = readFileSync(
  new URL('../../deploy/systemd/kelion-constructor-sync.service', import.meta.url),
  'utf8',
)
const workflow = readFileSync(
  new URL('../workflows/private-ai-finalize.yml', import.meta.url),
  'utf8',
)
const loginWorkflow = readFileSync(
  new URL('../workflows/vps-codex-login.yml', import.meta.url),
  'utf8',
)
const proofWorkflow = readFileSync(
  new URL('../workflows/private-ai-constructor-proof.yml', import.meta.url),
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

test('finalizerul refuză jurnalul max-model înainte și sub publication lock', () => {
  assert.match(finalizer, /readonly MAX_MODEL_JOURNAL=\$RUNTIME_ROOT\/constructor-max-model[.]journal/)
  const preflight = finalizer.indexOf('a persistent max-model transaction blocks finalization')
  const lock = finalizer.indexOf('flock -n 9')
  const lockedGuard = finalizer.indexOf('a persistent max-model transaction blocks finalization under publication lock', lock)
  const attemptMutation = finalizer.indexOf('install -d -o root -g root -m 0700 "$attempt_root"', lockedGuard)
  assert.ok(preflight >= 0 && lock > preflight && lockedGuard > lock && attemptMutation > lockedGuard)
})

test('compilarea Windows este o poartă înaintea oricărei mutații de finalizare pe VPS', () => {
  const validate = workflow.indexOf('\n  validate-source:')
  const windows = workflow.indexOf('\n  verify-windows-client:')
  const finalize = workflow.indexOf('\n  finalize-vps:')
  assert.ok(validate >= 0 && windows > validate && finalize > windows)
  const windowsJob = workflow.slice(windows, finalize)
  const finalizeJob = workflow.slice(finalize)
  assert.match(windowsJob, /needs: validate-source/)
  assert.match(windowsJob, /runs-on: windows-latest/)
  assert.match(windowsJob, /npm --prefix constructor-desktop run build -- --no-bundle/)
  assert.match(finalizeJob, /needs:\n\s+- validate-source\n\s+- verify-windows-client/)
  assert.ok(workflow.indexOf('environment: production', finalize) > finalize)
})

test('finalizarea consumă fail-closed manifestul gate al buildului reușit pentru commitul exact', () => {
  const lookup = workflow.indexOf('Leagă gate-ul de buildul reușit al commitului canonic exact')
  const firstScp = workflow.indexOf('scp "${ssh_opts[@]}" "$bundle"', lookup)
  assert.ok(lookup >= 0 && firstScp > lookup)
  assert.match(workflow, /permissions:\n\s+actions: read/)
  assert.match(workflow, /actions\/workflows\/build-images\.yml\/runs/)
  assert.match(workflow, /build_images_run_inventory_incomplete/)
  assert.match(workflow, /build_images_run_missing_or_ambiguous/)
  assert.match(workflow, /release-images-\$\{GITHUB_SHA\}/)
  assert.match(workflow, /select\(\.total_count == 1\)/)
  assert.match(workflow, /release_artifact_missing_or_ambiguous/)
  assert.match(workflow, /actions\/artifacts\/\$\{artifact_id\}\/zip/)
  assert.match(workflow, /keys == \["commit", "image", "schema", "sourceRunId"\]/)
  assert.match(workflow, /actions\/runs\/\$\{source_run_id\}/)
  assert.match(workflow, /\.path == "\.github\/workflows\/pr-verify\.yml"/)
  assert.match(workflow, /\.github\/private-ai\/codex-gates\.json[\s\S]*SHA256SUMS/)
  assert.match(workflow, /ExecStart=\/usr\/bin\/bash .* \$expected_gate_commit \$expected_gate_image/)
  const latestMaster = workflow.lastIndexOf('latest_master=$(GH_TOKEN="$REGISTRY_TOKEN" gh api', firstScp)
  assert.ok(latestMaster > lookup && latestMaster < firstScp)
  assert.match(workflow.slice(latestMaster, firstScp), /\[ "\$latest_master" = "\$expected_gate_commit" \]/)
  assert.doesNotMatch(workflow, /58f39cfef1ae38157a29d1a0810a334263926c0e|25b0b08c093ab2ae31036183e8f6028c8997794ea559b318080339b640ce9ea3/)
  assert.match(finalizer, /EXPECTED_GATE_COMMIT=\$\{2:\?gate commit required\}/)
  assert.match(finalizer, /EXPECTED_GATE_IMAGE=\$\{3:\?gate image required\}/)
  assert.match(finalizer, /GATE_MANIFEST_SOURCE=.*codex-gates\.json/)
  assert.doesNotMatch(finalizer, /58f39cfef1ae38157a29d1a0810a334263926c0e|25b0b08c093ab2ae31036183e8f6028c8997794ea559b318080339b640ce9ea3/)
})

test('probele operaționale cer același lock global înaintea workerului', () => {
  const execStart = 'ExecStart=/usr/bin/flock --exclusive --wait 9000 /run/lock/private-ai-model-switch.lock /usr/bin/node /opt/kelion-codex/codex-worker.mjs --once'
  assert.ok(loginWorkflow.includes(execStart))
  assert.ok(proofWorkflow.includes(execStart))
  assert.doesNotMatch(loginWorkflow, /ExecStart=\/usr\/bin\/node \/opt\/kelion-codex\/codex-worker\.mjs --once/)
  assert.doesNotMatch(proofWorkflow, /ExecStart=\/usr\/bin\/node \/opt\/kelion-codex\/codex-worker\.mjs --once/)
})

test('proba live identifică exact flock, workerul Node copil și descendentul OpenCode', () => {
  const processProof = proofWorkflow.slice(
    proofWorkflow.indexOf('[ -r "/proc/$main_pid/cmdline" ]'),
    proofWorkflow.indexOf('queue_receipt_sha='),
  )
  assert.match(processProof, /readlink -f -- "\/proc\/\$main_pid\/exe"\)" = \/usr\/bin\/flock/)
  ordered(processProof, [
    ['argv flock', 'expected_flock_argv=('],
    ['lock canonic', 'model_switch_lock=/run/lock/private-ai-model-switch.lock'],
    ['inode lock', "model_switch_lock_identity=$(stat -Lc '%d:%i'"],
    ['fd flock', 'main_lock_fds=$((main_lock_fds + 1))'],
    ['probă lock ocupat', '/usr/bin/flock --exclusive --nonblock "$model_switch_lock" /usr/bin/true'],
    ['cgroup', 'control_group=$(systemctl show kelion-codex-worker.service -p ControlGroup --value)'],
    ['worker Node', 'worker_node_processes=0'],
    ['descendență', 'is_descendant_of() {'],
    ['OpenCode', 'opencode_process=0'],
  ])
  assert.match(processProof, /expected_flock_argv=\([\s\S]*\/usr\/bin\/flock --exclusive --wait 9000[\s\S]*\/run\/lock\/private-ai-model-switch[.]lock[\s\S]*\/usr\/bin\/node \/opt\/kelion-codex\/codex-worker[.]mjs --once/)
  assert.match(processProof, /stat -Lc '%U:%G:%a:%h'[\s\S]*root:privateai:660:1/)
  assert.match(processProof, /worker_node_argv\[0\].*\/usr\/bin\/node/)
  assert.match(processProof, /worker_node_argv\[1\].*\/opt\/kelion-codex\/codex-worker[.]mjs/)
  assert.match(processProof, /worker_node_argv\[2\].*--once/)
  assert.match(processProof, /PPid:[\s\S]*"\$main_pid"/)
  assert.match(processProof, /\[ "\$worker_node_processes" -eq 1 \]/)
  assert.match(processProof, /is_descendant_of "\$pid" "\$worker_node_pid"[\s\S]*\/opt\/private-ai\/bin\/opencode/)
  assert.match(processProof, /\[ "\$opencode_process" -eq 1 \]/)
})

test('proba pilot leagă fail-closed profilul DB, receiptul jobului și argv-ul OpenCode', () => {
  assert.match(proofWorkflow, /b[.]execution_profile AS profile/)
  assert.match(proofWorkflow, /b[.]progress,/)
  assert.match(proofWorkflow, /row[.]profile !== 'fast' && row[.]profile !== 'powerful'/)
  assert.match(proofWorkflow, /fast: 'Model selectat manual FAST 35B: OpenCode execută ordinul'/)
  assert.match(proofWorkflow, /powerful: 'Model selectat manual POWERFUL 122B: OpenCode execută ordinul'/)
  assert.match(
    proofWorkflow,
    /if \(row[.]progress !== expectedProgressByProfile\[row[.]profile\]\) process[.]exit\(8\)/,
  )
  assert.match(
    proofWorkflow,
    /heartbeat[.]detail !== expectedProgressByProfile\[row[.]profile\]/,
  )
  assert.doesNotMatch(
    proofWorkflow,
    /OpenCode\/Qwen local execută ordinul cu acces complet la host/,
  )
  assert.match(worker, /label: 'FAST 35B'/)
  assert.match(worker, /label: 'POWERFUL 122B'/)
  assert.match(worker, /Model selectat manual \$\{turn[.]label\}: OpenCode execută ordinul/)
  assert.match(
    proofWorkflow,
    /\["baseCommit", "createdAt", "executor", "jobId", "profile", "taskId"\]/,
  )
  assert.match(proofWorkflow, /length == 1/)
  assert.match(proofWorkflow, /[.]\[0\][.]profile == "fast" or [.]\[0\][.]profile == "powerful"/)
  assert.match(proofWorkflow, /\[ "\$job_profile" = "\$queue_profile" \]/)
  assert.match(proofWorkflow, /\[ "\$job_profile" = "\$active_profile" \]/)
  assert.match(proofWorkflow, /fast\) expected_job_model="llama[.]cpp\/\$expected_model_alias" ;;/)
  assert.match(proofWorkflow, /powerful\) expected_job_model="llama[.]cpp\/\$expected_powerful_model_alias" ;;/)
  assert.match(proofWorkflow, /\[ "\$expected_job_model" = "\$expected_active_model" \]/)

  const argvProof = proofWorkflow.slice(
    proofWorkflow.indexOf('opencode_process=0'),
    proofWorkflow.indexOf('queue_receipt_sha=', proofWorkflow.indexOf('opencode_process=0')),
  )
  assert.match(argvProof, /--model "\$expected_job_model"/)
  assert.doesNotMatch(argvProof, /--model llama[.]cpp\/(?:qwen3[.]6|qwen3[.]5)/)
})

test('proba pilot mapează exact runtime-ul și fișierele FAST/POWERFUL fără comutare sau retry', () => {
  for (const literal of [
    'qwen3.6-35b-a3b-local',
    'qwen3.5-122b-a10b-local',
    'Qwen3.6-35B-A3B-Q4_K_M.gguf',
    '671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7',
    'Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf',
    'Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf',
    'Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf',
    '467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3',
    '90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7',
    'e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97',
  ]) {
    assert.ok(proofWorkflow.includes(literal), `contractul proof nu fixează ${literal}`)
  }

  const runtimeMap = proofWorkflow.slice(
    proofWorkflow.indexOf('case "$active_model_alias" in'),
    proofWorkflow.indexOf('active_model_state=', proofWorkflow.indexOf('case "$active_model_alias" in')),
  )
  const fast = runtimeMap.slice(
    runtimeMap.indexOf('"$expected_model_alias")'),
    runtimeMap.indexOf('"$expected_powerful_model_alias")'),
  )
  const powerful = runtimeMap.slice(runtimeMap.indexOf('"$expected_powerful_model_alias")'))
  assert.match(fast, /active_profile=fast/)
  assert.match(fast, /expected_active_model="llama[.]cpp\/\$expected_model_alias"/)
  assert.match(fast, /-hf "\$\{expected_model_repo\}:\$\{expected_model_quant\}" --offline/)
  assert.match(fast, /--ctx-size 32768 --n-predict 8192 --threads 12 --parallel 1/)
  assert.match(fast, /systemctl is-active --quiet private-ai-web[.]service/)
  assert.match(powerful, /active_profile=powerful/)
  assert.match(powerful, /expected_active_model="llama[.]cpp\/\$expected_powerful_model_alias"/)
  assert.match(powerful, /stat -Lc '%U:%G:%a:%s:%h'/)
  assert.match(powerful, /sha256sum "\$powerful_model_path"/)
  assert.match(powerful, /"\$llama_server" --model "\$active_model_file_path"/)
  assert.match(powerful, /--ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1/)
  assert.match(powerful, /ActiveState --value\)" = inactive/)
  assert.match(proofWorkflow, /\[ "\$queue_profile" = "\$active_profile" \]/)
  assert.doesNotMatch(proofWorkflow, /constructor-model-switch(?:[.]sh)?[[:space:]]+(?:fast|powerful)/)
  assert.doesNotMatch(proofWorkflow, /systemctl (?:start|restart) private-ai-llm[.]service/)
})

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
    'bb852ba09260b628c1fa27b3f00556ea9ebbdf8047b0e9764d3729eca7cff2b7',
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
    ['rename atomic', 'mv -fT -- "$candidate" "$target"'],
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
  assert.match(finalizer.slice(Math.max(0, transport - 300), executor), /127[.]0[.]0[.]1:18079/)
  assert.match(block, /WorkingDirectory=\/var\/lib\/kelion-codex/)
  assert.match(block, /2>&1/)
  assert.doesNotMatch(block, /--collect/)
  assert.match(block, /systemctl reset-failed/)
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


test('credentiala systemd 0444 este acceptată numai din mountul privat și rămâne read-only', () => {
  assert.match(worker, /startsWith\('\/run\/credentials\/'\)/)
  assert.match(worker, /realpathSync\(directory\) !== directory/)
  assert.match(worker, /CODEX_WORKER_SECRET_FILE && process[.]env[.]CREDENTIALS_DIRECTORY/)
  assert.match(worker, /location[.]systemd[\s\S]*info[.]mode & 0o222/)
  assert.match(worker, /CODEX_WORKER_SECRET_FILE[\s\S]*systemd: false/)
  assert.match(worker, /systemd: false[\s\S]*info[.]mode & 0o077/)
  assert.match(worker, /lstatSync\(location[.]path\)/)
})


test('diagnosticul claimului și rollbackul legacy păstrează dovezi fără conținut secret', () => {
  assert.match(finalizer, /PRIVATE_AI_WORKER_CLAIM_FAILED/)
  assert.match(finalizer, /ExecMainStatus/)
  const restoreLegacy = shellFunction('restore_legacy_path')
  assert.match(restoreLegacy, /legacy_restore_failure/)
  assert.match(restoreLegacy, /mv -fT --/)
  assert.match(finalizer, /PRIVATE_AI_RESTORE_LEGACY_FAILED/)
})

test('sync-ul neprivilegiat validează metadata askpass și claimul aparține invocării exacte', () => {
  assert.doesNotMatch(syncWorker, /! -w "\$askpass"/)
  assert.match(syncWorker, /stat -Lc '%u:%g:%a:%h'/)
  assert.match(syncWorker, /0:0:555:1/)
  assert.doesNotMatch(syncWorker, /runuser/)
  assert.match(syncWorker, /id -un[\s\S]*kelion-codex/)
  assert.match(syncUnit, /^User=kelion-codex$/m)
  assert.match(syncUnit, /^Group=kelion-codex$/m)
  assert.match(syncUnit, /^NoNewPrivileges=true$/m)
  assert.match(syncUnit, /^RestrictSUIDSGID=true$/m)
  assert.match(syncUnit, /^CapabilityBoundingSet=$/m)
  assert.match(syncUnit, /^AmbientCapabilities=$/m)
  assert.match(finalizer, /SYNC_WORKER_SOURCE/)
  assert.match(finalizer, /SYNC_UNIT_SOURCE/)
  assert.match(finalizer, /restore_file sync_worker/)
  assert.match(finalizer, /snapshot_file sync_worker/)
  assert.match(finalizer, /restore_file sync_unit/)
  assert.match(finalizer, /snapshot_file sync_unit/)
  assert.match(finalizer, /SYNC_UNIT_INSTALLED_SHA256/)
  assert.match(finalizer, /SYNC_SERVICE_E2E=passed/)
  assert.match(workflow, /deploy\/systemd\/kelion-constructor-sync[.]service/)
  assert.match(workflow, /SYNC_UNIT_INSTALLED_SHA256=\$expected_sync_unit_sha/)
  assert.match(finalizer, /_SYSTEMD_INVOCATION_ID=\$claim_invocation/)
  assert.match(finalizer, /PRIVATE_AI_SYNC_DIAGNOSTIC_END=yes/)
  const marker = finalizer.indexOf("printf 'WORKER_CLAIM_E2E=passed\\n'")
  const timer = finalizer.indexOf('systemctl enable --now kelion-codex-worker.timer', marker)
  assert.ok(marker >= 0 && timer > marker, 'timerul worker trebuie activat numai după dovada exactă')
})

test('bundle-ul finalizerului conține control-plane-ul manual complet și îl dovedește byte-exact', () => {
  const artifacts = [
    ['deploy/constructor-model-control.mjs', 'MODEL_CONTROL_INSTALLED_SHA256'],
    ['deploy/constructor-model-switch.sh', 'MODEL_SWITCH_INSTALLED_SHA256'],
    ['deploy/lib/service-auth.mjs', 'SERVICE_AUTH_INSTALLED_SHA256'],
    ['deploy/systemd/kelion-constructor-model-control.service', 'MODEL_CONTROL_UNIT_INSTALLED_SHA256'],
  ]
  for (const [artifact, proof] of artifacts) {
    const escaped = artifact.replaceAll('.', '[.]').replaceAll('/', '\\/')
    assert.match(workflow, new RegExp(`install -m 0600 ${escaped}`), `${artifact} nu este copiat în bundle`)
    assert.match(workflow, new RegExp(`sha256sum[\\s\\S]*${escaped}`), `${artifact} lipsește din SHA256SUMS`)
    assert.match(workflow, new RegExp(`tar --sort=name[\\s\\S]*${escaped}`), `${artifact} lipsește din arhiva canonică`)
    assert.match(workflow, new RegExp(`grep -qx "${proof}=\\$expected_`), `${proof} nu este verificat extern`)
  }
  assert.match(workflow,
    /constructor-model-control-secret[\s\S]*0:10050:440:1[\s\S]*constructor-reactivation\.journal[\s\S]*private-ai-finalize-reactivation\.owner[\s\S]*is-enabled --quiet kelion-constructor-model-control\.service[\s\S]*is-active --quiet kelion-constructor-model-control\.service[\s\S]*control\.sock/)

  const tarStart = workflow.indexOf('tar --sort=name --owner=0 --group=0 --numeric-owner')
  const tarEnd = workflow.indexOf('\n          bundle_sha=', tarStart)
  const tarEntries = [...workflow.slice(tarStart, tarEnd).matchAll(/^\s+([.A-Za-z0-9_/-]+)(?: \\)?$/gm)]
    .map((match) => match[1])
  const inventoryStart = workflow.indexOf("diff -u - \"$extract/entries\" <<'ENTRIES'")
  const inventoryBody = workflow.indexOf('\n', inventoryStart) + 1
  const inventoryEnd = workflow.indexOf('\n          ENTRIES', inventoryBody)
  const remoteInventory = workflow.slice(inventoryBody, inventoryEnd)
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  assert.ok(tarStart >= 0 && tarEnd > tarStart && inventoryStart >= 0 && inventoryEnd > inventoryBody)
  assert.deepEqual(remoteInventory, tarEntries,
    'inventarul remote trebuie să fie identic și în aceeași ordine cu membrii arhivei')
})

test('finalizerul armează intentul înainte de snapshot și publică workerul numai după control-plane', () => {
  const lock = finalizer.indexOf('flock -n 9')
  const marker = finalizer.indexOf('\npublish_finalizer_reactivation_intent \\', lock)
  const snapshot = finalizer.indexOf('\nsnapshot_file worker ', marker)
  const rollbackArmed = finalizer.indexOf('\nrollback_armed=1', snapshot)
  const modelControlInstall = finalizer.indexOf('mv -f -- "$model_control_candidate" "$MODEL_CONTROL_TARGET"', rollbackArmed)
  const switchInstall = finalizer.indexOf('mv -f -- "$model_switch_candidate" "$MODEL_SWITCH_TARGET"', modelControlInstall)
  const authInstall = finalizer.indexOf('mv -f -- "$service_auth_candidate" "$SERVICE_AUTH_TARGET"', switchInstall)
  const controlUnitInstall = finalizer.indexOf('mv -f -- "$model_control_unit_candidate" "$MODEL_CONTROL_UNIT_TARGET"', authInstall)
  const workerInstall = finalizer.indexOf('mv -f -- "$worker_candidate" "$WORKER_TARGET"', controlUnitInstall)
  const ready = finalizer.indexOf('\npublish_finalizer_runtime_ready_stamp', workerInstall)
  const controller = finalizer.indexOf('systemctl restart kelion-constructor-model-control.service', ready)
  const socket = finalizer.indexOf("printf 'MODEL_CONTROL_E2E=passed", controller)
  const timers = finalizer.indexOf('systemctl enable --now \\', socket)
  const clear = finalizer.indexOf('\nclear_finalizer_reactivation_intent \\', timers)
  const claim = finalizer.indexOf('systemctl start --no-block kelion-codex-worker.service', clear)
  assert.ok(lock >= 0 && marker > lock && snapshot > marker && rollbackArmed > snapshot
    && modelControlInstall > rollbackArmed && switchInstall > modelControlInstall
    && authInstall > switchInstall && controlUnitInstall > authInstall && workerInstall > controlUnitInstall
    && ready > workerInstall && controller > ready && socket > controller && timers > socket
    && clear > timers && claim > clear,
  'intentul durabil trebuie să încadreze publicația completă și dovada control-plane înainte de claim')
  assert.match(finalizer.slice(modelControlInstall, workerInstall),
    /constructor-model-control-secret[\s\S]*0:10050:440:1[\s\S]*--prepare-lock[\s\S]*--self-test/)
})

test('rollbackul finalizerului rearmează markerul și îl retrage numai după restaurarea completă', () => {
  const rollback = shellFunction('rollback')
  const rearm = rollback.indexOf('publish_finalizer_reactivation_intent')
  const controllerStop = rollback.indexOf('systemctl stop kelion-constructor-model-control.service', rearm)
  const restoreController = rollback.indexOf('restore_file model_control "$MODEL_CONTROL_TARGET"', controllerStop)
  const restoreSwitch = rollback.indexOf('restore_file model_switch "$MODEL_SWITCH_TARGET"', restoreController)
  const restoreAuth = rollback.indexOf('restore_file service_auth "$SERVICE_AUTH_TARGET"', restoreSwitch)
  const restoreUnit = rollback.indexOf('restore_file model_control_unit "$MODEL_CONTROL_UNIT_TARGET"', restoreAuth)
  const restoreSecret = rollback.indexOf('restore_file model_control_secret "$MODEL_CONTROL_SECRET"', restoreUnit)
  const restoreStates = rollback.indexOf('restore_unit_state kelion-runtime-config-recovery.service', restoreSecret)
  const clear = rollback.indexOf('clear_finalizer_reactivation_intent', restoreStates)
  assert.ok(rearm >= 0 && controllerStop > rearm && restoreController > controllerStop
    && restoreSwitch > restoreController && restoreAuth > restoreSwitch && restoreUnit > restoreAuth
    && restoreSecret > restoreUnit && restoreStates > restoreSecret && clear > restoreStates,
  'rollbackul nu poate retrage intentul înainte de restaurarea tuturor bytes/unităților')
  assert.match(rollback.slice(Math.max(0, clear - 120), clear), /rollback_failed" = 0/)
})
