import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLease } from './constructor-service-client.mjs'

test('diagnoza VPS raportează numai etichetele coliziunilor de token', () => {
  const workflow = read('.github/workflows/vps-diag.yml')
  const start = workflow.indexOf("=== separarea credentialelor GitHub (numai etichete) ===")
  const end = workflow.indexOf("=== sănătate publică ===", start)
  assert.ok(start >= 0 && end > start)
  const identityBlock = workflow.slice(start, end)

  assert.match(identityBlock, /TOKEN_IDENTITY_COLLISION:%s:%s/)
  assert.match(identityBlock, /TOKEN_IDENTITIES_DISTINCT/)
  assert.match(identityBlock, /constructor_labels=\(constructor-sync constructor-publisher constructor-release\)/)
  assert.match(identityBlock, /TOKEN_IDENTITY_CONSTRUCTOR_ABSENT/)
  assert.match(identityBlock, /TOKEN_IDENTITY_INVALID:constructor:partial:%s-of-3/)
  assert.match(identityBlock, /CODEX_WORKER_ENABLED=0[\s\S]*CONSTRUCTOR_PUBLISHER_ENABLED=0[\s\S]*CONSTRUCTOR_RELEASE_ENABLED=0/)
  assert.match(identityBlock, /TOKEN_IDENTITY_INVALID:constructor:configured-without-token/)
  assert.match(identityBlock, /stat -c '%u:%g:%a'/)
  assert.match(identityBlock, /token_gids=\(0 "\$publisher_gid" "\$release_gid"\)/)
  assert.match(identityBlock, /token_gids\+=\(0 10050\)/)
  assert.match(identityBlock, /without_cr_size=.*tr -d '\\015'/)
  assert.match(identityBlock, /without_nul_size=.*tr -d '\\000'/)
  assert.match(identityBlock, /\[ "\$\{#token_value\}" -ge 32 \]/)
  assert.match(identityBlock, /TOKEN_IDENTITY_INVALID:%s:marginal-whitespace/)
  assert.doesNotMatch(identityBlock, /sha(?:1|256|512)sum|openssl|base64|token_value[^\n]*printf/)
})

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const bashExecutable = process.platform === 'win32'
  ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash'
const shellFunction = (source, name) => {
  const start = source.indexOf(`${name}() {`)
  assert.ok(start >= 0, `funcția shell ${name} lipsește`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `funcția shell ${name} nu poate fi extrasă`)
  return source.slice(start, end + 2)
}

test('remedierea ACL VPS păstrează valorile și aplică exact contractul canonic', () => {
  const workflow = read('.github/workflows/vps-fix-acl.yml')
  assert.doesNotMatch(workflow, /\bpush:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /group: vps-secret-acl-maintenance[\s\S]*cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /group: production-release/)
  assert.match(workflow, /\[ "[$]GITHUB_REF" = refs\/heads\/master \]/)
  assert.match(workflow, /\[ -f "[$]p" \] && \[ ! -L "[$]p" \] && \[ -s "[$]p" \]/)
  assert.match(workflow, /github-worker-token root root 0440/)
  assert.match(workflow, /github-ghcr-read-token root root 0400/)
  assert.match(workflow, /github-release-oauth-token root 10050 0440/)
  assert.match(workflow, /github-publisher-token root "[$]publisher_group" 0440/)
  assert.match(workflow, /github-release-token root "[$]release_group" 0440/)
  assert.match(workflow, /\[\[ "[$]group" =~ \^\[0-9\]\+[$] \]\]; then printf '%s\\n' "[$]group"/)
  assert.match(workflow, /ACL_GROUP_MISSING:/)
  assert.match(workflow, /ACL_CHECK:\$p/)
  assert.match(workflow, /stat -c '%u:%g:%a'/)
  assert.doesNotMatch(workflow, /openssl|rand -hex|printf[^\n]*> "[$]p"|if \[ ! -s/)
  assert.equal(existsSync(join(root, '.github/workflows/vps-seed-slots.yml')), false,
    'workflow-ul concurent care genera și rescria secrete trebuie retras')
})

test('selecția runtime folosește direct candidatul validat din manifest', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const resolver = shellFunction(cutover, 'resolve_validated_candidate')
  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-cutover-candidate-'))
  const files = join(sandbox, 'files')
  mkdirSync(files)
  const oauth = join(files, 'app-secret.github-release-oauth-token')
  const ghcr = join(files, 'gate-secret.github-ghcr-read-token')
  const manifest = join(sandbox, 'manifest')
  writeFileSync(oauth, `${'a'.repeat(40)}\n`, { mode: 0o600 })
  writeFileSync(ghcr, `${'b'.repeat(40)}\n`, { mode: 0o600 })
  writeFileSync(manifest, 'app-secret.github-release-oauth-token\ngate-secret.github-ghcr-read-token\n', { mode: 0o600 })
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const shellPath = (path) => process.platform === 'win32'
    ? `/${path[0].toLowerCase()}${path.slice(2).replaceAll('\\', '/')}`
    : path

  const harness = `set -euo pipefail
die() { printf '%s\\n' "$1" >&2; exit 41; }
map_logical() { mapped_target=/missing/live/$1; mapped_owner=0; mapped_group=0; mapped_mode=600; restart_required=1; }
validate_secret_file() { [ -s "$1" ]; }
restart_required=0
stage_root=$1
${resolver}
resolve_validated_candidate selected app-secret.github-release-oauth-token
[ "$selected" = "$stage_root/files/app-secret.github-release-oauth-token" ]
resolve_validated_candidate selected gate-secret.github-ghcr-read-token
[ "$selected" = "$stage_root/files/gate-secret.github-ghcr-read-token" ]`
  const positive = spawnSync(bash, ['-c', harness, 'candidate-test', shellPath(sandbox)], { encoding: 'utf8' })
  assert.equal(positive.status, 0, positive.stderr)

  writeFileSync(manifest, 'gate-secret.github-ghcr-read-token\n', { mode: 0o600 })
  const absent = spawnSync(bash, ['-c', `${harness.split('resolve_validated_candidate selected app-secret')[0]}
resolve_validated_candidate selected app-secret.github-release-oauth-token`, 'candidate-test', shellPath(sandbox)], { encoding: 'utf8' })
  assert.equal(absent.status, 41)
  assert.match(absent.stderr, /nu este în manifest și lipsește live/)

  const live = join(files, 'app-secret.live-fallback')
  writeFileSync(live, `${'c'.repeat(40)}\n`, { mode: 0o600 })
  const fallbackHarness = `${harness.split('resolve_validated_candidate selected app-secret')[0]}
LIVE_FILE=$1
stage_root=$2
map_logical() { mapped_target=$LIVE_FILE; mapped_owner=$(id -u); mapped_group=$(id -g); mapped_mode=$(stat -c '%a' "$LIVE_FILE"); restart_required=1; }
resolve_validated_candidate selected app-secret.github-release-oauth-token
[ "$selected" = "$1" ]
[ "$restart_required" = 0 ]`
  const fallback = spawnSync(bash, ['-c', fallbackHarness, 'candidate-test', shellPath(live), shellPath(sandbox)], { encoding: 'utf8' })
  assert.equal(fallback.status, 0, fallback.stderr)

  writeFileSync(manifest, 'app-secret.github-release-oauth-token\ngate-secret.github-ghcr-read-token\n', { mode: 0o600 })
  rmSync(oauth)
  const removed = spawnSync(bash, ['-c', harness, 'candidate-test', shellPath(sandbox)], { encoding: 'utf8' })
  assert.equal(removed.status, 41)
  assert.match(removed.stderr, /a dispărut după manifest/)
  rmSync(sandbox, { recursive: true, force: true })
})

test('cele trei identități nu își pot împrumuta credentialele', () => {
  const worker = read('deploy/codex-worker.mjs')
  const publisher = read('deploy/constructor-publisher.mjs')
  const release = read('deploy/constructor-release.mjs')

  assert.doesNotMatch(worker, /github-publisher-token|github-release-token|GITHUB_PUBLISHER_TOKEN|GITHUB_RELEASE_TOKEN|\bgit['"], \['push'/i)
  assert.match(worker, /publishHandoff[\s\S]*patchSha256[\s\S]*gateReceiptSha256/)
  assert.match(worker, /reconcilePendingHandoffs[\s\S]*markHandoffRecorded/)
  assert.match(worker, /worktree', 'remove'[\s\S]*rmSync\(jobStateDir/)

  assert.doesNotMatch(publisher, /process\.env\.(?:VPS_SSH_KEY|OPENAI_API_KEY|OPENAI_ADMIN_KEY|CODEX_HOME)|loadSystemdCredential\('codex-worker-secret'/i)
  assert.match(publisher, /HEAD:refs\/heads\/\$\{built\.branch\}/)
  assert.doesNotMatch(publisher, /push[^\n]{0,200}(?:refs\/heads\/master|--force)/i)
  assert.match(publisher, /branches\/master\/protection/)
  assert.match(publisher, /required_signatures/)
  assert.match(publisher, /recoverMergedPr[\s\S]*compare\/\$\{commit\}\.\.\.master/)
  assert.match(publisher, /await runIgnoringOutput[\s\S]*await stopLease\.assert\(\)/)
  assert.match(publisher, /required_status_checks[\s\S]*required_approving_review_count[\s\S]*dismiss_stale_reviews[\s\S]*required_conversation_resolution[\s\S]*required_linear_history[\s\S]*allow_force_pushes[\s\S]*allow_deletions/)
  assert.match(publisher, /github-publisher-signing-key[\s\S]*ssh-keygen[\s\S]*gpg\.format=ssh[\s\S]*verify-commit/)

  assert.doesNotMatch(release, /node:child_process|VPS_SSH_KEY|CODEX_HOME|OPENAI_API_KEY|git push/i)
  assert.match(release, /actions\/workflows\/\$\{WORKFLOW\}\/dispatches/)
  assert.match(release, /successfulBuildArtifact[\s\S]*build-images\.yml[\s\S]*release-images-/)
  assert.match(release, /release_request_id: requestId/)
  assert.match(release, /releaseFailureCode[\s\S]*release_workflow_failed[\s\S]*live_proof_failed/)
  assert.match(release, /new URL\('\/api\/release-proof', PUBLIC_ORIGIN\)/)
  assert.match(release, /payload\?\.ready === true && payload\?\.release\?\.sideEffectsActive === true/)
  assert.match(release, /!response\.ok \|\| !activeReady[\s\S]*liveSha !== commit/)
  assert.doesNotMatch(release, /new URL\('\/api\/version', PUBLIC_ORIGIN\)[\s\S]*new URL\('\/readyz', PUBLIC_ORIGIN\)/)
})

test('toate controalele Constructor folosesc strategia canonică rebase', () => {
  const publisher = read('deploy/constructor-publisher.mjs')
  const adminRelease = read('backend/src/services/githubReleaseIntegration.ts')
  assert.match(publisher, /merge_method:\s*'rebase'/)
  assert.doesNotMatch(publisher, /merge_method:\s*'squash'/)
  assert.match(adminRelease, /pulls\/[$][{]number[}]\/reviews[\s\S]*event:\s*'APPROVE'/)
  assert.doesNotMatch(adminRelease, /merge_method|pulls\/[$][{]number[}]\/merge/)
})

test('publisherul raportează coduri deterministe și tratează schimbarea bazei ca stale_base', () => {
  const publisher = read('deploy/constructor-publisher.mjs')
  const catalog = publisher.slice(publisher.indexOf('const PUBLISHER_FAILURE_CODES'), publisher.indexOf('function publisherError'))
  const expected = [
    'stale_base',
    'ci_failed',
    'local_gate_failed',
    'pr_closed',
    'branch_protection_invalid',
    'github_auth_required',
    'publisher_failed',
  ]
  for (const code of expected) assert.match(catalog, new RegExp(`'${code}'`))
  assert.match(publisher, /publisherError\('stale_base', 'Baza handoff-ului nu mai este vârful master/)
  assert.match(publisher, /publisherError\('stale_base', 'Master s-a schimbat înainte de merge/)
  assert.match(publisher, /publisherError\('ci_failed'/)
  assert.match(publisher, /publisherError\('local_gate_failed'/)
  assert.match(publisher, /publisherError\('pr_closed'/)
  assert.match(publisher, /publisherError\('branch_protection_invalid'/)
  assert.match(publisher, /publisherError\('github_auth_required'/)
  assert.match(publisher, /let code = publisherFailureCode\(error\)/)
  assert.match(publisher, /code = publisherFailureCode\(cleanupError\)/)
  const pushBranch = publisher.slice(publisher.indexOf('async function pushBranch'), publisher.indexOf('async function openOrReusePr'))
  const authEnv = pushBranch.indexOf('KELION_GITHUB_TOKEN_FILE: tokenFile')
  const remoteRead = pushBranch.indexOf("git(['ls-remote'")
  assert.ok(authEnv >= 0 && remoteRead > authEnv, 'preflight-ul ramurii private trebuie autentificat înainte de ls-remote')
  assert.match(pushBranch, /ls-remote[\s\S]*\{ env \}/)
  assert.match(publisher, /hasExactRequiredCheckNames\(contexts, REQUIRED_CHECKS\)/)
  assert.match(publisher, /Protecția cu un control obligatoriu suplimentar a fost acceptată/)
  assert.match(publisher, /matching\.length !== 1/)
  assert.match(publisher, /bypass_pull_request_allowances[\s\S]*bypass\.users\.length !== 0[\s\S]*bypass\.teams\.length !== 0[\s\S]*bypass\.apps\.length !== 0/)
  assert.match(publisher, /collaborators\/[$][{]encodeURIComponent\(login\)[}]\/permission[\s\S]*\['write', 'maintain', 'admin'\]/)
  assert.match(publisher, /Recovery-ul a acceptat o asociere explicită la un PR străin/)
  assert.doesNotMatch(publisher, /policy\.appId === null/)
})

test('Adminul și publisherul refuză fail-closed toate regulile GitHub pe care fluxul nu le poate dovedi', () => {
  const publisher = read('deploy/constructor-publisher.mjs')
  const admin = read('backend/src/services/githubReleaseIntegration.ts')
  const adminTest = read('backend/src/services/githubReleaseIntegration.test.ts')

  for (const source of [publisher, admin]) {
    assert.match(source, /rules\/branches\/master\?per_page=100&page=/)
    assert.match(source, /require_code_owner_reviews\s*!==\s*false/)
    assert.match(source, /require_last_push_approval\s*!==\s*false/)
    assert.match(source, /dismissal_restrictions/)
    assert.match(source, /protection(?:\?|\.)\.restrictions|protection\.restrictions/)
  }
  assert.match(publisher, /activeBranchRules\.length !== 0[\s\S]*ruleset activ nesuportat/)
  assert.match(admin, /!hasNoActiveBranchRules\(activeBranchRules\)[\s\S]*github_branch_rules_unsupported/)
  assert.match(adminTest, /require_code_owner_reviews: true/)
  assert.match(adminTest, /require_last_push_approval: true/)
  assert.match(adminTest, /dismissal_restrictions: \{ users: \[\{ login: 'owner' \}\]/)
  assert.match(adminTest, /restrictions: \{ users: \[\], teams: \[\{ slug: 'release' \}\]/)
  assert.match(adminTest, /hasNoActiveBranchRules\(\[\{ type: 'required_status_checks', ruleset_id: 42 \}\]\)/)
})

test('controalele GitHub sunt fixate de workflow, suite, run, PR și job, nu doar de nume și App ID', () => {
  const publisher = read('deploy/constructor-publisher.mjs')
  const admin = read('backend/src/services/githubReleaseIntegration.ts')
  const adminTest = read('backend/src/services/githubReleaseIntegration.test.ts')
  for (const source of [publisher, admin]) {
    assert.ok(source.includes('check_suite'))
    assert.ok(source.includes('details_url') || source.includes('detailsUrl'))
    assert.ok(source.includes('actions/runs/'))
    assert.ok(source.includes('jobId'))
    assert.ok(source.includes('actions/workflows/pr-verify.yml'))
    for (const field of ['workflow_id', 'check_suite_id', 'pull_requests', 'head_sha', 'check_run_url']) {
      assert.ok(source.includes(field), `lipsește legătura de proveniență ${field}`)
    }
    assert.ok(source.includes('jobs?filter=latest'))
    assert.ok(source.includes('contents/'))
    assert.ok(source.includes('?ref='))
    assert.ok(source.includes('headWorkflowSha !== baseWorkflowSha'))
  }
  assert.match(adminTest, /id: 12[\s\S]*id: 13[\s\S]*app: \{ id: 41 \}[\s\S]*verify: 12/)
  assert.match(adminTest, /job IDs separate from check-run IDs[\s\S]*job\/8002[\s\S]*jobId: 8002/)
  assert.match(publisher, /check-runs\/\$\{check\.id\}/)
  assert.match(admin, /check-runs\/\$\{check\.id\}/)
  assert.match(publisher, /checkRunId: Number\(selected\[index\]\.id\)[\s\S]*jobId: coordinates\[index\]\.jobId/)
  assert.doesNotMatch(publisher.slice(publisher.indexOf('async function canonicalRequiredCheckRuns'), publisher.indexOf('async function waitForGreen')), /run\?\.pull_requests/)
  assert.doesNotMatch(admin.slice(admin.indexOf('async function canonicalCheckRunIds'), admin.indexOf('export async function readReleaseSnapshot')), /run\.pull_requests/)
  assert.match(publisher, /detachedAfterMerge[\s\S]*pull_requests: \[\][\s\S]*Recovery-ul a depins de asocierea PR volatilă/)
})

test('release-ul eșuat cere rerun pe același run înainte să-i urmărească noua încercare', () => {
  const release = read('deploy/constructor-release.mjs')
  const runOnce = release.slice(release.indexOf('async function runOnce'), release.indexOf('function selfTest'))
  const completion = release.slice(release.indexOf('async function waitForCompletion'), release.indexOf('async function externalProof'))
  const rerun = runOnce.indexOf('rerun-failed-jobs')
  const follow = runOnce.indexOf('await waitForCompletion')

  assert.match(release, /run\?\.status === 'completed' && run\?\.conclusion !== 'success'/)
  assert.match(runOnce, /actions\/runs\/\$\{workflowRunId\}\/rerun-failed-jobs`, 'POST'/)
  assert.match(runOnce, /minimumRunAttempt = previousRunAttempt \+ 1/)
  assert.ok(rerun >= 0 && follow > rerun, 'rerun-ul trebuie cerut înainte de urmărire')
  assert.match(completion, /runAttempt < minimumRunAttempt[\s\S]*continue/)
})

test('dovada externă leagă atomic readiness-ul de SHA-ul complet activ', () => {
  const release = read('deploy/constructor-release.mjs')
  const backend = read('backend/src/index.ts')
  const proof = release.slice(release.indexOf('async function externalProof'), release.indexOf('async function reconcileLegacyRelease'))
  const endpoint = backend.slice(backend.indexOf("app.get('/api/release-proof'"), backend.indexOf("app.get('/api/version'"))

  assert.match(proof, /\/api\/release-proof/)
  assert.match(proof, /activeCommit[\s\S]*ready === true[\s\S]*sideEffectsActive === true/)
  assert.match(proof, /\^\[0-9a-f\]\{40\}\$[\s\S]*liveSha !== commit/)
  assert.equal((proof.match(/await fetch/g) ?? []).length, 1)
  assert.doesNotMatch(proof, /compare\/\$\{commit\}\.\.\.\$\{liveSha\}/)
  assert.doesNotMatch(proof, /api\/version|\/readyz|commits\/\$\{liveVersion\}/)
  assert.match(proof, /return liveSha/)
  assert.match(endpoint, /readinessSnapshot\(\)[\s\S]*sideEffectsActive[\s\S]*activeCommit: DEPLOY_COMMIT/)
  assert.match(endpoint, /Cache-Control', 'no-store'/)
})

test('upgrade-ul release v1 rezolvă durabil absența ambiguă înainte de v2, fără redispatch', () => {
  const release = read('deploy/constructor-release.mjs')
  const pipeline = read('backend/src/services/constructorPipeline.ts')
  const route = read('backend/src/routes/constructor.ts')
  const migration = read('backend/migrations/20260908_constructor_release_dispatch_intents.sql')
  const legacy = release.slice(release.indexOf('async function reconcileLegacyRelease'), release.indexOf('async function runOnce'))
  const runOnce = release.slice(release.indexOf('async function runOnce'), release.indexOf('function selfTest'))
  const protocolBranch = runOnce.indexOf('candidate.releaseProtocolVersion === 1')
  const v2CandidateParser = runOnce.indexOf('const persistedCandidate =')

  assert.ok(protocolBranch >= 0 && v2CandidateParser > protocolBranch)
  assert.match(legacy, /kelion-release-v1/)
  assert.match(legacy, /legacy_dispatch_reconciled/)
  assert.match(legacy, /legacy_dispatch_absence_resolved/)
  assert.doesNotMatch(legacy, /actions\/workflows\/\$\{WORKFLOW\}\/dispatches|waitForReleaseRun/)
  const exhaustiveSearch = legacy.indexOf('discoveredLegacyRun = await existingReleaseRun(')
  const maturityGuard = legacy.indexOf('intentRetirementMature(legacyAmbiguityStartedAt)', exhaustiveSearch)
  const durableResolution = legacy.indexOf("event: 'legacy_dispatch_absence_resolved'", maturityGuard)
  const candidateProof = legacy.indexOf("if (!build) fail('Artefactul OCI semnat nu este disponibil pentru commitul merged')")
  assert.ok(exhaustiveSearch >= 0 && maturityGuard > exhaustiveSearch && durableResolution > maturityGuard && candidateProof > durableResolution,
    'v1 trebuie căutat exhaustiv și absența matură persistată înainte de probele v2 costisitoare')
  assert.match(legacy, /kind: 'legacy-release-dispatch-absence-resolution'[\s\S]*ambiguityStartedAt: legacyAmbiguityStartedAt[\s\S]*currentMaster/)
  assert.match(legacy, /Ambiguitatea dispatchului release v1 a fost rezolvată durabil/)
  assert.equal((legacy.match(/kelion-release-v1/g) ?? []).length, 1)
  assert.match(route, /event === 'legacy_dispatch_absence_resolved'[\s\S]*resolveLegacyReleaseAmbiguity/)
  assert.match(pipeline, /resolveLegacyReleaseAmbiguity[\s\S]*interval '4 hours'[\s\S]*INSERT INTO constructor_release_legacy_resolutions[\s\S]*release_protocol_version=2/)
  assert.match(migration, /release_legacy_ambiguity_started_at=transaction_timestamp\(\)[\s\S]*CREATE TABLE IF NOT EXISTS constructor_release_legacy_resolutions/)
  assert.match(runOnce, /request=NULL is a durable proof[\s\S]*candidate\.targetCommit = candidate\.masterCommit/)
})

test('cheia privată de semnare rămâne root-only și ajunge la publisher numai prin LoadCredential', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const generation = workflow.indexOf("ssh-keygen -q -t ed25519 -N ''")
  const candidateValidation = workflow.indexOf('validate_signing_key "$signing_candidate"', generation)
  const candidateSync = workflow.indexOf('sync -f "$signing_candidate"', candidateValidation)
  const rename = workflow.indexOf('mv -f -- "$signing_candidate" "$signing_key"', candidateSync)
  const directorySync = workflow.indexOf('sync -f "$signing_dir"', rename)
  const finalValidation = workflow.indexOf('validate_signing_key "$signing_key"', directorySync)
  const registrationRead = workflow.indexOf('existing_keys=$(curl', finalValidation)

  assert.ok(generation >= 0 && candidateValidation > generation && candidateSync > candidateValidation
    && rename > candidateSync && directorySync > rename && finalValidation > directorySync
    && registrationRead > finalValidation,
  'cheia trebuie validată și publicată durabil înainte de înregistrarea GitHub')
  assert.match(workflow, /stat -Lc '%u:%g:%a:%h' "[$]key"\)" = '0:0:400:1'/)
  assert.doesNotMatch(workflow, /ssh-keygen -q[^\n]*-f "[$]signing_key"/)
  assert.doesNotMatch(workflow, /chown root:kelion-publisher "[$]signing_key"|chmod 0440 "[$]signing_key"/)
})

test('bootstrap-ul repo este crash-safe și nu rescrie originul unui checkout neverificat', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const installer = read('deploy/instaleaza-constructor.sh')
  const workerUnit = read('deploy/systemd/kelion-codex-worker.service')
  const publisherUnit = read('deploy/systemd/kelion-constructor-publisher.service')
  const clone = workflow.slice(workflow.indexOf('clone_or_sync() {'), workflow.indexOf('clone_or_sync kelion-codex'))
  const cleanupTransition = clone.slice(clone.indexOf('prepare_clone_cleanup() {'), clone.indexOf('            case "$user"'))
  const candidateRoot = clone.indexOf('candidate_root=$(mktemp -d')
  const markerTemp = clone.indexOf('marker_temporary=$(mktemp', candidateRoot)
  const markerSync = clone.indexOf('sync -f "$candidate_root"', markerTemp)
  const exposeCandidate = clone.indexOf('chmod 0711 "$candidate_root"', markerSync)
  const cloneCandidate = clone.indexOf('git clone --no-tags "$expected" "$candidate"', markerSync)
  const originValidation = clone.indexOf('remote get-url origin', cloneCandidate)
  const dangerValidation = clone.indexOf("config --local --get-regexp", originValidation)
  const candidateSync = clone.indexOf('sync -f "$candidate"', dangerValidation)
  const rename = clone.indexOf('mv -f -- "$candidate" "$target"', candidateSync)
  const parentSync = clone.indexOf('sync -f "$parent"', rename)

  assert.ok(candidateRoot >= 0 && markerTemp > candidateRoot && markerSync > markerTemp
    && exposeCandidate > markerSync && cloneCandidate > exposeCandidate
    && originValidation > cloneCandidate && dangerValidation > originValidation
    && candidateSync > dangerValidation && rename > candidateSync && parentSync > rename,
  'checkout-ul nou trebuie clonat și validat într-un candidat durabil înainte de rename')
  assert.match(clone, /FETCH_HEAD\.lock[\s\S]*packed-refs\.lock[\s\S]*index\.lock[\s\S]*refs\/remotes\/origin\/master\.lock/)
  assert.match(clone, /stat -Lc '%u:%g:%a' "[$]parent"[)]" = '0:0:711'/)
  assert.match(clone, /candidate_mode[\s\S]*0:0:700[\s\S]*rm -rf --one-file-system/)
  assert.match(cleanupTransition, /0:0:711[\s\S]*chmod 0700 "[$]cleanup_root"[\s\S]*sync -f "[$]cleanup_root"[\s\S]*sync -f "[$]parent"[\s\S]*0:0:700/)
  const staleMarkerProof = clone.indexOf("printf 'schema=1\\nuser=%s\\ntarget=%s\\n'", clone.indexOf('for candidate_root'))
  const staleCleanupPhase = clone.indexOf('prepare_clone_cleanup "$candidate_root"', staleMarkerProof)
  const staleDelete = clone.indexOf('rm -rf --one-file-system -- "$candidate_root"', staleCleanupPhase)
  const targetMove = clone.indexOf('mv -f -- "$candidate" "$target"')
  const finalCleanupPhase = clone.indexOf('prepare_clone_cleanup "$candidate_root"', targetMove)
  const markerDelete = clone.indexOf('rm -f -- "$marker"', finalCleanupPhase)
  assert.ok(staleMarkerProof >= 0 && staleCleanupPhase > staleMarkerProof && staleDelete > staleCleanupPhase,
    'cleanup-ul stale trebuie să intre durabil în 0700 după dovada markerului și înainte de primul rm')
  assert.ok(targetMove >= 0 && finalCleanupPhase > targetMove && markerDelete > finalCleanupPhase,
    'cleanup-ul post-rename trebuie să intre durabil în 0700 înainte ca markerul să poată dispărea')
  assert.match(clone, /realpath -e -- "[$]candidate_root"[\s\S]*stat -Lc '%u:%g:%a' "[$]candidate_root"[)]" = '0:0:711'/)
  assert.match(clone, /realpath -e -- "[$]candidate"[\s\S]*stat -Lc '%U:%G:%a' "[$]candidate"[)]" = "[$]user:[$]primary_group:700"/)
  assert.doesNotMatch(clone, /remote set-url/)
  const secureParent = shellFunction(installer, 'secure_service_parent')
  const secureChild = shellFunction(installer, 'ensure_service_writable_dir')
  const secureHandoff = shellFunction(installer, 'secure_handoff_spool')
  assert.match(secureParent, /! -L "[$]path"[\s\S]*realpath -e -- "[$]path"[\s\S]*chown root:root[\s\S]*chmod 0711/)
  assert.match(secureChild, /! -L "[$]path"[\s\S]*realpath -e -- "[$]path"[\s\S]*chown "[$]owner:[$]group"[\s\S]*chmod 0700/)
  const handoffLockdown = secureHandoff.indexOf('chmod 00750 "$spool"')
  const handoffChildren = secureHandoff.indexOf('for child in ready ack retired')
  assert.ok(secureHandoff.indexOf('stat -Lc \'%u\' "$spool"') >= 0
    && handoffLockdown >= 0 && handoffChildren > handoffLockdown,
  'spool-ul trebuie să aibă proprietar root dovedit și să fie non-group-writable înainte de copii')
  assert.match(secureHandoff, /! -L "[$]child"[\s\S]*realpath -e -- "[$]child"[\s\S]*chmod 2770 "[$]child"/)
  assert.doesNotMatch(installer, /install -d[^\n]*\/var\/lib\/kelion-constructor-handoff/)
  assert.match(installer, /secure_service_parent \/var\/lib\/kelion-codex[\s\S]*secure_service_parent \/var\/lib\/kelion-publisher[\s\S]*secure_service_parent \/var\/lib\/kelion-release/)
  assert.doesNotMatch(installer, /install -d[^\n]*(?:\/var\/lib\/kelion-(?:codex|publisher|release))(?:\/|\s|$)/)
  assert.doesNotMatch(installer, /\/var\/lib\/kelion-(?:codex|publisher)\/\.local\/share/)
  assert.doesNotMatch(workerUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-codex(?:\s|$)/m)
  assert.match(workerUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-codex\/repo .*\/var\/lib\/kelion-codex\/jobs/m)
  assert.doesNotMatch(publisherUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-publisher(?:\s|$)/m)
  assert.match(publisherUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-publisher\/repo .*\/var\/lib\/kelion-publisher\/state/m)
  for (const unit of [workerUnit, publisherUnit]) {
    assert.match(unit, /^SupplementaryGroups=kelion-handoff$/m)
    assert.match(unit, /^ReadWritePaths=.*\/var\/lib\/kelion-constructor-handoff(?:\s|$)/m)
  }
  const releaseUnit = read('deploy/systemd/kelion-constructor-release.service')
  assert.doesNotMatch(releaseUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-release(?:\s|$)/m)
  assert.match(releaseUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-release\/state/m)

  const realStat = 'real_stat=$(type -P stat)'
  const handoffFaultScript = `set -euo pipefail
${secureHandoff}
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/var/lib/kelion-constructor-handoff" "$test_root/victim"
chmod 2770 "$test_root/var/lib/kelion-constructor-handoff"
printf '%s\n' untouched > "$test_root/victim/sentinel"
ln -s "$test_root/victim" "$test_root/var/lib/kelion-constructor-handoff/ready"
${realStat}
real_realpath=$(type -P realpath)
victim_mode_before=$("$real_stat" -c '%a' "$test_root/victim")
realpath() {
  local final=''
  for final in "$@"; do :; done
  if [ "$final" = "$test_root/var/lib/kelion-constructor-handoff/ready" ]; then
    printf '%s\n' "$test_root/victim"
  else
    "$real_realpath" "$@"
  fi
}
stat() {
  case "$2:$3" in
    "%u:%g:%a:$test_root/var/lib") printf '%s\n' '0:0:755' ;;
    "%u:$test_root/var/lib/kelion-constructor-handoff") printf '%s\n' 0 ;;
    "%U:%G:%a:$test_root/var/lib/kelion-constructor-handoff") printf '%s\n' 'root:kelion-handoff:750' ;;
    *) "$real_stat" "$@" ;;
  esac
}
chown() { :; }
sync() { :; }
if secure_handoff_spool "$test_root"; then exit 61; fi
[ "$("$real_stat" -c '%a' "$test_root/victim")" = "$victim_mode_before" ]
[ "$(cat "$test_root/victim/sentinel")" = untouched ]
`
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const handoffFault = spawnSync(bash, ['-s'], { input: handoffFaultScript, encoding: 'utf8' })
  assert.equal(handoffFault.status, 0, handoffFault.stderr || handoffFault.stdout)
})

test('diagnose-spool este o operație SSH strict read-only și fail-closed', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  assert.match(workflow, /operation:[\s\S]*options:[\s\S]*- diagnose-spool/)
  const start = workflow.indexOf('      - name: Diagnosticheaza spool-ul handoff (read-only)')
  assert.ok(start >= 0, 'workflow-ul trebuie să declare pasul read-only pentru spool')
  const nextStep = workflow.indexOf('\n      - name:', start + 1)
  const diagnostic = workflow.slice(start, nextStep < 0 ? workflow.length : nextStep)
  assert.match(diagnostic, /if: inputs\.operation == 'diagnose-spool'/)
  assert.match(diagnostic, /stat -c 'type=%F mode=%a owner=%U group=%G ctime=%z mtime=%y'/)
  assert.match(diagnostic, /getfacl -p "\$p"/)
  assert.match(diagnostic, /find \/var\/lib\/kelion-constructor-handoff -maxdepth 2/)
  assert.match(diagnostic, /sha256sum "\$activation_file"/)
  assert.match(diagnostic, /activation_file=\/run\/kelion-release\/active/)
  assert.match(diagnostic, /diagnostic_failure[\s\S]*source_commit/)
  assert.match(diagnostic, /path_read_error[\s\S]*rc_total=1/)
  assert.match(diagnostic, /probe identity id/)
  assert.match(diagnostic, /namei -l "\$p"/)
  assert.match(diagnostic, /findmnt -T \/var\/lib -no TARGET,FSTYPE,OPTIONS/)
  assert.match(diagnostic, /lsattr -d \/var\/lib\/kelion-constructor-handoff/)
  assert.match(diagnostic, /systemd-tmpfiles --cat-config/)
  assert.match(diagnostic, /journal_signal=%s matching_files=%s/)

  const remoteStart = diagnostic.indexOf("<<'REMOTE'")
  const remoteEnd = diagnostic.lastIndexOf('\n          REMOTE')
  assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, 'diagnosticul trebuie să aibă payload SSH delimitat')
  const remote = diagnostic.slice(remoteStart, remoteEnd)
  assert.doesNotMatch(remote, /^\s*(?:sudo\s+)?(?:mkdir|chown|chmod|setfacl|rm|mv|tee|install|touch|cp|sed)\b/m,
    'payload-ul VPS nu trebuie să invoce comenzi de mutație')
  assert.doesNotMatch(remote, /cat\s+[^-]/, 'diagnosticul nu trebuie să afișeze conținut raw')
})

test('audit-token-identity identifică doar numele coliziunii fără valori sau mutații VPS', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  assert.match(workflow, /operation:[\s\S]*options:[\s\S]*- audit-token-identity/)
  const start = workflow.indexOf('      - name: Auditeaza identitatea tokenurilor (read-only)')
  assert.ok(start >= 0, 'workflow-ul trebuie să declare auditul read-only al identității')
  const nextStep = workflow.indexOf('\n      - name:', start + 1)
  const audit = workflow.slice(start, nextStep < 0 ? workflow.length : nextStep)
  assert.match(audit, /if: inputs\.operation == 'audit-token-identity'/)
  assert.match(audit, /audit_failure[\s\S]*source_commit/)
  assert.match(audit, /oauth_admin_path=\/root\/kelion\/secrets\/github-release-oauth-token/)
  assert.match(audit, /IFS= read -r oauth_admin_token/)
  assert.match(audit, /IFS= read -r oauth_admin_token[\s\S]*\[\[ "\$oauth_admin_token" != \[\[:space:\]\]\* && "\$oauth_admin_token" != \*\[\[:space:\]\] \]\][\s\S]*sha256sum/,
    'auditul trebuie să respingă whitespace-ul marginal și în tokenul OAuth live')
  assert.match(audit, /oauth_admin_hash=\$\(ssh[\s\S]*\n          REMOTE\n          \)\n          \[ -n "\$oauth_admin_hash" \]/,
    'command substitution-ul SSH trebuie închis imediat după heredoc')
  assert.match(audit, /COLLISION: CONSTRUCTOR_SYNC_GITHUB_TOKEN/)
  assert.match(audit, /COLLISION: CONSTRUCTOR_PUBLISHER_GITHUB_TOKEN/)
  assert.match(audit, /COLLISION: VPS_GITHUB_TOKEN/)
  assert.match(audit, /COLLISION: CONSTRUCTOR_GHCR_READ_TOKEN/)
  assert.match(audit, /\[\[ "\$value" != \[\[:space:\]\]\* && "\$value" != \*\[\[:space:\]\] \]\]/,
    'auditul trebuie să respingă whitespace-ul marginal înainte de hashing')
  assert.match(audit, /"\$collision" -ne 0[\s\S]*AUDIT-VERDICT: COLLISION[\s\S]*audit_collision[\s\S]*exit 1/,
    'o coliziune trebuie să închidă auditul fail-closed cu telemetrie de eșec')
  assert.match(audit, /AUDIT-VERDICT: NO-COLLISION[\s\S]*audit_complete/)
  assert.doesNotMatch(audit, /AUDIT-VERDICT: COLLISION[\s\S]*"ok":true/,
    'ramura de coliziune nu poate raporta succes')
  assert.doesNotMatch(audit, /echo\s+['"]?\$?(?:h_sync|h_publisher|h_release|h_ghcr|oauth_admin_hash)/,
    'auditul nu trebuie să afișeze hashurile')
  assert.doesNotMatch(audit, /set\s+-x/, 'auditul nu trebuie să activeze xtrace')

  const remoteStart = audit.indexOf("<<'REMOTE'")
  const remoteEnd = audit.lastIndexOf('\n          REMOTE')
  assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, 'auditul trebuie să aibă payload SSH delimitat')
  const remote = audit.slice(remoteStart, remoteEnd)
  assert.doesNotMatch(remote, /^\s*(?:sudo\s+)?(?:mkdir|chown|chmod|setfacl|rm|mv|tee|install|touch|cp|sed)\b/m,
    'payload-ul VPS nu trebuie să invoce comenzi de mutație')
  assert.doesNotMatch(remote, /(?:cat|head|tail)\s+/, 'auditul nu trebuie să afișeze conținutul secretului')
})

test('repair-spool-layout normalizează numai layout-ul canonic cu Constructorul oprit', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  assert.match(workflow, /operation:[\s\S]*options:[\s\S]*- repair-spool-layout/)
  const start = workflow.indexOf('      - name: Repara controlat layout-ul spool-ului handoff')
  assert.ok(start >= 0, 'workflow-ul trebuie să declare remedierea dedicată a spool-ului')
  const nextStep = workflow.indexOf('\n      - name:', start + 1)
  const repair = workflow.slice(start, nextStep < 0 ? workflow.length : nextStep)
  assert.match(repair, /if: inputs\.operation == 'repair-spool-layout'/)
  assert.match(repair, /phase='repair-spool-layout'/)
  assert.match(repair, /repair_failure[\s\S]*current_check[\s\S]*source_commit/)
  assert.match(repair, /repair_complete/)
  assert.match(repair, /stat -c '%U:%G:%a' \/var\/lib/)
  assert.match(repair, /systemctl is-active --quiet "\$unit"/)
  assert.match(repair, /codex-worker\.enabled[\s\S]*constructor-publisher\.enabled[\s\S]*constructor-release\.enabled/)
  assert.match(repair, /find "\$spool" -mindepth 1 -maxdepth 1 -printf '%f\\n'/)
  assert.match(repair, /case "\$child" in ready\|ack\|retired\)/)
  assert.match(repair, /\[ -d "\$spool" \] && \[ ! -L "\$spool" \]/)
  assert.match(repair, /install -d -o root -g kelion-handoff -m 2770 "\$spool\/retired"/)
  assert.match(repair, /chmod 2770 "\$spool\/\$child"/)
  const childInstall = repair.indexOf('install -d -o root -g kelion-handoff -m 2770 "$spool/retired"')
  const firstParentChown = repair.indexOf('chown root:kelion-handoff "$spool"')
  const firstParentChmod = repair.indexOf('chmod 00750 "$spool"')
  const finalParentChown = repair.lastIndexOf('chown root:kelion-handoff "$spool"')
  const finalParentChmod = repair.lastIndexOf('chmod 00750 "$spool"')
  const childValidation = repair.indexOf("current_check='children-allowlist'")
  const finalVerify = repair.indexOf("current_check='verify-canonical-layout'")
  assert.ok(firstParentChown >= 0 && firstParentChown < firstParentChmod && firstParentChmod < childValidation,
    'părintele trebuie blocat înaintea validării și mutațiilor copiilor')
  assert.ok(childInstall < finalParentChown && finalParentChown < finalParentChmod && finalParentChmod < finalVerify,
    'părintele trebuie normalizat din nou după copii și înaintea verificării finale')
  assert.match(repair, /current_check="verify-canonical-layout-\$child"/)
  assert.match(repair, /root:kelion-handoff:750/)
  assert.match(repair, /root:kelion-handoff:2770/)
  assert.doesNotMatch(repair, /\$\{\{\s*inputs\.[^}]+\}\}/, 'payload-ul nu trebuie să interpoleze inputuri în shell')
  assert.doesNotMatch(repair, /^\s*(?:sudo\s+)?(?:rm|mv|tee|cp|setfacl)\b/m, 'remedierea nu trebuie să șteargă, mute sau suprascrie conținut')
})

test('configurarea Constructor atribuie fail-closed eșecurile tăcute post-installer fără date secrete', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const stepStart = workflow.indexOf('      - name: Configureaza Constructorul fara activare prematura')
  const stepEnd = workflow.indexOf('\n      - name:', stepStart + 1)
  assert.ok(stepStart >= 0 && stepEnd > stepStart, 'pasul configure-constructor trebuie delimitat')
  const step = workflow.slice(stepStart, stepEnd)
  const remoteStart = step.indexOf("<<'REMOTE'")
  const remoteEnd = step.lastIndexOf('\n          REMOTE')
  assert.ok(remoteStart >= 0 && remoteEnd > remoteStart, 'payload-ul remote configure-constructor trebuie delimitat')
  const remote = step.slice(remoteStart, remoteEnd)

  assert.match(remote, /set -Eeuo pipefail/)
  assert.match(remote, /cleanup_remote\(\) \{\s+trap - ERR/)
  assert.match(remote, /trap cleanup_remote EXIT[\s\S]*trap report_constructor_config_failure ERR/)
  assert.match(remote, /report_constructor_config_failure\(\)[\s\S]*BASH_LINENO/)
  assert.match(remote, /constructor_config_failure[\s\S]*constructor_config_phase[\s\S]*constructor_config_check[\s\S]*source_commit/)

  const expectedPhases = [
    'complete',
    'configuration-preflight',
    'constructor-install',
    'dependency-install',
    'post-installer',
    'remote-preflight',
    'runtime-config-cutover',
  ]
  const phases = [...remote.matchAll(/constructor_config_phase='([^']+)'/g)].map((match) => match[1])
  assert.deepEqual([...new Set(phases)].sort(), expectedPhases)

  const expectedChecks = [
    'apply',
    'bundle-contract',
    'codex-cli-install',
    'codex-cli-link',
    'config-stage',
    'cutover-stage',
    'existing-config-contract',
    'existing-unit-contract',
    'install-resume-contract',
    'installer',
    'node-runtime',
    'package-dependencies',
    'package-index',
    'payload-contract',
    'payload-decode',
    'publisher-gate-image',
    'publisher-repository',
    'resume-installer',
    'runtime-helper-publication',
    'runtime-journal-recovery',
    'secret-stage',
    'signing-key-layout',
    'signing-key-publication',
    'signing-key-registration',
    'signing-key-validation',
    'signing-stale-cleanup',
    'success-message',
    'unit-quiescence',
    'worker-gate-image',
    'worker-profile-publication',
    'worker-repository',
  ]
  const checks = [...remote.matchAll(/constructor_config_check='([^']+)'/g)].map((match) => match[1])
  assert.deepEqual([...new Set(checks)].sort(), expectedChecks)
  assert.equal([...remote.matchAll(/constructor_config_(?:phase|check)=(?!'[a-z0-9-]+')/g)].length, 0,
    'fazele și checkpointurile raportate trebuie să rămână literali din vocabularul fix')

  for (const [check, command] of [
    ['package-index', 'apt-get update -qq'],
    ['package-dependencies', 'apt-get install -y -qq ca-certificates'],
    ['codex-cli-install', "npm install --global --prefix /opt/kelion-codex/npm '@openai/codex@0.149.1'"],
    ['signing-stale-cleanup', 'for stale_signing_root in'],
    ['signing-key-validation', 'validate_signing_key "$signing_key"'],
    ['signing-key-registration', 'existing_keys=$(curl'],
    ['worker-repository', 'clone_or_sync kelion-codex'],
    ['publisher-repository', 'clone_or_sync kelion-publisher'],
    ['worker-gate-image', 'pull_gate kelion-codex'],
    ['publisher-gate-image', 'pull_gate kelion-publisher'],
    ['apply', 'KELION_CUTOVER_LOCK_HELD=1 bash "$work/deploy/lib/runtime-config-cutover.sh"'],
  ]) {
    const labelIndex = remote.indexOf(`constructor_config_check='${check}'`)
    const commandIndex = remote.indexOf(command, labelIndex)
    assert.ok(labelIndex >= 0 && commandIndex > labelIndex, `${check} trebuie setat înainte de comanda atribuită`)
  }

  const handlerStart = remote.indexOf('report_constructor_config_failure() {')
  const handlerEnd = remote.indexOf('\n          }\n          trap report_constructor_config_failure ERR', handlerStart)
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'handlerul ERR trebuie să poată fi extras')
  const handler = remote.slice(handlerStart, handlerEnd + '\n          }'.length)
    .split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
  assert.doesNotMatch(handler, /BASH_COMMAND|bundle|payload|token|secret/,
    'telemetria nu poate include comanda sau materialul sensibil')

  const sourceCommit = 'a'.repeat(40)
  const script = `set -Euo pipefail
constructor_config_phase='post-installer'
constructor_config_check='codex-cli-install'
source_commit='${sourceCommit}'
${handler}
cleanup_remote() { trap - ERR; printf '%s\\n' cleanup-complete; }
trap cleanup_remote EXIT
trap report_constructor_config_failure ERR
fail_inside_function() { return 17; }
fail_inside_function
exit 99
`
  const result = spawnSync(bashExecutable, ['-s'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 17, result.stderr || result.stdout)
  assert.equal(result.stdout.trim(), 'cleanup-complete')
  const events = result.stderr.trim().split(/\r?\n/).filter((line) => line.startsWith('{'))
  assert.equal(events.length, 1, result.stderr)
  const event = JSON.parse(events[0])
  assert.deepEqual({ ...event, line: 0 }, {
    ok: false,
    event: 'constructor_config_failure',
    phase: 'post-installer',
    check: 'codex-cli-install',
    line: 0,
    exit_code: 17,
    source_commit: sourceCommit,
  })
  assert.ok(Number.isInteger(event.line) && event.line > 0)
})

test('configurarea Constructor păstrează ACL-ul canonic al secretelor de producție', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  assert.match(workflow, /stage_value app-secret\.codex-worker-secret "[$]codex_secret"/)
  assert.match(workflow, /stage_value publisher-secret\.github-publisher-token "[$]publisher_token"/)
  assert.match(workflow, /stage_value gate-secret\.github-ghcr-read-token "[$]ghcr_read_token"/)
  assert.match(cutover, /app-secret\.openai-project-key[\s\S]*mapped_target=[$]SECRET_ROOT\/[$]secret_name; mapped_group=10050; mapped_mode=440/)
  assert.match(cutover, /gate-secret\.github-ghcr-read-token[\s\S]*mapped_target=[$]ROOT\/gate-secrets\/github-ghcr-read-token; mapped_mode=400/)
  assert.match(cutover, /publisher-secret\.github-publisher-token[\s\S]*group_id kelion-publisher[\s\S]*mapped_mode=440/)
})

test('politica de retry și checks a Constructorului rămâne aliniată în provisionare, deploy și control', () => {
  const deploy = read('deploy/deploy.sh')
  const provision = read('.github/workflows/vps-set-env.yml')
  const control = read('.github/workflows/vps-run.yml')
  const defaults = {
    CONSTRUCTOR_RETRY_BASE_SECONDS: '60',
    CONSTRUCTOR_RETRY_MAX_SECONDS: '1800',
    CONSTRUCTOR_EXTERNAL_RETRY_SECONDS: '900',
    CONSTRUCTOR_REQUIRED_CHECKS: 'verify,container-isolation,current-tree,merge-policy',
  }

  for (const [name, value] of Object.entries(defaults)) {
    const declaration = `${name}: \${{ vars.${name} || '${value}' }}`
    assert.ok(provision.includes(declaration), `provisionarea nu declară ${name}`)
    assert.ok(control.includes(declaration), `controlul VPS nu declară ${name}`)
    assert.ok(provision.includes(`"${name}=$${name}"`), `runtime.env nu primește ${name}`)
  }

  const deployAllowlist = deploy.slice(deploy.indexOf('declare -A allowed_config'), deploy.indexOf('while IFS='))
  for (const name of Object.keys(defaults)) assert.match(deployAllowlist, new RegExp(`\\b${name}\\b`))
  for (const workflow of [provision, control]) {
    assert.match(workflow, /validate_constructor_seconds CONSTRUCTOR_RETRY_BASE_SECONDS "[$]CONSTRUCTOR_RETRY_BASE_SECONDS" 5 3600/)
    assert.match(workflow, /validate_constructor_seconds CONSTRUCTOR_RETRY_MAX_SECONDS "[$]CONSTRUCTOR_RETRY_MAX_SECONDS" 30 86400/)
    assert.match(workflow, /validate_constructor_seconds CONSTRUCTOR_EXTERNAL_RETRY_SECONDS "[$]CONSTRUCTOR_EXTERNAL_RETRY_SECONDS" 60 86400/)
  }
  assert.match(deploy, /CONSTRUCTOR_RETRY_BASE_SECONDS trebuie să fie între 5 și 3600/)
  assert.match(deploy, /CONSTRUCTOR_RETRY_MAX_SECONDS trebuie să fie între 30 și 86400/)
  assert.match(deploy, /CONSTRUCTOR_EXTERNAL_RETRY_SECONDS trebuie să fie între 60 și 86400/)
  for (const source of [deploy, provision, control]) {
    assert.match(source, /CONSTRUCTOR_REQUIRED_CHECKS trebuie să păstreze verify și container-isolation/)
  }

  assert.match(control, /encode constructor-required-checks "[$]CONSTRUCTOR_REQUIRED_CHECKS"/)
  assert.match(control, /constructor_required_checks=[$][(]decode constructor-required-checks[)]/)
  assert.match(control, /CONSTRUCTOR_REQUIRED_CHECKS=[$]constructor_required_checks/)
  assert.match(control, /CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=verify,container-isolation/)
  assert.match(control, /replacement\["CONSTRUCTOR_RETRY_BASE_SECONDS"\] = retry_base/)
  assert.match(control, /replacement\["CONSTRUCTOR_RETRY_MAX_SECONDS"\] = retry_max/)
  assert.match(control, /replacement\["CONSTRUCTOR_EXTERNAL_RETRY_SECONDS"\] = retry_external/)
  assert.match(control, /replacement\["CONSTRUCTOR_REQUIRED_CHECKS"\] = required_checks/)
  assert.doesNotMatch(control, /set_runtime_value\(\)|set_runtime_value CONSTRUCTOR_/)
  const refresh = deploy.slice(deploy.indexOf('refresh_constructor_gate()'), deploy.indexOf('\nrefresh_constructor_gate\n'))
  assert.match(deploy, /required_checks=[$][(]config_value CONSTRUCTOR_REQUIRED_CHECKS[)]/)
  assert.match(refresh, /targets=[(]"[$]worker_env" "[$]publisher_env" "[$]release_env"[)]/)
  assert.match(refresh, /stage_constructor_env[\s\S]*--validate-env-file "[$][{]logicals\[[$]index\][}]" "[$][{]staged\[[$]index\][}]"[\s\S]*mv -f -- "[$]journal_temporary" "[$]gate_journal"[\s\S]*--recover-only[\s\S]*--leave-constructor-quiesced/)
  assert.ok(refresh.indexOf('--validate-env-file') < refresh.indexOf('mv -f -- "$journal_temporary" "$gate_journal"'),
    'toate cele trei env-uri gate trebuie validate înainte de publicarea jurnalului')
  assert.match(refresh, /assert_constructor_env_value "[$]publisher_env" CONSTRUCTOR_REQUIRED_CHECKS "[$]required_checks"/)
  assert.match(refresh, /assert_constructor_env_value "[$]release_env" CONSTRUCTOR_RELEASE_REQUIRED_CHECKS "[$]release_required_checks"/)
  assert.match(refresh, /token_file=\/root\/kelion\/gate-secrets\/github-ghcr-read-token/)
  assert.match(refresh, /stat -c '%u:%g:%a' "[$]token_file"[)]" = '0:0:400'/)
  assert.match(deploy, /restore_constructor_after_release[\s\S]*systemctl is-enabled --quiet "[$]timer"[\s\S]*systemctl is-active --quiet "[$]timer"/)
  assert.doesNotMatch(refresh, /systemctl (?:stop|enable)[^\n]*[|][|] true/)
  assert.doesNotMatch(control, /^\s+CONSTRUCTOR_REQUIRED_CHECKS=verify,container-isolation$/m)
})

test('systemd păstrează secret stores, userii și spool-ul separate', () => {
  const worker = read('deploy/systemd/kelion-codex-worker.service')
  const publisher = read('deploy/systemd/kelion-constructor-publisher.service')
  const release = read('deploy/systemd/kelion-constructor-release.service')
  assert.match(worker, /User=kelion-codex/)
  assert.match(worker, /LoadCredential=codex-worker-secret:/)
  assert.doesNotMatch(worker, /github-(?:publisher|release)-token/)

  assert.match(publisher, /User=kelion-publisher/)
  assert.match(publisher, /LoadCredential=constructor-publisher-secret:/)
  assert.match(publisher, /LoadCredential=constructor-publisher-secret:\/root\/kelion\/secrets\/constructor-publisher-secret/)
  assert.match(publisher, /LoadCredential=github-publisher-token:/)
  assert.match(publisher, /LoadCredential=github-publisher-signing-key:/)
  assert.match(publisher, /ReadWritePaths=[^\n]*\/var\/lib\/kelion-constructor-handoff/)
  assert.match(read('deploy/constructor-publisher.mjs'), /cleanupAcknowledgedHandoff[\s\S]*failureRecorded && retirement/)
  assert.doesNotMatch(publisher, /codex-worker-secret|constructor-release-secret|github-release-token|VPS/)

  assert.match(release, /User=kelion-release/)
  assert.match(release, /LoadCredential=constructor-release-secret:/)
  assert.match(release, /LoadCredential=constructor-release-secret:\/root\/kelion\/secrets\/constructor-release-secret/)
  assert.match(release, /LoadCredential=github-release-token:/)
  assert.doesNotMatch(release, /codex-worker-secret|constructor-publisher-secret|github-publisher-token|constructor-handoff|VPS/)
  for (const unit of [worker, publisher, release]) {
    assert.match(unit, /NoNewPrivileges=true/)
    assert.match(unit, /ProtectSystem=strict/)
    assert.match(unit, /CapabilityBoundingSet=\n/)
    assert.match(unit, /After=[^\n]*kelion-runtime-config-recovery\.service/)
    assert.match(unit, /ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready/)
    assert.doesNotMatch(unit, /\[Install\]|WantedBy=multi-user\.target/)
  }
  for (const unit of [worker, publisher]) {
    assert.match(unit, /^RestrictNamespaces=user mnt net pid ipc uts$/m)
    assert.doesNotMatch(unit, /^RestrictNamespaces=.*\bmount\b/m)
  }
})

test('quiesce-ul elimină și orice enable legacy al serviciilor oneshot', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const control = read('.github/workflows/vps-run.yml')
  const installer = read('deploy/instaleaza-constructor.sh')
  assert.match(shellFunction(deploy, 'force_quiesce_constructor_release'), /constructor_release_timers[\s\S]*stop_and_disable_constructor_release_timer[\s\S]*constructor_release_services[\s\S]*stop_and_disable_constructor_release_service[\s\S]*systemctl daemon-reload/)
  assert.match(shellFunction(cutover, 'force_quiesce_constructor_units'), /constructor_timers[\s\S]*stop_and_disable_constructor_timer[\s\S]*constructor_services[\s\S]*stop_and_disable_constructor_service[\s\S]*systemctl daemon-reload/)
  assert.match(shellFunction(cutover, 'restore_constructor_timers'), /constructor_services[\s\S]*stop_and_disable_constructor_service[\s\S]*validate_constructor_unit_file_state/)
  assert.match(control, /all_services[\s\S]*stop_and_disable_constructor_service "\$unit"/)
  assert.match(installer, /constructor_services[\s\S]*stop_and_disable_constructor_service "\$unit"/)
  for (const source of [cutover, installer, deploy]) {
    const helper = shellFunction(source, source === deploy
      ? 'stop_and_disable_constructor_release_service'
      : 'stop_and_disable_constructor_service')
    assert.match(helper, /systemctl stop "\$unit"[^\n]*\|\| :[\s\S]*systemctl disable --no-reload "\$unit"[^\n]*\|\| :/)
  }
  assert.match(control,
    /stop_and_disable_constructor_service\(\)[\s\S]*systemctl stop "\$unit"[^\n]*\|\| :[\s\S]*systemctl disable --no-reload "\$unit"[^\n]*\|\| :/)
})

test('workerul oprește copilul activ la pierderea lease-ului și păstrează adevărul porților locale', () => {
  const worker = read('deploy/codex-worker.mjs')
  const runLogged = worker.slice(worker.indexOf('function runLogged'), worker.indexOf('async function reportEvent'))
  const jobLease = worker.slice(worker.indexOf('function startJobLease'), worker.indexOf('async function runOnce'))

  assert.match(runLogged, /const onAbort = \(\) => \{[\s\S]*aborted = true[\s\S]*terminate\(\)/)
  assert.match(runLogged, /signal\?\.addEventListener\('abort', onAbort, \{ once: true \}\)/)
  assert.match(runLogged, /signal\?\.removeEventListener\('abort', onAbort\)/)
  assert.match(runLogged, /child\.kill\('SIGTERM'\)[\s\S]*setTimeout\([\s\S]*child\.kill\('SIGKILL'\)[\s\S]*2_000/)
  assert.match(jobLease, /new AbortController\(\)[\s\S]*controller\.abort\(error\)[\s\S]*stop\.signal = controller\.signal/)
  assert.match(worker, /30 \* 60_000,\s*stopExecLease\.signal/)
  assert.match(worker, /45 \* 60_000,\s*stopGateLease\.signal/)
  assert.equal([...worker.matchAll(/\bci:\s*'local_gates'/g)].length, 2)
  assert.doesNotMatch(worker, /\bci:\s*'green'/)
})

test('workerul face handoff-ul durabil pe disc înainte să confirme receiptul în DB', () => {
  const worker = read('deploy/codex-worker.mjs')
  const publish = worker.slice(worker.indexOf('function publishHandoff'), worker.indexOf('function handoffAckPath'))
  const writePatch = publish.indexOf("writeFileSync(join(staging, 'patch.diff')")
  const syncPatch = publish.indexOf("fsyncPath(join(staging, 'patch.diff'))")
  const syncReceipt = publish.indexOf("fsyncPath(join(staging, 'receipt.json'))")
  const syncStaging = publish.indexOf('fsyncPath(staging)')
  const rename = publish.indexOf('renameSync(staging, target)')
  const syncSourceParent = publish.indexOf('fsyncPath(stagingRoot)', rename)
  const syncTargetParent = publish.indexOf('fsyncPath(HANDOFF_READY)', rename)
  const returned = publish.indexOf('return { handoffId')

  assert.ok(writePatch >= 0 && syncPatch > writePatch && syncReceipt > syncPatch)
  assert.ok(syncStaging > syncReceipt && rename > syncStaging)
  assert.ok(syncSourceParent > rename && syncTargetParent > rename && returned > syncTargetParent)
  assert.match(worker, /HandoffDurabilityUncertainError[\s\S]*handoffMaterialized = true/)
})

test('reconcilierea rezervă loturi separate pentru handoff-uri noi și ACKed', () => {
  const worker = read('deploy/codex-worker.mjs')
  const reconcile = worker.slice(worker.indexOf('async function reconcilePendingHandoffs'), worker.indexOf('function commandOk'))
  assert.match(reconcile, /filter\(\(item\) => !item\.acknowledged\)\.slice\(0, 64\)/)
  assert.match(reconcile, /filter\(\(item\) => item\.acknowledged\)\.slice\(0, 64\)/)
  assert.match(reconcile, /\['merged', 'release_dispatched', 'deployed'\][\s\S]*retireAcknowledgedHandoff/)
  assert.match(reconcile, /status === 409[\s\S]*retireAcknowledgedHandoff/)
})

test('workerul nu publică ready înainte de reconciliere și lipsa unui ordin eligibil', () => {
  const worker = read('deploy/codex-worker.mjs')
  const prepare = worker.slice(worker.indexOf('async function prepareWorkerClaim'), worker.indexOf('async function acceptWorkerClaim'))
  const runOnce = worker.slice(worker.indexOf('async function runOnce'), worker.indexOf('async function selfTest'))
  const reconcile = prepare.indexOf('await reconcile(secret)')
  const claim = prepare.indexOf('await claim(secret)')
  const ready = prepare.indexOf("'ready'")
  const busy = prepare.indexOf("'busy'")

  assert.ok(reconcile >= 0 && claim > reconcile && ready > claim)
  assert.ok(busy > claim)
  assert.match(prepare, /response\.state === 'no_claimable_job'[\s\S]*'ready'[\s\S]*return null/)
  assert.match(prepare, /response\.state === 'pipeline_active'[\s\S]*'busy'[\s\S]*return null/)
  assert.match(prepare, /response\.job[\s\S]*'busy'[\s\S]*return job/)
  assert.match(prepare, /catch \(error\)[\s\S]*degradedWithoutMasking[\s\S]*throw error/)
  assert.doesNotMatch(runOnce, /heartbeat\(secret, 'ready'/)
  assert.match(runOnce, /prepareWorkerClaim\(secret\)[\s\S]*acceptWorkerClaim\(secret, claimed\)/)
})

test('bugetele systemd acoperă execuția Codex și porțile complete', () => {
  const worker = read('deploy/systemd/kelion-codex-worker.service')
  const publisher = read('deploy/systemd/kelion-constructor-publisher.service')
  const value = (unit, key) => {
    const match = unit.match(new RegExp(`^${key}=(\\d+)([A-Za-z]+)$`, 'm'))
    assert.ok(match, `lipsește ${key}`)
    return { amount: Number(match[1]), unit: match[2].toLowerCase() }
  }
  const minutes = (limit) => limit.unit === 'h' ? limit.amount * 60 : limit.unit === 'min' ? limit.amount : NaN
  const gibibytes = (limit) => limit.unit === 'g' ? limit.amount : limit.unit === 'm' ? limit.amount / 1024 : NaN

  assert.ok(minutes(value(worker, 'TimeoutStartSec')) >= 100)
  assert.ok(gibibytes(value(worker, 'MemoryMax')) >= 6)
  assert.ok(minutes(value(publisher, 'TimeoutStartSec')) >= 120)
})

test('installerul canonic lasă toate serviciile dezactivate și nu creează secrete', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  assert.match(installer, /KELION_CONSTRUCTOR_INSTALL/)
  assert.match(installer, /set -Eeuo pipefail/)
  assert.match(installer, /"event":"installer_failure","phase":"%s","line":%s,"exit_code":%s,"source_commit":"%s"/)
  assert.match(installer, /::error::Constructor installer gate: phase=%s line=%s exit=%s source_commit=%s/)
  assert.match(installer, /trap 'capture_constructor_install_failure "[$]LINENO"' ERR/)
  assert.match(installer, /trap report_constructor_install_failure EXIT/)
  assert.doesNotMatch(shellFunction(installer, 'report_constructor_install_failure'), /BASH_COMMAND|set -x|printf[^\n]*(?:token|secret|value|env)/i)
  assert.match(installer, /KELION_CONSTRUCTOR_SOURCE_COMMIT/)
  assert.match(installer, /constructor_install_assert "[$]LINENO" test "[$][(]readlink/)
  assert.match(installer, /constructor_install_assert "[$]LINENO" test "[$][(]realpath -e/)
  assert.match(installer, /usermod_help=[$][(]usermod --help 2>&1[)]/)
  assert.match(installer, /grep -Fq -- "[$]required_usermod_option" <<<"[$]usermod_help"/)
  assert.doesNotMatch(installer, /usermod --help 2>&1\s*[|]\s*grep -q/)
  assert.match(installer, /systemd-analyze verify/)
  assert.match(installer, /kelion-worker\.config\.toml/)
  assert.match(installer, /constructor_markers=\(\/etc\/kelion\/codex-worker\.enabled \/etc\/kelion\/constructor-publisher\.enabled \/etc\/kelion\/constructor-release\.enabled\)/)
  assert.match(installer, /rm -f -- "[$][{]constructor_markers\[@\][}]"\s+sync -f \/etc\/kelion/)
  assert.match(installer, /systemctl enable kelion-runtime-config-recovery\.service/)
  assert.match(installer, /install -d -o root -g root -m 0755 \/etc\/kelion[\s\S]*stat -c '%u:%g:%a' \/etc\/kelion[\s\S]*sync -f \/etc\/kelion[\s\S]*sync -f \/etc/)
  assert.match(installer, /readlink "[$]recovery_wants_link"[)]" = \/etc\/systemd\/system\/kelion-runtime-config-recovery\.service/)
  assert.doesNotMatch(installer, /readlink "[$]recovery_wants_link"[)]" = \.\.\//)
  const lock = installer.indexOf('acquire_publication_lock ||')
  const identities = installer.indexOf('ensure_group kelion-handoff')
  const transaction = installer.indexOf('stage_install_transaction')
  assert.ok(lock >= 0 && identities > lock && transaction > lock,
    'identitățile și tranzacția durabilă se modifică numai sub lock-ul comun dovedit')
  const logicalBlock = installer.slice(installer.indexOf('install_logicals=('), installer.indexOf('\n)', installer.indexOf('install_logicals=(')))
  assert.equal(logicalBlock.split('\n').filter((line) => /^  [a-z0-9.-]+$/.test(line)).length, 19)
  const withoutRecoveryEnable = installer.replace(/systemctl enable kelion-runtime-config-recovery\.service[^\n]*/, '')
  assert.doesNotMatch(withoutRecoveryEnable, /systemctl\s+(?:enable|start|restart)|openssl\s+rand|ghp_|github_pat_|CODEX_HOME=.*login/)
})

test('telemetria instalatorului rămâne fail-closed și nu divulgă mediul', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const reporter = shellFunction(installer, 'report_constructor_install_failure')
  const capture = shellFunction(installer, 'capture_constructor_install_failure')
  const canary = `CANARY-CONSTRUCTOR-${process.pid}-${Date.now()}`
  const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
  if (process.platform === 'win32') {
    assert.ok(existsSync(bashExecutable), `bash indisponibil: ${bashExecutable}`)
  }
  const probe = spawnSync(bashExecutable, ['-c', `
set -Eeuo pipefail
constructor_install_phase=unit-validation
constructor_install_failure_line=0
constructor_install_source_commit=${sourceCommit}
${reporter}
${capture}
trap 'capture_constructor_install_failure "$LINENO"' ERR
trap report_constructor_install_failure EXIT
false
`], {
    encoding: 'utf8',
    env: { ...process.env, CANARY_SECRET: canary },
  })

  assert.equal(probe.status, 1)
  assert.equal(probe.stdout, '')
  assert.match(probe.stderr,
    /{"ok":false,"event":"installer_failure","phase":"unit-validation","line":\d+,"exit_code":1,"source_commit":"0123456789abcdef0123456789abcdef01234567"}/)
  assert.match(probe.stderr,
    /::error::Constructor installer gate: phase=unit-validation line=\d+ exit=1 source_commit=0123456789abcdef0123456789abcdef01234567/)
  assert.doesNotMatch(probe.stdout + probe.stderr, new RegExp(canary))
  assert.doesNotMatch(probe.stdout + probe.stderr, /CANARY_SECRET|BASH_COMMAND|(?:^|\n)false(?:\n|$)/)
})

test('mapările subuid/subgid sunt validate strict și publicate atomic', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const validator = shellFunction(installer, 'validate_subid_map')
  const ensure = shellFunction(installer, 'ensure_subids')
  const firstSubidCommit = installer.lastIndexOf('ensure_subids kelion-codex')
  const durableQuiesce = installer.lastIndexOf('write_install_journal quiesced', firstSubidCommit)
  const secondSubidCommit = installer.lastIndexOf('ensure_subids kelion-publisher')
  assert.ok(durableQuiesce >= 0 && firstSubidCommit > durableQuiesce && secondSubidCommit > firstSubidCommit,
    'ambele mapări se publică numai după jurnalul quiesced, pentru recovery fail-closed între rename-uri')
  assert.match(ensure, /update_command=\(usermod\)[\s\S]*--add-subuids[\s\S]*--add-subgids[\s\S]*"[$][{]update_command\[@\][}]" "[$]user_name"/)
  assert.match(ensure, /cleanup_command=\(usermod\)[\s\S]*--del-subuids[\s\S]*--del-subgids[\s\S]*"[$][{]cleanup_command\[@\][}]" "[$]user_name"/)
  assert.match(ensure, /fsync_subid_path "[$]uid_file"[\s\S]*fsync_subid_path "[$]gid_file"[\s\S]*fsync_subid_path "[$]etc_root"/)
  assert.match(ensure, /"[$][{]update_command\[@\][}]" "[$]user_name" \|\| :[\s\S]*uid_final=.*require-existing[\s\S]*gid_final=.*require-existing[\s\S]*if \[ "[$]uid_final" = valid \] && \[ "[$]gid_final" = valid \]/)
  assert.doesNotMatch(ensure, /update_ok|\[ "[$](?:update|usermod)_status" = 0 \]/)
  assert.doesNotMatch(ensure, /(?:>>|mv -f|cp |install ).*(?:subuid|subgid|"\$uid_file"|"\$gid_file")/)

  const bundledPython = join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
  const pythonShim = process.platform === 'win32' && existsSync(bundledPython)
    ? `python3() { "${bundledPython.replaceAll('\\', '/')}" "$@"; }\n`
    : ''
  const script = `set -euo pipefail
${pythonShim}
${validator}
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
printf '%s\\n' 'other:100000:65536' > "$test_root/live"
result=$(validate_subid_map "$test_root/live" kelion-codex allow-missing)
[ "$result" = missing:165536 ]
printf '%s\\n' 'other:100000:65536' 'kelion-codex:165536:65536' > "$test_root/candidate"
[ "$(validate_subid_map "$test_root/candidate" kelion-codex require-existing)" = valid ]

printf 'kelion-codex:' > "$test_root/truncated"
if validate_subid_map "$test_root/truncated" kelion-codex allow-missing >/dev/null 2>&1; then exit 51; fi
printf '%s\\n' 'kelion-codex:100000:65536' 'kelion-codex:200000:65536' > "$test_root/duplicate"
if validate_subid_map "$test_root/duplicate" kelion-codex require-existing >/dev/null 2>&1; then exit 52; fi
printf '%s\\n' 'first:100000:65536' 'second:150000:65536' > "$test_root/overlap"
if validate_subid_map "$test_root/overlap" kelion-codex allow-missing >/dev/null 2>&1; then exit 53; fi
printf '%s\\n' 'kelion-codex:100000:1024' > "$test_root/short"
if validate_subid_map "$test_root/short" kelion-codex require-existing >/dev/null 2>&1; then exit 54; fi
printf '%s\\n' 'kelion-codex:0100000:65536' > "$test_root/noncanonical"
if validate_subid_map "$test_root/noncanonical" kelion-codex require-existing >/dev/null 2>&1; then exit 55; fi
`
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  // Writerul concurent publică după calculul intervalului, înainte de updater.
  // Mockul updaterului nativ recitește live la apel (precum usermod sub lock) și
  // dovedește că linia celuilalt cont nu este pierdută de commitul Kelion.
  const concurrencyScript = `set -euo pipefail
${pythonShim}
${validator}
${ensure}
validate_subid_path() { [ -f "$1" ] && [ ! -L "$1" ]; }
fsync_subid_path() { [ -e "$1" ]; }
fake_started=0
usermod() {
  local prefix='' add_uid='' add_gid='' del_uid='' del_gid='' user start end count
  while [ "$#" -gt 1 ]; do
    case "$1" in
      --prefix) prefix=$2; shift 2 ;;
      --add-subuids) add_uid=$2; shift 2 ;;
      --add-subgids) add_gid=$2; shift 2 ;;
      --del-subuids) del_uid=$2; shift 2 ;;
      --del-subgids) del_gid=$2; shift 2 ;;
      *) return 91 ;;
    esac
  done
  user=$1
  if [ "$fake_started" = 0 ]; then
    fake_started=1
    : > "$prefix/update-requested"
    while [ ! -f "$prefix/concurrent-done" ]; do sleep 0.01; done
  fi
  [ -z "$del_uid$del_gid" ] || return 92
  if [ -n "$add_uid" ]; then
    start=$(printf '%s' "$add_uid" | cut -d- -f1); end=$(printf '%s' "$add_uid" | cut -d- -f2); count=$((end - start + 1))
    printf '%s:%s:%s\\n' "$user" "$start" "$count" >> "$prefix/etc/subuid"
  fi
  if [ -n "$add_gid" ]; then
    start=$(printf '%s' "$add_gid" | cut -d- -f1); end=$(printf '%s' "$add_gid" | cut -d- -f2); count=$((end - start + 1))
    printf '%s:%s:%s\\n' "$user" "$start" "$count" >> "$prefix/etc/subgid"
  fi
}
prefix=$(mktemp -d)
trap 'rm -rf -- "$prefix"' EXIT
mkdir "$prefix/etc"
printf '%s\\n' 'other:100000:65536' > "$prefix/etc/subuid"
printf '%s\\n' 'other:100000:65536' > "$prefix/etc/subgid"
(
  while [ ! -f "$prefix/update-requested" ]; do sleep 0.01; done
  printf '%s\\n' 'concurrent:300000:65536' >> "$prefix/etc/subuid"
  printf '%s\\n' 'concurrent:300000:65536' >> "$prefix/etc/subgid"
  : > "$prefix/concurrent-done"
) &
writer=$!
ensure_subids kelion-codex "$prefix"
wait "$writer"
grep -qx 'other:100000:65536' "$prefix/etc/subuid"
grep -qx 'concurrent:300000:65536' "$prefix/etc/subuid"
grep -qx 'kelion-codex:165536:65536' "$prefix/etc/subuid"
grep -qx 'other:100000:65536' "$prefix/etc/subgid"
grep -qx 'concurrent:300000:65536' "$prefix/etc/subgid"
grep -qx 'kelion-codex:165536:65536' "$prefix/etc/subgid"
`
  const concurrent = spawnSync(bash, ['-s'], { input: concurrencyScript, encoding: 'utf8' })
  assert.equal(concurrent.status, 0, concurrent.stderr || concurrent.stdout)

  // Alt proces poate publica exact maparea țintă după precheck. Un usermod
  // care vede duplicatul poate ieși nonzero; starea strict validă trebuie
  // acceptată fără ca ramura de cleanup să șteargă maparea concurentului.
  const sameUserConcurrencyScript = `set -euo pipefail
${pythonShim}
${validator}
${ensure}
validate_subid_path() { [ -f "$1" ] && [ ! -L "$1" ]; }
fsync_subid_path() { [ -e "$1" ]; }
usermod() {
  local prefix='' deleting=0
  while [ "$#" -gt 1 ]; do
    case "$1" in
      --prefix) prefix=$2; shift 2 ;;
      --add-subuids|--add-subgids) shift 2 ;;
      --del-subuids|--del-subgids) deleting=1; shift 2 ;;
      *) return 91 ;;
    esac
  done
  if [ "$deleting" = 1 ]; then
    : > "$prefix/cleanup-called"
    return 0
  fi
  printf '%s\n' 'kelion-codex:165536:65536' >> "$prefix/etc/subuid"
  printf '%s\n' 'kelion-codex:165536:65536' >> "$prefix/etc/subgid"
  return 73
}
prefix=$(mktemp -d)
trap 'rm -rf -- "$prefix"' EXIT
mkdir "$prefix/etc"
printf '%s\n' 'other:100000:65536' > "$prefix/etc/subuid"
printf '%s\n' 'other:100000:65536' > "$prefix/etc/subgid"
ensure_subids kelion-codex "$prefix"
[ ! -e "$prefix/cleanup-called" ]
[ "$(grep -cx 'kelion-codex:165536:65536' "$prefix/etc/subuid")" = 1 ]
[ "$(grep -cx 'kelion-codex:165536:65536' "$prefix/etc/subgid")" = 1 ]
`
  const sameUserConcurrent = spawnSync(bash, ['-s'], { input: sameUserConcurrencyScript, encoding: 'utf8' })
  assert.equal(sameUserConcurrent.status, 0, sameUserConcurrent.stderr || sameUserConcurrent.stdout)
})

test('bootstrap-ul celor șase unități este jurnalizat și recuperă sigur orice set 1..5', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const control = read('.github/workflows/vps-run.yml')
  const intent = installer.lastIndexOf('stage_install_transaction')
  const quiesce = installer.lastIndexOf('quiesce_before_install')
  const firstPublish = installer.indexOf('publish_install_candidate "$logical"', quiesce)
  const stage = installer.indexOf('unit_stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX")')
  const invoke = installer.indexOf('"$unit_stage" "$ROOT/config/compose.production.yml" --leave-constructor-quiesced', stage)
  assert.ok(intent >= 0 && quiesce > intent && firstPublish > quiesce && stage > firstPublish && invoke > stage,
    'intentul durabil și quiesce-ul preced orice publicare, iar helperul candidat precede tranzacția celor șase unități')
  assert.match(shellFunction(installer, 'stage_install_transaction'), /sync -f "[$]install_root\/manifest"[\s\S]*sync -f "[$]install_root\/files"[\s\S]*sync -f "[$]install_root"[\s\S]*write_install_journal armed/)
  assert.equal((installer.slice(stage, invoke).match(/systemd-(?:timer|service)\.\$unit/g) ?? []).length, 6)
  assert.doesNotMatch(installer, /install[^\n]*deploy\/systemd\/\$unit[^\n]*\/etc\/systemd\/system\/\$unit/)

  const journal = cutover.indexOf('write_journal_phase prepared')
  const firstMutation = cutover.indexOf('mutation_started=1', journal)
  const firstRename = cutover.indexOf('mv -f -- "${prepared[$index]}"', firstMutation)
  assert.ok(journal >= 0 && firstMutation > journal && firstRename > firstMutation,
    'jurnalul fsync trebuie publicat înainte de primul rename systemd')
  const recovery = cutover.slice(cutover.indexOf('recover_interrupted_cutover()'), cutover.indexOf('garbage_collect_transactions()'))
  assert.match(recovery, /manifestul de rollback au fost autentificate[\s\S]*quiesce_units_for_recovery 1[\s\S]*rollback-ul durabil/)
  assert.match(cutover, /prepared\|files-committed\|backend-recreated[\s\S]*force_quiesce_constructor_units 1[\s\S]*restore_files/)
  const forwardCreate = cutover.indexOf('install -d -o root -g root -m 0700 "$transaction_root/forward"')
  const forwardSync = cutover.indexOf('fsync_path "$transaction_root/forward"', forwardCreate)
  assert.ok(forwardCreate >= 0 && forwardSync > forwardCreate && journal > forwardSync,
    'toți candidații roll-forward și manifestul lor trebuie fsync înainte de jurnal')
  const rollForward = shellFunction(cutover, 'roll_forward_unit_transaction')
  assert.equal((rollForward.match(/\[systemd-(?:timer|service)\.[^\]]+\]=1/g) ?? []).length, 6)
  assert.match(rollForward, /sha256sum[\s\S]*quiesce_units_for_recovery 1[\s\S]*unit-forward[\s\S]*systemctl daemon-reload[\s\S]*force_quiesce_constructor_units[\s\S]*wait_for_live_constructor_units_quiesced[\s\S]*clear_runtime_ready_stamp/)
  for (const stage of ['pre-quiesce', 'daemon-reload', 'post-quiesce', 'strict-live-unit-contract', 'ready-clear']) {
    assert.match(rollForward, new RegExp(`unit-roll-forward:${stage}`))
  }
  assert.doesNotMatch(rollForward, /validate_live_runtime_contract|publish_runtime_ready_stamp|restore_constructor_timers/)
  const forwardRecovery = recovery.indexOf('roll_forward_unit_transaction "$recovery_root"')
  const legacyRollback = recovery.indexOf('rollback-ul durabil al fișierelor')
  assert.ok(forwardRecovery >= 0 && legacyRollback > forwardRecovery,
    'orice mix vechi/nou 1..5 trebuie terminat cu candidații noi înaintea ramurii legacy de rollback')
  const cleanup = shellFunction(cutover, 'cleanup_cutover')
  assert.match(cleanup, /unit_only_transaction" = 1[\s\S]*roll_forward_unit_transaction "\$transaction_root"/)
  const pendingWriter = shellFunction(cutover, 'publish_unit_migration_pending')
  const retractReady = pendingWriter.indexOf('clear_runtime_ready_stamp')
  const publishPending = pendingWriter.indexOf('mv -f -- "$temporary" "$UNIT_MIGRATION_PENDING"', retractReady)
  const fsyncPending = pendingWriter.indexOf('fsync_path "$RUNTIME_ROOT"', publishPending)
  assert.ok(retractReady >= 0 && publishPending > retractReady && fsyncPending > publishPending,
    'ready este retras durabil înainte ca bariera pending să ajungă vizibilă')
  const main = cutover.slice(cutover.indexOf('mapfile -t manifest_entries'))
  const pending = main.indexOf('publish_unit_migration_pending')
  const initialQuiesce = main.indexOf('quiesce_constructor_units', pending)
  const durableJournal = main.indexOf('write_journal_phase prepared', initialQuiesce)
  const firstLiveRename = main.indexOf('mv -f -- "${prepared[$index]}"', durableJournal)
  assert.ok(pending >= 0 && initialQuiesce > pending && durableJournal > initialQuiesce && firstLiveRename > durableJournal,
    'unit-only retrage ready și publică pending înainte de primul stop, apoi jurnalizează înainte de rename')

  const resumeInstaller = control.indexOf('bash "$work/deploy/instaleaza-constructor.sh"')
  const precheck = control.indexOf("case \"$unit_count\" in")
  const normalInstaller = control.indexOf('if [ "$constructor_install_resumed" = 0 ]', precheck)
  assert.ok(resumeInstaller >= 0 && precheck > resumeInstaller && normalInstaller > precheck,
    'retry-ul reia intentul de instalare autentificat înainte să refuze un set parțial 1..5')
  assert.match(control.slice(control.indexOf('constructor_install_resume=0'), precheck),
    /\.kind == "constructor-install"[\s\S]*constructor_install_resume=1[\s\S]*KELION_CONSTRUCTOR_INSTALL=1 KELION_CUTOVER_LOCK_HELD=1[\s\S]*instaleaza-constructor\.sh[\s\S]*constructor_install_resumed=1/)
  assert.match(control, /\*\) echo 'Set systemd Constructor parțial; configurarea este refuzată'/)
})

test('contractul runtime validează tupla efectivă și din nou live înainte de stamp', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const validateLive = shellFunction(cutover, 'validate_live_runtime_contract')
  const validateState = shellFunction(cutover, 'validate_constructor_state')
  const publish = shellFunction(cutover, 'publish_runtime_ready_stamp')
  assert.match(validateLive, /unit_count[\s\S]*config_count[\s\S]*marker_count/)
  assert.match(validateLive, /0\) \[ "\$config_count" -eq 0 \] && \[ "\$marker_count" -eq 0 \]/)
  assert.match(validateState, /staged_unit_count[\s\S]*effective_unit_count[\s\S]*constructor_configured/)
  assert.match(validateState, /staging parțial al celor șase unități Constructor/)
  assert.match(validateState, /runtime-ul efectiv activează Constructor fără cele trei configuri/)
  assert.match(validateState, /flagurile runtime active cer configuri și unități Constructor complete/)
  assert.match(validateLive, /config_count" -eq 0[\s\S]*worker_enabled" = 0[\s\S]*publisher_enabled" = 0[\s\S]*release_enabled" = 0/)
  assert.match(validateLive, /worker_enabled" = 1[\s\S]*config_count" -eq 3[\s\S]*unit_count" -eq 6/)
  assert.match(publish, /validate_live_runtime_contract \|\| return 1/)
  const commit = cutover.slice(cutover.indexOf('mutation_started=1'), cutover.indexOf("if ! remove_transaction_dir", cutover.indexOf('mutation_started=1')))
  assert.match(commit, /validate_live_runtime_contract[\s\S]*write_journal_phase files-committed[\s\S]*validate_live_runtime_contract[\s\S]*write_journal_phase committed[\s\S]*publish_runtime_ready_stamp/)
})

test('validatorii unităților derivă identitatea exclusiv din argumentul explicit', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const validateText = shellFunction(cutover, 'validate_text_file_bytes')
  const validateTimer = shellFunction(cutover, 'validate_constructor_timer_unit')
  const validateService = shellFunction(cutover, 'validate_constructor_service_unit')
  const script = `set -euo pipefail
${validateText}
${validateTimer}
${validateService}
validate_from_conflicting_scope() {
  local logical=systemd-service.kelion-constructor-release.service
  validate_constructor_timer_unit \
    deploy/systemd/kelion-codex-worker.timer \
    systemd-timer.kelion-codex-worker.timer
  logical=systemd-timer.kelion-constructor-release.timer
  validate_constructor_service_unit \
    deploy/systemd/kelion-codex-worker.service \
    systemd-service.kelion-codex-worker.service
}
reject_spoofed_argument() {
  local logical=systemd-timer.kelion-codex-worker.timer
  if validate_constructor_timer_unit \
    deploy/systemd/kelion-codex-worker.timer systemd-timer.unknown; then return 1; fi
  logical=systemd-service.kelion-codex-worker.service
  if validate_constructor_service_unit \
    deploy/systemd/kelion-codex-worker.service systemd-service.unknown; then return 1; fi
}
validate_from_conflicting_scope
reject_spoofed_argument
unset logical
validate_constructor_timer_unit \
  deploy/systemd/kelion-codex-worker.timer \
  systemd-timer.kelion-codex-worker.timer
validate_constructor_service_unit \
  deploy/systemd/kelion-codex-worker.service \
  systemd-service.kelion-codex-worker.service`
  const result = spawnSync(bashExecutable, ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('workflows refuză bundle-ul dacă master avansează chiar înainte de primul mutator VPS', () => {
  for (const path of ['.github/workflows/vps-run.yml', '.github/workflows/vps-set-env.yml']) {
    const workflow = read(path)
    const latest = workflow.lastIndexOf('latest_master=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/master"')
    const scp = workflow.indexOf('scp "${ssh_opts[@]}"', latest)
    assert.ok(latest >= 0 && scp > latest)
    assert.match(workflow.slice(latest, scp), /\[ "\$bundle_commit" = "\$latest_master" \]/)
  }
})

test('backendul autorizează fiecare tranziție numai pe ruta domeniului său', () => {
  const route = read('backend/src/routes/constructor.ts')
  const auth = read('backend/src/services/constructorServiceAuth.ts')
  const migration = read('backend/migrations/20260901_constructor_publication_pipeline.sql')
  const workerEvent = route.slice(route.indexOf("'/api/internal/codex/jobs/:id/event'"), route.indexOf("'/api/internal/constructor-publisher/jobs/claim'"))
  assert.doesNotMatch(workerEvent, /event === 'pr_opened'|event === 'merged'|event === 'deployed'/)
  assert.match(route, /verifyPublisherRequest[\s\S]*recordPublisherPrOpened[\s\S]*recordPublisherMerged/)
  assert.match(route, /verifyReleaseRequest[\s\S]*recordReleaseDispatched[\s\S]*recordReleaseDeployed/)
  assert.match(auth, /constructor-publisher[\s\S]*x-constructor-publisher/)
  assert.match(auth, /'constructor-release'/)
  assert.match(auth, /'x-constructor-release'/)
  assert.match(migration, /PRIMARY KEY \(service_domain, nonce\)/)
  assert.match(migration, /publisher_lease_id UUID UNIQUE/)
  assert.match(migration, /release_lease_id UUID UNIQUE/)
})

test('workflow-ul de producție corelează idempotent cererea și rămâne environment-scoped', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const releaseJob = workflow.slice(workflow.indexOf('\n  release:'), workflow.indexOf('\n      - name: Dovadă externă exactă'))
  assert.match(workflow, /run-name: production-\$\{\{ inputs\.release_request_id \}\}-\$\{\{ inputs\.commit_sha \}\}-\$\{\{ inputs\.ci_run_id \}\}-\$\{\{ inputs\.build_run_id \}\}/)
  assert.match(workflow, /release_request_id:[\s\S]*required: true/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /CANDIDATE_SHA[\s\S]*origin\/master/)
  assert.match(releaseJob, /environment: production[\s\S]*git\/ref\/heads\/master[\s\S]*CANDIDATE_SHA" != "\$current_master[\s\S]*printf '%s' "\$REGISTRY_TOKEN" \| ssh/)
  assert.match(workflow, /actions\/runs\/[$][{]EXPECTED_CI_RUN_ID[}][\s\S]*pr-verify\.yml[\s\S]*actions\/runs\/[$][{]EXPECTED_BUILD_RUN_ID[}][\s\S]*build-images\.yml/)
  assert.doesNotMatch(workflow, /pull_request_target|continue-on-error/)
})

test('release-ul automat acceptă botul GitHub Actions fără să lărgească username-ul SSH', () => {
  const workflow = read('.github/workflows/deploy.yml')
  assert.ok(workflow.includes('[[ "$GITHUB_ACTOR" =~ ^[A-Za-z0-9-]+(\\[bot\\])?$ ]]'))
  assert.match(workflow, /docker login ghcr\.io --username '\$GITHUB_ACTOR' --password-stdin/)

  const actorContract = /^[A-Za-z0-9-]+(?:\[bot\])?$/
  for (const actor of ['kelion-team', 'github-actions[bot]', 'dependabot[bot]']) assert.match(actor, actorContract)
  for (const actor of ["bad'actor", 'bad actor', 'bad_actor', 'bot[bot]suffix']) assert.doesNotMatch(actor, actorContract)
})

test('identitatea workflow-ului release supraviețuiește avansării ref-ului după dispatch', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const release = read('deploy/constructor-release.mjs')
  const identity = release.slice(release.indexOf('function releaseRunTitles'), release.indexOf('function shouldRerunRelease'))

  assert.match(workflow, /title="production-\$RELEASE_REQUEST_ID-\$CANDIDATE_SHA-\$CI_RUN_ID-\$BUILD_RUN_ID"/)
  assert.match(identity, /releaseRunIdentityMatches[\s\S]*display_title/)
  assert.doesNotMatch(identity, /head_sha !== commit/)
  assert.match(release, /Identitatea tuplei release nu tolerează avansarea ref-ului după dispatch/)
})

test('identitatea buildului rămâne legată de sursa CI când ref-ul workflow_run a avansat', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const release = read('deploy/constructor-release.mjs')
  const identity = release.slice(release.indexOf('function buildRunIdentityMatches'), release.indexOf('async function exactSuccessfulBuildArtifact'))
  const buildLookup = workflow.slice(workflow.indexOf('expected_title="build-release-'), workflow.indexOf('          elif [ -z "$EXPECTED_CI_RUN_ID"'))
  const buildVerification = workflow.slice(workflow.indexOf('          build_run=$(gh api'), workflow.indexOf('          build_run_id=$EXPECTED_BUILD_RUN_ID'))

  assert.match(identity, /\^\[0-9a-f\]\{40\}\$[\s\S]*head_sha/)
  assert.match(identity, /event === 'workflow_run'[\s\S]*path === BUILD_WORKFLOW_PATH[\s\S]*display_title === `build-release-/)
  assert.doesNotMatch(identity, /head_sha\s*[!=]==?\s*commit/)
  assert.match(release, /Identitatea buildului nu tolerează avansarea ref-ului workflow_run/)
  assert.match(buildLookup, /head_sha \| test\("\^\[0-9a-f\]\{40\}\$"\)/)
  assert.match(buildLookup, /path == "\.github\/workflows\/build-images\.yml"[\s\S]*display_title == \$title/)
  assert.doesNotMatch(buildLookup, /head_sha == \$sha/)
  assert.match(buildVerification, /head_sha \| test\("\^\[0-9a-f\]\{40\}\$"\)/)
  assert.match(buildVerification, /path == "\.github\/workflows\/build-images\.yml"[\s\S]*display_title == \$title/)
  assert.doesNotMatch(buildVerification, /head_sha == \$sha/)
})

test('releaserul retrage un workflow reușit dacă master a avansat înainte de done', () => {
  const release = read('deploy/constructor-release.mjs')
  const pipeline = read('backend/src/services/constructorPipeline.ts')
  const migration = read('backend/migrations/20260908_constructor_release_dispatch_intents.sql')
  const successfulChecks = [...release.matchAll(/const liveVersion = await externalProof/g)].map((match) => match.index)

  assert.equal(successfulChecks.length, 2)
  for (const start of successfulChecks) {
    const tail = release.slice(start, start + 2_800)
    const masterCheck = tail.indexOf('await retireSuccessful')
    const deployed = tail.indexOf("event: 'deployed'")
    assert.ok(masterCheck > 0 && deployed > masterCheck,
      'master trebuie reverificat după dovada live și înainte de done')
  }
  assert.match(release, /retireSuccessfulV1IfSuperseded[\s\S]*currentMasterIncludingTarget[\s\S]*target_advanced_after_success[\s\S]*event: 'dispatch_retired'/)
  assert.match(release, /retireSuccessfulRunIfSuperseded[\s\S]*currentMasterIncludingTarget[\s\S]*target_advanced_after_success[\s\S]*event: 'dispatch_retired'/)
  assert.equal((release.match(/await retireSuccessfulV1IfSuperseded\(\)/g) ?? []).length, 2)
  assert.equal((release.match(/await retireSuccessfulRunIfSuperseded\(\)/g) ?? []).length, 2)
  assert.match(pipeline, /'target_advanced_after_success'/)
  assert.match(migration, /'target_advanced_after_success'/)
})

test('credentialele GitHub dedicate nu se amestecă între Admin, gate și identitățile Constructor', () => {
  const control = read('.github/workflows/vps-run.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const deploy = read('deploy/deploy.sh')
  const compose = read('deploy/compose.production.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const units = [
    read('deploy/systemd/kelion-codex-worker.service'),
    read('deploy/systemd/kelion-constructor-publisher.service'),
    read('deploy/systemd/kelion-constructor-release.service'),
  ].join('\n')

  assert.match(control, /SYNC_GITHUB_TOKEN: [$][{][{] secrets\.CONSTRUCTOR_SYNC_GITHUB_TOKEN [}][}]/)
  assert.match(control, /GHCR_READ_TOKEN: [$][{][{] secrets\.CONSTRUCTOR_GHCR_READ_TOKEN [}][}]/)
  assert.match(control, /github_tokens=\("[$]SYNC_GITHUB_TOKEN" "[$]PUBLISHER_GITHUB_TOKEN" "[$]RELEASE_GITHUB_TOKEN" "[$]GHCR_READ_TOKEN"\)/)
  assert.match(control, /pull_gate kelion-codex \/run\/kelion-codex "[$]ghcr_read_token"/)
  assert.match(control, /pull_gate kelion-publisher \/run\/kelion-publisher "[$]ghcr_read_token"/)
  assert.doesNotMatch(control, /pull_gate kelion-(?:codex|publisher)[^\n]*"[$](?:sync_token|publisher_token)"/)
  assert.match(deploy, /token_file=\/root\/kelion\/gate-secrets\/github-ghcr-read-token/)
  assert.doesNotMatch(deploy, /token_file=\/root\/kelion\/publisher-secrets\/github-publisher-token/)

  assert.match(provision, /GITHUB_RELEASE_OAUTH_TOKEN: [$][{][{] secrets\.RELEASE_GITHUB_TOKEN [}][}]/)
  assert.match(provision, /stage_value app-secret\.github-release-oauth-token "[$]oauth_token"/)
  assert.match(compose, /GITHUB_RELEASE_OAUTH_TOKEN_FILE: \/run\/secrets\/github-release-oauth-token/)
  assert.match(compose, /source: [$][{]KELION_SECRET_ROOT[^\n]*\/github-release-oauth-token[\s\S]*target: \/run\/secrets\/github-release-oauth-token/)
  assert.doesNotMatch(units, /github-release-oauth-token|github-ghcr-read-token/)
  assert.match(cutover, /assert_pairwise_distinct 'tokenurile GitHub Constructor și OAuth Admin'[\s\S]*worker-secret\.github-worker-token[\s\S]*app-secret\.github-release-oauth-token/)
})

test('cutover-ul runtime oprește toate unitățile, face rollback de grup și recreează backendul înainte de activare', () => {
  const deploy = read('deploy/deploy.sh')
  const control = read('.github/workflows/vps-run.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')

  assert.match(cutover, /constructor_timers=\([\s\S]*kelion-codex-worker\.timer[\s\S]*kelion-constructor-publisher\.timer[\s\S]*kelion-constructor-release\.timer/)
  assert.match(cutover, /constructor_services=\([\s\S]*kelion-codex-worker\.service[\s\S]*kelion-constructor-publisher\.service[\s\S]*kelion-constructor-release\.service/)
  assert.match(cutover, /force_quiesce_constructor_units[\s\S]*restore_files[\s\S]*recreate_active_release[\s\S]*restore_constructor_timers/)
  assert.match(cutover, /--force-recreate --wait --wait-timeout 180/)
  assert.match(cutover, /mutation_started=1[\s\S]*mv -f --[\s\S]*config_consistent=1[\s\S]*recreate_active_release[\s\S]*restore_constructor_timers/)

  assert.match(control, /KELION_CUTOVER_LOCK_HELD=1 bash "[$]work\/deploy\/lib\/runtime-config-cutover\.sh" "[$]cutover_stage"/)
  assert.match(provision, /KELION_CUTOVER_LOCK_HELD=1 bash "[$]work\/deploy\/lib\/runtime-config-cutover\.sh" "[$]cutover_stage"/)
  assert.doesNotMatch(provision, /mv "[$]temporary" \/root\/kelion\/config\/runtime\.env|mv "[$]temporary" "\/root\/kelion\/secrets\/[$]name"/)

  const quiesce = deploy.lastIndexOf('\nquiesce_constructor_before_candidate \\\n')
  const candidate = deploy.indexOf('"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" up -d')
  const refresh = deploy.lastIndexOf('\n  refresh_constructor_gate\n')
  const reactivate = deploy.indexOf('restore_constructor_after_release', refresh)
  assert.ok(quiesce >= 0 && candidate > quiesce, 'Constructor trebuie oprit înainte de pornirea candidatului')
  assert.match(deploy, /quiesce_constructor_before_candidate\(\)[\s\S]*case "[$]unit_count" in[\s\S]*0\)[\s\S]*6\)[\s\S]*force_quiesce_constructor_release/)
  assert.match(deploy.slice(quiesce, candidate), /upgrade_constructor_timer_units_quiesced[\s\S]*assert_constructor_release_handoff_drained/)
  assert.match(cutover, /systemd-timer\.kelion-codex-worker\.timer[\s\S]*systemd-timer\.kelion-constructor-publisher\.timer[\s\S]*systemd-timer\.kelion-constructor-release\.timer/)
  assert.match(cutover, /systemd-service\.kelion-codex-worker\.service[\s\S]*systemd-service\.kelion-constructor-publisher\.service[\s\S]*systemd-service\.kelion-constructor-release\.service/)
  assert.ok(refresh >= 0 && reactivate > refresh, 'timer-ele se reactivează numai după commitul configului')
  assert.match(cutover, /\[\[ "[$]stage_root" =~ \^\/root\/kelion\/runtime\/runtime-cutover\\\.\[A-Za-z0-9\]\+[$] \]\]/)
  assert.match(cutover, /stage_canonical=[$][(]realpath -e -- "[$]stage_root"[)]/)
  assert.match(cutover, /\[ "[$]stage_root" = "[$]stage_canonical" \][\s\S]*rm -rf -- "[$]stage_root"/)
})

test('activarea release este tranzacțională și cere workerul plus publisherul sănătoase', () => {
  const control = read('.github/workflows/vps-run.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const releaseStart = control.indexOf('            activate-release)')
  const releaseEnd = control.indexOf('            constructor-status)', releaseStart)
  assert.ok(releaseStart >= 0 && releaseEnd > releaseStart, 'ramura activate-release lipsește')
  const release = control.slice(releaseStart, releaseEnd)

  assert.match(control, /trap cleanup_activation EXIT/)
  const prepareMarkerRootStart = control.indexOf('prepare_marker_root_durable() {')
  const prepareMarkerRootEnd = control.indexOf('\n          }\n', prepareMarkerRootStart)
  assert.ok(prepareMarkerRootStart >= 0 && prepareMarkerRootEnd > prepareMarkerRootStart)
  const prepareMarkerRoot = control.slice(prepareMarkerRootStart, prepareMarkerRootEnd)
  assert.match(prepareMarkerRoot, /case "[$]mode" in 750\|755[\s\S]*chmod 0755 \/etc\/kelion[\s\S]*0:0:755[\s\S]*fsync_remote \/etc\/kelion[\s\S]*fsync_remote \/etc/)
  const snapshotActivationStart = control.indexOf('snapshot_activation_state() {')
  const snapshotActivationEnd = control.indexOf('\n          }\n', snapshotActivationStart)
  assert.ok(snapshotActivationStart >= 0 && snapshotActivationEnd > snapshotActivationStart)
  const snapshotActivation = control.slice(snapshotActivationStart, snapshotActivationEnd)
  const prepareRoot = snapshotActivation.indexOf('prepare_marker_root_durable')
  const stateMutation = snapshotActivation.indexOf(': > "$state_file"')
  const snapshotSync = snapshotActivation.indexOf('fsync_remote "$activation_dir"')
  const physicalQuiesce = snapshotActivation.indexOf('force_quiesce_activation', snapshotSync)
  const activationJournal = snapshotActivation.indexOf('write_activation_journal')
  assert.ok(prepareRoot >= 0 && stateMutation > prepareRoot && snapshotSync > stateMutation
    && physicalQuiesce > snapshotSync && activationJournal > physicalQuiesce,
  'snapshotul este fsync, apoi ready+unitățile sunt retrase înainte de jurnalul prepared')
  assert.match(control, /snapshot_activation_state\(\)[\s\S]*cp --preserve=mode,ownership,timestamps -- "[$]marker" "[$]activation_dir\/marker\.[$]index"[\s\S]*fsync_remote "[$]state_file"[\s\S]*force_quiesce_activation[\s\S]*write_activation_journal/)
  assert.match(cutover, /recover_interrupted_activation\(\)[\s\S]*ensure_constructor_marker_root_durable[\s\S]*validate_live_runtime_contract[\s\S]*quiesce_units_for_recovery[\s\S]*mv -f -- "[$]restored" "[$]marker"[\s\S]*fsync_path \/etc\/kelion[\s\S]*systemctl enable "[$]timer"[\s\S]*start_constructor_unit "[$]timer"/)
  assert.match(shellFunction(cutover, 'validate_live_runtime_contract'), /validate_constructor_marker_root/)
  assert.match(cutover, /readlink "[$]wants_link"[)]" = "\/etc\/systemd\/system\/[$]timer"[\s\S]*realpath -e -- "[$]wants_link"[)]" = "\/etc\/systemd\/system\/[$]timer"/)
  assert.doesNotMatch(cutover, /readlink "[$]wants_link"[)]" = "\.\.\/[$]timer"/)
  assert.match(release, /flock -n 9/)
  assert.match(release, /validate_runtime/)
  assert.match(release, /validate_marker \/etc\/kelion\/codex-worker\.enabled[\s\S]*validate_marker \/etc\/kelion\/constructor-publisher\.enabled/)
  assert.match(release, /require_enabled_flag CODEX_WORKER_ENABLED[\s\S]*require_enabled_flag CONSTRUCTOR_PUBLISHER_ENABLED[\s\S]*require_enabled_flag CONSTRUCTOR_RELEASE_ENABLED/)
  assert.match(release, /assert_backend_side_effects_active[^\n]*[\s\S]*snapshot_activation_state/)
  assert.match(control, /assert_backend_side_effects_active\(\)[\s\S]*\.ready == true and \.release\.sideEffectsActive == true/)
  const cleanupActivationStart = control.indexOf('cleanup_activation() {')
  const cleanupActivationEnd = control.indexOf('\n          }\n', cleanupActivationStart)
  const cleanupActivation = control.slice(cleanupActivationStart, cleanupActivationEnd)
  const recoveryLeave = cleanupActivation.indexOf('--leave-constructor-quiesced')
  const fallbackQuiesce = cleanupActivation.indexOf('force_quiesce_activation', recoveryLeave)
  assert.ok(recoveryLeave >= 0 && fallbackQuiesce > recoveryLeave,
    'cleanup-ul recuperează numai în stare quiesced înainte de fallback; nu poate activa într-un workflow eșuat')

  const workerEnabled = release.indexOf('systemctl is-enabled --quiet kelion-codex-worker.timer')
  const publisherActive = release.indexOf('systemctl is-active --quiet kelion-constructor-publisher.timer')
  const snapshot = release.indexOf('snapshot_activation_state')
  const rollForward = release.indexOf('runtime-config-cutover.sh --recover-only', snapshot)
  assert.ok(workerEnabled >= 0 && publisherActive > workerEnabled && snapshot > publisherActive,
    'release cere workerul și publisherul enabled/active înainte de snapshot')
  assert.ok(rollForward > snapshot, 'jurnalul/snapshotul durabil trebuie publicat înainte de roll-forward')
  assert.doesNotMatch(release, /systemctl (?:start|enable --now)/,
    'workflow-ul nu pornește unități direct; helperul jurnalizat face commitul înaintea pornirii')
})

test('SIGKILL în activare nu poate deschide unitățile înainte de commitul applied durabil', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const control = read('.github/workflows/vps-run.yml')
  const workflowFunction = (name) => {
    const start = control.indexOf(`${name}() {`)
    const end = control.indexOf('\n          }\n', start)
    assert.ok(start >= 0 && end > start, `funcția workflow ${name} nu poate fi extrasă`)
    return control.slice(start, end + 12)
  }
  const recovery = shellFunction(cutover, 'recover_interrupted_activation')
  const quiesce = recovery.indexOf('quiesce_units_for_recovery')
  const publishPending = recovery.indexOf('publish_activation_pending', quiesce)
  const markerMutation = recovery.indexOf('mv -f -- "$restored" "$marker"', publishPending)
  const genericQuiesce = recovery.indexOf('write_activation_journal_phase quiesced', markerMutation)
  const applied = recovery.indexOf('write_activation_journal_phase applied', genericQuiesce)
  const clearPending = recovery.indexOf('clear_activation_pending', applied)
  const ready = recovery.indexOf('publish_runtime_ready_stamp', clearPending)
  const firstEnable = recovery.indexOf('systemctl enable "$timer"', ready)
  const firstStart = recovery.indexOf('start_constructor_unit "$timer"', ready)
  assert.ok(quiesce >= 0 && publishPending > quiesce && markerMutation > publishPending,
    'gate-ul pending trebuie publicat după quiesce și înaintea primei mutații live')
  assert.ok(genericQuiesce > markerMutation && applied > genericQuiesce
    && clearPending > applied && ready > clearPending && firstEnable > ready && firstStart > ready,
  'applied trebuie fsync înainte de retragerea pending, ready și orice enable/start')
  assert.match(recovery,
    /if \[ "[$]leave_constructor_quiesced" = 1 \] \|\| \[ "[$]activation_resume_operation" != "[$]operation" \]; then[\s\S]*write_activation_journal_phase quiesced[\s\S]*return 0[\s\S]*write_activation_journal_phase applied/)

  const preflight = workflowFunction('recover_activation_preflight')
  assert.match(preflight,
    /if \[ -e "[$]activation_journal" \] \|\| \[ -L "[$]activation_journal" \]; then[\s\S]*--leave-constructor-quiesced[\s\S]*else[\s\S]*--recover-only/)
  assert.match(workflowFunction('load_activation_barrier'),
    /activation_pending[\s\S]*0:0:444[\s\S]*schema=1/)
  assert.match(workflowFunction('clear_activation_journal'),
    /\[ ! -e "[$]activation_pending" \] && \[ ! -L "[$]activation_pending" \][\s\S]*rm -f -- "[$]activation_journal"/)
  const snapshotWriter = workflowFunction('snapshot_activation_state')
  const durableSnapshot = snapshotWriter.indexOf('fsync_remote "$activation_dir"')
  const preJournalQuiesce = snapshotWriter.indexOf('force_quiesce_activation', durableSnapshot)
  const preparedJournal = snapshotWriter.indexOf('write_activation_journal', preJournalQuiesce)
  assert.ok(durableSnapshot >= 0 && preJournalQuiesce > durableSnapshot && preparedJournal > preJournalQuiesce,
    'callerul trebuie să oprească fizic unitățile între snapshotul durabil și jurnalul prepared')

  const units = [
    'deploy/systemd/kelion-codex-worker.timer',
    'deploy/systemd/kelion-constructor-publisher.timer',
    'deploy/systemd/kelion-constructor-release.timer',
    'deploy/systemd/kelion-codex-worker.service',
    'deploy/systemd/kelion-constructor-publisher.service',
    'deploy/systemd/kelion-constructor-release.service',
    'deploy/systemd/kelion-constructor-sync.service',
  ]
  for (const path of units) {
    const unit = read(path)
    assert.match(unit, /ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready/)
    assert.match(unit, /ConditionPathExists=!\/run\/kelion\/constructor-activation\.pending/)
  }
  assert.match(shellFunction(cutover, 'validate_constructor_timer_unit'),
    /ConditionPathExists=!\/run\/kelion\/constructor-activation\.pending/)
  assert.match(shellFunction(cutover, 'validate_constructor_service_unit'),
    /ConditionPathExists=!\/run\/kelion\/constructor-activation\.pending/)

  // Fault injection la fiecare frontieră durabilă. Condițiile systemd cer
  // simultan ready prezent și pending absent; numai ultima stare poate porni.
  const canUnitStart = ({ pending, ready: readyPresent }) => !pending && readyPresent
  const crashCuts = [
    { name: 'quiesced-pending', phase: 'quiesced', pending: true, ready: false },
    { name: 'stale-ready-pending', phase: 'quiesced', pending: true, ready: true },
    { name: 'applied-before-gate-clear', phase: 'applied', pending: true, ready: false },
    { name: 'applied-after-gate-clear', phase: 'applied', pending: false, ready: false },
  ]
  for (const cut of crashCuts) assert.equal(canUnitStart(cut), false, cut.name)
  assert.equal(canUnitStart({ phase: 'applied', pending: false, ready: true }), true)
})

test('release-ul drenează handoff-urile Constructor după quiesce și înainte de PONR', () => {
  const deploy = read('deploy/deploy.sh')
  const quiesce = deploy.lastIndexOf('\nquiesce_constructor_before_candidate \\\n')
  const drain = deploy.indexOf('\nassert_constructor_release_handoff_drained \\\n', quiesce)
  const backup = deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"', drain)
  const migration = deploy.indexOf('migration_output=$(docker run', drain)
  const ponr = deploy.indexOf('\n  mark_point_of_no_return', drain)
  assert.ok(quiesce >= 0 && drain > quiesce && backup > drain && migration > drain && ponr > drain,
    'preflight-ul DB trebuie să fie post-quiesce și pre-backup/migrare/PONR')
  assert.match(deploy, /assert_constructor_release_handoff_drained\(\)[\s\S]*information_schema\.columns[\s\S]*FROM build_jobs[\s\S]*b\.status = [$]1[\s\S]*b\.constructor_stage = ANY\([$]2::text\[\]\)[\s\S]*"running",[\s\S]*\["merged", "release_dispatched"\]/)
  assert.match(deploy, /count\(\*\) FILTER \(WHERE is_current IS NOT TRUE\)/)
  assert.match(deploy, /hasV2Schema[\s\S]*release_protocol_version = 2[\s\S]*release_intent_receipt_sha256 IS NOT NULL[\s\S]*release_dispatch_receipt_sha256 IS NOT NULL/)
  const trap = deploy.indexOf('trap on_release_exit EXIT')
  assert.ok(trap >= 0 && trap < drain, 'trap-ul de rollback trebuie armat înainte de preflight-ul DB')
})

test('markerul release și helperul de recovery sunt persistate în ordinea sigură', () => {
  const deploy = read('deploy/deploy.sh')
  const oldRecovery = deploy.indexOf("# Jurnalele runtime/activare sunt recuperate cu helperul instalat")
  const nextRecovery = deploy.indexOf('# Un SIGKILL/reboot în timpul rotației runtime', oldRecovery)
  const recoveryBootstrap = deploy.slice(oldRecovery, nextRecovery)
  const helperInstalls = [...recoveryBootstrap.matchAll(/install_recovery_artifact "[$]BUNDLE_DIR\/lib\/runtime-config-cutover\.sh"/g)]
    .map((match) => match.index)
  const verifyRecoveryUnit = recoveryBootstrap.indexOf('if ! systemd-analyze verify "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service"')
  assert.equal(helperInstalls.length, 2)
  assert.ok(oldRecovery >= 0 && helperInstalls[0] < verifyRecoveryUnit && verifyRecoveryUnit < helperInstalls[1],
    'hostul nou pregătește executabilul înainte de verify, iar hostul existent îl înlocuiește numai după verify')
  assert.match(recoveryBootstrap, /recovery_helper_bootstrapped=1[\s\S]*if ! systemd-analyze verify[\s\S]*if \[ "[$]recovery_helper_bootstrapped" = 1 \][\s\S]*recovery_helper_bootstrap_identity[\s\S]*rm -f -- "[$]ROOT\/bin\/runtime-config-cutover\.sh"[\s\S]*fsync_release_artifact "[$]ROOT\/bin" directory/)
  assert.match(recoveryBootstrap, /if \[ "[$]recovery_helper_bootstrapped" = 0 \]; then[\s\S]*install_recovery_artifact "[$]BUNDLE_DIR\/lib\/runtime-config-cutover\.sh"/)
  assert.match(deploy, /restore_release_marker\(\)[\s\S]*fsync_release_artifact "[$]temporary" file[\s\S]*mv -f -- "[$]temporary" "[$]RELEASE_STATE_ROOT\/active"[\s\S]*fsync_release_artifact "[$]RELEASE_STATE_ROOT" directory/)
  assert.match(deploy, /printf '%s\\n' "[$]COMMIT_SHA" > "[$]temporary_active"[\s\S]*fsync_release_artifact "[$]temporary_active" file[\s\S]*mv -f -- "[$]temporary_active" "[$]RELEASE_STATE_ROOT\/active"[\s\S]*fsync_release_artifact "[$]RELEASE_STATE_ROOT" directory/)
  assert.match(deploy, /\[ ! -e "[$]RELEASE_STATE_ROOT\/active" \] && \[ ! -L "[$]RELEASE_STATE_ROOT\/active" \][\s\S]*markerul release activ existent este gol sau necanonic/)
})

test('tokenurile de configurare sunt validate înainte de header sau staging', () => {
  const control = read('.github/workflows/vps-run.yml')
  const runnerValidation = control.indexOf("names = (\n              'CODEX_WORKER_SECRET'")
  const payload = control.indexOf('encode codex-worker "$CODEX_WORKER_SECRET"')
  const remoteValidation = control.indexOf('validate_decoded_secret codex-worker "$codex_secret"')
  const bootstrap = control.indexOf('install -d -o root -g root -m 0700 "$bootstrap"', remoteValidation)
  const header = control.indexOf('publisher_headers=$bootstrap/publisher-api.headers', remoteValidation)
  assert.ok(runnerValidation >= 0 && payload > runnerValidation, 'runnerul validează secretele înainte de payload')
  assert.ok(remoteValidation > payload && bootstrap > remoteValidation && header > bootstrap,
    'VPS-ul validează valorile și creează bootstrap-ul înainte de headerul GitHub')
  assert.match(control, /clean_bytes=[$][(]printf '%s' "[$]value" \| LC_ALL=C tr -d '\\000-\\037\\177'/)
})

test('recover-only și activarea verifică întreg contractul runtime live', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const control = read('.github/workflows/vps-run.yml')
  assert.match(cutover, /validate_live_runtime_contract\(\)[\s\S]*validate_env_file "[$]CONFIG_ROOT\/runtime\.env" runtime\.env[\s\S]*validate_env_file "[$]path" "[$][{]config_logicals\[[$]index\][}]"/)
  assert.match(cutover, /recover_interrupted_activation\(\)[\s\S]*validate_live_runtime_contract[\s\S]*quiesce_units_for_recovery/)
  const recoveryTail = cutover.slice(cutover.indexOf('if [ "$recover_only" = 1 ]; then', cutover.indexOf('garbage_collect_gate_transactions')))
  const validatePending = recoveryTail.indexOf('validate_unit_migration_pending')
  const ownerBranch = recoveryTail.indexOf('deploy_quiesce_owned_by_caller', validatePending)
  const ownerBarrier = recoveryTail.indexOf('validate_constructor_quiesce_barrier', ownerBranch)
  const pendingBranch = recoveryTail.indexOf('if [ -f "$UNIT_MIGRATION_PENDING" ]', ownerBarrier)
  const validateUnits = recoveryTail.indexOf('validate_constructor_quiesce_barrier', pendingBranch)
  const refuseGenericBoot = recoveryTail.indexOf("bariera unit-only blochează boot-ul generic", validateUnits)
  const validateRuntime = recoveryTail.indexOf('validate_live_runtime_contract', refuseGenericBoot)
  assert.ok(validatePending >= 0 && ownerBranch > validatePending && ownerBarrier > ownerBranch
    && pendingBranch > ownerBarrier && validateUnits > pendingBranch
    && refuseGenericBoot > validateUnits && validateRuntime > refuseGenericBoot,
  'recover-only dovedește bariera fizică pentru owner și pending înainte de contractul runtime strict')
  assert.match(control, /validate_runtime\(\)[\s\S]*--validate-env-file runtime\.env \/root\/kelion\/config\/runtime\.env/)
  assert.match(control, /require_enabled_flag\(\)[\s\S]*grep -c "\^[$][{]flag[}]=1[$]"/)
})

test('recovery-ul de boot precedă timerele Constructor', () => {
  const recovery = read('deploy/systemd/kelion-runtime-config-recovery.service')
  const sync = read('deploy/systemd/kelion-constructor-sync.service')
  const timers = [
    read('deploy/systemd/kelion-codex-worker.timer'),
    read('deploy/systemd/kelion-constructor-publisher.timer'),
    read('deploy/systemd/kelion-constructor-release.timer'),
  ]
  assert.match(recovery, /Wants=docker\.service[\s\S]*After=local-fs\.target docker\.service[\s\S]*Before=kelion-constructor-sync\.service kelion-codex-worker\.timer kelion-constructor-publisher\.timer kelion-constructor-release\.timer kelion-codex-worker\.service kelion-constructor-publisher\.service kelion-constructor-release\.service/)
  assert.doesNotMatch(recovery, /Requires=docker\.service/)
  assert.match(recovery, /--recover-only \/root\/kelion\/config\/compose\.production\.yml/)
  assert.match(recovery, /Environment=KELION_RECOVERY_BOOT=1/)
  for (const timer of timers) {
    assert.doesNotMatch(timer, /Requires=kelion-runtime-config-recovery\.service/)
    assert.match(timer, /After=kelion-runtime-config-recovery\.service/)
    assert.match(timer, /ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready/)
  }
  assert.match(sync, /^After=.*(?:^| )kelion-runtime-config-recovery\.service(?: |$)/m)
  assert.match(sync, /ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready/)
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  assert.match(cutover, /if \[ "[$]boot_recovery" = 1 \]; then\s+systemctl start --no-block/)
  const main = cutover.slice(cutover.indexOf('trap cleanup_cutover EXIT'))
  const earlyRecover = main.indexOf('if [ "$recover_only" = 1 ]')
  const clear = main.indexOf('retract_runtime_ready_stamp_for_recovery', earlyRecover)
  const quiesce = main.indexOf('quiesce_units_for_recovery 1', earlyRecover)
  const strict = main.indexOf('validate_deploy_quiesce_journal', earlyRecover)
  const journalRecovery = main.indexOf('recover_interrupted_gate_refresh', earlyRecover)
  const liveContract = main.indexOf('validate_live_runtime_contract', journalRecovery)
  assert.ok(earlyRecover >= 0 && clear > earlyRecover && quiesce > clear && strict > quiesce
    && journalRecovery > strict && liveContract > journalRecovery,
  'boot recovery trebuie să retragă stamp-ul și să oprească inclusiv legacy/1..5 înainte de orice contract strict')
  assert.match(main.slice(0, strict), /Acest[\s\S]*pas nu repară fișiere fără jurnal/)
  const retract = shellFunction(cutover, 'retract_runtime_ready_stamp_for_recovery')
  assert.match(retract, /READY_ROOT[\s\S]*! -L "\$READY_ROOT"[\s\S]*(?:rmdir|rm -f)[\s\S]*fsync_path "\$READY_ROOT"/)
  assert.doesNotMatch(retract, /validate_runtime_ready_stamp|grep -qx 'schema=1'/)
  assert.match(main.slice(earlyRecover, quiesce), /if ! retract_runtime_ready_stamp_for_recovery[\s\S]*force_quiesce_constructor_units 1/)
  const dockerProof = main.indexOf('systemctl is-active --quiet docker.service', quiesce)
  assert.ok(dockerProof > quiesce && strict > dockerProof,
    'Docker poate eșua fără să sară quiesce-ul, dar stamp-ul nu se publică înainte să fie activ')
  const forceQuiesce = shellFunction(cutover, 'force_quiesce_constructor_units')
  const quiescePostconditions = shellFunction(cutover, 'validate_constructor_quiesce_postconditions')
  assert.match(forceQuiesce, /stop_and_disable_constructor_timer[\s\S]*stop_and_disable_constructor_service[\s\S]*systemctl daemon-reload[\s\S]*wait_for_constructor_quiesce_postconditions/)
  assert.match(quiescePostconditions, /ActiveState[\s\S]*systemctl list-jobs --no-legend --plain/)
})

test('recovery-ul de boot așteaptă bounded backendul și rămâne fail-closed la timeout', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const waiter = shellFunction(cutover, 'wait_for_activation_backend_ready')
  assert.match(waiter, /boot_recovery[\s\S]*SECONDS \+ 480[\s\S]*--max-time "[$]max_time"[\s\S]*sideEffectsActive == true[\s\S]*sleep 5/)
  const script = `set -euo pipefail
${waiter}
counter=$(mktemp)
trap 'rm -f -- "$counter"' EXIT
printf '0\n' > "$counter"
curl() {
  local count
  count=$(cat "$counter"); count=$((count + 1)); printf '%s\n' "$count" > "$counter"
  [ "$count" -ge 3 ] || return 7
  printf '%s\n' '{"ready":true,"release":{"sideEffectsActive":true}}'
}
jq() { local payload; payload=$(cat); [[ "$payload" == *'"ready":true'* && "$payload" == *'"sideEffectsActive":true'* ]]; }
sleep() { SECONDS=$((SECONDS + $1)); }
boot_recovery=1
wait_for_activation_backend_ready http://127.0.0.1:18079
[ "$(cat "$counter")" = 3 ]
printf '0\n' > "$counter"
curl() { local count; count=$(cat "$counter"); count=$((count + 1)); printf '%s\n' "$count" > "$counter"; return 7; }
sleep() { SECONDS=$((SECONDS + 240)); }
if wait_for_activation_backend_ready http://127.0.0.1:18079; then exit 41; fi
[ "$(cat "$counter")" -ge 3 ]
`
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('HMAC-urile Constructor sunt verificate ca identități distincte înainte de orice commit', () => {
  const control = read('.github/workflows/vps-run.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  for (const source of [control, provision]) {
    assert.match(source, /CODEX_WORKER_SECRET" != "[$]CONSTRUCTOR_PUBLISHER_SECRET|codex_secret" != "[$]publisher_secret/)
    assert.match(source, /CODEX_WORKER_SECRET" != "[$]CONSTRUCTOR_RELEASE_SECRET|codex_secret" != "[$]release_secret/)
    assert.match(source, /CONSTRUCTOR_PUBLISHER_SECRET" != "[$]CONSTRUCTOR_RELEASE_SECRET|publisher_secret" != "[$]release_secret/)
  }
  assert.match(cutover, /assert_pairwise_distinct 'HMAC-urile Constructor'[\s\S]*app-secret\.codex-worker-secret[\s\S]*app-secret\.constructor-publisher-secret[\s\S]*app-secret\.constructor-release-secret/)
})

test('validatorul secretelor acceptă o linie validă și respinge CR sau NUL binary-safe', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const validator = shellFunction(cutover, 'validate_secret_file')
  assert.ok(!validator.includes("$'\\r\\|\\x00'"), 'CR și NUL nu trebuie combinați într-un singur pattern BRE')
  assert.match(validator, /tr -d '\\015'/)
  assert.match(validator, /tr -d '\\000'/)

  const script = `set -euo pipefail
${validator}
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
printf '%s\\n' 'valid-secret-value-with-more-than-32-characters' > "$test_root/valid"
printf 'invalid-cr\\r\\n' > "$test_root/cr"
printf 'invalid\\000nul\\n' > "$test_root/nul"
validate_secret_file "$test_root/valid"
if validate_secret_file "$test_root/cr"; then exit 21; fi
if validate_secret_file "$test_root/nul"; then exit 22; fi
`
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('allowlist-ul runtime respinge newline injection și chei necunoscute', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const runtimeAllowed = cutover.match(/runtime\.env\)\s+allowed_names='([^']+)'/)
  assert.ok(runtimeAllowed, 'allowlist-ul runtime nu poate fi extras')
  const overrides = new Map([
    ['NODE_ENV', 'production'],
    ['PORT', '8080'],
    ['PUBLIC_APP_ORIGIN', 'https://kelionai.app'],
    ['FRONTEND_ORIGIN', 'https://kelionai.app'],
    ['GOOGLE_REDIRECT_URI', 'https://kelionai.app/auth/google/callback'],
    ['OPENAI_API_KEY_FILE', '/run/secrets/openai-project-key'],
    ['DATABASE_URL_FILE', '/run/secrets/database-url'],
    ['SESSION_SECRET_FILE', '/run/secrets/session-secret'],
    ['GOOGLE_CLIENT_SECRET_FILE', '/run/secrets/google-client-secret'],
    ['GOOGLE_TOKEN_ENCRYPTION_KEY_FILE', '/run/secrets/google-token-encryption-key'],
    ['CODEX_WORKER_SECRET_FILE', '/run/secrets/codex-worker-secret'],
    ['CONSTRUCTOR_PUBLISHER_SECRET_FILE', '/run/secrets/constructor-publisher-secret'],
    ['CONSTRUCTOR_RELEASE_SECRET_FILE', '/run/secrets/constructor-release-secret'],
    ['GITHUB_RELEASE_OAUTH_TOKEN_FILE', '/run/secrets/github-release-oauth-token'],
    ['BROWSER_WORKER_SOCKET', '/run/kelion-browser-api/browser.sock'],
    ['BROWSER_WORKER_SECRET_FILE', '/run/secrets/browser-worker-secret'],
    ['CONVERTER_WORKER_SOCKET', '/run/kelion-converter-api/converter.sock'],
    ['CONVERTER_WORKER_SECRET_FILE', '/run/secrets/converter-worker-secret'],
    ['REVOLUT_MERCHANT_SECRET_KEY_FILE', '/run/secrets/revolut-merchant-secret-key'],
    ['REVOLUT_WEBHOOK_SIGNING_SECRET_FILE', '/run/secrets/revolut-webhook-signing-secret'],
    ['VAPID_PRIVATE_KEY_FILE', '/run/secrets/vapid-private-key'],
    ['CODEX_WORKER_ENABLED', '0'],
    ['CONSTRUCTOR_PUBLISHER_ENABLED', '0'],
    ['CONSTRUCTOR_RELEASE_ENABLED', '0'],
    ['CONSTRUCTOR_RETRY_BASE_SECONDS', '60'],
    ['CONSTRUCTOR_RETRY_MAX_SECONDS', '1800'],
    ['CONSTRUCTOR_EXTERNAL_RETRY_SECONDS', '900'],
    ['CONSTRUCTOR_REQUIRED_CHECKS', 'verify,container-isolation'],
  ])
  const runtimeNames = runtimeAllowed[1].split(' ')
  const runtimeLines = runtimeNames.map((name) => `${name}=${overrides.get(name) ?? ''}`).join('\n')
  const provision = read('.github/workflows/vps-set-env.yml')
  const payloadStart = provision.indexOf("env_payload=$(printf '%s\\n'")
  const payload = provision.slice(payloadStart, provision.indexOf('\n\n          umask 077', payloadStart))
  for (const name of runtimeNames) {
    assert.match(payload, new RegExp(`["']${name}=`), `provisionarea nu produce cheia runtime obligatorie ${name}`)
  }
  const validator = `${shellFunction(cutover, 'validate_text_file_bytes')}\n\n${shellFunction(cutover, 'validate_env_file')}`.replaceAll('\r', '')
  const bundledPython = join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
  const pythonShim = process.platform === 'win32' && existsSync(bundledPython)
    ? `python3() { "${bundledPython.replaceAll('\\', '/')}" "$@"; }\n`
    : ''
  const script = `set -euo pipefail
${pythonShim}
${validator}
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
cat > "$test_root/valid" <<'EOF'
${runtimeLines}
EOF
cp "$test_root/valid" "$test_root/unknown"
printf '%s\\n' 'FRONTEND_DIST=/tmp/attacker' >> "$test_root/unknown"
cp "$test_root/valid" "$test_root/newline"
printf 'DATA_CONTROLLER_NAME=Kelion\\nFRONTEND_DIST=/tmp/injected\\n' >> "$test_root/newline"
cp "$test_root/valid" "$test_root/duplicate"
printf '%s\\n' 'NODE_ENV=production' >> "$test_root/duplicate"
sed '/^GOOGLE_TTS_VOICE=/d' "$test_root/valid" > "$test_root/missing"
sed 's#^PUBLIC_APP_ORIGIN=.*#PUBLIC_APP_ORIGIN=https://kelionai.app/#' "$test_root/valid" > "$test_root/bad-origin"
sed 's#^DATABASE_URL_FILE=.*#DATABASE_URL_FILE=/tmp/injected#' "$test_root/valid" > "$test_root/bad-constant"
validate_env_file "$test_root/valid" runtime.env
if validate_env_file "$test_root/unknown" runtime.env; then exit 31; fi
if validate_env_file "$test_root/newline" runtime.env; then exit 32; fi
if validate_env_file "$test_root/duplicate" runtime.env; then exit 33; fi
if validate_env_file "$test_root/missing" runtime.env; then exit 34; fi
if validate_env_file "$test_root/bad-origin" runtime.env; then exit 35; fi
if validate_env_file "$test_root/bad-constant" runtime.env; then exit 36; fi
`
  const windowsBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  const bash = process.platform === 'win32' && existsSync(windowsBash) ? windowsBash : 'bash'
  const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('ledger-ul release permite retry numai după rollback dovedit și oprește al doilea cutover după success', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const arm = deploy.lastIndexOf('write_constructor_deploy_quiesce_journal armed')
  const started = deploy.indexOf('write_release_request_ledger started', arm)
  const quiesce = deploy.lastIndexOf('quiesce_constructor_before_candidate')
  const success = deploy.lastIndexOf('write_release_request_ledger success')
  assert.ok(arm >= 0 && started > arm && quiesce > started && success > quiesce,
    'jurnalul quiesce și intentul trebuie să preceadă cutover-ul, iar success să fie ultimul commit')
  assert.match(deploy, /validate_release_request_ledger\(\)[\s\S]*requestId == [$]requestId[\s\S]*commit == [$]commit[\s\S]*ciRunId == [$]ciRunId[\s\S]*buildRunId == [$]buildRunId/)
  const ledgerValidator = shellFunction(deploy, 'validate_release_request_ledger')
  assert.doesNotMatch(ledgerValidator, /workflowRunId ==/,
    'workflowRunId este audit, nu parte din cheia idempotentă la retry')
  assert.match(deploy, /release_request_state" = success[\s\S]*release_request_live_proof[\s\S]*release_noop/)
  assert.match(deploy, /rollback_switch; then[\s\S]*constructor_deploy_quiesce_snapshot_matches_previous[\s\S]*write_release_request_ledger retryable[\s\S]*restore_constructor_after_release/)
  assert.match(deploy, /recovered_constructor_quiesce_phase[\s\S]*active_release_live_proof[\s\S]*write_release_request_ledger retryable/)
  assert.match(cutover, /DEPLOY_QUIESCE_JOURNAL=[^\n]+constructor-deploy-quiesce\.journal[\s\S]*validate_deploy_quiesce_journal/)
  assert.match(cutover, /quiesce_units_for_recovery[\s\S]*publish_runtime_ready_stamp[\s\S]*restore_constructor_timers[\s\S]*clear_deploy_quiesce_journal/)
})

test('jurnalul deploy leagă markerul activ de gate și nu poate fi consumat de recovery generic', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const control = read('.github/workflows/vps-run.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  const activeMove = deploy.indexOf('mv -f -- "$temporary_active" "$RELEASE_STATE_ROOT/active"')
  const activePhase = deploy.indexOf('write_constructor_deploy_quiesce_journal active-published', activeMove)
  const refresh = deploy.lastIndexOf('\n  refresh_constructor_gate\n')
  const gateProof = deploy.indexOf('constructor_gate_matches_candidate || die', refresh)
  const gatePhase = deploy.indexOf('write_constructor_deploy_quiesce_journal gate-committed', gateProof)
  const success = deploy.lastIndexOf('write_release_request_ledger success')
  const restore = deploy.lastIndexOf('restore_constructor_after_release')
  assert.ok(activeMove >= 0 && activePhase > activeMove && refresh > activePhase,
    'markerul candidat trebuie să publice faza active-published înainte de refresh-ul gate')
  assert.ok(gateProof > refresh && gatePhase > gateProof,
    'faza gate-committed poate fi publicată numai după dovada exactă a gate-ului candidat')
  assert.ok(restore > gatePhase && success > restore,
    'ledger-ul success se publică numai după reconcilierea și post-check-ul Constructor')
  assert.match(deploy, /schema:2[\s\S]*activeBefore:[-a-zA-Z_$][\s\S]*gateSha256:[\s\S]*committedGateSha256/)
  assert.match(deploy, /constructor_deploy_quiesce_snapshot_matches_previous[\s\S]*active_release_live_proof 1[\s\S]*write_release_request_ledger retryable/)
  assert.match(deploy, /release_request_state" = none[\s\S]*recovered_constructor_quiesce_phase" = armed[\s\S]*restore_constructor_after_release/)
  assert.match(deploy, /release_cutover_committed" = 1[\s\S]*Constructor rămâne quiesced/)

  const authorization = cutover.indexOf('deploy_quiesce_authorized=0')
  const recovery = cutover.indexOf('\nrecover_interrupted_gate_refresh\n')
  assert.ok(authorization >= 0 && recovery > authorization,
    'owner/proof trebuie validate înaintea oricărui recovery care ar putea porni unități')
  assert.match(cutover, /\.schema == 2[\s\S]*activeBefore[\s\S]*committedGateSha256/)
  assert.match(cutover, /deploy_quiesce_proof" = 1[\s\S]*deploy_quiesce_owned_by_caller[\s\S]*deploy_quiesce_generation_proof/)
  assert.match(cutover, /recovery\/reactivare refuzată fără owner și dovadă de generație exactă/)
  assert.match(cutover, /KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_COMMIT/)

  for (const workflow of [control, provision]) {
    assert.match(workflow, /deploy_quiesce_journal=\/root\/kelion\/runtime\/constructor-deploy-quiesce\.journal[\s\S]*--leave-constructor-quiesced[\s\S]*exit 1/)
  }
})

test('toate ferestrele hard-crash ale markerului și gate-ului reiau același roll-forward', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const markerPublisher = shellFunction(deploy, 'publish_candidate_active_marker')
  const markerPrepared = markerPublisher.indexOf('write_constructor_deploy_quiesce_journal active-prepared')
  const markerMove = markerPublisher.indexOf('mv -f -- "$temporary_active" "$RELEASE_STATE_ROOT/active"')
  const markerPublished = markerPublisher.indexOf('write_constructor_deploy_quiesce_journal active-published')
  const proxyPrepared = deploy.lastIndexOf('write_constructor_deploy_quiesce_journal active-prepared')
  const proxySwitch = deploy.indexOf('publish_target_proxy_files_from_intent', proxyPrepared)
  const activeMarkerCall = deploy.indexOf('\npublish_candidate_active_marker \\', proxySwitch)
  const preparedWriter = deploy.indexOf('write_constructor_deploy_gate_prepared_journal "${staged[0]}"')
  const gateJournal = deploy.indexOf('mv -f -- "$journal_temporary" "$gate_journal"', preparedWriter)
  const gateApply = deploy.indexOf('--leave-constructor-quiesced', gateJournal)
  const committedPhase = deploy.indexOf('write_constructor_deploy_quiesce_journal gate-committed', gateApply)
  const earlyPreparedRecovery = deploy.indexOf('Un crash după switch-ul proxy')
  const topologyCapture = deploy.indexOf('managed_proxy_running=0')
  const topologyMarkerValidation = deploy.indexOf('old_marker=$(sed -n', topologyCapture)
  assert.ok(markerPrepared >= 0 && markerMove > markerPrepared && markerPublished > markerMove,
    'faza active-prepared trebuie să preceadă rename-ul markerului, iar active-published să îl urmeze')
  assert.ok(activeMarkerCall > proxySwitch && preparedWriter > activeMarkerCall && gateJournal > preparedWriter && gateApply > gateJournal && committedPhase > gateApply,
    'hashurile target și faza gate-prepared trebuie să fie durabile înainte de gate journal/apply')
  assert.ok(proxyPrepared >= 0 && proxySwitch > proxyPrepared && activeMarkerCall > proxySwitch,
    'active-prepared trebuie să fie fsync înainte de switch-ul proxy și active-published după marker')
  assert.ok(earlyPreparedRecovery >= 0 && topologyCapture > earlyPreparedRecovery && topologyMarkerValidation > earlyPreparedRecovery,
    'proxy=candidat + marker vechi trebuie reconciliat înainte de validarea topologiei la restart')
  assert.match(deploy.slice(earlyPreparedRecovery - 12000, topologyCapture),
    /roll_forward_active_prepared_before_topology[\s\S]*publish_target_proxy_files_from_intent[\s\S]*caddy reload[\s\S]*retire_legacy_generation_from_deploy_journal[\s\S]*publish_candidate_active_marker[\s\S]*recovered_constructor_quiesce_phase=active-published/)
  assert.match(deploy.slice(earlyPreparedRecovery - 12000, topologyCapture),
    /restore_old_proxy_intent_before_topology[\s\S]*restore_proxy_files_from_intent[\s\S]*active_release_live_proof 1/)
  assert.match(deploy, /recovered_constructor_quiesce_phase" = active-published[\s\S]*recovered_constructor_quiesce_phase" = gate-prepared[\s\S]*resume_after_active_marker=1/)
  assert.match(deploy, /recovered_constructor_quiesce_phase" = gate-committed[\s\S]*resume_after_gate_commit=1/)
  assert.match(deploy, /if \[ "[$]resume_after_gate_commit" = 0 \]; then\s+refresh_constructor_gate[\s\S]*constructor_gate_matches_candidate/)
  assert.match(deploy, /release_rollforward_only" = 1[\s\S]*Constructor rămâne quiesced/)
  assert.match(deploy, /resume_after_active_marker" = 0[\s\S]*stop_active_runtime[\s\S]*else[\s\S]*stop_candidate_runtime/)
  assert.match(deploy, /resume_destructive_recovery=1[\s\S]*point_of_no_return=1/)
  assert.match(deploy, /destructive_cutover" = 1 \] \|\| \[ "[$]resume_destructive_recovery" = 1[\s\S]*pointOfNoReturn == true[\s\S]*clear_recovery_journal/)
  assert.match(cutover, /phase == "gate-prepared"[\s\S]*targetGateSha256/)
  assert.match(cutover, /phase != "gate-committed"[\s\S]*committedGateSha256/)
})

test('proxy candidat cu marker vechi este dovedit fără a confunda release-ul legacy', () => {
  const deploy = read('deploy/deploy.sh')
  const preparedProof = shellFunction(deploy, 'prepared_candidate_public_live_proof')
  const oldProof = shellFunction(deploy, 'active_release_live_proof')
  const writer = shellFunction(deploy, 'write_constructor_deploy_quiesce_journal')
  const recovery = shellFunction(deploy, 'roll_forward_active_prepared_before_topology')
  assert.match(preparedProof, /live_version" = "[$][{]COMMIT_SHA:0:7[}]"/)
  assert.match(preparedProof, /\.release\.candidate == true and \.release\.sideEffectsActive == false/)
  assert.match(writer, /previous_version_before[\s\S]*--arg activeVersionBefore[\s\S]*activeVersionBefore:[$]activeVersionBefore/)
  assert.match(oldProof, /activeVersionBefore[\s\S]*live_version" = "[$]expected_legacy_version"/)
  assert.match(oldProof, /release\.candidate \/\/ false[\s\S]*release\.sideEffectsActive \/\/ true/)
  const files = recovery.indexOf('publish_target_proxy_files_from_intent')
  const proxyUp = recovery.indexOf('up -d --no-build --wait', files)
  const preparedPublic = recovery.indexOf('prepared_candidate_public_live_proof', proxyUp)
  const publish = recovery.indexOf('publish_candidate_active_marker', preparedPublic)
  const activeWait = recovery.indexOf('candidate_public_live_proof', publish)
  assert.ok(files >= 0 && proxyUp > files && preparedPublic > proxyUp && publish > preparedPublic && activeWait > publish,
    'recovery-ul trebuie să reconcilieze fișierele/proxy-ul, să dovedească candidatul inactiv și abia apoi să publice markerul')
})

test('primul cutover păstrează lista legacy și o oprește exact la resume', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const journalWriter = shellFunction(deploy, 'write_constructor_deploy_quiesce_journal')
  const legacyStop = shellFunction(deploy, 'retire_legacy_generation_from_deploy_journal')
  const proxyStop = shellFunction(deploy, 'retire_legacy_proxy_from_deploy_journal')
  assert.match(journalWriter, /legacy_runtime_running[\s\S]*--argjson legacyContainers[\s\S]*legacyContainers:[$]legacyContainers/)
  assert.match(journalWriter, /kelionai-app[\s\S]*omniroute[\s\S]*kelionai-coqui/)
  assert.match(legacyStop, /requestId == [$]requestId[\s\S]*commit == [$]commit[\s\S]*activeBefore == "legacy"/)
  assert.match(legacyStop, /legacyContainers[\s\S]*index\("kelionai-app"\) != null[\s\S]*retire_container_restart/)
  assert.match(proxyStop, /legacyProxyRestartPolicy[\s\S]*retire_container_restart kelion-caddy/)
  assert.match(journalWriter, /legacyRestartPolicies[\s\S]*legacyProxyRestartPolicy/)
  assert.match(deploy, /activeBefore == "legacy"[\s\S]*stop_legacy_runtime_from_deploy_journal[\s\S]*stop_candidate_runtime/)
  assert.match(cutover, /legacyContainers[\s\S]*legacyRestartPolicies[\s\S]*activeBefore == "legacy"/)
})

test('proxy intent-ul este durabil înainte de Caddy/upstream și se reconciliază înainte de topologie', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const writer = shellFunction(deploy, 'write_constructor_deploy_quiesce_journal')
  const publishFiles = shellFunction(deploy, 'publish_target_proxy_files_from_intent')
  const rollForward = shellFunction(deploy, 'roll_forward_active_prepared_before_topology')
  const restoreOld = shellFunction(deploy, 'restore_old_proxy_intent_before_topology')
  assert.match(writer, /proxyIntent:[{]activeSlotBefore:[$]activeSlotBefore,targetSlot:[$]targetSlot/)
  assert.match(writer, /caddyfileSnapshot:[-a-zA-Z_$][\s\S]*caddyfileSha256:[-a-zA-Z_$][\s\S]*oldUpstreamSnapshot:[-a-zA-Z_$][\s\S]*oldUpstreamSha256:[-a-zA-Z_$]/)
  assert.match(writer, /targetCaddyfileSha256:[-a-zA-Z_$][\s\S]*targetUpstreamSha256:[-a-zA-Z_$]/)
  assert.match(cutover, /proxyIntent[\s\S]*caddyfile-rollback[\s\S]*upstream-rollback[\s\S]*targetCaddyfileSha256[\s\S]*targetUpstreamSha256/)

  const prepared = deploy.lastIndexOf('write_constructor_deploy_quiesce_journal active-prepared')
  const install = deploy.indexOf('publish_target_proxy_files_from_intent', prepared)
  const marker = deploy.indexOf('\npublish_candidate_active_marker \\', install)
  assert.ok(prepared >= 0 && install > prepared && marker > install,
    'active-prepared trebuie fsync înaintea oricărui install/mv proxy')
  assert.match(publishFiles, /fsync_release_artifact "[$]temporary" file[\s\S]*mv -f -- "[$]temporary" "[$]UPSTREAM_FILE"[\s\S]*fsync_release_artifact "[$]PROXY_CONFIG_ROOT\/upstream" directory/)
  assert.match(publishFiles, /install_recovery_artifact "[$]BUNDLE_DIR\/Caddyfile" "[$]LIVE_CADDYFILE"/)

  const recoveryCall = deploy.indexOf('roll_forward_active_prepared_before_topology \\')
  const topology = deploy.indexOf('managed_proxy_running=0', recoveryCall)
  assert.ok(recoveryCall >= 0 && topology > recoveryCall,
    'switch-ul parțial trebuie reconciliat înainte de citirea upstreamului/topologiei')
  assert.match(rollForward, /publish_target_proxy_files_from_intent[\s\S]*retire_legacy_proxy_from_deploy_journal[\s\S]*up -d --no-build --wait[\s\S]*caddy reload[\s\S]*retire_legacy_generation_from_deploy_journal[\s\S]*publish_candidate_active_marker/)
  assert.match(restoreOld, /restore_proxy_files_from_intent[\s\S]*kelion-proxy[\s\S]*active_release_live_proof 1/)
})

test('schedulerul persistent este fsync și probat înainte de completion și ledger success', () => {
  const deploy = read('deploy/deploy.sh')
  const installScript = shellFunction(deploy, 'install_persistent_backup_script')
  const activateScript = shellFunction(deploy, 'activate_persistent_backup_script')
  const installSchedule = shellFunction(deploy, 'install_backup_schedule')
  const proof = shellFunction(deploy, 'backup_schedule_live_proof')
  assert.match(installScript, /fsync_release_artifact "[$]candidate" file[\s\S]*mv -f[\s\S]*fsync_release_artifact "[$]BACKUP_RELEASE_ROOT\/[$]COMMIT_SHA" directory/)
  assert.match(activateScript, /mv -Tf[\s\S]*fsync_release_artifact "[$]BACKUP_INSTALL_ROOT" directory/)
  assert.match(installSchedule, /fsync_release_artifact "[$]candidate" file[\s\S]*mv -f[\s\S]*fsync_release_artifact "[$]SYSTEMD_UNIT_ROOT" directory[\s\S]*timers\.target\.wants[\s\S]*NextElapseUSecRealtime/)
  assert.match(proof, /PERSISTENT_BACKUP_SCRIPT[\s\S]*BACKUP_CURRENT_LINK[\s\S]*BACKUP_SERVICE[\s\S]*BACKUP_TIMER[\s\S]*NextElapseUSecRealtime/)
  assert.match(proof, /state == "committed"[\s\S]*root-crontab[\s\S]*cmp -s "[$]expected" "[$]observed"/)
  const finalProof = deploy.lastIndexOf('backup_schedule_live_proof \\')
  const completion = deploy.indexOf('write_release_completion_record', finalProof)
  const restore = deploy.indexOf('restore_constructor_after_release', completion)
  const success = deploy.indexOf('write_release_request_ledger success', restore)
  assert.ok(finalProof >= 0 && completion > finalProof && restore > completion && success > restore,
    'scheduler proof trebuie să preceadă completion, iar success să urmeze post-check-ul Constructor')
  assert.match(shellFunction(deploy, 'reconcile_constructor_after_completed_release'), /backup_schedule_live_proof/)
})

test('generația Constructor complet absentă poate fi comisă și recuperată numai ca 3x absent', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const match = shellFunction(deploy, 'constructor_gate_matches_candidate')
  const writer = shellFunction(deploy, 'write_constructor_deploy_quiesce_journal')
  assert.match(match, /config_count" = 0[\s\S]*marker_count" = 0[\s\S]*systemctl cat[\s\S]*0\|6\) return 0/)
  assert.match(match, /systemctl is-enabled[\s\S]*systemctl is-active/)
  assert.match(writer, /targetGateSha256 = [{]worker:"absent",publisher:"absent",release:"absent"[}][\s\S]*committedGateSha256 = \.targetGateSha256/)
  assert.match(cutover, /targetGateSha256[\s\S]*all\(\.\[\]; \. == "absent"\)/)
  assert.match(cutover, /committedGateSha256[\s\S]*expected" = absent[\s\S]*constructor_configs/)
})

test('recovery-ul distructiv pre-PONR restaurează DB/runtime/proxy înainte de topologie', () => {
  const deploy = read('deploy/deploy.sh')
  const recovery = shellFunction(deploy, 'recover_destructive_pre_ponr_before_topology')
  assert.match(deploy, /recovery_journal_ponr" = false[\s\S]*active-prepared[\s\S]*rolled-back[\s\S]*recover_pre_ponr_destructive=1/)
  assert.match(deploy, /migrationContractBefore:[-a-zA-Z_$]/)
  assert.match(recovery, /\.phase == "rolled-back"/)
  assert.match(recovery, /docker ps -aq[\s\S]*journal_proxy_target_slot[\s\S]*ensure_containers_stopped[\s\S]*dbRestoreRequired[\s\S]*restore-verified-backup\.sh/)
  assert.match(recovery, /ensure_containers_running[\s\S]*restore_old_proxy_intent_before_topology[\s\S]*active_release_live_proof 1[\s\S]*mark_existing_recovery_journal_rolled_back/)
  const call = deploy.indexOf('recover_destructive_pre_ponr_before_topology \\')
  const topology = deploy.indexOf('managed_proxy_running=0', call)
  assert.ok(call >= 0 && topology > call, 'rollback-ul DB/runtime/proxy trebuie finalizat înainte de topologie')
  assert.match(deploy, /pre_ponr_active_prepared_restored=1[\s\S]*pre_ponr_active_prepared_restored" != 1/)
  const finalizer = shellFunction(deploy, 'finalize_rolled_back_recovery_journal')
  assert.match(finalizer, /release_request_state" = retryable[\s\S]*CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL[\s\S]*phase == "rolled-back"/)
  assert.match(finalizer, /migrationContractBefore/)
  assert.match(finalizer, /candidate_running[\s\S]*sideEffectsActive == true[\s\S]*restored_contract[\s\S]*rm -f -- "[$]RECOVERY_JOURNAL"/)
  assert.match(deploy, /finalize_rolled_back_recovery_only=1[\s\S]*finalize_rolled_back_recovery_journal[\s\S]*recover_destructive_pre_ponr_before_topology/)
  assert.match(deploy, /restore_constructor_after_release[\s\S]*finalize_rolled_back_recovery_journal/)
  const rollback = shellFunction(deploy, 'rollback_switch')
  assert.match(rollback, /write_recovery_journal rolled-back/)
  assert.doesNotMatch(rollback, /clear_recovery_journal/)
})

test('retragerea cronului legacy are intent durabil și recovery idempotent', () => {
  const deploy = read('deploy/deploy.sh')
  const start = deploy.indexOf('retire_legacy_backup_cron() (')
  const end = deploy.indexOf('\n)\n', start)
  assert.ok(start >= 0 && end > start, 'funcția de retragere cron lipsește')
  const retire = deploy.slice(start, end + 3)
  const backupFsync = retire.indexOf('fsync_release_artifact "$backup_candidate" file')
  const prepared = retire.indexOf('write_retirement_marker prepared')
  const apply = retire.indexOf('crontab -u root "$after"', prepared)
  const verify = retire.indexOf('cmp -s "$after" "$observed"', apply)
  const committed = retire.indexOf('write_retirement_marker committed', verify)
  assert.ok(backupFsync >= 0 && prepared > backupFsync && apply > prepared && verify > apply && committed > verify,
    'backupul și intentul trebuie fsync înainte de mutația crontab, iar committed numai după verificare')
  assert.match(retire, /count" -eq 0[\s\S]*marker_state" = prepared[\s\S]*systemctl is-enabled[\s\S]*write_retirement_marker committed/)
  assert.match(retire, /awk -v target="[$]LEGACY_BACKUP_CRON"[\s\S]*cmp -s "[$]after" "[$]observed"[\s\S]*write_retirement_marker committed/)
  assert.match(retire, /legacy-backup-cron-retired[\s\S]*schema:2,state:[$]state[\s\S]*fsync_release_artifact "[$]RUNTIME_ROOT" directory/)
})

test('un gate target comis nu permite rollback-ul aplicației înainte de faza committed', () => {
  const deploy = read('deploy/deploy.sh')
  const classifier = shellFunction(deploy, 'classify_gate_prepared_failure')
  const exitTrap = shellFunction(deploy, 'on_release_exit')
  const classify = exitTrap.indexOf('classify_gate_prepared_failure')
  const rollback = exitTrap.indexOf('rollback_switch')
  assert.ok(classify >= 0 && rollback > classify,
    'trap-ul trebuie să clasifice generația gate înainte de orice rollback app/proxy')
  const target = classifier.indexOf('constructor_deploy_gate_hashes_match targetGateSha256')
  const previous = classifier.indexOf('constructor_deploy_gate_hashes_match gateSha256')
  assert.ok(target >= 0 && previous > target, 'hashurile target trebuie verificate înaintea snapshotului vechi')
  assert.match(classifier, /targetGateSha256[\s\S]*release_rollforward_only=1[\s\S]*gateSha256/)
  assert.match(classifier, /phase == "gate-committed"[\s\S]*committedGateSha256 == \.targetGateSha256[\s\S]*release_rollforward_only=1/)
  assert.match(classifier, /generație mixtă[\s\S]*release_rollforward_only=1[\s\S]*gate_matches_active_release=0/)
  const durableCommit = deploy.lastIndexOf('write_constructor_deploy_quiesce_journal gate-committed')
  const ramFlag = deploy.indexOf('release_cutover_committed=1', durableCommit)
  assert.ok(durableCommit >= 0 && ramFlag > durableCommit,
    'testul acoperă semnalul dintre journal gate-committed și flagul RAM')
  assert.match(deploy, /refresh_constructor_gate[\s\S]*constructor_gate_matches_candidate[\s\S]*write_constructor_deploy_quiesce_journal gate-committed/)
})

test('migrarea unităților legacy este unit-only înaintea tranzacției runtime mixte', () => {
  const deploy = read('deploy/deploy.sh')
  const provision = read('.github/workflows/vps-set-env.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const unitStart = provision.indexOf('# Helperul publică mai întâi intentul unit-only')
  const unitInvoke = provision.indexOf('--leave-constructor-quiesced', unitStart)
  const recoveryInstall = provision.indexOf('install_atomic "$work/deploy/systemd/kelion-runtime-config-recovery.service"', unitInvoke)
  const mixedStart = provision.indexOf('cutover_stage=$(mktemp -d /root/kelion/runtime/runtime-cutover.XXXXXX)', recoveryInstall)
  const mixedInvoke = provision.indexOf('runtime-config-cutover.sh" "$cutover_stage"', mixedStart)
  assert.ok(unitStart >= 0 && unitInvoke > unitStart && recoveryInstall > unitInvoke
    && mixedStart > recoveryInstall && mixedInvoke > mixedStart)
  assert.match(provision.slice(unitStart, unitInvoke), /systemd-timer\.[$]unit[\s\S]*systemd-service\.[$]unit/)
  assert.doesNotMatch(provision.slice(mixedStart, mixedInvoke), /systemd-(?:timer|service)\./)
  assert.match(deploy, /upgrade_constructor_timer_units_quiesced\(\) \([\s\S]*systemd-timer\.[$]unit[\s\S]*systemd-service\.[$]unit[\s\S]*--leave-constructor-quiesced/)
  assert.match(cutover, /systemd-timer\.kelion-codex-worker\.timer\|systemd-timer\.kelion-constructor-publisher\.timer\|systemd-timer\.kelion-constructor-release\.timer/)
  assert.match(cutover, /systemd-service\.kelion-codex-worker\.service\|systemd-service\.kelion-constructor-publisher\.service\|systemd-service\.kelion-constructor-release\.service/)
  assert.match(cutover, /validate_constructor_timer_unit\(\)[\s\S]*ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready[\s\S]*Requires=kelion-runtime-config-recovery\.service/)
  const journal = cutover.indexOf('write_journal_phase prepared')
  const move = cutover.indexOf('mv -f -- "${prepared[$index]}"')
  assert.ok(journal >= 0 && move > journal, 'jurnalul fsync trebuie să preceadă orice înlocuire de timer')
})

test('tranzacția unit-only amână porțile secretelor până la cutover-ul mixt cu candidații noi', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const installer = read('deploy/instaleaza-constructor.sh')
  const provision = read('.github/workflows/vps-set-env.yml')
  const deploy = read('deploy/deploy.sh')
  const validator = shellFunction(cutover, 'validate_candidate_secret_separation')
  const hmacGate = validator.indexOf("assert_pairwise_distinct 'HMAC-urile Constructor'")
  const oauthGate = validator.indexOf("assert_pairwise_distinct 'credentialele OAuth Admin și GHCR'", hmacGate)
  const githubGate = validator.indexOf("assert_pairwise_distinct 'tokenurile GitHub Constructor și OAuth Admin'", oauthGate)
  const mainStart = cutover.indexOf('mapfile -t manifest_entries')
  const main = cutover.slice(mainStart)
  const stateValidation = main.indexOf('\nvalidate_constructor_state\n')
  const validatorCall = main.indexOf('\nvalidate_candidate_secret_separation\n')
  const journal = main.indexOf('write_journal_phase prepared', validatorCall)
  const mutation = main.indexOf('mutation_started=1', journal)
  const firstMove = main.indexOf('mv -f -- "${prepared[$index]}"', mutation)

  assert.ok(hmacGate >= 0 && oauthGate > hmacGate && githubGate > oauthGate,
    'validatorul păstrează ordinea tuturor porților de identitate')
  assert.ok(stateValidation >= 0 && validatorCall > stateValidation && journal > validatorCall
    && mutation > journal && firstMove > mutation,
  'validatorul strict trebuie apelat după selecția generației și înainte de jurnal sau commit')
  assert.equal((main.match(/^validate_candidate_secret_separation$/gm) ?? []).length, 1)
  assert.match(validator, /unit_only_transaction" = 1[^\n]*defer_secret_gates" = 1[\s\S]*return 0/)
  assert.match(validator, /constructor_configured" -eq 3/)
  assert.match(validator, /app-secret\.github-release-oauth-token/)
  assert.match(validator, /gate-secret\.github-ghcr-read-token/)
  assert.equal((installer.match(/KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER=1/g) ?? []).length, 1,
    'installerul poate amâna porțile numai la singurul său cutover unit-only')
  assert.equal((provision.match(/KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER=1/g) ?? []).length, 1,
    'provisionarea poate amâna porțile numai la cutover-ul unit-only urmat de staging strict')
  assert.doesNotMatch(deploy, /KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER/,
    'deploy-ul release trebuie să valideze secretele live chiar în cutover-ul unit-only')

  const harness = `set -euo pipefail
${validator}
calls=0
force_collision=0
assert_pairwise_distinct() {
  calls=$((calls + 1))
  if [ "$force_collision" = 1 ]; then return 73; fi
}
unit_only_transaction=1
constructor_configured=3
defer_secret_gates=1
force_collision=1
validate_candidate_secret_separation
[ "$calls" = 0 ]
calls=0
defer_secret_gates=0
force_collision=0
validate_candidate_secret_separation
[ "$calls" = 3 ]
calls=0
unit_only_transaction=0
defer_secret_gates=1
force_collision=0
validate_candidate_secret_separation
[ "$calls" = 3 ]
calls=0
force_collision=1
if validate_candidate_secret_separation; then exit 91; fi
[ "$calls" = 1 ]`
  const result = spawnSync(bashExecutable, ['-c', harness], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('quiesce distinge timerele disabled de serviciile oneshot statice', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const installer = read('deploy/instaleaza-constructor.sh')
  const predicates = [
    ['runtime', shellFunction(cutover, 'validate_constructor_unit_file_state')],
    ['installer', shellFunction(installer, 'validate_constructor_unit_file_state')],
  ]
  const prepublicationPredicates = [
    ['runtime', shellFunction(cutover, 'validate_constructor_prepublication_unit_file_state')],
    ['installer', shellFunction(installer, 'validate_constructor_prepublication_unit_file_state')],
  ]

  for (const [label, predicate] of predicates) {
    const harness = `set -euo pipefail
${predicate}
systemctl() {
  [ "\$1" = show ] || return 91
  [ "\${FAKE_SHOW_FAILURE:-0}" = 0 ] || return 92
  printf '%s\\n' "\${FAKE_UNIT_FILE_STATE-}"
}
FAKE_UNIT_FILE_STATE=disabled
validate_constructor_unit_file_state kelion-codex-worker.timer
FAKE_UNIT_FILE_STATE=static
validate_constructor_unit_file_state kelion-constructor-publisher.service
for state in static enabled enabled-runtime linked linked-runtime indirect masked generated transient bad ''; do
  FAKE_UNIT_FILE_STATE=\$state
  if validate_constructor_unit_file_state kelion-constructor-release.timer; then exit 101; fi
done
for state in disabled enabled enabled-runtime linked linked-runtime indirect masked generated transient bad ''; do
  FAKE_UNIT_FILE_STATE=\$state
  if validate_constructor_unit_file_state kelion-constructor-release.service; then exit 102; fi
done
FAKE_SHOW_FAILURE=1
if validate_constructor_unit_file_state kelion-codex-worker.timer; then exit 103; fi
FAKE_SHOW_FAILURE=0
FAKE_UNIT_FILE_STATE=disabled
if validate_constructor_unit_file_state kelion-constructor-sync.service; then exit 104; fi`
    const result = spawnSync(bashExecutable, ['-c', harness], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`)
  }

  for (const [label, predicate] of prepublicationPredicates) {
    const harness = `set -euo pipefail
${predicate}
systemctl() {
  [ "\$1" = show ] || return 91
  printf '%s\\n' "\${FAKE_UNIT_FILE_STATE-}"
}
FAKE_UNIT_FILE_STATE=disabled
validate_constructor_prepublication_unit_file_state kelion-constructor-release.timer
validate_constructor_prepublication_unit_file_state kelion-constructor-release.service
FAKE_UNIT_FILE_STATE=static
validate_constructor_prepublication_unit_file_state kelion-constructor-release.service
if validate_constructor_prepublication_unit_file_state kelion-constructor-release.timer; then exit 111; fi
for state in enabled enabled-runtime linked linked-runtime indirect masked generated transient bad ''; do
  FAKE_UNIT_FILE_STATE=\$state
  if validate_constructor_prepublication_unit_file_state kelion-constructor-release.service; then exit 112; fi
done`
    const result = spawnSync(bashExecutable, ['-c', harness], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${label} prepublication: ${result.stderr || result.stdout}`)
  }

  const runtimeBarrier = shellFunction(cutover, 'validate_constructor_quiesce_barrier')
  const runtimeEarly = shellFunction(cutover, 'early_recover_only_barrier')
  const runtimeStopTimer = shellFunction(cutover, 'stop_and_disable_constructor_timer')
  const runtimeStopService = shellFunction(cutover, 'stop_and_disable_constructor_service')
  const runtimeReport = shellFunction(cutover, 'report_quiesce_postcondition_failure')
  const runtimeForce = shellFunction(cutover, 'force_quiesce_constructor_units')
  const runtimePostconditions = shellFunction(cutover, 'validate_constructor_quiesce_postconditions')
  const runtimeRestore = shellFunction(cutover, 'restore_constructor_timers')
  const installerQuiesce = shellFunction(installer, 'quiesce_before_install')
  const installerQuiescePostconditions = shellFunction(installer, 'validate_install_quiesce_postconditions')
  const installerPublishedPostconditions = shellFunction(installer, 'validate_published_systemd_postconditions')
  const installerPublished = installer.slice(installer.indexOf('set_constructor_install_phase published-validation'))
  assert.match(runtimeBarrier, /validate_constructor_unit_file_state "\$unit"/)
  assert.match(runtimeForce, /constructor_timers[\s\S]*stop_and_disable_constructor_timer[\s\S]*constructor_services[\s\S]*stop_and_disable_constructor_service[\s\S]*systemctl daemon-reload[\s\S]*wait_for_constructor_quiesce_postconditions/)
  assert.match(runtimePostconditions, /ActiveState[\s\S]*list-jobs/)
  assert.match(runtimeRestore, /constructor_services[\s\S]*stop_and_disable_constructor_service[\s\S]*validate_constructor_unit_file_state/)
  assert.doesNotMatch(installerQuiesce, /systemctl disable --now/)
  assert.match(installerQuiesce, /constructor_timers[\s\S]*stop_and_disable_constructor_timer[\s\S]*constructor_services[\s\S]*stop_and_disable_constructor_service[\s\S]*systemctl daemon-reload[\s\S]*wait_for_install_quiesce_postconditions/)
  assert.match(installerQuiescePostconditions, /validate_constructor_prepublication_unit_file_state "\$unit"/)
  assert.match(installerPublished, /wait_for_published_systemd_postconditions/)
  assert.match(installerPublishedPostconditions, /validate_constructor_unit_file_state "\$unit"/)
  assert.doesNotMatch(runtimeBarrier, /is-enabled/)
  assert.doesNotMatch(installerQuiesce, /is-enabled/)

  const earlyHarness = `set -euo pipefail
${runtimeStopTimer}
${runtimeStopService}
${runtimeReport}
${shellFunction(cutover, 'validate_constructor_prepublication_unit_file_state')}
${runtimeEarly}
systemctl() {
  local command=\$1 unit=\${2:-}
  if [ "\$command" = disable ] && [ "\$unit" = --no-reload ]; then unit=\$3; fi
  case "\$command" in
    cat) return 0 ;;
    stop) [ "\${FAIL_STOP:-0}" = 0 ] ;;
    disable) [ "\${FAIL_DISABLE:-0}" = 0 ] ;;
    daemon-reload) [ "\${FAIL_RELOAD:-0}" = 0 ] ;;
    show)
      if [[ "\$*" == *UnitFileState* ]]; then
        [[ "\$unit" == *.timer ]] && echo disabled || echo "\${SERVICE_STATE:-static}"
      else echo "\${ACTIVE_STATE:-inactive}"; fi ;;
    list-jobs) [ "\${PENDING_JOB:-0}" = 0 ] || echo '1 fake start waiting' ;;
    *) return 91 ;;
  esac
}
early_recover_only_barrier
FAIL_STOP=1 FAIL_DISABLE=1
early_recover_only_barrier
FAIL_STOP=0 FAIL_DISABLE=0
SERVICE_STATE=enabled
if early_recover_only_barrier; then exit 101; fi
SERVICE_STATE=static ACTIVE_STATE=active
if early_recover_only_barrier; then exit 102; fi
ACTIVE_STATE=inactive PENDING_JOB=1
if early_recover_only_barrier; then exit 103; fi`
  const earlyResult = spawnSync(bashExecutable, ['-c', earlyHarness], { encoding: 'utf8' })
  assert.equal(earlyResult.status, 0, earlyResult.stderr || earlyResult.stdout)
})

test('dovezile systemd post-reload reîncearcă bounded fără să relaxeze contractul', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const installer = read('deploy/instaleaza-constructor.sh')
  const waiters = [
    [cutover, 'wait_for_live_constructor_units_quiesced', 'validate_live_constructor_units_quiesced', 'wait_for_live_constructor_units_quiesced'],
    [cutover, 'wait_for_constructor_quiesce_postconditions', 'validate_constructor_quiesce_postconditions', 'wait_for_constructor_quiesce_postconditions 1'],
    [installer, 'wait_for_install_quiesce_postconditions', 'validate_install_quiesce_postconditions', 'wait_for_install_quiesce_postconditions 6'],
    [installer, 'wait_for_published_systemd_postconditions', 'validate_published_systemd_postconditions', 'wait_for_published_systemd_postconditions'],
  ]

  for (const [source, waiterName, validatorName, invocation] of waiters) {
    const waiter = shellFunction(source, waiterName)
    assert.match(waiter, new RegExp(`attempt <= 12[\\s\\S]*${validatorName}[\\s\\S]*sleep 0\\.25`))
    assert.doesNotMatch(waiter, /^\s*(?:systemctl|rm|mv|install)\b/m)

    const harness = `set -euo pipefail
${waiter}
calls=0
sleeps=0
${validatorName}() {
  calls=$((calls + 1))
  [ "$calls" -ge 3 ]
}
sleep() { sleeps=$((sleeps + 1)); }
${invocation}
[ "$calls" -eq 3 ] && [ "$sleeps" -eq 2 ]

calls=0
sleeps=0
${validatorName}() {
  calls=$((calls + 1))
  return 1
}
if ${invocation}; then exit 121; fi
[ "$calls" -eq 12 ] && [ "$sleeps" -eq 11 ]`
    const result = spawnSync(bashExecutable, ['-c', harness], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${waiterName}: ${result.stderr || result.stdout}`)
  }
})

test('contractul live strict atribuie fiecare predicat systemd fără date libere', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const reporter = shellFunction(cutover, 'report_live_constructor_quiesce_failure')
  const effective = shellFunction(cutover, 'validate_effective_constructor_unit')
  const strict = shellFunction(cutover, 'validate_live_constructor_units_quiesced')
  const barrier = shellFunction(cutover, 'validate_constructor_quiesce_barrier')

  assert.doesNotMatch(cutover, /validate_effective_constructor_unit_for_quiesce/)
  assert.match(effective, /local unit=\$1 report=\$\{2:-0\}/)
  assert.match(strict, /validate_effective_constructor_unit "\$unit" "\$report"/)
  assert.match(reporter, /case "\$unit" in[\s\S]*\*\) unit=unknown/)
  assert.match(reporter, /case "\$predicate" in[\s\S]*\*\) predicate=unknown/)
  assert.match(reporter, /live-quiesce-contract:%s:%s/)
  for (const predicate of [
    'ready-stamp-present', 'file-type', 'file-metadata-query', 'file-metadata',
    'timer-contract', 'service-contract', 'unit-catalog', 'unit-count',
  ]) assert.match(strict, new RegExp(predicate))
  for (const predicate of [
    'fragment-query', 'fragment-path', 'dropins-query', 'dropins-present',
    'load-state-query', 'load-state', 'reload-state-query', 'reload-needed',
  ]) assert.match(effective, new RegExp(predicate))
  for (const predicate of [
    'timer-unit-file-state', 'service-unit-file-state', 'active-state-query',
    'active-state', 'pending-job', 'auxiliary-active-state-query',
    'auxiliary-active-state', 'auxiliary-pending-job',
  ]) assert.match(barrier, new RegExp(predicate))

  const effectiveHarness = `set -euo pipefail
${reporter}
${effective}
mode=ok
systemctl() {
  [ "$1" = show ] || return 91
  local unit=$2 property=\${3#--property=}
  case "$property" in
    FragmentPath)
      [ "$mode" != fragment-query ] || return 1
      [ "$mode" != fragment-path ] && printf '/etc/systemd/system/%s\\n' "$unit" || printf '/wrong\\n' ;;
    DropInPaths)
      [ "$mode" != dropins-query ] || return 1
      [ "$mode" != dropins-present ] || printf '/drop-in.conf\\n' ;;
    LoadState)
      [ "$mode" != load-state-query ] || return 1
      [ "$mode" != load-state ] && printf 'loaded\\n' || printf 'not-found\\n' ;;
    NeedDaemonReload)
      [ "$mode" != reload-state-query ] || return 1
      [ "$mode" != reload-needed ] && printf 'no\\n' || printf 'yes\\n' ;;
    *) return 92 ;;
  esac
}
for item in \\
  fragment-query:fragment-query fragment-path:fragment-path \\
  dropins-query:dropins-query dropins-present:dropins-present \\
  load-state-query:load-state-query load-state:load-state \\
  reload-state-query:reload-state-query reload-needed:reload-needed; do
  mode=\${item%%:*}; expected=\${item#*:}
  if output=$(validate_effective_constructor_unit kelion-codex-worker.timer 1 2>&1); then exit 121; fi
  [ "$output" = "runtime-cutover: live-quiesce-contract:kelion-codex-worker.timer:$expected" ]
done
mode=ok
validate_effective_constructor_unit kelion-codex-worker.timer 1
[ "$(report_live_constructor_quiesce_failure '../../secret' '../../value' 2>&1)" = \\
  'runtime-cutover: live-quiesce-contract:unknown:unknown' ]`
  const effectiveResult = spawnSync(bashExecutable, ['-c', effectiveHarness], { encoding: 'utf8' })
  assert.equal(effectiveResult.status, 0, effectiveResult.stderr || effectiveResult.stdout)

  const barrierHarness = `set -euo pipefail
${reporter}
${barrier}
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
READY_STAMP=$tmp/absent
constructor_timers=()
constructor_services=(kelion-codex-worker.service)
constructor_auxiliary_services=()
validate_constructor_unit_file_state() { return 1; }
systemctl() { [ "$1" = cat ]; }
if output=$(validate_constructor_quiesce_barrier 1 2>&1); then exit 131; fi
[ "$output" = 'runtime-cutover: live-quiesce-contract:kelion-codex-worker.service:service-unit-file-state' ]
if output=$(validate_constructor_quiesce_barrier 2 2>&1); then exit 132; fi
[ -z "$output" ]`
  const barrierResult = spawnSync(bashExecutable, ['-c', barrierHarness], { encoding: 'utf8' })
  assert.equal(barrierResult.status, 0, barrierResult.stderr || barrierResult.stdout)

  const waiter = shellFunction(cutover, 'wait_for_live_constructor_units_quiesced')
  const waiterHarness = `set -euo pipefail
${waiter}
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
calls=0
reports=''
validate_live_constructor_units_quiesced() {
  calls=$((calls + 1))
  reports="$reports$1"
  if [ "$1" = 1 ]; then printf '%s\\n' final-attribution >&2; fi
  return 1
}
sleep() { :; }
if wait_for_live_constructor_units_quiesced 2> "$tmp/output"; then exit 141; fi
[ "$calls" -eq 12 ]
[ "$reports" = 000000000001 ]
[ "$(cat "$tmp/output")" = final-attribution ]`
  const waiterResult = spawnSync(bashExecutable, ['-c', waiterHarness], { encoding: 'utf8' })
  assert.equal(waiterResult.status, 0, waiterResult.stderr || waiterResult.stdout)
})

test('bootstrapul recovery acceptă numai helperul b911 și candidatul compatibil pin-uit', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const recovery = shellFunction(installer, 'recover_existing_runtime_journal')
  assert.match(installer, /LEGACY_STATIC_RUNTIME_HELPER_SHA256=db72ef1d9c92660adfb656330efb4e651c16d0439643c7fd944c2dd56ee1c9de/)
  const compatiblePin = installer.match(/COMPATIBLE_RUNTIME_HELPER_SHA256=([0-9a-f]{64})/)?.[1]
  assert.equal(compatiblePin, createHash('sha256').update(cutover).digest('hex'),
    'pin-ul helperului compatibil trebuie să urmărească exact bytes din bundle')
  const livePin = recovery.indexOf('[ "$live_sha" = "$LEGACY_STATIC_RUNTIME_HELPER_SHA256" ]')
  const loadIntent = recovery.indexOf('load_install_transaction', livePin)
  const bindHelper = recovery.indexOf('validate_published_candidate runtime-helper', loadIntent)
  const bindCompose = recovery.indexOf('validate_published_candidate compose-production', bindHelper)
  const preparedOnly = recovery.indexOf('.phase == "prepared"', bindCompose)
  const candidatePin = recovery.indexOf('[ "$candidate_sha" = "$COMPATIBLE_RUNTIME_HELPER_SHA256" ]', preparedOnly)
  const durableCopy = recovery.indexOf('sync -f "$temporary"', candidatePin)
  const ownerRun = recovery.indexOf('KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$install_request_id"', durableCopy)
  const noexecSafeRun = recovery.indexOf('bash "$recovery_helper" --recover-only', ownerRun)
  const cleanup = recovery.indexOf('rm -f -- "$temporary"', ownerRun)
  const journalGone = recovery.indexOf('[ ! -e "$runtime_journal" ]', cleanup)
  assert.ok(livePin >= 0 && loadIntent > livePin && bindHelper > loadIntent && bindCompose > bindHelper
    && preparedOnly > bindCompose && candidatePin > preparedOnly && durableCopy > candidatePin
    && ownerRun > durableCopy && noexecSafeRun > ownerRun && cleanup > noexecSafeRun && journalGone > cleanup)
  assert.match(recovery, /elif KELION_CUTOVER_LOCK_HELD=1[\s\S]*"\$recovery_helper" --recover-only/,
    'orice helper live necunoscut trebuie să-și consume propriul jurnal')
  assert.doesNotMatch(recovery, /publish_install_candidate|mv -f --[^\n]*runtime-config-cutover/)
})

test('un intent quiesced dintr-o sursă veche este supersedat atomic înainte de republicare', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const journalWriter = shellFunction(installer, 'write_install_journal')
  const loader = shellFunction(installer, 'load_install_transaction')
  const validator = shellFunction(installer, 'validate_superseded_install_root')
  const cleanup = shellFunction(installer, 'remove_superseded_install_root')
  const previousCleanup = shellFunction(installer, 'remove_previous_superseded_install_root')
  const finalizer = shellFunction(installer, 'clear_install_transaction')
  const supersede = shellFunction(installer, 'supersede_quiesced_install_transaction')
  const main = installer.slice(installer.indexOf("install_root=''"))
  const branch = main.slice(main.indexOf('if [ "$resume_different_source" = 1 ]'))
  const switchJournal = supersede.indexOf('stage_install_transaction')
  const durableQuiesced = supersede.indexOf('write_install_journal quiesced', switchJournal)
  const journalUnlink = finalizer.indexOf('rm -f -- "$INSTALL_JOURNAL"')
  const journalFsync = finalizer.indexOf('sync -f "$RUNTIME_ROOT"', journalUnlink)
  const currentRootCleanup = finalizer.indexOf('rm -f -- "$install_root/files/$logical"', journalFsync)
  const removeOld = finalizer.indexOf('remove_superseded_install_root', currentRootCleanup)
  const removePrevious = finalizer.indexOf('remove_previous_superseded_install_root', removeOld)

  assert.match(journalWriter,
    /supersededTransactionRoot[\s\S]*supersededManifestSha256[\s\S]*supersededSourceSha256[\s\S]*previousSupersededTransactionRoot[\s\S]*previousSupersededManifestSha256[\s\S]*previousSupersededSourceSha256[\s\S]*sync -f "[$]temporary"[\s\S]*mv -f -- "[$]temporary" "[$]INSTALL_JOURNAL"[\s\S]*sync -f "[$]RUNTIME_ROOT"/)
  assert.match(loader,
    /has\("supersededTransactionRoot"\)[\s\S]*has\("supersededManifestSha256"\)[\s\S]*has\("supersededSourceSha256"\)[\s\S]*supersededTransactionRoot != \.transactionRoot[\s\S]*validate_superseded_install_root/)
  assert.match(loader, /\.sourceSha256 == \.manifestSha256/,
    'proveniența generației curente trebuie legată de manifestul autentificat')
  assert.match(loader, /\.supersededSourceSha256 == \.supersededManifestSha256/,
    'proveniența generației supersedate trebuie legată de manifestul autentificat')
  assert.match(loader, /supersededSourceSha256 != \.sourceSha256/,
    'sursa curentă nu poate reveni la generația supersedată imediat')
  assert.match(loader,
    /previousSupersededSourceSha256 == \.previousSupersededManifestSha256[\s\S]*previousSupersededSourceSha256 != \.sourceSha256[\s\S]*previousSupersededSourceSha256 != \.supersededSourceSha256[\s\S]*previousSupersededTransactionRoot != \.transactionRoot[\s\S]*previousSupersededTransactionRoot != \.supersededTransactionRoot/,
    'a doua generație supersedată trebuie autentificată și distinctă de celelalte două')
  assert.match(validator, /\[ -e "[$]root" \] \|\| \[ -L "[$]root" \] \|\| return 1/,
    'un jurnal activ nu poate accepta dispariția rădăcinii supersedate')
  assert.match(validator, /realpath -e[\s\S]*0:0:700[\s\S]*0:0:700/)
  assert.match(validator, /root\/manifest[\s\S]*0:0:600[\s\S]*sha256sum[\s\S]*manifest_sha256/)
  assert.match(validator, /candidate=[$]root\/files\/[$]logical[\s\S]*0:0:600[\s\S]*sha256sum[\s\S]*digest/)
  assert.match(cleanup,
    /validate_superseded_install_root[\s\S]*rm -f -- "[$]root\/files\/[$]logical"[\s\S]*rmdir -- "[$]root\/files"[\s\S]*rmdir -- "[$]root"[\s\S]*sync -f "[$]RUNTIME_ROOT"/)
  assert.match(previousCleanup,
    /validate_superseded_install_root[\s\S]*rm -f -- "[$]root\/files\/[$]logical"[\s\S]*rmdir -- "[$]root\/files"[\s\S]*rmdir -- "[$]root"[\s\S]*sync -f "[$]RUNTIME_ROOT"/)
  assert.ok(switchJournal >= 0 && durableQuiesced > switchJournal,
    'intentul curent trebuie să fie durabil înainte să continue instalarea')
  assert.ok(journalUnlink >= 0 && journalFsync > journalUnlink
    && currentRootCleanup > journalFsync && removeOld > currentRootCleanup && removePrevious > removeOld,
  'niciun cleanup curent sau supersedat nu poate începe înainte ca absența jurnalului să fie durabilă')
  assert.doesNotMatch(supersede, /clear_install_transaction|remove_superseded_install_root|runtime-config-cutover\.sh/,
    'supersedarea nu poate crea o fereastră fără jurnal și nu poate executa helperul generației vechi')

  const noRuntimeJournal = branch.indexOf('[ ! -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ]')
  const boundedSupersession = branch.indexOf('[ -z "$install_previous_superseded_root" ]')
  const noReady = branch.indexOf('[ ! -e "$READY_STAMP" ]', noRuntimeJournal)
  const canonicalPending = branch.indexOf('[ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ]', noReady)
  const exactOldArtifacts = branch.indexOf('validate_published_candidate "$logical"', canonicalPending)
  const validOldUnits = branch.indexOf('verify_candidate_units', exactOldArtifacts)
  const atomicSwitch = branch.indexOf('supersede_quiesced_install_transaction', validOldUnits)
  const publishCurrent = main.indexOf('set_constructor_install_phase artifact-publication', main.indexOf('if [ "$resume_different_source" = 1 ]'))
  assert.ok(boundedSupersession >= 0 && noRuntimeJournal > boundedSupersession
    && noReady > noRuntimeJournal && canonicalPending > noReady
    && exactOldArtifacts > canonicalPending && validOldUnits > exactOldArtifacts && atomicSwitch > validOldUnits,
  'a treia supersedare, orice jurnal runtime, ready, pending necanonic, artefact vechi diferit sau tuplă invalidă trebuie să refuze switch-ul')
  assert.ok(publishCurrent > main.indexOf('supersede_quiesced_install_transaction', main.indexOf('if [ "$resume_different_source" = 1 ]')),
    'candidații checkoutului curent pot fi publicați numai după switch-ul durabil al jurnalului')
  assert.doesNotMatch(main, /Intentul întrerupt a fost finalizat fail-closed; se aplică acum checkoutul curent/)

  const supersessionHarness = `set -euo pipefail
${supersede}
stage_calls=0
write_calls=0
stage_install_transaction() {
  stage_calls=$((stage_calls + 1))
  install_root=/root/kelion/runtime/constructor-install.NEW
  install_manifest_sha256=$(printf 'c%.0s' {1..64})
  install_source_sha256=$install_manifest_sha256
}
write_install_journal() { [ "\$1" = quiesced ]; write_calls=$((write_calls + 1)); }
constructor_install_source_commit=$(printf 'd%.0s' {1..40})
install_root=/root/kelion/runtime/constructor-install.B
install_manifest_sha256=$(printf 'b%.0s' {1..64})
install_source_sha256=$install_manifest_sha256
install_superseded_root=/root/kelion/runtime/constructor-install.A
install_superseded_manifest_sha256=$(printf 'a%.0s' {1..64})
install_superseded_source_sha256=$install_superseded_manifest_sha256
install_previous_superseded_root=''
install_previous_superseded_manifest_sha256=''
install_previous_superseded_source_sha256=''
supersede_quiesced_install_transaction
[ "\$install_root" = /root/kelion/runtime/constructor-install.NEW ]
[ "\$install_superseded_root" = /root/kelion/runtime/constructor-install.B ]
[ "\$install_previous_superseded_root" = /root/kelion/runtime/constructor-install.A ]
[ "\$stage_calls:\$write_calls" = 1:1 ]
stage_before=\$stage_calls
write_before=\$write_calls
install_root=/root/kelion/runtime/constructor-install.D
install_manifest_sha256=$(printf 'e%.0s' {1..64})
install_source_sha256=$install_manifest_sha256
if supersede_quiesced_install_transaction; then exit 121; fi
[ "\$stage_calls:\$write_calls" = "\$stage_before:\$write_before" ]`
  const supersessionResult = spawnSync(bashExecutable, ['-c', supersessionHarness], { encoding: 'utf8' })
  assert.equal(supersessionResult.status, 0, supersessionResult.stderr || supersessionResult.stdout)
})

test('jurnalul durabil recuperează un SIGKILL între mutări înainte de backend și timere', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const recovery = cutover.indexOf('\nrecover_interrupted_cutover\n')
  const manifest = cutover.indexOf('\nmapfile -t manifest_entries', recovery)
  const durableBackup = cutover.indexOf('fsync_path "$transaction_root/rollback-manifest"')
  const prepared = cutover.indexOf('write_journal_phase prepared')
  const firstMove = cutover.indexOf('mv -f -- "${prepared[$index]}"')
  const filesCommitted = cutover.indexOf('write_journal_phase files-committed')
  const backendRecreated = cutover.lastIndexOf('write_journal_phase backend-recreated')
  const committed = cutover.lastIndexOf('write_journal_phase committed')
  const timersStart = cutover.lastIndexOf('restore_constructor_timers || die')
  assert.ok(recovery >= 0 && manifest > recovery, 'recovery rulează înainte să accepte noul manifest')
  assert.ok(durableBackup >= 0 && prepared > durableBackup && firstMove > prepared && filesCommitted > firstMove,
    'backupul și jurnalul fsync sunt durabile înaintea primei mutări')
  assert.ok(backendRecreated >= 0 && committed > backendRecreated && timersStart > committed,
    'pragul committed trebuie fsync după backend și înainte de primul start Constructor')
  assert.match(cutover, /recover_interrupted_cutover\(\)[\s\S]*quiesce_units_for_recovery[\s\S]*rollback-ul durabil al fișierelor[\s\S]*recreate_active_release "[$]recovery_compose"[\s\S]*restore_constructor_timers[\s\S]*clear_journal/)
  assert.match(cutover, /phase" = committed[\s\S]*validate_live_markers_for_recovery[\s\S]*recreate_active_release "[$]recovery_compose"[\s\S]*restore_constructor_timers/)
  assert.match(cutover, /write_journal_phase backend-recreated[\s\S]*write_journal_phase committed[\s\S]*restore_constructor_timers[\s\S]*write_journal_phase timers-restored[\s\S]*clear_journal/)
  assert.match(cutover, /committed\|timers-restored\)[\s\S]*force_quiesce_constructor_units[\s\S]*prepared\|files-committed\|backend-recreated\)[\s\S]*restore_files/)
  assert.match(cutover, /if \[ "[$]marker" = legacy \]; then\s*return 1/)
})

test('pierderea lease-ului este observabilă înainte de următoarea mutație', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return calls === 1
      ? new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{"error":"lease_lost"}', { status: 409, headers: { 'content-type': 'application/json' } })
  }
  const lease = startLease({
    api: new URL('http://127.0.0.1:18079/'),
    secret: 's'.repeat(32),
    prefix: 'x-constructor-publisher',
    path: '/api/internal/constructor-publisher/jobs/1/lease',
    body: { taskId: 'codex-123e4567-e89b-42d3-a456-426614174000', leaseId: '123e4567-e89b-42d3-a456-426614174001' },
    intervalMs: 5,
  })
  try {
    await lease.assert()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    await assert.rejects(lease.assert(), /HTTP 409/)
  } finally {
    await lease().catch(() => undefined)
    globalThis.fetch = originalFetch
  }
})
