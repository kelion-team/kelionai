import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
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
const runtimeFixture = (cutover) => {
  const runtimeAllowed = cutover.match(/runtime\.env\)\s+allowed_names='([^']+)'/)
  assert.ok(runtimeAllowed, 'allowlist-ul runtime nu poate fi extras')
  const overrides = new Map([
    ['NODE_ENV', 'production'],
    ['PORT', '8080'],
    ['PUBLIC_APP_ORIGIN', 'https://kelionai.app'],
    ['FRONTEND_ORIGIN', 'https://kelionai.app'],
    ['GOOGLE_REDIRECT_URI', 'https://kelionai.app/auth/google/callback'],
    ['OPENAI_API_KEY_FILE', '/run/secrets/openai-project-key'],
    ['OPENAI_ADMIN_KEY_FILE', '/run/secrets/openai-admin-key'],
    ['DATABASE_URL_FILE', '/run/secrets/database-url'],
    ['SESSION_SECRET_FILE', '/run/secrets/session-secret'],
    ['GOOGLE_CLIENT_SECRET_FILE', '/run/secrets/google-client-secret'],
    ['GOOGLE_TOKEN_ENCRYPTION_KEY_FILE', '/run/secrets/google-token-encryption-key'],
    ['CODEX_WORKER_SECRET_FILE', '/run/secrets/codex-worker-secret'],
    ['CONSTRUCTOR_MODEL_CONTROL_ENABLED', '1'],
    ['CONSTRUCTOR_MODEL_CONTROL_SOCKET', '/run/kelion-constructor-model-control/control.sock'],
    ['CONSTRUCTOR_MODEL_CONTROL_SECRET_FILE', '/run/secrets/constructor-model-control-secret'],
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
  const names = runtimeAllowed[1].split(' ')
  return {
    names,
    lines: names.map((name) => `${name}=${overrides.get(name) ?? ''}`).join('\n'),
  }
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

test('cheia publică ED25519 este canonizată fără comentariul emis de ssh-keygen', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const remoteShell = workflow.replace(/^ {10}/gm, '')
  const canonicalizer = shellFunction(remoteShell, 'canonical_signing_public')
  const validator = shellFunction(remoteShell, 'validate_signing_key')
  const publicBlob = 'AAAAC3NzaC1lZDI1NTE5AAAAIEyQeN2s7FJY0m3JwWQdTGV0wRPs+TRxVv5V9smS'
  const script = `
ssh-keygen() {
  [ "\${1-}" = -y ]
  printf '%s\\n' 'ssh-ed25519 ${publicBlob} kelion-constructor@legacy.example'
}
${canonicalizer}
canonical_signing_public ignored
`
  const result = spawnSync(bashExecutable, ['-c', script], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), `ssh-ed25519 ${publicBlob}`)
  assert.match(validator, /public=[$]\(canonical_signing_public "[$]key"\)/)
  assert.match(validator, /LC_ALL=C ssh-keygen -lf - -E sha256/)
  assert.ok(validator.includes('no\\ comment\\ \\(ED25519\\)'))
  assert.match(workflow, /signing_public=[$]\(canonical_signing_public "[$]signing_key"\)/)
  assert.match(canonicalizer, /ssh-keygen -y -P '' -f "[$]key" 2>\/dev\/null/)
  assert.match(canonicalizer, /\[ "[$]\{#raw\}" -ge 1 \][\s\S]*\[ "[$]\{#raw\}" -le 32768 \]/)
  assert.match(canonicalizer, /"[$]raw" != \*[$]'\\r'\*[\s\S]*"[$]raw" != \*[$]'\\n'\*/)
  assert.doesNotMatch(workflow, /public=[$]\(ssh-keygen -y -f "[$]key"\)/)
})

test('canonizarea reală păstrează fingerprintul și respinge alte tipuri sau o parolă', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const canonicalizer = shellFunction(workflow.replace(/^ {10}/gm, ''), 'canonical_signing_public')
  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-signing-public-'))
  const key = join(sandbox, 'ed25519')
  const encrypted = join(sandbox, 'encrypted')
  const ecdsa = join(sandbox, 'ecdsa')
  const generate = (args) => spawnSync('ssh-keygen', ['-q', ...args], { encoding: 'utf8' })
  const canonicalize = (path) => spawnSync(bashExecutable,
    ['-c', `${canonicalizer}\ncanonical_signing_public "$1"`, 'bash', path], { encoding: 'utf8' })

  try {
    const generated = generate(['-t', 'ed25519', '-N', '', '-C', 'kelion constructor legacy comment', '-f', key])
    assert.equal(generated.status, 0, generated.stderr)
    const raw = spawnSync('ssh-keygen', ['-y', '-P', '', '-f', key], { encoding: 'utf8' })
    assert.equal(raw.status, 0, raw.stderr)

    const canonical = canonicalize(key)
    assert.equal(canonical.status, 0, canonical.stderr)
    assert.equal(canonical.stdout.trim(), raw.stdout.trim().split(/\s+/).slice(0, 2).join(' '))

    const privateFingerprint = spawnSync('ssh-keygen', ['-lf', key, '-E', 'sha256'], { encoding: 'utf8' })
    const publicFingerprint = spawnSync('ssh-keygen', ['-lf', '-', '-E', 'sha256'], {
      encoding: 'utf8', input: canonical.stdout,
    })
    assert.equal(privateFingerprint.status, 0, privateFingerprint.stderr)
    assert.equal(publicFingerprint.status, 0, publicFingerprint.stderr)
    assert.equal(publicFingerprint.stdout.split(/\s+/)[1], privateFingerprint.stdout.split(/\s+/)[1])

    const encryptedGenerated = generate(['-t', 'ed25519', '-N', 'not-empty', '-C', 'encrypted', '-f', encrypted])
    assert.equal(encryptedGenerated.status, 0, encryptedGenerated.stderr)
    assert.notEqual(canonicalize(encrypted).status, 0)

    const ecdsaGenerated = generate(['-t', 'ecdsa', '-b', '256', '-N', '', '-C', 'wrong-type', '-f', ecdsa])
    assert.equal(ecdsaGenerated.status, 0, ecdsaGenerated.stderr)
    assert.notEqual(canonicalize(ecdsa).status, 0)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('metadata legacy a cheii de semnare este normalizată fără schimbarea materialului', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const normalization = workflow.indexOf('normalize_legacy_signing_key()')
  const finalValidation = workflow.indexOf('constructor_config_check=\'signing-key-validation\'', normalization)
  const registration = workflow.indexOf('constructor_config_check=\'signing-key-registration\'', finalValidation)
  const section = workflow.slice(normalization, registration)

  assert.ok(normalization >= 0 && finalValidation > normalization && registration > finalValidation)
  assert.match(section, /\[ -f "[$]key" \] && \[ ! -L "[$]key" \]/)
  assert.match(section, /stat -Lc '%u:%h' "[$]key"\)" = '0:1'/)
  assert.match(section, /stat -Lc '%s' "[$]key"/)
  assert.match(section, /install -o root -g root -m 0400 -- "[$]key" "[$]candidate"/)
  assert.match(section, /validate_signing_key "[$]candidate"[\s\S]*cmp -s -- "[$]key" "[$]candidate"/)
  assert.match(section, /sync -f "[$]candidate"[\s\S]*mv -f -- "[$]candidate" "[$]key"[\s\S]*sync -f "[$]signing_dir"[\s\S]*rmdir -- "[$]recovery_root"[\s\S]*sync -f "[$]signing_dir"/)
  assert.match(section, /constructor_config_check='signing-key-normalization'[\s\S]*normalize_legacy_signing_key "[$]signing_key"[\s\S]*constructor_config_check='signing-key-validation'[\s\S]*validate_signing_key "[$]signing_key"/)
  assert.doesNotMatch(section, /ssh-keygen[^\n]*-[Ct][^\n]*"[$]key"/)
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
  const validateInstallDirectory = shellFunction(installer, 'validate_root_owned_install_directory')
  const ensureInstallDirectory = shellFunction(installer, 'ensure_root_owned_install_directory')
  const secureHandoff = shellFunction(installer, 'secure_handoff_spool')
  assert.match(secureParent, /! -L "[$]path"[\s\S]*realpath -e -- "[$]path"[\s\S]*chown root:root[\s\S]*chmod 0711/)
  assert.match(secureChild, /! -L "[$]path"[\s\S]*realpath -e -- "[$]path"[\s\S]*chown "[$]owner:[$]group"[\s\S]*chmod 0700/)
  assert.match(validateInstallDirectory, /! -L "[$]path"[\s\S]*realpath -e -- "[$]path"[\s\S]*stat -Lc '%u:%g'[\s\S]*0022/)
  assert.match(ensureInstallDirectory, /validate_root_owned_install_directory "[$]parent"[\s\S]*validate_root_owned_install_directory "[$]path"[\s\S]*install -d/)
  const optValidation = installer.indexOf('validate_root_owned_install_directory /opt')
  const firstOptMutation = installer.indexOf('ensure_root_owned_install_directory /opt/kelion-codex 0755')
  assert.ok(optValidation >= 0 && firstOptMutation > optValidation,
    'layout-ul /opt trebuie validat înaintea primei mutații Constructor')
  assert.match(installer, /ensure_root_owned_install_directory \/opt\/kelion-codex 0755[\s\S]*ensure_root_owned_install_directory \/opt\/kelion-constructor 0755[\s\S]*ensure_root_owned_install_directory \/opt\/kelion-constructor\/lib 0755/)
  assert.match(installer, /validate_root_owned_install_directory \/etc\/systemd\/system[\s\S]*ensure_root_owned_install_directory \/etc\/systemd\/system\/private-ai-web\.service\.d 0755/)
  assert.doesNotMatch(installer, /ensure_root_owned_install_directory \/opt\/kelion-codex\/profile-home/,
    'installerul local nu trebuie să recreeze profilul Codex retras')
  assert.doesNotMatch(installer, /install -d[^\n]*\/opt\/kelion-(?:codex|constructor)/)
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
  if (/^NoNewPrivileges=false$/m.test(workerUnit)) {
    assert.match(workerUnit, /^ReadWritePaths=$/m)
    assert.match(workerUnit, /^SupplementaryGroups=kelion-handoff privateai$/m)
    assert.match(workerUnit, /^ProtectSystem=false$/m)
  } else {
    assert.doesNotMatch(workerUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-codex(?:\s|$)/m)
    assert.match(workerUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-codex\/repo .*\/var\/lib\/kelion-codex\/jobs/m)
    assert.match(workerUnit, /^SupplementaryGroups=kelion-handoff$/m)
    assert.match(workerUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-constructor-handoff(?:\s|$)/m)
  }
  assert.doesNotMatch(publisherUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-publisher(?:\s|$)/m)
  assert.match(publisherUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-publisher\/repo .*\/var\/lib\/kelion-publisher\/state/m)
  assert.match(publisherUnit, /^SupplementaryGroups=kelion-handoff$/m)
  assert.match(publisherUnit, /^ReadWritePaths=.*\/var\/lib\/kelion-constructor-handoff(?:\s|$)/m)
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
    'configure-owner-commit',
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
    'config-stage',
    'configure-owner-journal',
    'cutover-stage',
    'existing-config-contract',
    'existing-unit-contract',
    'install-resume-contract',
    'installer',
    'installer-journal-finalize',
    'local-repair-executor',
    'model-control-secret-bootstrap',
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
    'signing-key-normalization',
    'signing-key-publication',
    'signing-key-registration',
    'signing-key-validation',
    'signing-stale-cleanup',
    'success-message',
    'unit-quiescence',
    'worker-gate-image',
    'worker-repository',
  ]
  const checks = [...remote.matchAll(/constructor_config_check='([^']+)'/g)].map((match) => match[1])
  assert.deepEqual([...new Set(checks)].sort(), expectedChecks)
  assert.equal([...remote.matchAll(/constructor_config_(?:phase|check)=(?!'[a-z0-9-]+')/g)].length, 0,
    'fazele și checkpointurile raportate trebuie să rămână literali din vocabularul fix')

  for (const [check, command] of [
    ['package-index', 'apt-get update -qq'],
    ['package-dependencies', 'apt-get install -y -qq ca-certificates'],
    ['local-repair-executor', '/opt/private-ai/bin/opencode --version'],
    ['signing-stale-cleanup', 'for stale_signing_root in'],
    ['signing-key-validation', 'validate_signing_key "$signing_key"'],
    ['signing-key-registration', 'existing_keys=$(curl'],
    ['worker-repository', 'clone_or_sync kelion-codex'],
    ['publisher-repository', 'clone_or_sync kelion-publisher'],
    ['worker-gate-image', 'pull_gate kelion-codex'],
    ['publisher-gate-image', 'pull_gate kelion-publisher'],
    ['apply', 'KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$configure_install_request_id"'],
  ]) {
    const labelIndex = remote.indexOf(`constructor_config_check='${check}'`)
    const commandIndex = remote.indexOf(command, labelIndex)
    assert.ok(labelIndex >= 0 && commandIndex > labelIndex, `${check} trebuie setat înainte de comanda atribuită`)
  }

  const localExecutor = remote.slice(
    remote.indexOf("constructor_config_check='local-repair-executor'"),
    remote.indexOf("constructor_config_check='cutover-stage'"),
  )
  assert.match(localExecutor, /\/opt\/private-ai\/bin\/opencode --version\)" = '1\.18\.25'/)
  assert.match(localExecutor, /\.enabled_providers == \["llama\.cpp"\]/)
  assert.match(localExecutor, /\.model == "llama\.cpp\/qwen3\.6-35b-a3b-local"/)
  assert.match(localExecutor, /has\("apiKey"\) \| not/)
  assert.match(localExecutor, /options\.baseURL == "http:\/\/127\.0\.0\.1:24080\/v1"/)
  assert.match(localExecutor, /systemctl is-active --quiet private-ai-llm\.service/)
  assert.match(localExecutor, /systemctl is-active --quiet private-ai-web\.service/)
  assert.match(localExecutor, /127\.0\.0\.1:24080\/health/)
  assert.match(localExecutor, /\[ ! -e \/var\/lib\/kelion-codex-auth \] && \[ ! -L \/var\/lib\/kelion-codex-auth \]/)
  assert.match(localExecutor, /\[ ! -e \/opt\/kelion-codex\/profile-home \] && \[ ! -L \/opt\/kelion-codex\/profile-home \]/)
  assert.doesNotMatch(remote, /@openai\/codex|forced_login_method|CODEX_HOME|login status|npm install --global/)

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
constructor_config_check='local-repair-executor'
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
    check: 'local-repair-executor',
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

test('configure leagă retry-ul installerului de aceeași tuplă exactă de 25 artefacte', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const installer = read('deploy/instaleaza-constructor.sh')
  const normalized = workflow.replace(/^ {10}/gm, '')
  const arrayValues = (source, name, valuePattern) => {
    const start = source.indexOf(`${name}=(`)
    const end = source.indexOf('\n)', start)
    assert.ok(start >= 0 && end > start, `array-ul ${name} trebuie delimitat`)
    return [...source.slice(start, end).matchAll(valuePattern)].map((match) => match[1])
  }

  const installerLogicals = arrayValues(installer, 'install_logicals', /^  ([a-z0-9.-]+)$/gm)
  const configureLogicals = arrayValues(normalized, 'configure_install_logicals', /^  ([a-z0-9.-]+)$/gm)
  const installerSources = arrayValues(installer, 'install_sources', /^  "\$repo_root\/([^"]+)"$/gm)
  const configureSources = arrayValues(normalized, 'configure_install_sources', /^  "\$work\/([^"]+)"$/gm)
  assert.equal(installerLogicals.length, 25)
  assert.deepEqual(configureLogicals, installerLogicals,
    'workflowul trebuie să folosească ordinea logică exactă a producerului jurnalului')
  assert.deepEqual(configureSources, installerSources,
    'workflowul trebuie să amprenteze exact aceleași surse ca installerul')

  const canonical = installerLogicals.map((logical, index) => {
    const digest = createHash('sha256').update(readFileSync(join(root, installerSources[index]))).digest('hex')
    return `${logical}\t${digest}\n`
  }).join('')
  const expectedSourceSha = createHash('sha256').update(canonical).digest('hex')
  const arraysStart = normalized.indexOf('configure_install_logicals=(')
  const functionStart = normalized.indexOf('current_configure_install_source_sha256() {', arraysStart)
  const arrays = normalized.slice(arraysStart, functionStart)
  const sourceHasher = shellFunction(normalized, 'current_configure_install_source_sha256')
  const hashResult = spawnSync(bashExecutable, ['-s', '--', root], {
    input: `set -euo pipefail\nwork=$1\n${arrays}\n${sourceHasher}\ncurrent_configure_install_source_sha256\n`,
    encoding: 'utf8',
  })
  assert.equal(hashResult.status, 0, hashResult.stderr)
  assert.equal(hashResult.stdout.trim(), expectedSourceSha,
    'algoritmul remote trebuie să fie byte-exact cu current_source_sha256 al installerului')

  const firstDigest = canonical.match(/[0-9a-f]{64}/)?.[0]
  assert.ok(firstDigest)
  const advancedCanonical = canonical.replace(firstDigest, `${firstDigest[0] === '0' ? '1' : '0'}${firstDigest.slice(1)}`)
  const oldGenerationSha = createHash('sha256').update(advancedCanonical).digest('hex')
  assert.notEqual(oldGenerationSha, expectedSourceSha)

  const loader = shellFunction(normalized, 'load_configure_install_journal')
  const guardStart = loader.indexOf('if [ "$configure_install_journal_source_sha256" != "$configure_install_current_source_sha256" ]')
  const guardEnd = loader.indexOf('\n  fi', guardStart)
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'guardul generației trebuie să poată fi executat izolat')
  const generationGuard = loader.slice(guardStart, guardEnd + '\n  fi'.length)
  const runGuard = (journalSource, currentSource, journalCommit) => spawnSync(bashExecutable, ['-s'], {
    input: `set -euo pipefail\nconfigure_install_journal_source_sha256=${journalSource}\nconfigure_install_current_source_sha256=${currentSource}\nconfigure_install_commit=${journalCommit}\n${generationGuard}\nprintf '%s\\n' accepted\n`,
    encoding: 'utf8',
  })
  const sameGeneration = runGuard(expectedSourceSha, expectedSourceSha, expectedSourceSha.slice(0, 40))
  assert.equal(sameGeneration.status, 0, sameGeneration.stderr)
  assert.equal(sameGeneration.stdout.trim(), 'accepted')
  const masterAdvanced = runGuard(oldGenerationSha, expectedSourceSha, oldGenerationSha.slice(0, 40))
  assert.equal(masterAdvanced.status, 1, masterAdvanced.stdout)
  assert.match(masterAdvanced.stderr, /altei generații de 25 artefacte/)

  const bind = workflow.indexOf('configure_install_journal_source_sha256=$(jq -er', workflow.indexOf('load_configure_install_journal()'))
  const mismatchExit = workflow.indexOf('altei generații de 25 artefacte', bind)
  const bothOrResume = workflow.indexOf('if [ -e "$reactivation_journal" ]', mismatchExit)
  const candidatePublication = workflow.indexOf("constructor_config_check='runtime-helper-publication'", bothOrResume)
  assert.ok(bind >= 0 && mismatchExit > bind && bothOrResume > mismatchExit && candidatePublication > bothOrResume,
    'mismatch-ul generației trebuie să oprească fluxul înainte de BOTH/resume și orice candidat nou')
})

test('configure păstrează ownerul installerului până la mixed commit și repornește recovery înaintea controllerului', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const normalized = workflow.replace(/^ {10}/gm, '')
  const installer = read('deploy/instaleaza-constructor.sh')
  assert.equal((workflow.match(/KELION_CONSTRUCTOR_CONFIGURE_OWNER=1/g) ?? []).length, 2,
    'fresh și resume trebuie să lase installerul sub același owner exterior')

  const pendingPreflight = workflow.indexOf('constructor_unit_pending=/root/kelion/runtime/constructor-unit-migration.pending')
  const pendingJournal = workflow.indexOf("bariera unit-only fără jurnal installer autentic este refuzată", pendingPreflight)
  const journalLoad = workflow.indexOf('load_configure_install_journal', pendingJournal)
  assert.ok(pendingPreflight >= 0 && pendingJournal > pendingPreflight && journalLoad > pendingJournal,
    'pending este acceptat numai dacă urmează clasificarea jurnalului installer autentic')

  const ownerLoad = workflow.indexOf("constructor_config_check='configure-owner-journal'")
  const requestOwner = workflow.indexOf('KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$configure_install_request_id"', ownerLoad)
  const commitOwner = workflow.indexOf('KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$configure_install_commit"', requestOwner)
  const mixed = workflow.indexOf('--leave-constructor-quiesced', commitOwner)
  const finalLoad = workflow.indexOf('load_configure_install_journal', mixed)
  const clearActivation = workflow.indexOf('rm -f -- "$activation_pending"', finalLoad)
  const clearOuter = workflow.indexOf('rm -f -- "$deploy_quiesce_journal"', clearActivation)
  const unlock = workflow.indexOf('flock -u 9', clearOuter)
  const recovery = workflow.indexOf('systemctl start kelion-runtime-config-recovery.service', unlock)
  const controller = workflow.indexOf('systemctl restart kelion-constructor-model-control.service', recovery)
  const probe = workflow.indexOf('probe_configured_model_controller', controller)
  assert.ok(ownerLoad >= 0 && requestOwner > ownerLoad && commitOwner > requestOwner && mixed > commitOwner
    && finalLoad > mixed && clearActivation > finalLoad && clearOuter > clearActivation
    && unlock > clearOuter && recovery > unlock && controller > recovery && probe > controller,
  'mixed cutover păstrează ownerul, consumă barierele durabil, eliberează lockul și abia apoi pornește recovery/controller')

  const configureBranch = installer.slice(
    installer.indexOf('if [ "$constructor_install_configure_owner" = 1 ]; then', installer.indexOf('set_constructor_install_phase commit')),
    installer.indexOf('elif [ "$constructor_install_upgrade_owner" = 1 ]; then', installer.indexOf('set_constructor_install_phase commit')),
  )
  assert.match(configureBranch, /validate_constructor_activation_pending[\s\S]*validate_model_controller_quiesced[\s\S]*load_install_transaction[\s\S]*constructor-unit-migration\.pending/)
  assert.doesNotMatch(configureBranch, /clear_install_transaction|clear_constructor_activation_pending|start_model_controller/)

  const restore = shellFunction(normalized, 'restore_configure_recovery_and_controller')
  const harness = `set -euo pipefail
calls=''
record() { calls="\${calls}|$*"; }
flock() { record "flock:$*"; }
systemctl() {
  record "systemctl:$*"
  case "$1:\${3:-}" in
    is-enabled:kelion-*.timer|is-active:kelion-*.timer) return 1 ;;
    *) return 0 ;;
  esac
}
probe_configured_model_controller() { record probe; }
reactivation_journal=/tmp/kelion-test-reactivation-journal-absent
exec 9>/dev/null
${restore}
restore_configure_recovery_and_controller
printf '%s\n' "$calls"
`
  const executed = spawnSync(bashExecutable, ['-s'], { input: harness, encoding: 'utf8' })
  assert.equal(executed.status, 0, executed.stderr)
  const calls = executed.stdout.trim()
  assert.match(calls,
    /^\|flock:-u 9\|systemctl:reset-failed kelion-runtime-config-recovery\.service kelion-constructor-model-control\.service\|systemctl:start kelion-runtime-config-recovery\.service\|systemctl:is-active --quiet kelion-runtime-config-recovery\.service\|systemctl:restart kelion-constructor-model-control\.service\|probe/)
  assert.match(calls, /systemctl:is-enabled --quiet kelion-codex-worker\.timer/)
  assert.match(calls, /systemctl:is-active --quiet kelion-constructor-release\.timer$/)
})

test('secretul controllerului se naște o singură dată pe VPS și rămâne idempotent', () => {
  const configure = read('.github/workflows/vps-run.yml')
  const provision = read('.github/workflows/vps-set-env.yml')
  for (const [name, workflow] of [['configure', configure], ['provision', provision]]) {
    assert.doesNotMatch(workflow, /secrets\.CONSTRUCTOR_MODEL_CONTROL_SECRET/, `${name}: secret GitHub interzis`)
    assert.doesNotMatch(workflow, /encode constructor-model-control|decode constructor-model-control/,
      `${name}: valoarea locală nu traversează payloadul`)
    const remote = workflow.replace(/^ {10}/gm, '')
    const bootstrap = shellFunction(remote, 'ensure_local_model_control_secret')
    const missing = bootstrap.indexOf('if [ ! -e "$secret_path" ] && [ ! -L "$secret_path" ]; then')
    const generation = bootstrap.indexOf('openssl rand -hex 32', missing)
    const publish = bootstrap.indexOf('mv -f -- "$candidate" "$secret_path"', generation)
    const fileSync = bootstrap.indexOf('sync -f "$secret_path"', publish)
    const dirSync = bootstrap.indexOf('sync -f "$secret_dir"', fileSync)
    const finalStat = bootstrap.indexOf("0:10050:440:1", dirSync)
    const readExisting = bootstrap.indexOf('model_control_secret=$(<"$secret_path")', finalStat)
    assert.ok(missing >= 0 && generation > missing && publish > generation && fileSync > publish
      && dirSync > fileSync && finalStat > dirSync && readExisting > finalStat,
    `${name}: generarea atomică și validarea idempotentă nu sunt ordonate`)
    assert.equal((bootstrap.match(/openssl rand -hex 32/g) ?? []).length, 1)
    assert.match(workflow, /stage_value app-secret\.constructor-model-control-secret "[$]model_control_secret"/)
    assert.match(workflow, /[$]codex_secret" != "[$]model_control_secret/)
    assert.match(workflow, /[$]model_control_secret" != "[$]publisher_secret/)
    assert.match(workflow, /[$]model_control_secret" != "[$]release_secret/)
  }
  const generation = configure.indexOf("constructor_config_check='model-control-secret-bootstrap'")
  const installer = configure.indexOf('bash "$work/deploy/instaleaza-constructor.sh"', generation)
  assert.ok(generation >= 0 && installer > generation,
    'configure trebuie să publice secretul local înainte de orice reluare/instalare')
})

test('workerul serializează execuția cu schimbarea manuală pe lockul canonic', () => {
  const unit = read('deploy/systemd/kelion-codex-worker.service')
  const cutover = shellFunction(read('deploy/lib/runtime-config-cutover.sh'), 'validate_constructor_service_unit')
  const execStart = 'ExecStart=/usr/bin/flock --exclusive --wait 9000 /run/lock/private-ai-model-switch.lock /usr/bin/node /opt/kelion-codex/codex-worker.mjs --once'
  assert.match(unit, /^SupplementaryGroups=kelion-handoff privateai$/m)
  assert.equal(unit.split('\n').filter((line) => line === execStart).length, 1)
  assert.ok(cutover.includes(execStart.slice('ExecStart='.length)))
  assert.match(cutover, /grep -Fxc "ExecStart=\$exec_start"/)
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
  assert.match(refresh, /release[)]\s+awk -F= -v checks="[$]release_required_checks"/)
  assert.doesNotMatch(refresh, /release[)]\s+awk -F= -v checks="[$]required_checks"/)
  assert.match(refresh, /token_file=\/root\/kelion\/gate-secrets\/github-ghcr-read-token/)
  assert.match(refresh, /stat -c '%u:%g:%a' "[$]token_file"[)]" = '0:0:400'/)
  assert.match(deploy, /restore_constructor_after_release[\s\S]*systemctl is-enabled --quiet "[$]timer"[\s\S]*systemctl is-active --quiet "[$]timer"/)
  assert.doesNotMatch(refresh, /systemctl (?:stop|enable)[^\n]*[|][|] true/)
  assert.doesNotMatch(control, /^\s+CONSTRUCTOR_REQUIRED_CHECKS=verify,container-isolation$/m)
})

test('env-ul release generat de control trece validatorul runtime real', () => {
  const control = read('.github/workflows/vps-run.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const marker = '          cat > "$cutover_stage/files/constructor-config.constructor-release.env" <<EOF\n'
  const start = control.indexOf(marker)
  const end = control.indexOf('\n          EOF', start + marker.length)

  assert.ok(start >= 0 && end > start, 'heredoc-ul constructor-release.env nu poate fi extras')
  const template = control.slice(start + marker.length, end).replace(/^ {10}/gm, '')
  const rendered = template
    .replaceAll('$repository', 'kelion-team/kelionai')
    .replaceAll('$public_origin', 'https://kelionai.app')
  assert.doesNotMatch(rendered, /^\s*#/, 'fișierul env strict nu poate conține comentarii')

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-constructor-release-env-'))
  const envFile = join(sandbox, 'constructor-release.env')
  try {
    writeFileSync(envFile, `${rendered}\n`)
    const validator = [
      'set -euo pipefail',
      shellFunction(cutover, 'validate_text_file_bytes'),
      shellFunction(cutover, 'validate_env_file'),
      'validate_env_file "$1" constructor-config.constructor-release.env',
    ].join('\n')
    const result = spawnSync(bashExecutable, ['-c', validator, 'validate-constructor-release-env', envFile], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `validatorul runtime a respins env-ul generat: ${result.stderr}`)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('contractul live separă porțile PR de porțile release post-merge', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const checksValidator = shellFunction(cutover, 'validate_constructor_checks_contract')
  const command = `${checksValidator}\nvalidate_constructor_checks_contract "$1" "$2" "$3"`
  const prChecks = 'verify,container-isolation,current-tree,merge-policy'
  const releaseChecks = 'verify,container-isolation'
  const run = (runtime, publisher, release) => spawnSync(
    bashExecutable,
    ['-c', command, 'validate-constructor-checks', runtime, publisher, release],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(run(prChecks, prChecks, releaseChecks).status, 0)
  assert.notEqual(run(prChecks, releaseChecks, releaseChecks).status, 0,
    'publisherul trebuie să păstreze toate porțile PR din runtime')
  assert.notEqual(run(prChecks, prChecks, prChecks).status, 0,
    'release-ul post-merge nu poate cere joburile exclusiv PR')

  const liveContract = shellFunction(cutover, 'validate_live_runtime_contract')
  assert.match(liveContract,
    /validate_constructor_checks_contract "[$]runtime_checks" "[$]publisher_checks" "[$]release_checks"/)
  assert.doesNotMatch(liveContract, /"[$]runtime_checks" = "[$]release_checks"/)
})

test('rescrierea runtime.env din control rulează cu AWK-ul de sistem', () => {
  const control = read('.github/workflows/vps-run.yml')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const commandStart = control.indexOf('          awk -F= \\')
  const programMarker = '-v required_checks="$constructor_required_checks" \''
  const markerStart = control.indexOf(programMarker, commandStart)
  const programStart = control.indexOf('\n', markerStart) + 1
  const programEnd = control.indexOf('\n          \' "$runtime_file" >', programStart)

  assert.ok(commandStart >= 0 && markerStart >= commandStart && programStart > markerStart && programEnd > programStart,
    'programul AWK care rescrie runtime.env nu poate fi extras din workflow')

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-runtime-rewrite-'))
  const runtime = join(sandbox, 'runtime.env')
  const migrated = join(sandbox, 'migrated.env')
  const { lines: currentRuntime } = runtimeFixture(cutover)
  const legacyMissing = new Set([
    'CONSTRUCTOR_RETRY_BASE_SECONDS',
    'CONSTRUCTOR_RETRY_MAX_SECONDS',
    'CONSTRUCTOR_EXTERNAL_RETRY_SECONDS',
    'CONSTRUCTOR_REQUIRED_CHECKS',
    'GITHUB_RELEASE_OAUTH_TOKEN_FILE',
    'GOOGLE_TTS_VOICE',
  ])
  const legacyRuntime = currentRuntime
    .split('\n')
    .filter((line) => !legacyMissing.has(line.slice(0, line.indexOf('='))))
    .join('\n')
  writeFileSync(runtime, `${legacyRuntime}\n`)

  try {
    const result = spawnSync('awk', [
      '-F=',
      '-v', 'retry_base=60',
      '-v', 'retry_max=1800',
      '-v', 'retry_external=900',
      '-v', 'required_checks=verify,container-isolation,current-tree,merge-policy',
      control.slice(programStart, programEnd),
      runtime,
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    writeFileSync(migrated, result.stdout)
    const lines = result.stdout.trimEnd().split('\n')
    for (const expected of [
      'CODEX_WORKER_ENABLED=1',
      'CONSTRUCTOR_PUBLISHER_ENABLED=1',
      'CONSTRUCTOR_RELEASE_ENABLED=1',
      'CONSTRUCTOR_RETRY_BASE_SECONDS=60',
      'CONSTRUCTOR_RETRY_MAX_SECONDS=1800',
      'CONSTRUCTOR_EXTERNAL_RETRY_SECONDS=900',
      'CONSTRUCTOR_REQUIRED_CHECKS=verify,container-isolation,current-tree,merge-policy',
      'GITHUB_RELEASE_OAUTH_TOKEN_FILE=/run/secrets/github-release-oauth-token',
      'GOOGLE_TTS_VOICE=Charon',
    ]) assert.equal(lines.filter((line) => line === expected).length, 1,
      `runtime.env nu conține exact o apariție ${expected}`)

    const validator = [
      'set -euo pipefail',
      shellFunction(cutover, 'validate_text_file_bytes'),
      shellFunction(cutover, 'validate_env_file'),
      'validate_env_file "$1" runtime.env',
    ].join('\n')
    const validation = spawnSync(bashExecutable, ['-c', validator, 'validate-migrated-runtime', migrated], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(validation.status, 0, validation.stderr)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
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
  if (/^NoNewPrivileges=false$/m.test(worker)) {
    assert.match(worker, /^ProtectSystem=false$/m)
    assert.match(worker, /^CapabilityBoundingSet=~$/m)
    assert.match(worker, /^RestrictNamespaces=false$/m)
  } else {
    assert.match(worker, /NoNewPrivileges=true/)
    assert.match(worker, /ProtectSystem=strict/)
    assert.match(worker, /CapabilityBoundingSet=\n/)
    assert.match(worker, /^RestrictNamespaces=user mnt net pid ipc uts$/m)
    assert.doesNotMatch(worker, /^RestrictNamespaces=.*\bmount\b/m)
  }
  for (const unit of [publisher, release]) {
    assert.match(unit, /NoNewPrivileges=true/)
    assert.match(unit, /ProtectSystem=strict/)
    assert.match(unit, /CapabilityBoundingSet=\n/)
  }
  for (const unit of [worker, publisher, release]) {
    assert.match(unit, /After=[^\n]*kelion-runtime-config-recovery\.service/)
    assert.match(unit, /ConditionPathExists=\/run\/kelion\/runtime-config-recovery\.ready/)
    assert.doesNotMatch(unit, /\[Install\]|WantedBy=multi-user\.target/)
  }
  assert.match(publisher, /^RestrictNamespaces=user mnt net pid ipc uts$/m)
  assert.doesNotMatch(publisher, /^RestrictNamespaces=.*\bmount\b/m)
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
  if (runLogged.includes("signalGroup('SIGTERM')")) {
    assert.match(runLogged, /detached: true[\s\S]*signalGroup\('SIGTERM'\)[\s\S]*setTimeout\([\s\S]*signalGroup\('SIGKILL'\)[\s\S]*2_000/)
    assert.match(runLogged, /privilegedKill[\s\S]*\/usr\/bin\/sudo[\s\S]*\/usr\/bin\/kill/)
  } else {
  assert.match(runLogged, /child\.kill\('SIGTERM'\)[\s\S]*setTimeout\([\s\S]*child\.kill\('SIGKILL'\)[\s\S]*2_000/)
  }
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
  assert.match(
    runOnce,
    /prepareWorkerClaim\(secret, \{ profile: profile\.tier \}\)[\s\S]*acceptWorkerClaim\(secret, claimed\)/,
  )
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

test('installerul lasă capabilitățile dezactivate și pornește controllerul numai după commit', () => {
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
  assert.match(installer, /validate_opencode_constructor_config "\$repo_root\/deploy\/opencode-constructor\.json"/)
  assert.match(installer, /retire_legacy_codex_state/)
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
  assert.equal(logicalBlock.split('\n').filter((line) => /^  [a-z0-9.-]+$/.test(line)).length, 25)
  assert.equal(installer.split('systemctl restart private-ai-web.service').length - 1, 1)
  assert.equal(installer.split('systemctl enable kelion-runtime-config-recovery.service').length - 1, 1)
  const privateAiRestart = installer.indexOf('systemctl restart private-ai-web.service')
  const privateAiValidation = installer.indexOf('validate_private_ai_web_full_access', privateAiRestart)
  assert.ok(privateAiRestart >= 0 && privateAiValidation > privateAiRestart,
    'restartul necesar al executorului local trebuie urmat de validarea contractului live')
  const installerMain = installer.slice(installer.indexOf('set_constructor_install_phase transaction-prepare'))
  const pendingPublish = installerMain.indexOf('publish_constructor_activation_pending')
  const quiesce = installerMain.indexOf('quiesce_before_install', pendingPublish)
  const installClear = installerMain.indexOf('clear_install_transaction', quiesce)
  const pendingClear = installerMain.indexOf('clear_constructor_activation_pending', installClear)
  const controllerStart = installerMain.indexOf('"$ROOT/bin/runtime-config-cutover.sh" --recover-only', pendingClear)
  assert.ok(pendingPublish >= 0 && quiesce > pendingPublish && installClear > quiesce
    && pendingClear > installClear && controllerStart > pendingClear,
  'sentinelul precede quiesce, iar recovery-ul probează controllerul numai după clear-ul durabil al installerului')
  assert.equal(installerMain.indexOf('start_model_controller_after_install_commit', pendingClear), -1,
    'installerul standalone nu poate porni controllerul peste un ready stamp retras')
  assert.match(shellFunction(installer, 'start_model_controller_after_install_commit'),
    /\[ ! -e "\$INSTALL_JOURNAL" \][\s\S]*\[ ! -e "\$ACTIVATION_PENDING" \][\s\S]*systemctl restart kelion-constructor-model-control\.service/)
  const withoutExpectedServiceMutations = installer
    .replaceAll(/systemctl restart private-ai-web\.service[^\n]*/g, '')
    .replaceAll(/systemctl enable kelion-runtime-config-recovery\.service[^\n]*/g, '')
    .replaceAll(/systemctl enable kelion-constructor-model-control\.service[^\n]*/g, '')
    .replaceAll(/systemctl restart kelion-constructor-model-control\.service[^\n]*/g, '')
  assert.doesNotMatch(withoutExpectedServiceMutations,
    /systemctl\s+(?:enable|start|restart)|openssl\s+rand|ghp_|github_pat_|CODEX_HOME=.*login/)
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

test('release-ul refuză jurnalul persistent max-model înainte și sub publication lock', () => {
  const deploy = read('deploy/deploy.sh')
  assert.match(deploy, /MAX_MODEL_JOURNAL=\$RUNTIME_ROOT\/constructor-max-model[.]journal/)
  const preflight = deploy.indexOf('o tranzacție max-model persistentă blochează release-ul')
  const lock = deploy.indexOf('flock 8', preflight)
  const lockedGuard = deploy.indexOf('o tranzacție max-model persistentă blochează release-ul sub publication lock', lock)
  const recovery = deploy.indexOf('recover_lost_post_ponr_quiesce', lockedGuard)
  assert.ok(preflight >= 0 && lock > preflight && lockedGuard > lock && recovery > lockedGuard)
})

test('release-ul dovedește controllerul ready înainte de mutații și quiesced înaintea candidatului', () => {
  const deploy = read('deploy/deploy.sh')
  const installation = shellFunction(deploy, 'constructor_model_control_installation_proof')
  const ready = shellFunction(deploy, 'constructor_model_control_ready_proof')
  const quiesced = shellFunction(deploy, 'constructor_model_control_quiesced_proof')
  assert.match(installation,
    /constructor-model-control\.mjs\|0:0:555:1[\s\S]*constructor-model-switch\|0:0:755:1[\s\S]*kelion-constructor-model-control\.service\|0:0:444:1[\s\S]*constructor-model-control-secret\|0:10050:440:1/)
  assert.match(installation, /FragmentPath[\s\S]*DropInPaths[\s\S]*systemctl is-enabled/)
  assert.match(ready,
    /runtime-config-recovery\.ready[\s\S]*0:0:444:1[\s\S]*systemctl is-active[\s\S]*0:10050:660/)
  assert.match(quiesced,
    /ActiveState[\s\S]*inactive\|failed[\s\S]*systemctl list-jobs[\s\S]*\[ ! -e "\$socket" \]/)

  const early = deploy.indexOf("controllerul manual de model nu este instalat și ready înaintea release-ului")
  const lock = deploy.indexOf('flock 8', early)
  const locked = deploy.indexOf('controllerul manual de model s-a schimbat înainte de tranzacția release', lock)
  const firstJournal = deploy.indexOf('write_constructor_deploy_quiesce_journal armed', locked)
  assert.ok(early >= 0 && lock > early && locked > lock && firstJournal > locked,
    'controllerul trebuie verificat read-only înainte și sub lock, înaintea primului jurnal')

  const freshBlock = deploy.indexOf('# Constructorul rămâne oprit pe toată fereastra')
  const cutover = deploy.indexOf('upgrade_constructor_timer_units_quiesced', freshBlock)
  const firstQuiesced = deploy.indexOf('constructor_model_control_quiesced_proof', cutover)
  const backup = deploy.indexOf('install_cleanup_script', firstQuiesced)
  const secondQuiesced = deploy.indexOf('constructor_model_control_quiesced_proof', backup)
  const candidate = deploy.indexOf('"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" down', secondQuiesced)
  assert.ok(freshBlock >= 0 && cutover > freshBlock && firstQuiesced > cutover && backup > firstQuiesced
    && secondQuiesced > backup && candidate > secondQuiesced,
  'quiesce-ul se dovedește imediat după cutover și din nou după backup/migrări, înaintea candidatului')
  assert.doesNotMatch(deploy.slice(firstQuiesced, candidate),
    /systemctl is-active --quiet kelion-constructor-model-control\.service/)
})

test('controllerul manual rămâne oprit până la clear-ul durabil al jurnalului runtime', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const restore = shellFunction(cutover, 'restore_constructor_model_control')
  const protectedRestoreHelper = shellFunction(cutover, 'restore_runtime_controller_or_quiesce')
  assert.match(restore, /\[ -e "\$JOURNAL" \] \|\| \[ -L "\$JOURNAL" \]/)
  assert.match(restore, /validate_owned_runtime_journal/)
  assert.match(restore, /leave_constructor_quiesced" = 1[\s\S]*validate_effective_constructor_unit "\$unit"[\s\S]*systemctl is-enabled --quiet "\$unit"/)
  assert.match(restore, /systemctl stop "\$unit"/)
  assert.match(protectedRestoreHelper,
    /restore_constructor_model_control[\s\S]*force_quiesce_constructor_units 1[\s\S]*clear_runtime_ready_stamp/)
  const controllerFailureHarness = `set -euo pipefail
CALLS=$1
restore_constructor_model_control() { return 1; }
force_quiesce_constructor_units() { printf 'quiesce:%s\\n' "\${1:-}" >> "$CALLS"; }
clear_runtime_ready_stamp() { printf 'clear-ready\\n' >> "$CALLS"; }
${protectedRestoreHelper}
if restore_runtime_controller_or_quiesce; then exit 90; fi`
  const controllerFailureSandbox = mkdtempSync(join(tmpdir(), 'kelion-controller-restore-failure-'))
  try {
    const calls = join(controllerFailureSandbox, 'calls')
    const result = spawnSync(bashExecutable, ['-c', controllerFailureHarness, 'controller-failure', calls], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(calls, 'utf8'), 'quiesce:1\nclear-ready\n')
  } finally {
    rmSync(controllerFailureSandbox, { recursive: true, force: true })
  }
  const transaction = cutover.slice(cutover.indexOf("write_journal_phase files-committed"))
  const protectedRestore = transaction.indexOf('restore_constructor_model_control')
  const backend = transaction.indexOf('recreate_active_release', protectedRestore)
  const clear = transaction.indexOf("clear_journal || die 'jurnalul cutover-ului finalizat", backend)
  const committedRestore = transaction.indexOf('restore_runtime_controller_or_quiesce', clear)
  const committedTimers = transaction.indexOf('restore_constructor_timers', committedRestore)
  const succeeded = transaction.indexOf('operation_succeeded=1', committedTimers)
  assert.ok(protectedRestore >= 0 && backend > protectedRestore && clear > backend
    && committedRestore > clear && committedTimers > committedRestore && succeeded > committedTimers)

  const recoverOnly = cutover.slice(cutover.indexOf('if [ "$recover_only" = 1 ]; then', cutover.indexOf('recover_interrupted_gate_refresh')))
  const ready = recoverOnly.indexOf('publish_runtime_ready_stamp')
  const clearOuter = recoverOnly.indexOf('clear_deploy_quiesce_journal', ready)
  const liveRestore = recoverOnly.indexOf('restore_runtime_controller_or_quiesce', clearOuter)
  const liveTimers = recoverOnly.indexOf('restore_constructor_timers', liveRestore)
  const disarm = recoverOnly.indexOf('recovery_in_progress=0', liveTimers)
  assert.ok(ready >= 0 && clearOuter > ready && liveRestore > clearOuter
    && liveTimers > liveRestore && disarm > liveTimers,
  'recovery consumă jurnalul, probează controllerul sincron și abia apoi pornește timerele/dezarmează cleanup-ul')

  const controllerUnit = read('deploy/systemd/kelion-constructor-model-control.service')
  const recoveryUnit = read('deploy/systemd/kelion-runtime-config-recovery.service')
  assert.doesNotMatch(controllerUnit, /^(?:After|Requires)=.*kelion-runtime-config-recovery\.service/m)
  assert.doesNotMatch(recoveryUnit, /^Before=.*kelion-constructor-model-control\.service/m)

  const deploy = read('deploy/deploy.sh')
  const releaseRestore = shellFunction(deploy, 'restore_constructor_after_release')
  assert.match(releaseRestore,
    /kelion-runtime-config-recovery\.service[\s\S]*kelion-constructor-model-control\.service[\s\S]*control\.sock[\s\S]*0:10050:660/)
})

test('reactivarea păstrează un intent persistent până după controller și toate timerele', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const validate = shellFunction(cutover, 'validate_reactivation_journal')
  const publish = shellFunction(cutover, 'publish_reactivation_journal')
  const clear = shellFunction(cutover, 'clear_reactivation_journal')
  assert.match(validate,
    /0:0:600:1[\s\S]*schema == 1[\s\S]*kind == "constructor-reactivation"[\s\S]*phase == "pending"[\s\S]*keys == \["kind","phase","schema"\]/)
  const markerFsync = publish.indexOf('fsync_path "$temporary"')
  const markerRename = publish.indexOf('mv -f -- "$temporary" "$REACTIVATION_JOURNAL"', markerFsync)
  const directoryFsync = publish.indexOf('fsync_path "$RUNTIME_ROOT"', markerRename)
  assert.ok(markerFsync >= 0 && markerRename > markerFsync && directoryFsync > markerRename)
  assert.match(clear, /rm -f -- "\$REACTIVATION_JOURNAL"[\s\S]*fsync_path "\$RUNTIME_ROOT"/)

  const final = cutover.slice(cutover.lastIndexOf('write_journal_phase backend-recreated'))
  const arm = final.indexOf('publish_reactivation_journal')
  const runtimeClear = final.indexOf("clear_journal || die 'jurnalul cutover-ului finalizat", arm)
  const controller = final.indexOf('restore_runtime_controller_or_quiesce', runtimeClear)
  const timers = final.indexOf('restore_constructor_timers', controller)
  const markerClear = final.indexOf('clear_reactivation_journal', timers)
  const success = final.indexOf('operation_succeeded=1', markerClear)
  assert.ok(arm >= 0 && runtimeClear > arm && controller > runtimeClear
    && timers > controller && markerClear > timers && success > markerClear,
  'markerul persistent trebuie să acopere fiecare fereastră SIGKILL până la probele complete')

  const recovery = cutover.slice(cutover.indexOf('if [ "$recover_only" = 1 ]; then', cutover.indexOf('recover_interrupted_gate_refresh')))
  const recoveryArm = recovery.indexOf('publish_reactivation_journal')
  const ready = recovery.indexOf('publish_runtime_ready_stamp', recoveryArm)
  const outerClear = recovery.indexOf('clear_deploy_quiesce_journal', ready)
  const recoveryController = recovery.indexOf('restore_runtime_controller_or_quiesce', outerClear)
  const recoveryTimers = recovery.indexOf('restore_constructor_timers', recoveryController)
  const recoveryMarkerClear = recovery.indexOf('clear_reactivation_journal', recoveryTimers)
  assert.ok(recoveryArm >= 0 && ready > recoveryArm && outerClear > ready
    && recoveryController > outerClear && recoveryTimers > recoveryController
    && recoveryMarkerClear > recoveryTimers)

  for (const path of [
    'deploy/systemd/kelion-codex-worker.service',
    'deploy/systemd/kelion-constructor-publisher.service',
    'deploy/systemd/kelion-constructor-release.service',
    'deploy/systemd/kelion-constructor-sync.service',
  ]) {
    assert.match(read(path), /^ConditionPathExists=!\/root\/kelion\/runtime\/constructor-reactivation\.journal$/m)
  }
  for (const path of [
    'deploy/systemd/kelion-codex-worker.timer',
    'deploy/systemd/kelion-constructor-publisher.timer',
    'deploy/systemd/kelion-constructor-release.timer',
    'deploy/systemd/kelion-constructor-model-control.service',
  ]) {
    assert.doesNotMatch(read(path), /^ConditionPathExists=.*constructor-reactivation\.journal$/m)
  }

  const early = shellFunction(cutover, 'early_recover_only_barrier')
  assert.match(early,
    /kelion-constructor-model-control\.service[\s\S]*systemctl stop "\$unit"[\s\S]*ActiveState[\s\S]*systemctl list-jobs[\s\S]*control\.sock/)

  const installer = read('deploy/instaleaza-constructor.sh')
  const installerValidator = shellFunction(installer, 'validate_constructor_reactivation_journal')
  assert.match(installerValidator,
    /0:0:600:1[\s\S]*schema == 1[\s\S]*constructor-reactivation[\s\S]*keys == \["kind","phase","schema"\]/)
  const prelockValidation = installer.indexOf('validate_constructor_reactivation_state || {')
  const publicationLock = installer.indexOf('acquire_publication_lock || {', prelockValidation)
  const lockedValidation = installer.indexOf('validate_constructor_reactivation_state || {', publicationLock)
  const exactHelper = installer.indexOf('cmp -s -- "$candidate_recovery_helper" "$live_recovery_helper"', lockedValidation)
  const adoption = installer.indexOf('"$live_recovery_helper" --recover-only "$live_recovery_compose"', exactHelper)
  const postcondition = installer.indexOf('constructor_reactivation_postcondition', adoption)
  const identityMutation = installer.indexOf('set_constructor_install_phase identity-layout', postcondition)
  assert.ok(prelockValidation >= 0 && publicationLock > prelockValidation
    && lockedValidation > publicationLock && exactHelper > lockedValidation
    && adoption > exactHelper && postcondition > adoption && identityMutation > postcondition,
  'installerul acceptă numai markerul autentic și îl adoptă sub lock înaintea primei mutații')
})

test('retry-ul deploy separă marker-only de fereastra SIGKILL cu outer+reactivation', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const lock = deploy.indexOf('\nflock 8\n')
  const earlyStart = deploy.indexOf('if [ -e "$CONSTRUCTOR_REACTIVATION_JOURNAL" ]', lock)
  const earlyEnd = deploy.indexOf('\n\n[ ! -e "$MAX_MODEL_JOURNAL" ]', earlyStart)
  const early = deploy.slice(earlyStart, earlyEnd)
  const markerProof = early.indexOf('validate_constructor_reactivation_intent')
  const outerAbsent = early.indexOf('[ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]', markerProof)
  const genericCall = early.indexOf('"$ROOT/bin/runtime-config-cutover.sh" --recover-only', outerAbsent)
  const bothBranch = early.indexOf('\n  else\n', genericCall)
  const outerAcl = early.indexOf("0:0:600:1", bothBranch)
  assert.ok(lock >= 0 && earlyStart > lock && markerProof >= 0 && outerAbsent > markerProof
    && genericCall > outerAbsent && bothBranch > genericCall && outerAcl > bothBranch,
  'markerul este autentificat înainte de rutare, iar ownerless rulează exclusiv când outer lipsește')
  assert.equal((early.match(/runtime-config-cutover\.sh" --recover-only/g) ?? []).length, 1)
  assert.doesNotMatch(early.slice(bothBranch), /KELION_CUTOVER_LOCK_HELD|runtime-config-cutover\.sh" --recover-only/,
    'fereastra BOTH trebuie păstrată pentru ownerul tuplei, fără apel generic')

  const outerTuple = deploy.indexOf('recovered_constructor_quiesce_phase=$(jq -er', earlyEnd)
  const ownerRestoreCall = deploy.indexOf('\n  restore_constructor_after_release \\', outerTuple)
  assert.ok(outerTuple > earlyEnd && ownerRestoreCall > outerTuple,
    'retry-ul BOTH trebuie să autentifice outer-ul înainte de calea owner-aware')
  const ownerRestore = shellFunction(deploy, 'restore_constructor_after_release')
  assert.match(ownerRestore,
    /KELION_DEPLOY_QUIESCE_PROOF=1[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="\$KELION_RELEASE_REQUEST_ID"[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_COMMIT="\$COMMIT_SHA"[\s\S]*runtime-config-cutover\.sh" --recover-only/)

  const ownerFinal = cutover.slice(cutover.indexOf('if [ "$recover_only" = 1 ]; then',
    cutover.indexOf('recover_interrupted_cutover')))
  const clearOuter = ownerFinal.indexOf('clear_deploy_quiesce_journal')
  const controller = ownerFinal.indexOf('restore_runtime_controller_or_quiesce', clearOuter)
  const timers = ownerFinal.indexOf('restore_constructor_timers', controller)
  const clearMarker = ownerFinal.indexOf('clear_reactivation_journal_or_defer', timers)
  assert.ok(clearOuter >= 0 && controller > clearOuter && timers > controller && clearMarker > timers,
    'ownerul consumă outer-ul și markerul numai în ordinea de convergență dovedită')

  const retryModel = ({ markerValid, outer }) => {
    if (!markerValid) throw new Error('invalid-marker')
    const earlyOwnerlessCalls = outer ? 0 : 1
    const ownerCalls = outer ? 1 : 0
    return { earlyOwnerlessCalls, ownerCalls, marker: false, outer: false }
  }
  assert.deepEqual(retryModel({ markerValid: true, outer: false }),
    { earlyOwnerlessCalls: 1, ownerCalls: 0, marker: false, outer: false })
  assert.deepEqual(retryModel({ markerValid: true, outer: true }),
    { earlyOwnerlessCalls: 0, ownerCalls: 1, marker: false, outer: false })
  assert.throws(() => retryModel({ markerValid: false, outer: true }), /invalid-marker/)
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

test('Podman rulează din runtime-ul accesibil identității Constructor', () => {
  const control = read('.github/workflows/vps-run.yml')
  const deploy = read('deploy/deploy.sh')

  for (const [name, source] of [['control', control], ['deploy', deploy]]) {
    const commands = source.split('\n').filter((line) => line.includes('runuser -u "$user"') && line.includes('podman '))
    assert.equal(commands.length, 4, `${name} trebuie să aibă exact login, pull și cele două logout-uri Podman`)
    for (const command of commands) {
      assert.match(command, /\(cd "[$]runtime" && runuser -u "[$]user" -- env /,
        `${name} nu poate porni Podman moștenind directorul root-only al sesiunii SSH`)
    }
  }
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

  assert.match(control, /KELION_CUTOVER_LOCK_HELD=1[\s\S]{0,500}bash "[$]work\/deploy\/lib\/runtime-config-cutover\.sh"[\s\S]{0,120}"[$]cutover_stage"/)
  assert.match(provision, /KELION_CUTOVER_LOCK_HELD=1[\s\S]{0,500}bash "[$]work\/deploy\/lib\/runtime-config-cutover\.sh"[\s\S]{0,120}"[$]cutover_stage"/)
  assert.doesNotMatch(provision, /mv "[$]temporary" \/root\/kelion\/config\/runtime\.env|mv "[$]temporary" "\/root\/kelion\/secrets\/[$]name"/)

  const quiesce = deploy.lastIndexOf('\nquiesce_constructor_before_candidate \\\n')
  const candidate = deploy.indexOf('"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" up -d')
  const refresh = deploy.lastIndexOf('\n  refresh_constructor_gate\n')
  const reactivate = deploy.indexOf('restore_constructor_after_release', refresh)
  assert.ok(quiesce >= 0 && candidate > quiesce, 'Constructor trebuie oprit înainte de pornirea candidatului')
  assert.match(deploy, /quiesce_constructor_before_candidate\(\)[\s\S]*case "[$]unit_count" in[\s\S]*0\)[\s\S]*6\)[\s\S]*constructor_release_quiesced=1/)
  assert.match(deploy.slice(quiesce, candidate), /upgrade_constructor_timer_units_quiesced[\s\S]*assert_constructor_release_handoff_drained/)
  const failedReactivation = shellFunction(deploy, 'quiesce_constructor_after_failed_reactivation_proof')
  const durableIntent = failedReactivation.indexOf('publish_constructor_reactivation_intent')
  const stopController = failedReactivation.indexOf('systemctl stop kelion-constructor-model-control.service', durableIntent)
  const forceQuiesce = failedReactivation.indexOf('force_quiesce_constructor_release', stopController)
  const intentProof = failedReactivation.indexOf('validate_constructor_reactivation_intent', forceQuiesce)
  assert.ok(durableIntent >= 0 && stopController > durableIntent && forceQuiesce > stopController
    && intentProof > forceQuiesce,
  'orice probă post-helper eșuată rearmează intentul durabil înainte să retragă din nou Constructorul')
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
  const activationRecovery = shellFunction(cutover, 'recover_interrupted_activation')
  assert.match(activationRecovery,
    /ensure_constructor_marker_root_durable[\s\S]*validate_live_runtime_contract[\s\S]*quiesce_units_for_recovery[\s\S]*mv -f -- "[$]restored" "[$]marker"[\s\S]*fsync_path \/etc\/kelion[\s\S]*write_activation_journal_phase applied[\s\S]*clear_activation_pending[\s\S]*validate_reactivation_journal[\s\S]*validate_constructor_quiesce_barrier[\s\S]*activation_outer_commit_pending=1/)
  assert.doesNotMatch(activationRecovery, /publish_runtime_ready_stamp|systemctl enable|start_constructor_unit/,
    'helperul nu poate activa sub jurnalul exterior al operației')
  assert.match(shellFunction(cutover, 'validate_live_runtime_contract'), /validate_constructor_marker_root/)
  const timerRestore = shellFunction(cutover, 'restore_constructor_timers')
  assert.match(timerRestore,
    /systemctl enable "[$]timer"[\s\S]*start_constructor_unit "[$]timer"[\s\S]*systemctl is-enabled --quiet "[$]timer"/)
  assert.match(shellFunction(cutover, 'validate_live_runtime_contract'),
    /path=\/etc\/systemd\/system\/[$]unit[\s\S]*\[ -f "[$]path" \][\s\S]*validate_effective_constructor_unit "[$]unit"/)
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
  const activationTail = control.slice(control.indexOf('if [ "$activation_in_progress" = 1 ]; then'))
  assert.match(activationTail,
    /phase == "applied"[\s\S]*reactivation_journal[\s\S]*clear_activation_journal[\s\S]*runtime-config-cutover\.sh[\s\S]*--recover-only[\s\S]*reactivation_journal[\s\S]*kelion-constructor-model-control\.service[\s\S]*control\.sock[\s\S]*prove_worker_oneshot_success/)
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
  const durableBlocker = recovery.indexOf('publish_unit_migration_pending', applied)
  const clearPending = recovery.indexOf('clear_activation_pending', applied)
  const reactivationProof = recovery.indexOf('validate_reactivation_journal', clearPending)
  const quiesceProof = recovery.indexOf('validate_constructor_quiesce_barrier', reactivationProof)
  const handoff = recovery.indexOf('activation_outer_commit_pending=1', quiesceProof)
  assert.ok(quiesce >= 0 && publishPending > quiesce && markerMutation > publishPending,
    'gate-ul pending trebuie publicat după quiesce și înaintea primei mutații live')
  assert.ok(genericQuiesce > markerMutation && applied > genericQuiesce
    && durableBlocker > applied && clearPending > durableBlocker
    && reactivationProof > clearPending && quiesceProof > reactivationProof && handoff > quiesceProof,
  'applied și blockerul persistent trebuie fsync înainte de retragerea pending și handoff-ul outer')
  assert.doesNotMatch(recovery, /publish_runtime_ready_stamp|systemctl enable|start_constructor_unit/,
    'recovery-ul activării nu poate deschide unități cât jurnalul exterior există')
  assert.match(recovery,
    /if \[ "[$]activation_resume_operation" != "[$]operation" \]; then[\s\S]*write_activation_journal_phase quiesced[\s\S]*return 0[\s\S]*write_activation_journal_phase applied/)
  const appliedLeave = recovery.indexOf('if [ "$leave_constructor_quiesced" = 1 ]; then', applied)
  const appliedLeaveReturn = recovery.indexOf('return 0', clearPending)
  const appliedLeaveBranch = recovery.slice(appliedLeave, reactivationProof)
  assert.ok(appliedLeave > applied && appliedLeaveReturn > clearPending && reactivationProof > appliedLeaveReturn,
    'resume+leave trebuie să închidă applied sub blocker înaintea handoff-ului generic')
  assert.doesNotMatch(appliedLeaveBranch, /systemctl enable|start_constructor_unit|publish_runtime_ready_stamp/,
    'resume+leave nu poate activa timere sau servicii')
  assert.match(appliedLeaveBranch,
    /validate_unit_migration_pending[\s\S]*UNIT_MIGRATION_PENDING[\s\S]*ACTIVATION_PENDING[\s\S]*READY_STAMP[\s\S]*validate_constructor_quiesce_barrier/)
  const activationBarrierExit = cutover.indexOf('if [ "$activation_barrier_pending" = 1 ]; then')
  const recoverOnlyMain = cutover.indexOf('if [ "$recover_only" = 1 ]; then', activationBarrierExit)
  const unitBlockerBranch = cutover.indexOf('if [ -f "$UNIT_MIGRATION_PENDING" ]; then', recoverOnlyMain)
  const genericReady = cutover.indexOf('publish_runtime_ready_stamp', unitBlockerBranch)
  assert.ok(activationBarrierExit >= 0 && recoverOnlyMain > activationBarrierExit
    && unitBlockerBranch > recoverOnlyMain && genericReady > unitBlockerBranch,
  'recover-only trebuie să trateze blockerul persistent înainte de calea generică ready')
  assert.match(cutover.slice(unitBlockerBranch, genericReady),
    /unit-only blochează boot-ul generic[\s\S]*exit 0/,
    'blockerul persistent trebuie fie să oprească boot-ul, fie să iasă quiesced înainte de ready')

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

  // Fault injection la fiecare frontieră durabilă. Blockerul persistent este
  // publicat înainte ca pendingul activării să dispară și împiedică recovery-ul
  // de boot să publice ready după ce deploy-ul consumă jurnalul activării.
  const canUnitStart = ({ pending, reactivation = false, ready: readyPresent }) =>
    !pending && !reactivation && readyPresent
  const crashCuts = [
    { name: 'quiesced-pending', phase: 'quiesced', pending: true, reactivation: true, ready: false },
    { name: 'stale-ready-pending', phase: 'quiesced', pending: true, reactivation: true, ready: true },
    { name: 'applied-before-gate-clear', phase: 'applied', pending: true, reactivation: true, ready: false },
    { name: 'applied-blocker-durable', phase: 'applied', pending: true, reactivation: true, ready: false, unitBlocker: true },
    { name: 'applied-after-gate-clear', phase: 'applied', pending: false, reactivation: true, ready: false, unitBlocker: true },
    { name: 'outer-cleared-before-controller', phase: null, pending: false, reactivation: true, ready: true },
  ]
  for (const cut of crashCuts) assert.equal(canUnitStart(cut), false, cut.name)
  assert.equal(canUnitStart({ phase: 'applied', pending: false, reactivation: false, ready: true }), true)

  const recoveryReady = ({ unitBlocker, liveContractValid }) => !unitBlocker && liveContractValid
  const canStartAfterReboot = ({ unitBlocker, liveContractValid = true }) =>
    canUnitStart({ pending: false, ready: recoveryReady({ unitBlocker, liveContractValid }) })
  assert.equal(canStartAfterReboot({ unitBlocker: true }), false,
    'după journal clear, blockerul persistent interzice ready/start la reboot')
  assert.equal(canStartAfterReboot({ unitBlocker: false }), true,
    'controlul dovedește că testul ar detecta lipsa blockerului')
  assert.equal(canStartAfterReboot({ unitBlocker: false, liveContractValid: false }), false,
    'contractul live invalid rămâne fail-closed independent de blocker')
})

test('release-ul drenează handoff-urile Constructor după quiesce și înainte de PONR', async () => {
  const deploy = read('deploy/deploy.sh')
  const quiesce = deploy.lastIndexOf('\nquiesce_constructor_before_candidate \\\n')
  const drain = deploy.indexOf('\nassert_constructor_release_handoff_drained \\\n', quiesce)
  const backup = deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"', drain)
  const migration = deploy.indexOf('migration_output=$(docker run', drain)
  const ponr = deploy.indexOf('\n  mark_point_of_no_return', drain)
  assert.ok(quiesce >= 0 && drain > quiesce && backup > drain && migration > drain && ponr > drain,
    'preflight-ul DB trebuie să fie post-quiesce și pre-backup/migrare/PONR')
  assert.match(deploy, /assert_constructor_release_handoff_drained\(\)[\s\S]*information_schema\.columns[\s\S]*FROM build_jobs[\s\S]*b\.status = [$]1::text[\s\S]*b\.constructor_stage = ANY\([$]2::text\[\]\)/)
  assert.match(deploy, /const sharedOwnershipValues = \[[\s\S]*"running",[\s\S]*\["merged", "release_dispatched"\]/)
  assert.match(deploy, /count\(\*\) FILTER \(WHERE is_current IS NOT TRUE\)/)
  assert.match(deploy, /hasV2Schema[\s\S]*release_protocol_version = 2[\s\S]*release_intent_receipt_sha256 IS NOT NULL[\s\S]*release_dispatch_receipt_sha256 IS NOT NULL/)

  const ownershipStart = deploy.indexOf('  const sharedOwnershipValues = [')
  const ownershipEnd = deploy.indexOf('\n  const result = await client.query(`', ownershipStart)
  const queryStartMarker = '  const result = await client.query(`\n'
  const queryStart = deploy.indexOf(queryStartMarker, ownershipEnd) + queryStartMarker.length
  const queryEnd = deploy.indexOf('\n  `, ownership.values)', queryStart)
  assert.ok(ownershipStart >= 0 && ownershipEnd > ownershipStart && queryStart >= queryStartMarker.length && queryEnd > queryStart,
    'query builder-ul handoff nu poate fi extras din deploy')

  const buildOwnership = new Function('hasV2Schema', 'process',
    `${deploy.slice(ownershipStart, ownershipEnd)}\nreturn ownership`)
  const queryTemplate = deploy.slice(queryStart, queryEnd)
  const releaseEnv = {
    KELION_RELEASE_REQUEST_ID: '11111111-1111-4111-8111-111111111111',
    KELION_RELEASE_COMMIT_SHA: 'a'.repeat(40),
    KELION_RELEASE_CI_RUN_ID: '8001',
    KELION_RELEASE_BUILD_RUN_ID: '8002',
    KELION_RELEASE_WORKFLOW_RUN_ID: '9001',
  }
  const ownershipFor = (hasV2Schema) => buildOwnership(hasV2Schema, { env: releaseEnv })
  const queryFor = (ownership) => queryTemplate.replace('${ownership.predicate}', ownership.predicate)
  const assertContiguousParameters = (ownership) => {
    const indexes = [...new Set([...queryFor(ownership).matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))]
      .sort((left, right) => left - right)
    assert.deepEqual(indexes, Array.from({ length: ownership.values.length }, (_, index) => index + 1),
      'fiecare valoare bind trebuie să aibă un placeholder tipabil și contiguu')
  }
  const v1Ownership = ownershipFor(false)
  const v2Ownership = ownershipFor(true)
  assertContiguousParameters(v1Ownership)
  assertContiguousParameters(v2Ownership)
  assert.equal(v1Ownership.values.length, 5)
  assert.equal(v2Ownership.values.length, 7)

  const backendRequire = createRequire(join(root, 'backend/package.json'))
  const { PGlite } = backendRequire('@electric-sql/pglite')
  const exerciseSchema = async (hasV2Schema) => {
    const database = new PGlite()
    try {
      await database.exec(`
        CREATE TABLE build_jobs (
          id bigint PRIMARY KEY,
          status text NOT NULL,
          constructor_stage text NOT NULL
        );
        CREATE TABLE constructor_pipeline (
          job_id bigint PRIMARY KEY,
          release_request_id uuid,
          merged_commit_sha text,
          release_workflow_run_id bigint,
          release_dispatch_receipt_sha256 text
          ${hasV2Schema ? `,
          release_protocol_version integer,
          release_target_sha text,
          release_target_receipt_sha256 text,
          release_ci_run_id bigint,
          release_build_run_id bigint,
          release_artifact_id text,
          release_candidate_receipt_sha256 text,
          release_intent_receipt_sha256 text` : ''}
        );
        INSERT INTO build_jobs (id, status, constructor_stage) VALUES
          (1, 'running', 'release_dispatched'),
          (2, 'running', 'merged');
      `)
      if (hasV2Schema) {
        await database.query(`
          INSERT INTO constructor_pipeline (
            job_id, release_request_id, merged_commit_sha, release_workflow_run_id,
            release_dispatch_receipt_sha256, release_protocol_version, release_target_sha,
            release_target_receipt_sha256, release_ci_run_id, release_build_run_id,
            release_artifact_id, release_candidate_receipt_sha256, release_intent_receipt_sha256
          ) VALUES
            (1, $1::uuid, $2::text, $3::bigint, 'legacy-receipt', 2, $2::text,
             'target-receipt', $4::bigint, $5::bigint, 'artifact', 'candidate-receipt', 'intent-receipt'),
            (2, '22222222-2222-4222-8222-222222222222'::uuid, $2::text, 9999,
             'foreign-legacy-receipt', 2, $2::text, 'foreign-target-receipt',
             $4::bigint, $5::bigint, 'foreign-artifact', 'foreign-candidate-receipt', 'foreign-intent-receipt')
        `, [releaseEnv.KELION_RELEASE_REQUEST_ID, releaseEnv.KELION_RELEASE_COMMIT_SHA,
          releaseEnv.KELION_RELEASE_WORKFLOW_RUN_ID, releaseEnv.KELION_RELEASE_CI_RUN_ID,
          releaseEnv.KELION_RELEASE_BUILD_RUN_ID])
      } else {
        await database.query(`
          INSERT INTO constructor_pipeline (
            job_id, release_request_id, merged_commit_sha, release_workflow_run_id,
            release_dispatch_receipt_sha256
          ) VALUES
            (1, $1::uuid, $2::text, $3::bigint, 'current-receipt'),
            (2, '22222222-2222-4222-8222-222222222222'::uuid, $2::text, 9999, 'foreign-receipt')
        `, [releaseEnv.KELION_RELEASE_REQUEST_ID, releaseEnv.KELION_RELEASE_COMMIT_SHA,
          releaseEnv.KELION_RELEASE_WORKFLOW_RUN_ID])
      }
      const ownership = ownershipFor(hasV2Schema)
      const result = await database.query(queryFor(ownership), ownership.values)
      assert.deepEqual(result.rows, [{ blocking: 1, current: 1 }])
    } finally {
      await database.close()
    }
  }
  await exerciseSchema(false)
  await exerciseSchema(true)

  const trap = deploy.indexOf('trap on_release_exit EXIT')
  assert.ok(trap >= 0 && trap < drain, 'trap-ul de rollback trebuie armat înainte de preflight-ul DB')
})

test('markerul release și helperul de recovery sunt persistate în ordinea sigură', () => {
  const deploy = read('deploy/deploy.sh')
  const oldRecovery = deploy.indexOf("# Jurnalele runtime/activare sunt recuperate în mod normal cu helperul care le-a")
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
  assert.doesNotMatch(recovery, /^Before=.*kelion-constructor-model-control\.service/m)
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

test('toate unitățile systemd publicate respectă contractul strict de bytes text', () => {
  const unitPaths = [
    'private-ai-web-full-access.conf',
    'kelion-runtime-config-recovery.service',
    'kelion-constructor-sync.service',
    'kelion-codex-worker.timer',
    'kelion-constructor-publisher.timer',
    'kelion-constructor-release.timer',
    'kelion-codex-worker.service',
    'kelion-constructor-publisher.service',
    'kelion-constructor-release.service',
    'kelion-constructor-model-control.service',
  ].map((unit) => join(root, 'deploy', 'systemd', unit))
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const installer = read('deploy/instaleaza-constructor.sh')
  const mergePolicy = read('.github/workflows/vps-auto-merge-chore-prs.yml')
  const runtimeValidator = shellFunction(cutover, 'validate_text_file_bytes')
    .replace('validate_text_file_bytes()', 'validate_runtime_text_file_bytes()')
  const installerValidator = shellFunction(installer, 'validate_systemd_text_file_bytes')
  const sourceValidator = shellFunction(installer, 'validate_source_systemd_text_files')
  const verifyCandidateUnits = shellFunction(installer, 'verify_candidate_units')
  assert.match(sourceValidator,
    /systemd-\*\)[\s\S]*validate_systemd_text_file_bytes "\$\{install_sources\[\$index\]\}"[\s\S]*"\$count" -eq 10/)
  assert.match(verifyCandidateUnits,
    /local allow_legacy_text=\$\{1:-0\}[\s\S]*case "\$allow_legacy_text" in 0\|1\)[\s\S]*if \[ "\$allow_legacy_text" = 0 \]; then[\s\S]*validate_systemd_text_file_bytes/)
  assert.match(mergePolicy, /"deploy\/systemd\/kelion-constructor-sync\.service"/)

  const transaction = installer.slice(installer.indexOf('set_constructor_install_phase recovery-preflight'))
  const sourceProof = transaction.indexOf('validate_source_systemd_text_files')
  const stage = transaction.indexOf('stage_install_transaction')
  const quiesce = transaction.indexOf('quiesce_before_install')
  const supersede = transaction.indexOf('verify_candidate_units 1')
  assert.ok(sourceProof >= 0 && sourceProof < stage && stage < quiesce && supersede > quiesce,
    'bytes sunt validate înainte de intent/quiesce, iar numai candidatul legacy autentificat poate fi supersedat')

  const result = spawnSync(bashExecutable, ['-s', '--', ...unitPaths], {
    input: `set -euo pipefail
${runtimeValidator}
${installerValidator}
for file in "$@"; do
  validate_runtime_text_file_bytes "$file"
  validate_systemd_text_file_bytes "$file"
done
`,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
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
  const { names: runtimeNames, lines: runtimeLines } = runtimeFixture(cutover)
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

  const gateRecoveryStart = deploy.indexOf('gate_recovery_journal=$RUNTIME_ROOT/constructor-gate-refresh.journal')
  const gateRecoveryEnd = deploy.indexOf("# Jurnalele runtime/activare sunt recuperate în mod normal", gateRecoveryStart)
  assert.ok(gateRecoveryStart >= 0 && gateRecoveryEnd > gateRecoveryStart)
  const gateRecovery = deploy.slice(gateRecoveryStart, gateRecoveryEnd)
  const outerRequest = gateRecovery.indexOf('gate_recovery_owner_request_id=$(jq -er')
  const outerCommit = gateRecovery.indexOf("gate_recovery_owner_commit=$(jq -er '.commit'", outerRequest)
  const exactTuple = gateRecovery.indexOf('[ "$gate_recovery_owner_request_id" = "$KELION_RELEASE_REQUEST_ID" ]', outerCommit)
  const gateCommit = gateRecovery.indexOf("$(jq -er '.commit' \"$gate_recovery_journal\")", exactTuple)
  const invokeOwnerRequest = gateRecovery.indexOf('KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$gate_recovery_owner_request_id"', gateCommit)
  const invokeOwnerCommit = gateRecovery.indexOf('KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$gate_recovery_owner_commit"', invokeOwnerRequest)
  const invokeHelper = gateRecovery.indexOf('"$gate_recovery_root/recovery-helper.sh" --recover-only', invokeOwnerCommit)
  assert.ok(outerRequest >= 0 && outerCommit > outerRequest && exactTuple > outerCommit
    && gateCommit > exactTuple && invokeOwnerRequest > gateCommit
    && invokeOwnerCommit > invokeOwnerRequest && invokeHelper > invokeOwnerCommit,
  'recovery-ul gate jurnalizat derivă și autentifică ownerul outer/gate/current înainte să-l transmită helperului')
  assert.match(gateRecovery,
    /\.schema == 2 and \.phase == "gate-prepared"[\s\S]*requestId[\s\S]*commit[\s\S]*targetGateSha256[\s\S]*outer\/gate\/current release/)

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

test('recovery-ul post-PONR este legat de incident, artefacte semnate și dovada externă exactă', () => {
  const workflow = read('.github/workflows/vps-post-ponr-recovery.yml')
  const mergePolicy = read('.github/workflows/vps-auto-merge-chore-prs.yml')
  const target = 'de9fe5f3f081373a23796d83b469651e9c1e33e7'
  const recoveryBase = 'afc3c7484ff7982a78b10feb2ee0c6eb4fe927a3'
  assert.match(workflow, /name: VPS post-PONR recovery de9/)
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m)
  assert.doesNotMatch(workflow, /actions:\s*write|route-to-master|auto_routed_to_master/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/master'[\s\S]*github\.ref_name == 'master'/)
  assert.match(workflow, /group: production-release[\s\S]*cancel-in-progress: false/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, new RegExp(`target=${target}[\\s\\S]*request=e5c00af2-1fb9-4daf-a30b-bdfed24d5689[\\s\\S]*failed_run=33227925046[\\s\\S]*ci_run=33227451553[\\s\\S]*build_run=33227641381`))
  assert.match(workflow, new RegExp(`recovery_base=${recoveryBase}[\\s\\S]*EVENT_BEFORE" = "\\$recovery_base"`))
  assert.match(workflow, /verify-incident:[\s\S]*fetch-depth: 3/)
  assert.match(workflow, /git rev-parse HEAD\^\)" = "\$recovery_base"[\s\S]*git rev-parse "\$recovery_base\^"\)" = "\$target"[\s\S]*git rev-list --count "\$recovery_base\.\.\$hotfix"\)" -eq 1[\s\S]*remote_master[\s\S]*"\$remote_master" = "\$hotfix"/)
  assert.match(workflow, /"\$\{#changed\[@\]\}" -eq 7[\s\S]*vps-auto-merge-chore-prs\.yml[\s\S]*vps-recovery\.yml[\s\S]*Dockerfile\.gates[\s\S]*deploy\/lib\/codex-boundary\.test\.mjs/)
  for (const path of [
    '.github/workflows/vps-post-ponr-recovery.yml',
    '.github/workflows/vps-recovery.yml',
    'Dockerfile.gates',
    'deploy/lib/codex-boundary.test.mjs',
    'deploy/lib/release-rollback.test.mjs',
  ]) {
    assert.ok(mergePolicy.includes(`"${path}"`), `merge-policy trebuie să permită ${path}`)
  }
  assert.match(workflow, /actions\/runs\/\$\{failed_run\}[\s\S]*\.head_sha == \$sha[\s\S]*\.conclusion == "failure"[\s\S]*workflows\/deploy\.yml/)
  assert.match(workflow, /failed_recovery_run=33238849810[\s\S]*actions\/runs\/\$\{failed_recovery_run\}[\s\S]*\.head_sha == \$sha[\s\S]*workflows\/vps-post-ponr-recovery\.yml/)
  assert.match(workflow, /actions\/runs\/\$\{ci_run\}[\s\S]*\.head_sha == \$sha[\s\S]*\.conclusion == "success"[\s\S]*\["container-isolation", "release-train-preflight", "verify"\]/)
  assert.match(workflow, /actions\/runs\/\$\{build_run\}[\s\S]*\.head_sha == \$sha[\s\S]*\.conclusion == "success"[\s\S]*workflows\/build-images\.yml/)
  const hotfixCiStart = workflow.indexOf('deadline=$((SECONDS + 9900))')
  const incidentProof = workflow.indexOf('release=$(gh api', hotfixCiStart)
  const firstVpsMutation = workflow.indexOf('name: Închide tranzacția post-PONR pe VPS')
  assert.ok(hotfixCiStart >= 0 && incidentProof > hotfixCiStart && firstVpsMutation > incidentProof,
    'CI-ul push exact al hotfixului trebuie dovedit înaintea oricărei mutații VPS')
  const hotfixCi = workflow.slice(hotfixCiStart, incidentProof)
  assert.match(hotfixCi, /actions\/workflows\/pr-verify\.yml\/runs\?branch=master&event=push/)
  assert.match(hotfixCi, /\.head_sha == \$sha[\s\S]*\.head_branch == "master"[\s\S]*\.event == "push"/)
  assert.match(hotfixCi, /hotfix_ci_conclusion[\s\S]*success\) break[\s\S]*actions\/runs\/\$\{hotfix_ci_id\}\/jobs/)
  assert.match(hotfixCi, /\["container-isolation", "release-train-preflight", "verify"\]/)
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}[\s\S]*release-images-de9fe5f3f081373a23796d83b469651e9c1e33e7[\s\S]*run-id: '33227641381'/)
  assert.match(workflow, /\.images \| keys \| sort[\s\S]*\["app", "browser", "browser-egress", "converter-gateway", "converter-parser"\]/)
  assert.match(workflow, /for component in app browser browser-egress converter-gateway converter-parser[\s\S]*cosign verify[\s\S]*--annotations "git_sha=\$target"/)
  assert.match(workflow, /gate_ref=.*codex-gates\.json[\s\S]*cosign verify[\s\S]*"\$gate_ref"/)
  assert.match(workflow, /KELION_RELEASE_APPROVED=1[\s\S]*KELION_RECOVER_LOST_POST_PONR=1[\s\S]*KELION_RELEASE_REQUEST_ID="\$request"[\s\S]*KELION_RELEASE_WORKFLOW_RUN_ID="\$failed_run"[\s\S]*KELION_CI_RUN_ID="\$ci_run"[\s\S]*KELION_BUILD_RUN_ID="\$build_run"/)
  assert.doesNotMatch(workflow, /install -d[^\n]*\/root\/kelion\/runtime/)
  assert.match(workflow, /runtime_metadata=\$\(stat -Lc '%u:%g:%a' \/root\/kelion\/runtime\)[\s\S]*\[ "\$runtime_uid" = 0 \]\n\s+\[\[ "\$runtime_gid" =~ \^\[0-9\]\+\$ \]\]\n\s+\[\[ "\$runtime_mode" =~ \^\[0-7\]\{3,4\}\$ \]\][\s\S]*8#\$runtime_mode & 0022[\s\S]*post_ponr_preflight runtime_metadata=/)
  assert.doesNotMatch(workflow, /\[ "\$runtime_uid" = 0 \] &&/)
  assert.match(workflow, /remote_stage="\/root\/kelion-post-ponr\.\$\{GITHUB_RUN_ID\}"[\s\S]*remote_docker_config="\$remote_stage\/docker-config"/)
  assert.match(workflow, /DOCKER_CONFIG='\$remote_docker_config' docker login[\s\S]*post_ponr_preflight ghcr=authenticated/)
  assert.match(workflow, /post_ponr_preflight_failed phase=[\s\S]*post_ponr_remote_failed phase=/)
  assert.equal((workflow.match(/trap 'on_err "\$LINENO" "\$\?"' ERR/g) ?? []).length, 2,
    'ambele shell-uri remote trebuie să captureze linia și codul comenzii care a eșuat')
  assert.doesNotMatch(workflow, /^\s+\[[^\n]*\]\s*&&/m,
    'aserțiunile standalone nu pot folosi AND-list, deoarece Bash errexit le-ar putea ignora')
  assert.match(workflow, /DOCKER_CONFIG="\$docker_config"[\s\S]*KELION_RELEASE_APPROVED=1/)
  assert.match(workflow, /DOCKER_CONFIG="\$docker_config" docker logout[\s\S]*rm -rf -- "\$stage"/)
  assert.match(workflow, /\/api\/release-proof[\s\S]*\.ready == true[\s\S]*\.release\.sideEffectsActive == true[\s\S]*\.release\.candidate \/\/ false\) == false[\s\S]*\.activeCommit == \$expected/)
})

test('recovery-ul VPS generic defer-ează jurnalul distructiv înaintea helperului și îl reverifică sub lock', () => {
  const workflow = read('.github/workflows/vps-recovery.yml')
  assert.match(workflow, /^on:\n\s+workflow_dispatch:\s*$/m)
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m)
  assert.match(workflow, /group: production-release[\s\S]*cancel-in-progress: false/)
  const classify = workflow.indexOf('  classify:')
  const recover = workflow.indexOf('  recover:', classify)
  assert.ok(classify >= 0 && recover > classify)
  assert.doesNotMatch(workflow.slice(0, classify), /^concurrency:/m)
  assert.match(workflow.slice(recover), /concurrency:\n\s+group: production-release/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/master'[\s\S]*github\.ref_name == 'master'/)
  assert.match(workflow, /BEFORE_SHA[\s\S]*de9fe5f3f081373a23796d83b469651e9c1e33e7\|afc3c7484ff7982a78b10feb2ee0c6eb4fe927a3[\s\S]*execute=false/)
  assert.match(workflow, /RECOVERY_DEFERRED: tranziția incidentului aparține workflow-ului post-PONR dedicat/)
  assert.doesNotMatch(workflow, /\[ -n "\$VPS_HOST" \] &&/)
  assert.match(workflow, /\[ -f \/root\/kelion\/bin\/runtime-config-cutover\.sh \]\n\s+\[ ! -L \/root\/kelion\/bin\/runtime-config-cutover\.sh \][\s\S]*\[ -f \/root\/kelion\/config\/compose\.production\.yml \]\n\s+\[ ! -L \/root\/kelion\/config\/compose\.production\.yml \]/)
  assert.doesNotMatch(workflow, /\[ -f \/root\/kelion\/(?:bin\/runtime-config-cutover\.sh|config\/compose\.production\.yml) \]\s*\\\n\s*&&/)
  const journal = workflow.indexOf('journal=/root/kelion/runtime/destructive-cutover-recovery.json')
  const defer = workflow.indexOf('RECOVERY_DEFERRED_QUIESCED: există un jurnal distructiv valid', journal)
  const exit = workflow.indexOf('exit 0', defer)
  const helper = workflow.indexOf('KELION_CUTOVER_LOCK_HELD=1 /root/kelion/bin/runtime-config-cutover.sh', exit)
  assert.ok(journal >= 0 && defer > journal && exit > defer && helper > exit,
    'jurnalul distructiv trebuie autentificat și defer-at înainte de orice helper generic')
  const lock = workflow.indexOf('flock -n 9', exit)
  const helperValidation = workflow.indexOf('[ -f /root/kelion/bin/runtime-config-cutover.sh ]', lock)
  const lockedRecheck = workflow.indexOf('if defer_for_destructive_journal; then', helperValidation)
  assert.ok(lock > exit && helperValidation > lock && lockedRecheck > helperValidation && helper > lockedRecheck,
    'jurnalul distructiv trebuie reverificat sub publication lock imediat înaintea helperului generic')
  const lockSetup = workflow.slice(exit, helperValidation)
  assert.match(lockSetup, /publication_lock=\/root\/kelion\/publicare\.lock[\s\S]*0:0:600:1/)
  assert.match(lockSetup, /exec 9<"\$publication_lock"[\s\S]*readlink "\/proc\/\$\$\/fd\/9"/)
  assert.match(lockSetup, /publication_fd_identity=.*%d:%i[\s\S]*flock -n 9[\s\S]*publication_fd_identity/)
  assert.doesNotMatch(lockSetup, /exec 9>|exec 9<>|chown|chmod/)
  assert.equal((workflow.match(/if defer_for_destructive_journal; then/g) ?? []).length, 2)
  const guardDefinition = workflow.slice(
    workflow.indexOf('defer_for_destructive_journal() {'),
    workflow.indexOf('if defer_for_destructive_journal; then'),
  )
  assert.doesNotMatch(guardDefinition, /\brm\b|\bmv\b|\binstall\b|--recover-only/)
  const guard = workflow.slice(journal, helper)
  assert.match(guard, /stat -Lc '%u:%g:%a:%h'[\s\S]*0:0:600:1/)
  assert.match(guard, /\.phase == "maintenance"[\s\S]*\.dbRestoreRequired == false/)
  assert.match(guard, /\.phase == "point-of-no-return"[\s\S]*\.pointOfNoReturn == true[\s\S]*\.dbRestoreRequired == true/)
  assert.match(guard, /\.phase == "completed"[\s\S]*\.pointOfNoReturn == true[\s\S]*\.dbRestoreRequired == false/)
  assert.match(guard, /\.activeRuntimeContainers \| type == "array" and length == 5/)
  assert.doesNotMatch(guard, /rm -f -- "\$journal"|rm -rf|--recover-only/)
})

test('discard-ul runtime acceptă numai cele 12 backupuri nemutate și păstrează pending-ul', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const discard = shellFunction(cutover, 'discard_unmutated_prepared_cutover')
  const allowlistBlock = discard.match(/local -A allowed=\(([\s\S]*?)\n  \)/)
  assert.ok(allowlistBlock, 'allowlistul special nu poate fi extras')
  const allowlist = [...allowlistBlock[1].matchAll(/\[([^\]]+)\]=1/g)].map((entry) => entry[1])
  assert.deepEqual(allowlist, [
    'app-secret.codex-worker-secret',
    'app-secret.constructor-model-control-secret',
    'app-secret.constructor-publisher-secret',
    'app-secret.constructor-release-secret',
    'worker-secret.github-worker-token',
    'publisher-secret.github-publisher-token',
    'release-secret.github-release-token',
    'gate-secret.github-ghcr-read-token',
    'constructor-config.codex-worker.env',
    'constructor-config.constructor-publisher.env',
    'constructor-config.constructor-release.env',
    'runtime.env',
  ])

  const pendingBefore = discard.indexOf('validate_unit_migration_pending')
  const pendingBytesBefore = discard.indexOf("grep -qx 'schema=1'", pendingBefore)
  const journal = discard.indexOf('.phase == "prepared"', pendingBytesBefore)
  const composeCmp = discard.indexOf('cmp -s -- "$recovery_compose" "$selected_compose"', journal)
  const manifest = discard.indexOf("while IFS=$'\\t' read -r logical present extra", composeCmp)
  const exactCount = discard.indexOf('[ "$manifest_count" -eq 12 ]', manifest)
  const backupInventory = discard.indexOf('observed_backups=$(find', exactCount)
  const topology = discard.indexOf('mapfile -t target_ids', backupInventory)
  const finalOwnerProof = discard.lastIndexOf('deploy_quiesce_owned_by_caller')
  const pendingFinal = discard.indexOf('[ -f "$UNIT_MIGRATION_PENDING" ]', finalOwnerProof)
  const quiesceFinal = discard.indexOf('wait_for_live_constructor_units_quiesced', pendingFinal)
  const clear = discard.indexOf("clear_journal || die 'jurnalul runtime prepared", finalOwnerProof)
  const remove = discard.indexOf('remove_transaction_after_durable_journal_clear "$recovery_root"', clear)
  const reset = discard.indexOf('recovery_in_progress=0', remove)
  assert.ok(pendingBefore >= 0 && pendingBytesBefore > pendingBefore && journal > pendingBytesBefore
    && composeCmp > journal && manifest > composeCmp && exactCount > manifest
    && backupInventory > exactCount && topology > backupInventory
    && finalOwnerProof > topology && pendingFinal > finalOwnerProof && quiesceFinal > pendingFinal
    && clear > quiesceFinal && remove > clear && reset > remove,
  'toate dovezile, inclusiv pending/quiesce, precedă unlink-ul, iar resetul urmează remove')

  const manifestChecks = discard.slice(manifest, exactCount)
  assert.equal((manifestChecks.match(/stat -Lc '%u:%g:%a:%h'/g) ?? []).length, 2,
    'backupul și ținta live cer ambele ACL plus nlink exact')
  assert.match(manifestChecks, /\$mapped_owner:\$mapped_group:\$mapped_mode:1[\s\S]*cmp -s -- "\$mapped_target" "\$backup"/)
  assert.match(discard, /observed_manifest[\s\S]*"\$observed_manifest" = "\$expected"[\s\S]*observed_backups[\s\S]*"\$observed_backups" = "\$expected"/)
  assert.doesNotMatch(discard, /clear_unit_migration_pending/)
  assert.doesNotMatch(discard.slice(0, clear), /\b(?:mv|install|rm)\s+(?:-[^\n ]+\s+)*--?[^=]/,
    'discard-ul nu poate muta, instala sau șterge înaintea commitului unic')
})

test('refuzul discard-ului armează cleanup fail-closed și păstrează jurnalul plus tranzacția', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  assert.match(cutover,
    /if \[ -n "\$activation_resume_operation" \]; then\s*\[ "\$recover_only" = 1 \] && \[ "\$discard_unmutated_prepared" = 0 \] \\\s*&& \[ "\$discard_unmutated_gate_prepared" = 0 \] \\\s*\|\| die 'resume-ul activării este permis numai în recover-only generic'/,
  'resume-ul explicit nu poate împrumuta autoritatea căii destructive discard')
  assert.match(cutover,
    /if \[ "\$leave_constructor_quiesced" = 1 \]; then\s*\[ "\$activation_resume_operation" = activate-worker-publisher \]/,
  'resume+leave trebuie limitat la operația one-shot acceptată de callerul pin-uit')
  const cleanup = shellFunction(cutover, 'cleanup_cutover')
  const trap = cutover.indexOf('trap cleanup_cutover EXIT')
  const arm = cutover.indexOf('if [ "$discard_unmutated_prepared" = 1 ] || [ "$discard_unmutated_gate_prepared" = 1 ]; then', trap)
  const armed = cutover.indexOf('recovery_in_progress=1', arm)
  const firstRecoveryValidator = cutover.indexOf('retract_runtime_ready_stamp_for_recovery', arm)
  const deployValidator = cutover.indexOf("validate_deploy_quiesce_journal || die", arm)
  const specialCall = cutover.indexOf('discard_unmutated_prepared_cutover "$discard_target_commit" "$compose_file"', arm)
  const genericRecovery = cutover.indexOf('\nrecover_interrupted_gate_refresh\n', specialCall)
  assert.ok(trap >= 0 && arm > trap && armed > arm && firstRecoveryValidator > armed && deployValidator > armed
    && specialCall > deployValidator && genericRecovery > specialCall,
  'guardul special trebuie armat înaintea validatorilor și executat înainte de recovery generic')

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-discard-cleanup-'))
  const journal = join(sandbox, 'runtime-config-cutover.journal')
  const transaction = join(sandbox, 'runtime-config-txn.Refusal')
  const calls = join(sandbox, 'calls.log')
  mkdirSync(transaction)
  writeFileSync(journal, '{"schema":1,"phase":"prepared"}\n', { mode: 0o600 })
  writeFileSync(calls, '', { mode: 0o600 })
  const harness = `set -uo pipefail
JOURNAL=$1
transaction_root=$2
CALLS=$3
recovery_in_progress=0
discard_unmutated_prepared=1
discard_unmutated_gate_prepared=0
recover_only=1
mutation_started=0
operation_succeeded=0
restart_guarded=0
units_quiesced=0
leave_constructor_quiesced=1
config_consistent=1
backend_consistent=1
unit_only_transaction=0
journal_owned=1
journal_clear_durable=0
stage_root=
stage_canonical=
prepared=()
force_quiesce_constructor_units() { printf 'force\\n' >> "$CALLS"; }
clear_runtime_ready_stamp() { printf 'stamp\\n' >> "$CALLS"; }
clear_journal() { printf 'CLEAR\\n' >> "$CALLS"; rm -f -- "$JOURNAL"; }
remove_transaction_after_durable_journal_clear() { printf 'REMOVE\\n' >> "$CALLS"; rmdir "$1"; }
roll_forward_unit_transaction() { return 1; }
restore_files() { return 1; }
recreate_active_release() { return 1; }
validate_unit_migration_pending() { return 1; }
wait_for_live_constructor_units_quiesced() { return 1; }
validate_live_runtime_contract() { return 1; }
publish_runtime_ready_stamp() { return 1; }
restore_constructor_timers() { return 1; }
${cleanup}
die() { exit 73; }
validate_deploy_quiesce_journal() { return 1; }
trap cleanup_cutover EXIT
if [ "$discard_unmutated_prepared" = 1 ] || [ "$discard_unmutated_gate_prepared" = 1 ]; then
  recovery_in_progress=1
fi
validate_deploy_quiesce_journal || die`
  const result = spawnSync(bashExecutable, ['-c', harness, 'discard-cleanup', journal, transaction, calls], { encoding: 'utf8' })
  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.equal(existsSync(journal), true, 'jurnalul trebuie păstrat după refuz')
  assert.equal(existsSync(transaction), true, 'tranzacția trebuie păstrată după refuz')
  assert.doesNotMatch(readFileSync(calls, 'utf8'), /CLEAR|REMOVE/)
  rmSync(sandbox, { recursive: true, force: true })
})

test('installerul refuză recovery-ul distructiv înainte de mutații și din nou sub lock', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const guard = shellFunction(installer, 'guard_destructive_cutover_recovery_absent')
  assert.match(guard, /! -e "\$DESTRUCTIVE_RECOVERY_JOURNAL"[\s\S]*! -L "\$DESTRUCTIVE_RECOVERY_JOURNAL"/)
  const guardDefinition = installer.indexOf('guard_destructive_cutover_recovery_absent() {')
  const firstGuard = installer.indexOf('guard_destructive_cutover_recovery_absent || {', guardDefinition)
  const firstInstall = installer.indexOf('install -d', firstGuard)
  const lock = installer.indexOf('acquire_publication_lock || {', firstInstall)
  const secondGuard = installer.indexOf('guard_destructive_cutover_recovery_absent || {', lock)
  const identityPhase = installer.indexOf('set_constructor_install_phase identity-layout', secondGuard)
  assert.ok(firstGuard > guardDefinition && firstInstall > firstGuard && lock > firstInstall
    && secondGuard > lock && identityPhase > secondGuard,
  'primul guard precedă primul install -d, iar al doilea urmează imediat publication lock')
  assert.equal((installer.match(/guard_destructive_cutover_recovery_absent \|\| \{/g) ?? []).length, 2)
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
  const mixedInvoke = provision.indexOf('"$cutover_stage" "$work/deploy/compose.production.yml"', mixedStart)
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

test('vps-set-env separă bootstrapul fără controller de reactivarea canonică', () => {
  const provision = read('.github/workflows/vps-set-env.yml')
  const classify = provision.indexOf('controller_artifacts=(')
  const partial = provision.indexOf("Controllerul manual este instalat parțial", classify)
  const firstPublication = provision.indexOf('install_atomic "$work/deploy/lib/runtime-config-cutover.sh"', classify)
  const finalBranch = provision.indexOf('if [ "$controller_bootstrap_quiesced" = 1 ]; then', firstPublication)
  const leave = provision.indexOf('--leave-constructor-quiesced', finalBranch)
  const liveBranch = provision.indexOf('\n          else', leave)
  const noLeave = provision.indexOf('"$cutover_stage" "$work/deploy/compose.production.yml"', liveBranch)
  const controllerProof = provision.indexOf('systemctl is-active --quiet kelion-constructor-model-control.service', noLeave)
  const socketProof = provision.indexOf("0:10050:660", controllerProof)
  assert.ok(classify >= 0 && partial > classify && firstPublication > partial
    && finalBranch > firstPublication && leave > finalBranch && liveBranch > leave
    && noLeave > liveBranch && controllerProof > noLeave && socketProof > controllerProof,
  'clasificarea read-only trebuie să preceadă mutația, iar numai controllerul canonic poate urma calea no-leave')
  const classification = provision.slice(classify, firstPublication)
  assert.match(classification, /case "\$controller_artifact_count" in[\s\S]*0\)[\s\S]*controller_bootstrap_quiesced=1[\s\S]*3\)[\s\S]*controller_bootstrap_quiesced=0/)
  assert.match(classification, /constructor-model-control\.mjs[\s\S]*constructor-model-switch[\s\S]*kelion-constructor-model-control\.service/)
  assert.match(classification,
    /validate_controller_artifact_bytes[\s\S]*controller_candidates[\s\S]*controller_sha256[\s\S]*Controllerul manual diferă byte-exact de checkout/)
  assert.match(classification, /--self-test[\s\S]*After=local-fs\.target private-ai-llm\.service[\s\S]*systemctl is-enabled --quiet kelion-constructor-model-control\.service/)
  assert.match(provision.slice(finalBranch), /bootstrap-quiesced până la configure-constructor/)

  const bundleStart = provision.indexOf('git archive --format=tar HEAD')
  const bundleEnd = provision.indexOf('bundle_commit=$(git rev-parse HEAD)', bundleStart)
  const bundle = provision.slice(bundleStart, bundleEnd)
  for (const path of [
    'deploy/constructor-model-control.mjs',
    'deploy/constructor-model-switch.sh',
    'deploy/systemd/kelion-constructor-model-control.service',
  ]) {
    assert.match(bundle, new RegExp(path.replaceAll('.', '\\.') ))
    assert.match(bundle, new RegExp(`git cat-file blob HEAD:${path.replaceAll('.', '\\.')} \\| sha256sum`))
  }
  assert.match(provision,
    /bash -s --[\s\\]*"\$remote_bundle" "\$remote_payload" "\$cleanup_unit"[\s\\]*"\$controller_model_control_sha256" "\$controller_model_switch_sha256" "\$controller_unit_sha256"/)
  assert.doesNotMatch(provision,
    /install_atomic[^\n]*(?:constructor-model-control|constructor-model-switch)/,
    'rotația secretelor nu publică artefactele controllerului; doar le clasifică byte-exact')

  const validator = shellFunction(provision.replace(/^ {10}/gm, ''), 'validate_controller_artifact_bytes')
  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-controller-byte-proof-'))
  try {
    const candidate = join(sandbox, 'controller-candidate.service')
    const exact = join(sandbox, 'controller-live-exact.service')
    const oldCompatible = join(sandbox, 'controller-live-old.service')
    const canonical = read('deploy/systemd/kelion-constructor-model-control.service')
    const digest = createHash('sha256').update(canonical).digest('hex')
    writeFileSync(candidate, canonical)
    writeFileSync(exact, canonical)
    // Un comentariu păstrează toate directivele/invariant-ele systemd, dar
    // simulează o generație live veche care nu este byte-identică checkoutului.
    writeFileSync(oldCompatible, `${canonical}# legacy-compatible-generation\n`)
    const runProof = (live) => spawnSync(bashExecutable, ['-c', `set -euo pipefail
${validator}
validate_controller_artifact_bytes "$1" "$2" "$3"`, 'controller-byte-proof', live, candidate, digest], {
      encoding: 'utf8',
    })
    const exactResult = runProof(exact)
    assert.equal(exactResult.status, 0, exactResult.stderr || exactResult.stdout)
    const oldResult = runProof(oldCompatible)
    assert.notEqual(oldResult.status, 0,
      'un controller semantic compatibil, dar cu SHA diferit, trebuie refuzat înainte de mutație')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
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
  assert.match(cutover,
    /write_journal_phase backend-recreated[\s\S]*write_journal_phase committed[\s\S]*publish_reactivation_journal[\s\S]*clear_journal[\s\S]*restore_runtime_controller_or_quiesce[\s\S]*restore_constructor_timers[\s\S]*clear_reactivation_journal/)
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

test('clientul intern refuză explicit un heartbeat nepersistat', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true,"heartbeatPersisted":false}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const lease = startLease({
    api: new URL('http://127.0.0.1:18079/'),
    secret: 'h'.repeat(32),
    prefix: 'x-constructor-publisher',
    path: '/api/internal/constructor-publisher/jobs/1/lease',
    body: { taskId: 'codex-123e4567-e89b-42d3-a456-426614174000', leaseId: '123e4567-e89b-42d3-a456-426614174001' },
    intervalMs: 60_000,
  })
  try {
    await assert.rejects(lease.assert(), /heartbeat nepersistat/)
  } finally {
    await lease().catch(() => undefined)
    globalThis.fetch = originalFetch
  }
})

test('publisherul și releaserul refuză orice nepotrivire marker-execuție', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-constructor-vector-'))
  const credential = join(sandbox, 'hmac')
  writeFileSync(credential, `${'h'.repeat(40)}\n`, { mode: 0o600 })
  const cases = [
    {
      script: 'deploy/constructor-publisher.mjs',
      execEnv: 'CONSTRUCTOR_PUBLISHER_EXEC_ENABLED',
      markerEnv: 'CONSTRUCTOR_PUBLISHER_ENABLE_MARKER',
      secretEnv: 'CONSTRUCTOR_PUBLISHER_SECRET_FILE',
      label: 'Publisherul',
    },
    {
      script: 'deploy/constructor-release.mjs',
      execEnv: 'CONSTRUCTOR_RELEASE_EXEC_ENABLED',
      markerEnv: 'CONSTRUCTOR_RELEASE_ENABLE_MARKER',
      secretEnv: 'CONSTRUCTOR_RELEASE_SECRET_FILE',
      label: 'Release dispatcher',
    },
  ]
  try {
    for (const candidate of cases) {
      for (const [enabled, markerPresent] of [[true, false], [false, true]]) {
        const marker = join(sandbox, `${candidate.execEnv}-${enabled}-${markerPresent}`)
        if (markerPresent) writeFileSync(marker, 'enabled\n', { mode: 0o600 })
        const result = spawnSync(process.execPath, [join(root, candidate.script), '--once'], {
          encoding: 'utf8',
          timeout: 5_000,
          env: {
            ...process.env,
            KELION_CONSTRUCTOR_API: 'http://127.0.0.1:1/',
            [candidate.execEnv]: enabled ? '1' : '0',
            [candidate.markerEnv]: marker,
            [candidate.secretEnv]: credential,
          },
        })
        assert.notEqual(result.status, 0, `${candidate.label} a acceptat vectorul ${enabled}:${markerPresent}`)
        assert.match(`${result.stdout}${result.stderr}`, new RegExp(`${candidate.label}.*dezactivat explicit`))
        assert.doesNotMatch(result.stdout, /:\s*dezactivat\s*$/m,
          'nepotrivirea nu poate fi raportată drept stare dezactivată sănătoasă')
      }
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('preflightul publisher/release poate raporta degradarea după încărcarea HMAC', () => {
  for (const path of ['deploy/constructor-publisher.mjs', 'deploy/constructor-release.mjs']) {
    const source = read(path)
    const runOnce = source.slice(source.indexOf('async function runOnce() {'), source.indexOf('\n}\n', source.indexOf('async function runOnce() {')) + 3)
    const hmac = runOnce.indexOf('loadSystemdCredential(')
    const guardedPreflight = runOnce.indexOf('try {', hmac)
    const layout = runOnce.indexOf('assertEnabledLayout()', guardedPreflight)
    const stateMutation = runOnce.indexOf('mkdirSync(STATE', layout)
    const catchBlock = runOnce.indexOf('} catch (error) {', stateMutation)
    const report = runOnce.indexOf('PreflightFailure(hmac.value, error)', catchBlock)
    assert.ok(hmac >= 0 && guardedPreflight > hmac && layout > guardedPreflight
      && stateMutation > layout && catchBlock > stateMutation && report > catchBlock,
    `${path} trebuie să încarce HMAC înaintea preflightului raportabil și a primei mutații`)
  }
})

test('garbage collectorul activărilor păstrează jurnalul canonic', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const collector = shellFunction(cutover, 'garbage_collect_activations')
  const existsGuard = '    [ -e "$candidate" ] || continue'
  const journalSkip = '    [ "$candidate" = "$ACTIVATION_JOURNAL" ] && continue'
  const directoryGuard = '&& [ -d "$candidate" ] && [ ! -L "$candidate" ]'

  assert.equal(collector.split(journalSkip).length - 1, 1,
    'excluderea jurnalului trebuie să fie exactă și unică')
  assert.ok(collector.indexOf(existsGuard) < collector.indexOf(journalSkip),
    'candidatul trebuie să existe înainte de comparație')
  assert.ok(collector.indexOf(journalSkip) < collector.indexOf(directoryGuard),
    'jurnalul trebuie exclus înainte de testul de director')
  assert.ok(collector.includes('constructor-activation\\.[A-Za-z0-9._-]+$'),
    'GC-ul trebuie să accepte și snapshoturi legacy validate strict din runtime')
  assert.match(collector, /remove_activation_dir "\$canonical" \|\| return 1/,
    'snapshoturile reale trebuie curățate în continuare')
  const journalAbsent = collector.indexOf('if [ ! -e "$ACTIVATION_JOURNAL" ]')
  const preRemovalFsync = collector.indexOf('fsync_path "$RUNTIME_ROOT" || return 1', journalAbsent)
  const removeSnapshot = collector.indexOf('remove_activation_dir "$canonical" || return 1', preRemovalFsync)
  const postRemovalFsync = collector.indexOf('fsync_path "$RUNTIME_ROOT" || return 1', removeSnapshot)
  assert.ok(journalAbsent >= 0 && preRemovalFsync > journalAbsent
    && removeSnapshot > preRemovalFsync && postRemovalFsync > removeSnapshot,
  'GC-ul persistă absența jurnalului înainte de remove și persistă din nou directorul după remove')
})

test('deploy-ul migrează one-shot numai deadlockul GC al activării', () => {
  const deploy = read('deploy/deploy.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const recovery = shellFunction(deploy, 'recover_runtime_activation_before_upgrade')

  assert.match(deploy,
    /LEGACY_ACTIVATION_GC_RUNTIME_HELPER_SHA256=ce136f70aa3c9672f14916055644b1e0eedf9a95944bb30066689dcaa68c318e/)
  const compatiblePin = deploy.match(
    /COMPATIBLE_ACTIVATION_GC_RUNTIME_HELPER_SHA256=([0-9a-f]{64})/)?.[1]
  assert.equal(compatiblePin, createHash('sha256').update(cutover).digest('hex'),
    'helperul candidat trebuie pin-uit la bytes exacți')

  const livePin = recovery.indexOf(
    '[ "$live_sha" = "$LEGACY_ACTIVATION_GC_RUNTIME_HELPER_SHA256" ]')
  const mixedRuntimeRefusal = recovery.indexOf(
    'for incompatible in "$runtime_journal" "$gate_journal" "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL"', livePin)
  const retryBlocker = recovery.indexOf('if [ -e "$unit_migration_pending" ]', mixedRuntimeRefusal)
  const retryBlockerProof = recovery.indexOf(
    'validate_compatible_activation_blocker "$unit_migration_pending"', retryBlocker)
  const journalAcl = recovery.indexOf("0:0:600:1", retryBlockerProof)
  const workerOnly = recovery.indexOf('.operation == "activate-worker-publisher"', journalAcl)
  const rootAllowlist = recovery.indexOf('constructor-activation\\\\.[A-Za-z0-9]+', workerOnly)
  const candidatePin = recovery.indexOf(
    '[ "$candidate_sha" = "$COMPATIBLE_ACTIVATION_GC_RUNTIME_HELPER_SHA256" ]', rootAllowlist)
  const temporaryCopy = recovery.indexOf(
    'mktemp /run/kelion-activation-recovery-helper.XXXXXX', candidatePin)
  const durableCopy = recovery.indexOf('fsync_release_artifact "$temporary" file', temporaryCopy)
  const explicitResume = recovery.indexOf(
    'KELION_ACTIVATION_RESUME_OPERATION="$activation_operation"', durableCopy)
  const resumeRun = recovery.indexOf(
    'bash "$recovery_helper" --recover-only "$live_compose" --leave-constructor-quiesced;', explicitResume)
  const appliedProof = recovery.indexOf('.phase == "applied"', resumeRun)
  const blockerProof = recovery.indexOf(
    'validate_compatible_activation_blocker "$unit_migration_pending"', appliedProof)
  const blockerReproof = recovery.indexOf(
    'validate_compatible_activation_blocker "$unit_migration_pending"', blockerProof + 1)
  const blockerFilePersist = recovery.indexOf(
    'fsync_release_artifact "$unit_migration_pending" file', blockerReproof)
  const blockerDirectoryPersist = recovery.indexOf(
    'fsync_release_artifact "$RUNTIME_ROOT" directory', blockerFilePersist)
  const journalUnlink = recovery.indexOf('rm -f -- "$activation_journal"', blockerDirectoryPersist)
  const journalPersist = recovery.indexOf('fsync_release_artifact "$RUNTIME_ROOT" directory', journalUnlink)
  const journalGone = recovery.indexOf('[ ! -e "$activation_journal" ]', journalPersist)
  const rootRemoval = recovery.indexOf('rm -rf --one-file-system -- "$activation_root"', journalGone)
  const rootPersist = recovery.indexOf('fsync_release_artifact "$RUNTIME_ROOT" directory', rootRemoval)
  const orphanProof = recovery.indexOf(
    'for activation_candidate in "$RUNTIME_ROOT"/constructor-activation.*', rootPersist)
  const readyAbsent = recovery.indexOf(
    '[ ! -e /run/kelion/runtime-config-recovery.ready ]', orphanProof)
  const cleanup = recovery.indexOf('rm -f -- "$temporary"', readyAbsent)

  assert.ok(livePin >= 0 && mixedRuntimeRefusal > livePin && retryBlocker > mixedRuntimeRefusal
    && retryBlockerProof > retryBlocker && journalAcl > retryBlockerProof
    && workerOnly > journalAcl && rootAllowlist > workerOnly && candidatePin > rootAllowlist
    && temporaryCopy > candidatePin && durableCopy > temporaryCopy
    && explicitResume > durableCopy && resumeRun > explicitResume && appliedProof > resumeRun
    && blockerProof > appliedProof && blockerReproof > blockerProof
    && blockerFilePersist > blockerReproof && blockerDirectoryPersist > blockerFilePersist
    && journalUnlink > blockerDirectoryPersist
    && journalPersist > journalUnlink
    && journalGone > journalPersist && rootRemoval > journalGone && rootPersist > rootRemoval
    && orphanProof > rootPersist && readyAbsent > orphanProof
    && cleanup > readyAbsent,
  'fallback-ul trebuie să fie dublu pin-uit, applied+blocked, quiesced și curățat journal-before-root')
  assert.doesNotMatch(recovery.slice(explicitResume, orphanProof),
    /start_constructor_unit|systemctl (?:start|enable)/,
    'bootstrap-ul deploy nu poate porni dependențe ori timere Constructor')
  assert.doesNotMatch(recovery, /rm -f -- "[$]unit_migration_pending"/,
    'blockerul persistent este consumat numai de cutover-ul strict ulterior')
  assert.match(recovery,
    /elif \[ "\$status" = 0 \]; then[\s\S]*"\$recovery_helper" --recover-only "\$live_compose" --leave-constructor-quiesced/,
    'orice alt helper trebuie să-și recupereze propriile jurnale')
  assert.doesNotMatch(recovery,
    /install_recovery_artifact[\s\S]*runtime-config-cutover|mv -f --[^\n]*ROOT\/bin\/runtime-config-cutover/,
    'migrarea one-shot nu poate înlocui helperul live înainte de recovery')

  const mainStart = deploy.indexOf('# Jurnalele runtime/activare sunt recuperate în mod normal')
  const call = deploy.indexOf('\n  recover_runtime_activation_before_upgrade \\\n', mainStart)
  const triggerStart = deploy.lastIndexOf(
    '\nif [ -e "$RUNTIME_ROOT/runtime-config-cutover.journal"', call)
  const replayTrigger = deploy.slice(triggerStart, call)
  const persistentUpgrade = deploy.indexOf(
    '# Upgrade atomic și fsync al recovery gate-ului de boot', call)
  assert.ok(mainStart >= 0 && call > mainStart && triggerStart > mainStart && persistentUpgrade > call,
    'recovery-ul one-shot trebuie să se încheie înaintea upgrade-ului persistent')
  assert.match(replayTrigger,
    /constructor-activation\.journal[\s\S]*constructor-unit-migration\.pending[\s\S]*CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL/,
  'un reboot după unlink-ul jurnalului trebuie să reintre fail-closed prin blockerul persistent')
})

test('blockerul applied este replay-idempotent și refuză aliasuri, ACL ori conținut diferit', () => {
  const deploy = read('deploy/deploy.sh')
  const validator = shellFunction(deploy, 'validate_compatible_activation_blocker')
  assert.match(validator, /\[ -f "\$blocker" \] && \[ ! -L "\$blocker" \]/)
  assert.match(validator, /stat -Lc '%u:%g:%a:%h'[\s\S]*0:0:600:1/)
  assert.match(validator, /wc -l[\s\S]*-eq 1[\s\S]*grep -qx 'schema=1'/)
  const harnessValidator = validator.replace(
    "= '0:0:600:1'",
    `= '${process.getuid()}:${process.getgid()}:600:1'`)
  assert.ok(harnessValidator.includes(
    `= '${process.getuid()}:${process.getgid()}:600:1'`),
  'harnessul trebuie să adapteze numai ownerul așteptat la runnerul curent')

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-activation-blocker-'))
  const blocker = join(sandbox, 'constructor-unit-migration.pending')
  const alias = join(sandbox, 'blocker.alias')
  const hardlink = join(sandbox, 'blocker.hardlink')
  const harness = `set -euo pipefail
${harnessValidator}
blocker=$1
alias=$2
hardlink=$3
printf 'schema=1\\n' > "$blocker"
chmod 0600 "$blocker"
validate_compatible_activation_blocker "$blocker"
validate_compatible_activation_blocker "$blocker"
ln -s "$blocker" "$alias"
if validate_compatible_activation_blocker "$alias"; then exit 71; fi
chmod 0640 "$blocker"
if validate_compatible_activation_blocker "$blocker"; then exit 72; fi
chmod 0600 "$blocker"
printf 'schema=2\\n' > "$blocker"
if validate_compatible_activation_blocker "$blocker"; then exit 73; fi
printf 'schema=1\\n' > "$blocker"
ln "$blocker" "$hardlink"
if validate_compatible_activation_blocker "$blocker"; then exit 74; fi`
  const result = spawnSync(bashExecutable, ['-c', harness, 'activation-blocker', blocker, alias, hardlink], {
    encoding: 'utf8',
  })
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('upgrade-ul Constructor este o operație workflow izolată de credentialele aplicației', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const stepContaining = (needle) => {
    const needleIndex = workflow.indexOf(needle)
    assert.ok(needleIndex >= 0, `workflow-ul trebuie să conțină ${needle}`)
    const start = workflow.lastIndexOf('\n      - ', needleIndex)
    const next = workflow.indexOf('\n      - ', needleIndex)
    const end = next === -1 ? workflow.length : next
    assert.ok(start >= 0 && end > needleIndex, `pasul care conține ${needle} trebuie delimitat`)
    return workflow.slice(start, end)
  }

  const optionStart = workflow.indexOf('        options:')
  const optionEnd = workflow.indexOf('\n      auto_routed_to_master:', optionStart)
  assert.ok(optionStart >= 0 && optionEnd > optionStart)
  const operationOptions = workflow.slice(optionStart, optionEnd)
  assert.equal(operationOptions.match(/^\s+- upgrade-constructor$/gm)?.length, 1,
    'upgrade-constructor trebuie să fie o operație explicită și unică')

  const checkout = stepContaining('actions/checkout@')
  const gate = stepContaining('Leaga imaginea gate de sursa Constructor')
  for (const prerequisite of [checkout, gate]) {
    assert.match(prerequisite, /inputs\.operation == 'configure-constructor'/)
    assert.match(prerequisite, /inputs\.operation == 'upgrade-constructor'/)
  }

  const controlStart = workflow.indexOf('\n  control:')
  const stepsStart = workflow.indexOf('\n    steps:', controlStart)
  assert.ok(controlStart >= 0 && stepsStart > controlStart)
  const controlPreamble = workflow.slice(controlStart, stepsStart)
  const configure = stepContaining('Configureaza Constructorul fara activare prematura')
  const applicationCredentials = new Map([
    ['CODEX_WORKER_SECRET', 'CODEX_WORKER_SECRET'],
    ['CONSTRUCTOR_PUBLISHER_SECRET', 'CONSTRUCTOR_PUBLISHER_SECRET'],
    ['CONSTRUCTOR_RELEASE_SECRET', 'CONSTRUCTOR_RELEASE_SECRET'],
    ['SYNC_GITHUB_TOKEN', 'CONSTRUCTOR_SYNC_GITHUB_TOKEN'],
    ['PUBLISHER_GITHUB_TOKEN', 'CONSTRUCTOR_PUBLISHER_GITHUB_TOKEN'],
    ['RELEASE_GITHUB_TOKEN', 'VPS_GITHUB_TOKEN'],
    ['GHCR_READ_TOKEN', 'CONSTRUCTOR_GHCR_READ_TOKEN'],
  ])
  const controlSecretRefs = [...controlPreamble.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)]
    .map((match) => match[1])
  assert.deepEqual(controlSecretRefs, ['VPS_SSH_KEY'],
    'job-ul control poate moșteni numai cheia SSH; tokenul GitHub de control este github.token')
  assert.match(controlPreamble, /^\s+GH_TOKEN: \$\{\{ github\.token \}\}$/m)
  for (const [environmentName, secretName] of applicationCredentials) {
    assert.doesNotMatch(controlPreamble, new RegExp(`^\\s+${environmentName}:`, 'm'),
      `${environmentName} nu poate fi moștenit de toate operațiile control`)
    assert.ok(configure.includes(`${environmentName}: \${{ secrets.${secretName} }}`),
      `${environmentName} trebuie injectat numai în pasul configure`)
  }
  const audit = stepContaining('Auditeaza identitatea tokenurilor (read-only)')
  for (const [environmentName, secretName] of [...applicationCredentials].slice(3)) {
    assert.ok(audit.includes(`${environmentName}: \${{ secrets.${secretName} }}`),
      `${environmentName} trebuie injectat punctual și în audit-token-identity`)
  }
  for (const environmentName of [...applicationCredentials.keys()].slice(0, 3)) {
    assert.doesNotMatch(audit, new RegExp(`^\\s+${environmentName}:`, 'm'),
      `audit-token-identity nu are nevoie de ${environmentName}`)
  }

  const upgradeStep = stepContaining('deploy/upgrade-constructor.sh')
  assert.match(upgradeStep, /if: inputs\.operation == 'upgrade-constructor'/)
  assert.match(upgradeStep, /KELION_CONSTRUCTOR_UPGRADE=1/)
  assert.match(upgradeStep, /KELION_CONSTRUCTOR_SOURCE_COMMIT=/)
  assert.match(upgradeStep, /bash [^\n]*deploy\/upgrade-constructor\.sh/)
  assert.match(upgradeStep, /remote_bundle=.*\$\{GITHUB_RUN_ID\}.*\$\{GITHUB_RUN_ATTEMPT\}/)
  const bundleCleanup = upgradeStep.match(/([a-z_]+)\(\) \{[\s\S]{0,700}?rm -f -- '[\$]remote_bundle'/)?.[1]
  assert.ok(bundleCleanup, 'bundle-ul remote trebuie eliminat de un cleanup delimitat')
  assert.ok(upgradeStep.includes(`trap ${bundleCleanup} EXIT`))

  const checkoutCommit = upgradeStep.indexOf('git rev-parse HEAD')
  const remoteMaster = upgradeStep.indexOf('/git/ref/heads/master', checkoutCommit)
  const firstCopy = upgradeStep.indexOf('scp ', remoteMaster)
  const remoteRun = upgradeStep.indexOf('deploy/upgrade-constructor.sh', firstCopy)
  assert.ok(checkoutCommit >= 0 && remoteMaster > checkoutCommit && firstCopy > remoteMaster && remoteRun > firstCopy,
    'master trebuie reverificat imediat înainte de primul mutator VPS și înainte de execuția upgrade-ului')

  for (const environmentName of applicationCredentials.keys()) {
    assert.doesNotMatch(upgradeStep, new RegExp(`\\b${environmentName}\\b`),
      `pasul upgrade nu poate primi ${environmentName}`)
  }
  const explicitSecretRefs = [...upgradeStep.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)]
    .map((match) => match[1])
  assert.ok(explicitSecretRefs.every((name) => name === 'VPS_SSH_KEY'),
    `upgrade-ul poate primi numai cheia SSH de control, nu ${explicitSecretRefs.join(', ')}`)
  assert.doesNotMatch(upgradeStep,
    /\bpayload\b|\bbase64\b|\bapt(?:-get)?\b|\bnpm\b|set\s+-x|printenv|declare\s+-p|export\s+-p/i)
})

test('dovada release din workflow cere candidate=false și SHA-ul selectat în fresh și recovery', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const upgradeStart = workflow.indexOf('- name: Actualizeaza atomic Constructorul in-place')
  const upgradeEnd = workflow.indexOf('\n      - name:', upgradeStart + 1)
  assert.ok(upgradeStart >= 0 && upgradeEnd > upgradeStart)
  const upgradeStep = workflow.slice(upgradeStart, upgradeEnd)
  const filterMatch = upgradeStep.match(
    /jq -e --arg expected "\$source_commit" '([\s\S]*?)' <<<"\$release_proof"/)
  assert.ok(filterMatch, 'predicatul jq al dovezii release din pasul upgrade trebuie să poată fi extras')
  const filter = filterMatch[1]
  assert.match(filter, /\.ready == true/)
  assert.match(filter, /\.release\.candidate == false/)
  assert.match(filter, /\.release\.sideEffectsActive == true/)
  assert.match(filter, /\.activeCommit == \$expected/)
  assert.doesNotMatch(filter, /candidate\s*\/\//,
    'absența candidate nu poate fi convertită implicit în false')

  const evaluate = (expected, payload) => spawnSync('jq', ['-e', '--arg', 'expected', expected, filter], {
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
  })
  for (const [mode, expected, mismatch] of [
    ['fresh', '89abcdef0123456789abcdef0123456789abcdef', '76543210fedcba9876543210fedcba9876543210'],
    ['recovery', '1234567890abcdef1234567890abcdef12345678', '89abcdef0123456789abcdef0123456789abcdef'],
  ]) {
    assert.equal(evaluate(expected, {
      ready: true,
      release: { candidate: false, sideEffectsActive: true },
      activeCommit: expected,
    }).status, 0, `${mode} trebuie să accepte numai SHA-ul selectat exact`)
    assert.notEqual(evaluate(expected, {
      ready: true,
      release: { sideEffectsActive: true },
      activeCommit: expected,
    }).status, 0, `${mode} trebuie să refuze payloadul fără candidate`)
    assert.notEqual(evaluate(expected, {
      ready: true,
      release: { candidate: true, sideEffectsActive: true },
      activeCommit: expected,
    }).status, 0, `${mode} trebuie să refuze candidatul pre-PONR`)
    assert.notEqual(evaluate(expected, {
      ready: true,
      release: { candidate: false, sideEffectsActive: true },
      activeCommit: mismatch,
    }).status, 0, `${mode} trebuie să refuze un release live de la alt SHA`)
  }
  assert.match(upgradeStep,
    /active_marker=\/root\/kelion\/runtime\/release-state\/active[\s\S]*grep -qx "\$source_commit" "\$active_marker"/,
    'dovada remote trebuie să lege și markerul activ exact de sursa fresh/recovery')
})

test('selectorul upgrade folosește master pentru fresh și numai jurnalul strict al unui ancestor pentru recovery', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const step = (name) => {
    const start = workflow.indexOf(`- name: ${name}`)
    const next = workflow.indexOf('\n      - name:', start + 1)
    assert.ok(start >= 0, `pasul ${name} lipsește`)
    return workflow.slice(start, next < 0 ? workflow.length : next)
  }
  const checkoutStart = workflow.indexOf('- uses: actions/checkout@')
  const checkoutEnd = workflow.indexOf('\n      - name:', checkoutStart)
  const checkout = workflow.slice(checkoutStart, checkoutEnd)
  assert.match(checkout, /if: inputs\.operation == 'configure-constructor' \|\| inputs\.operation == 'upgrade-constructor'/)
  assert.match(checkout, /ref: master[\s\S]*fetch-depth: 0[\s\S]*persist-credentials: false/)

  const selector = step('Selecteaza determinist sursa upgrade-ului Constructor')
  assert.match(selector, /set -Eeuo pipefail/)
  const remoteSelectorMatch = selector.match(
    /journal_source=\$\(ssh[\s\S]*?<<'REMOTE'\n([\s\S]*?)\n\s+REMOTE\n/)
  assert.ok(remoteSelectorMatch, 'heredoc-ul probei remote trebuie să poată fi extras')
  const remoteSelector = remoteSelectorMatch[1]
  assert.doesNotMatch(remoteSelector,
    /\b(?:rm|mv|cp|install|touch|mkdir|rmdir|truncate|tee|chmod|chown|systemctl|flock|scp|rsync)\b|\btar\s+-x/,
    'selectorul remote este strict read-only și nu poate lua lock ori modifica VPS-ul')
  assert.doesNotMatch(remoteSelector,
    /set\s+-x|printenv|declare\s+-p|export\s+-p|\b(?:SendEnv|AcceptEnv)\b/,
    'selectorul nu poate exporta sau afișa mediul')
  assert.deepEqual(remoteSelector.match(/^\s*exec\b.*$/gm)?.map((line) => line.trim()), [
    'exec 8<"$journal"',
    'exec 7<"$snapshot_root/state"',
  ], 'singurele exec-uri remote permise deschid read-only FD-urile pin-uite')
  for (const credential of [
    'CODEX_WORKER_SECRET',
    'CONSTRUCTOR_PUBLISHER_SECRET',
    'CONSTRUCTOR_RELEASE_SECRET',
    'SYNC_GITHUB_TOKEN',
    'PUBLISHER_GITHUB_TOKEN',
    'RELEASE_GITHUB_TOKEN',
    'GHCR_READ_TOKEN',
  ]) {
    assert.doesNotMatch(selector, new RegExp(`\\b${credential}\\b`),
      `selectorul nu poate primi ${credential}`)
  }
  const master = selector.indexOf('master_commit=$(gh api')
  const localMaster = selector.indexOf('[ "$(git rev-parse HEAD)" = "$master_commit" ]', master)
  const remoteProbe = selector.indexOf('journal_source=$(ssh', localMaster)
  const absent = selector.indexOf('if [ ! -e "$journal" ] && [ ! -L "$journal" ]; then', remoteProbe)
  const absentResult = selector.indexOf("printf 'none\\n'", absent)
  const journalFile = selector.indexOf('[ -f "$journal" ] && [ ! -L "$journal" ]', absentResult)
  const journalAcl = selector.indexOf("0:0:600:1", journalFile)
  const journalIdentity = selector.indexOf("journal_identity=$(stat -Lc '%d:%i' \"$journal\")", journalAcl)
  const journalFdOpen = selector.indexOf('exec 8<"$journal"', journalIdentity)
  const journalFdPath = selector.indexOf('readlink /proc/$$/fd/8', journalFdOpen)
  const journalFdAcl = selector.indexOf("stat -Lc '%u:%g:%a:%h' /proc/$$/fd/8", journalFdPath)
  const journalFdIdentity = selector.indexOf("stat -Lc '%d:%i' /proc/$$/fd/8", journalFdAcl)
  const journalLine = selector.indexOf('wc -l < /proc/$$/fd/8', journalFdIdentity)
  const journalJq = selector.indexOf('source_commit=$(jq -er', journalLine)
  const journalPathRecheck = selector.indexOf('[ ! -L "$journal" ]', journalJq)
  const journalIdentityRecheck = selector.indexOf("stat -Lc '%d:%i' \"$journal\"", journalPathRecheck)
  const snapshotGuard = selector.indexOf('[ -d "$snapshot_root" ] && [ ! -L "$snapshot_root" ]', journalIdentityRecheck)
  const snapshotCanonical = selector.indexOf('realpath -e -- "$snapshot_root"', snapshotGuard)
  const snapshotIdentity = selector.indexOf("snapshot_identity=$(stat -Lc '%d:%i' \"$snapshot_root\")", snapshotCanonical)
  const stateGuard = selector.indexOf('[ -f "$snapshot_root/state" ] && [ ! -L "$snapshot_root/state" ]', snapshotIdentity)
  const stateIdentity = selector.indexOf("state_identity=$(stat -Lc '%d:%i' \"$snapshot_root/state\")", stateGuard)
  const stateFdOpen = selector.indexOf('exec 7<"$snapshot_root/state"', stateIdentity)
  const stateFdPath = selector.indexOf('readlink /proc/$$/fd/7', stateFdOpen)
  const stateFdAcl = selector.indexOf("stat -Lc '%u:%g:%a:%h' /proc/$$/fd/7", stateFdPath)
  const stateFdIdentity = selector.indexOf("stat -Lc '%d:%i' /proc/$$/fd/7", stateFdAcl)
  const stateHash = selector.indexOf('sha256sum /proc/$$/fd/7', stateFdIdentity)
  const statePathRecheck = selector.indexOf('[ ! -L "$snapshot_root/state" ]', stateHash)
  const stateIdentityRecheck = selector.indexOf("stat -Lc '%d:%i' \"$snapshot_root/state\"", statePathRecheck)
  const snapshotPathRecheck = selector.indexOf('[ ! -L "$snapshot_root" ]', stateIdentityRecheck)
  const snapshotIdentityRecheck = selector.indexOf("stat -Lc '%d:%i' \"$snapshot_root\"", snapshotPathRecheck)
  const oneResult = selector.indexOf('[ "$(printf \'%s\\n\' "$journal_source" | wc -l)" -eq 1 ]', snapshotIdentityRecheck)
  assert.ok(master >= 0 && localMaster > master && remoteProbe > localMaster && absent > remoteProbe
    && absentResult > absent && journalFile > absentResult && journalAcl > journalFile
    && journalIdentity > journalAcl && journalFdOpen > journalIdentity
    && journalFdPath > journalFdOpen && journalFdAcl > journalFdPath
    && journalFdIdentity > journalFdAcl && journalLine > journalFdIdentity
    && journalJq > journalLine && journalPathRecheck > journalJq
    && journalIdentityRecheck > journalPathRecheck && snapshotGuard > journalIdentityRecheck
    && snapshotCanonical > snapshotGuard && snapshotIdentity > snapshotCanonical
    && stateGuard > snapshotIdentity && stateIdentity > stateGuard && stateFdOpen > stateIdentity
    && stateFdPath > stateFdOpen && stateFdAcl > stateFdPath && stateFdIdentity > stateFdAcl
    && stateHash > stateFdIdentity && statePathRecheck > stateHash
    && stateIdentityRecheck > statePathRecheck && snapshotPathRecheck > stateIdentityRecheck
    && snapshotIdentityRecheck > snapshotPathRecheck && oneResult > snapshotIdentityRecheck,
  'proba remote trebuie să distingă absența reală de symlink și să citească jurnalul/state prin FD-uri pin-uite, cu dev:ino reverificat')

  const filterMatch = selector.match(/source_commit=\$\(jq -er '([\s\S]*?)' \/proc\/\$\$\/fd\/8\)/)
  assert.ok(filterMatch, 'schema jq a jurnalului selector trebuie să poată fi extrasă')
  const journalFilter = filterMatch[1]
  assert.match(journalFilter, /\.schema == 1 and \.kind == "constructor-upgrade"/)
  assert.match(journalFilter,
    /\.phase == "armed" or \.phase == "installed" or \.phase == "committed"/)
  assert.match(journalFilter, /keys == \["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"\]/)
  const ancestor = '1234567890abcdef1234567890abcdef12345678'
  const validJournal = {
    schema: 1,
    kind: 'constructor-upgrade',
    phase: 'armed',
    sourceCommit: ancestor,
    snapshotRoot: '/root/kelion/runtime/constructor-upgrade.Abc123',
    stateSha256: 'a'.repeat(64),
  }
  const evaluateJournal = (journal) => spawnSync('jq', ['-er', journalFilter], {
    input: `${JSON.stringify(journal)}\n`,
    encoding: 'utf8',
  })
  for (const phase of ['armed', 'installed', 'committed']) {
    const accepted = evaluateJournal({ ...validJournal, phase })
    assert.equal(accepted.status, 0, `${phase}: ${accepted.stderr}`)
    assert.equal(accepted.stdout.trim(), ancestor)
  }
  for (const malformed of [
    Object.fromEntries(Object.entries(validJournal).filter(([key]) => key !== 'phase')),
    { ...validJournal, phase: 'complete' },
    { ...validJournal, phase: '' },
    { ...validJournal, phase: null },
    { ...validJournal, sourceCommit: ancestor.slice(0, 7) },
    { ...validJournal, snapshotRoot: '/tmp/constructor-upgrade.Abc123' },
    { ...validJournal, stateSha256: 'a'.repeat(63) },
    { ...validJournal, extra: true },
  ]) {
    assert.notEqual(evaluateJournal(malformed).status, 0,
      'orice abatere de la schema exactă a jurnalului trebuie refuzată')
  }

  const freshDefault = selector.indexOf('recovery=0', oneResult)
  const freshCommit = selector.indexOf('source_commit=$master_commit', freshDefault)
  const recoveryBranch = selector.indexOf('if [ "$journal_source" != none ]; then', freshCommit)
  const sourceShape = selector.indexOf('[[ "$journal_source" =~ ^[0-9a-f]{40}$ ]]', recoveryBranch)
  const sourceObject = selector.indexOf('git cat-file -e "$journal_source^{commit}"', sourceShape)
  const sourceAncestor = selector.indexOf('git merge-base --is-ancestor "$journal_source" "$master_commit"', sourceObject)
  const recoveryCommit = selector.indexOf('source_commit=$journal_source', sourceAncestor)
  const recoveryMode = selector.indexOf('recovery=1', recoveryCommit)
  const checkoutSelected = selector.indexOf('git checkout --detach "$source_commit"', recoveryMode)
  const verifySelected = selector.indexOf('[ "$(git rev-parse HEAD)" = "$source_commit" ]', checkoutSelected)
  const publishOutputs = selector.indexOf("printf 'commit=%s\\nmaster=%s\\nrecovery=%s\\n'", verifySelected)
  assert.ok(freshDefault >= 0 && freshCommit > freshDefault && recoveryBranch > freshCommit
    && sourceShape > recoveryBranch && sourceObject > sourceShape && sourceAncestor > sourceObject
    && recoveryCommit > sourceAncestor && recoveryMode > recoveryCommit
    && checkoutSelected > recoveryMode && verifySelected > checkoutSelected && publishOutputs > verifySelected,
  'absența trebuie să selecteze master/0, iar jurnalul strict numai un commit existent ancestor și modul 1')
  assert.doesNotMatch(selector.slice(sourceAncestor, recoveryCommit), /\|\|\s*true/)

  const gate = step('Leaga imaginea gate de sursa Constructor')
  assert.match(workflow,
    /control:\n[\s\S]*?timeout-minutes: 90[\s\S]*?Leaga imaginea gate de sursa Constructor/)
  assert.match(gate,
    /case "\$UPGRADE_RECOVERY" in[\s\S]*0\) \[ "\$commit" = "\$remote_master" \][\s\S]*1\) git merge-base --is-ancestor "\$commit" "\$remote_master"/)
  assert.match(gate,
    /gate_deadline=\$SECONDS[\s\S]*configure-constructor[\s\S]*SECONDS \+ 1800[\s\S]*sleep 20/)
  assert.match(gate,
    /actions\/workflows\/build-images\.yml\/runs"[\s\\]*-f event=workflow_run -f status=completed -f head_sha="\$commit" -f per_page=100/)
  assert.match(gate,
    /build_matches=[\s\S]*head_sha == \$sha[\s\S]*head_branch == "master"[\s\S]*event == "workflow_run"[\s\S]*conclusion == "success"[\s\S]*head_repository\.full_name == \$repo/)
  assert.match(gate, /\[ "\$build_matches" -le 1 \]/)
  assert.match(gate, /\[ "\$artifact_matches" -le 1 \]/)
  assert.match(gate, /\[ "\$entries" = \$'codex-gates\.json\\nimages\.json' \]/)
  assert.match(gate,
    /keys == \["commit", "image", "schema", "sourceRunId"\][\s\S]*\.schema == 1[\s\S]*\.commit == \$commit/)
  assert.match(gate,
    /\.event == "push"[\s\S]*\.conclusion == "success"[\s\S]*\.repository\.full_name == \$repo[\s\S]*pr-verify\.yml/)
  assert.match(gate, /latest_master=.*git\/ref\/heads\/master[\s\S]*\[ "\$latest_master" = "\$remote_master" \]/)
  const upgradeStep = step('Actualizeaza atomic Constructorul in-place')
  assert.match(upgradeStep,
    /\[ "\$source_commit" = "\$UPGRADE_SOURCE_COMMIT" \][\s\S]*\[ "\$\(git rev-parse origin\/master\)" = "\$UPGRADE_MASTER_COMMIT" \]/)
  assert.match(upgradeStep,
    /case "\$UPGRADE_RECOVERY" in 0\|1\) ;; \*\) exit 1 ;; esac/)
  assert.match(upgradeStep,
    /if \[ "\$UPGRADE_RECOVERY" = 0 \]; then[\s\S]*\[ "\$bundle_commit" = "\$latest_master" \][\s\S]*else[\s\S]*git merge-base --is-ancestor "\$bundle_commit" "\$latest_master"/)
  assert.match(upgradeStep,
    /KELION_CONSTRUCTOR_RECOVERY="\$recovery"[\s\\]*KELION_CONSTRUCTOR_SOURCE_COMMIT="\$source_commit"/)
})

test('scriptul upgrade leagă modul fresh/recovery de prezența jurnalului și de commitul selectat', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  assert.match(upgrade,
    /constructor_upgrade_recovery=\$\{KELION_CONSTRUCTOR_RECOVERY:-invalid\}[\s\S]*\[\[ "\$constructor_upgrade_recovery" =~ \^\[01\]\$ \]\]/)
  const modeBranch = upgrade.indexOf('if [ "$constructor_upgrade_recovery" = 0 ]; then')
  const publicationLock = upgrade.lastIndexOf('flock -n 9', modeBranch)
  const freshAbsence = upgrade.indexOf('[ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ]', modeBranch)
  const snapshot = upgrade.indexOf('create_upgrade_snapshot', freshAbsence)
  const recoveryPresence = upgrade.indexOf('[ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]', snapshot)
  const load = upgrade.indexOf('load_upgrade_journal', recoveryPresence)
  assert.ok(publicationLock >= 0 && modeBranch > publicationLock && freshAbsence > modeBranch && snapshot > freshAbsence
    && recoveryPresence > snapshot && load > recoveryPresence,
  'fresh trebuie să ceară jurnal absent și să-l creeze; recovery trebuie să ceară jurnal prezent înainte de load')
  const loader = shellFunction(upgrade, 'load_upgrade_journal')
  assert.match(loader, /--arg commit "\$constructor_upgrade_source_commit"[\s\S]*\.sourceCommit == \$commit/)
  assert.match(loader,
    /\[ "\$\(sha256sum "\$state_file" \| awk '\{print \$1\}'\)" = "\$snapshot_state_sha256" \]/)
})

test('upgrade-ul Constructor păstrează un jurnal exterior durabil și rămâne quiesced până la generația completă', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  const arrayValues = (name) => {
    const match = upgrade.match(new RegExp(`${name}=\\(\\n([\\s\\S]*?)\\n\\)`))
    assert.ok(match, `vectorul ${name} lipsește`)
    return match[1].trim().split(/\r?\n/).map((line) => line.trim())
  }
  assert.deepEqual(arrayValues('constructor_markers'), [
    '/etc/kelion/codex-worker.enabled',
    '/etc/kelion/constructor-publisher.enabled',
    '/etc/kelion/constructor-release.enabled',
  ])
  assert.deepEqual(arrayValues('constructor_timers'), [
    'kelion-codex-worker.timer',
    'kelion-constructor-publisher.timer',
    'kelion-constructor-release.timer',
  ])
  assert.deepEqual(arrayValues('constructor_services'), [
    'kelion-codex-worker.service',
    'kelion-constructor-publisher.service',
    'kelion-constructor-release.service',
  ])
  assert.match(upgrade, /UPGRADE_JOURNAL=\$RUNTIME_ROOT\/constructor-upgrade\.journal/)

  const liveVector = shellFunction(upgrade, 'validate_live_activation_vector')
  assert.match(liveVector,
    /if \[ "\$present" = 1 \]; then[\s\S]*"\$unit_file_state" = enabled[\s\S]*"\$active_state" = active[\s\S]*else[\s\S]*"\$unit_file_state" = disabled[\s\S]*"\$active_state" = inactive/)
  assert.match(liveVector,
    /constructor_markers\[2\][\s\S]*constructor_markers\[0\][\s\S]*constructor_markers\[1\][\s\S]*constructor_markers\[1\][\s\S]*constructor_markers\[0\]/,
    'vectorii activi acceptați trebuie să fie prefixele canonice worker, publisher, release')

  const snapshot = shellFunction(upgrade, 'create_upgrade_snapshot')
  const snapshotFileFsync = snapshot.indexOf('fsync_path "$snapshot_root/marker.$index"')
  const snapshotStateFsync = snapshot.indexOf('fsync_path "$state_file"', snapshotFileFsync)
  const snapshotRootFsync = snapshot.indexOf('fsync_path "$snapshot_root"', snapshotStateFsync)
  const snapshotHash = snapshot.indexOf('snapshot_state_sha256=$(sha256sum "$state_file"', snapshotRootFsync)
  const armedJournal = snapshot.indexOf('write_upgrade_journal armed', snapshotHash)
  assert.ok(snapshotFileFsync >= 0 && snapshotStateFsync > snapshotFileFsync
    && snapshotRootFsync > snapshotStateFsync && snapshotHash > snapshotRootFsync
    && armedJournal > snapshotHash,
  'copiile, starea și directorul snapshotului trebuie fsync înaintea jurnalului armed')

  const journalWriter = shellFunction(upgrade, 'write_upgrade_journal')
  assert.match(journalWriter, /case "\$phase" in armed\|installed\|committed\) ;; \*\) return 1 ;; esac/)
  assert.match(journalWriter,
    /schema:1,kind:"constructor-upgrade",phase:\$phase,sourceCommit:\$sourceCommit,[\s\S]*snapshotRoot:\$snapshotRoot,stateSha256:\$stateSha256/)
  const journalFsync = journalWriter.indexOf('fsync_path "$temporary"')
  const journalMove = journalWriter.indexOf('mv -f -- "$temporary" "$UPGRADE_JOURNAL"', journalFsync)
  const journalRootFsync = journalWriter.indexOf('fsync_path "$RUNTIME_ROOT"', journalMove)
  assert.ok(journalFsync >= 0 && journalMove > journalFsync && journalRootFsync > journalMove)

  const journalLoader = shellFunction(upgrade, 'load_upgrade_journal')
  assert.match(journalLoader,
    /\.schema == 1 and \.kind == "constructor-upgrade"[\s\S]*\(\.phase == "armed" or \.phase == "installed" or \.phase == "committed"\)[\s\S]*\.sourceCommit == \$commit/)
  assert.match(journalLoader,
    /keys == \["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"\]/)
  assert.match(journalLoader, /sha256sum "\$state_file"[\s\S]*snapshot_state_sha256/)
  assert.match(journalLoader, /\[ "\$\{#snapshot_lines\[@\]\}" -eq 6 \]/)
  assert.match(journalLoader,
    /"\$first" = "\$\{snapshot_marker_present\[\$index\]\}"[\s\S]*"\$second" = "\$\{snapshot_marker_present\[\$index\]\}"/,
    'snapshotul autentificat trebuie să lege marker == timer enabled == timer active')

  const installedProof = shellFunction(upgrade, 'validate_installed_generation_quiesced')
  assert.match(installedProof, /cmp -s -- "\$repo_root\/deploy\/codex-worker\.mjs" \/opt\/kelion-codex\/codex-worker\.mjs/)
  assert.match(installedProof, /\[ ! -e "\$READY_STAMP" \] && \[ ! -L "\$READY_STAMP" \]/)
  assert.match(installedProof, /for marker in "\$\{constructor_markers\[@\]\}"[\s\S]*\[ ! -e "\$marker" \]/)
  assert.match(installedProof, /UnitFileState --value\)" = disabled[\s\S]*inactive\|failed/)
  assert.match(installedProof, /validate_service_quiescence/)

  const main = upgrade.slice(upgrade.lastIndexOf('[ -d "$ROOT" ]'))
  const publicationLock = main.indexOf('flock -n 9')
  const createSnapshot = main.indexOf('create_upgrade_snapshot', publicationLock)
  const loadArmed = main.indexOf('load_upgrade_journal', createSnapshot)
  const installer = main.indexOf('bash "$repo_root/deploy/instaleaza-constructor.sh"', loadArmed)
  const proveInstalled = main.indexOf('validate_installed_generation_quiesced', installer)
  const commitInstalled = main.indexOf('write_upgrade_journal installed', proveInstalled)
  const strictCutover = main.indexOf('strict_constructor_config_recommit', commitInstalled)
  const proveCommittedQuiesced = main.indexOf('validate_committed_activation_vector_quiesced', strictCutover)
  const commitCommitted = main.indexOf('write_upgrade_journal committed', proveCommittedQuiesced)
  const loadCommitted = main.indexOf('load_upgrade_journal', commitCommitted)
  const quiesceCommitted = main.indexOf('quiesce_committed_activation', loadCommitted)
  const reproveCommittedQuiesced = main.indexOf('validate_committed_activation_vector_quiesced', quiesceCommitted)
  const finalizeCommitted = main.indexOf('finalize_committed_activation', reproveCommittedQuiesced)
  const proveRestored = main.indexOf('validate_restored_activation_vector', finalizeCommitted)
  const workerHash = main.indexOf('worker_sha256=$(sha256sum', proveRestored)
  const clearOuter = main.indexOf('clear_upgrade_transaction', workerHash)
  assert.ok(publicationLock >= 0 && createSnapshot > publicationLock && loadArmed > createSnapshot
    && installer > loadArmed && proveInstalled > installer && commitInstalled > proveInstalled
    && strictCutover > commitInstalled && proveCommittedQuiesced > strictCutover
    && commitCommitted > proveCommittedQuiesced && loadCommitted > commitCommitted
    && quiesceCommitted > loadCommitted && reproveCommittedQuiesced > quiesceCommitted
    && finalizeCommitted > reproveCommittedQuiesced && proveRestored > finalizeCommitted
    && workerHash > proveRestored && clearOuter > workerHash,
  'jurnalul exterior trebuie să încadreze installerul roll-forward, cutover-ul strict și dovada exactă finală')
  assert.match(main.slice(loadArmed, installer), /\[ "\$upgrade_phase" = armed \]/)
  assert.match(main.slice(loadArmed, installer), /KELION_CONSTRUCTOR_SOURCE_COMMIT="\$constructor_upgrade_source_commit"/)
  assert.doesNotMatch(shellFunction(upgrade, 'report_constructor_upgrade_failure'),
    /clear_upgrade_transaction|rm -f -- "\$UPGRADE_JOURNAL"|rm -rf[^\n]*constructor-upgrade/,
    'un eșec trebuie să păstreze jurnalul exterior și snapshotul pentru retry autentificat')
})

test('faza committed precede orice activare și recuperează idempotent un SIGKILL după primul timer', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const bootUnit = read('deploy/systemd/kelion-runtime-config-recovery.service')
  const main = upgrade.slice(upgrade.lastIndexOf('[ -d "$ROOT" ]'))
  const installedBranch = main.indexOf('if [ "$upgrade_phase" = installed ]; then')
  const strictRecommit = main.indexOf('strict_constructor_config_recommit', installedBranch)
  const quiescedProof = main.indexOf('validate_committed_activation_vector_quiesced', strictRecommit)
  const committedWrite = main.indexOf('write_upgrade_journal committed', quiescedProof)
  const committedLoad = main.indexOf('load_upgrade_journal', committedWrite)
  const committedEntry = main.indexOf('[ "$upgrade_phase" = committed ]', committedLoad)
  const retryQuiesce = main.indexOf('quiesce_committed_activation', committedEntry)
  const retryQuiescedProof = main.indexOf('validate_committed_activation_vector_quiesced', retryQuiesce)
  const retryCommittedWrite = main.indexOf('write_upgrade_journal committed', retryQuiescedProof)
  const retryCommittedLoad = main.indexOf('load_upgrade_journal', retryCommittedWrite)
  const clearControllerPending = main.indexOf('clear_upgrade_activation_pending', retryCommittedLoad)
  const firstActivation = main.indexOf('finalize_committed_activation', clearControllerPending)
  const exactProof = main.indexOf('validate_restored_activation_vector', firstActivation)
  const workerHashProof = main.indexOf('worker_sha256=$(sha256sum', exactProof)
  const clear = main.indexOf('clear_upgrade_transaction', exactProof)
  const controllerStart = main.indexOf('start_model_controller_after_upgrade_commit', clear)
  const clearDisarm = main.indexOf('activation_restore_started=0', controllerStart)
  assert.ok(installedBranch >= 0 && strictRecommit > installedBranch && quiescedProof > strictRecommit
    && committedWrite > quiescedProof && committedLoad > committedWrite
    && committedEntry > committedLoad && retryQuiesce > committedEntry
    && retryQuiescedProof > retryQuiesce && retryCommittedWrite > retryQuiescedProof
    && retryCommittedLoad > retryCommittedWrite && clearControllerPending > retryCommittedLoad
    && firstActivation > clearControllerPending
    && exactProof > firstActivation && workerHashProof > exactProof
    && clear > workerHashProof && controllerStart > clear && clearDisarm > controllerStart,
  'fiecare retry republică committed sub quiesce, păstrează markerul peste clear-ul outer și dezarmează cleanup numai după controller')
  assert.doesNotMatch(main.slice(strictRecommit, committedWrite),
    /finalize_committed_activation|validate_restored_activation_vector|systemctl\s+(?:enable|start)|publish_runtime_ready_stamp/)

  const journalWriter = shellFunction(upgrade, 'write_upgrade_journal')
  const fileFsync = journalWriter.indexOf('fsync_path "$temporary"')
  const journalMove = journalWriter.indexOf('mv -f -- "$temporary" "$UPGRADE_JOURNAL"', fileFsync)
  const directoryFsync = journalWriter.indexOf('fsync_path "$RUNTIME_ROOT"', journalMove)
  assert.ok(fileFsync >= 0 && journalMove > fileFsync && directoryFsync > journalMove,
    'write committed revine numai după fsync(file), rename și fsync(runtime root)')

  const recommit = shellFunction(upgrade, 'strict_constructor_config_recommit')
  const recommitHelperCalls = recommit.match(/^\s*"\$helper" .*$/gm) ?? []
  assert.equal(recommitHelperCalls.length, 2)
  for (const helperCall of recommitHelperCalls) {
    assert.match(helperCall, /--leave-constructor-quiesced$/,
      'pregătirea din installed nu poate publica ready ori porni timere')
  }
  assert.doesNotMatch(recommit,
    /systemctl\s+(?:enable|start)|publish_runtime_ready_stamp|restore_constructor_timers/)
  const committedVectorProof = shellFunction(upgrade, 'validate_committed_activation_vector_quiesced')
  assert.match(committedVectorProof,
    /\[ ! -e "\$READY_STAMP" \] && \[ ! -L "\$READY_STAMP" \][\s\S]*UnitFileState --value[\s\S]*"\$unit_file_state" = disabled[\s\S]*inactive\|failed/)

  const actualClear = shellFunction(upgrade, 'clear_upgrade_transaction')
  const clearLoad = actualClear.indexOf('load_upgrade_journal')
  const clearCommitted = actualClear.indexOf('[ "$upgrade_phase" = committed ]', clearLoad)
  const clearUnlink = actualClear.indexOf('rm -f -- "$UPGRADE_JOURNAL"', clearCommitted)
  const clearFsync = actualClear.indexOf('fsync_path "$RUNTIME_ROOT"', clearUnlink)
  assert.ok(clearLoad >= 0 && clearCommitted > clearLoad && clearUnlink > clearCommitted && clearFsync > clearUnlink,
    'clear-ul real reautentifică committed și persistă unlink-ul outer înainte de snapshot GC')
  assert.doesNotMatch(actualClear, /activation_restore_started=/,
    'flagul se dezarmează numai în main după dovada exactă, nu în clear')

  const flowEnd = main.indexOf('\nprintf \'{"ok":true,"event":"constructor_upgrade_complete"', clear)
  assert.ok(flowEnd > clear)
  const executableFlow = main.slice(installedBranch, flowEnd)
  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-constructor-committed-'))
  const runtimeRoot = join(sandbox, 'runtime')
  const snapshotRoot = join(runtimeRoot, 'snapshot')
  const journal = join(runtimeRoot, 'constructor-upgrade.journal')
  const state = join(sandbox, 'units.state')
  const expected = join(sandbox, 'expected.state')
  const quiesced = join(sandbox, 'quiesced.state')
  const ready = join(sandbox, 'runtime.ready')
  const crashEvents = join(sandbox, 'crash.events')
  const bootEvents = join(sandbox, 'boot.events')
  const retryEvents = join(sandbox, 'retry.events')
  const renameCrashEvents = join(sandbox, 'rename-crash.events')
  const renameRetryEvents = join(sandbox, 'rename-retry.events')
  const rmFailureEvents = join(sandbox, 'rm-failure.events')
  const fsyncFailureEvents = join(sandbox, 'fsync-failure.events')
  const freshEvents = join(sandbox, 'fresh.events')
  const resurrectedEvents = join(sandbox, 'resurrected.events')
  mkdirSync(snapshotRoot, { recursive: true })
  for (let index = 0; index < 3; index += 1) writeFileSync(join(snapshotRoot, `marker.${index}`), '')
  writeFileSync(join(snapshotRoot, 'state'), 'snapshot\n')
  const quiescedState = [
    'kelion-codex-worker.timer disabled inactive',
    'kelion-constructor-publisher.timer disabled inactive',
    'kelion-constructor-release.timer disabled inactive',
    'kelion-codex-worker.service static inactive',
    'kelion-constructor-publisher.service static inactive',
    'kelion-constructor-release.service static inactive',
  ].join('\n') + '\n'
  const expectedState = [
    'kelion-codex-worker.timer enabled active',
    'kelion-constructor-publisher.timer enabled active',
    'kelion-constructor-release.timer disabled inactive',
    'kelion-codex-worker.service static inactive',
    'kelion-constructor-publisher.service static inactive',
    'kelion-constructor-release.service static inactive',
  ].join('\n') + '\n'
  const committedDocument = {
    schema: 1,
    kind: 'constructor-upgrade',
    phase: 'committed',
    sourceCommit: 'b'.repeat(40),
    snapshotRoot: '/root/kelion/runtime/constructor-upgrade.Harness',
    stateSha256: 'a'.repeat(64),
  }
  writeFileSync(state, quiescedState)
  writeFileSync(quiesced, quiescedState)
  writeFileSync(expected, expectedState)
  writeFileSync(crashEvents, '')
  writeFileSync(bootEvents, '')
  writeFileSync(retryEvents, '')
  writeFileSync(renameCrashEvents, '')
  writeFileSync(renameRetryEvents, '')
  writeFileSync(rmFailureEvents, '')
  writeFileSync(fsyncFailureEvents, '')
  writeFileSync(freshEvents, '')
  writeFileSync(resurrectedEvents, '')

  const harness = `
set -Eeuo pipefail
RUNTIME_ROOT=$HARNESS_RUNTIME_ROOT
UPGRADE_JOURNAL=$HARNESS_JOURNAL
snapshot_root=$HARNESS_SNAPSHOT_ROOT
snapshot_state_sha256=${'a'.repeat(64)}
constructor_upgrade_source_commit=${'b'.repeat(40)}
constructor_markers=(worker publisher release)
activation_restore_started=0
controller_commit_start_started=0
restored_proof=0

event() { printf '%s\\n' "$1" >> "$HARNESS_EVENTS"; }
exit_cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" != 0 ] && [ "$activation_restore_started" = 1 ]; then
    event exit-quiesce
    quiesce_committed_activation
  fi
  exit "$status"
}
trap exit_cleanup EXIT
write_quiesced_state() { command cp "$HARNESS_QUIESCED" "$HARNESS_STATE"; }
write_restored_state() {
  local worker publisher release
  IFS=, read -r worker publisher release <<<"$HARNESS_VECTOR"
  {
    if [ "$worker" = 1 ]; then printf 'kelion-codex-worker.timer enabled active\\n'; else printf 'kelion-codex-worker.timer disabled inactive\\n'; fi
    if [ "$publisher" = 1 ]; then printf 'kelion-constructor-publisher.timer enabled active\\n'; else printf 'kelion-constructor-publisher.timer disabled inactive\\n'; fi
    if [ "$release" = 1 ]; then printf 'kelion-constructor-release.timer enabled active\\n'; else printf 'kelion-constructor-release.timer disabled inactive\\n'; fi
    printf '%s\\n' \\
      'kelion-codex-worker.service static inactive' \\
      'kelion-constructor-publisher.service static inactive' \\
      'kelion-constructor-release.service static inactive'
  } > "$HARNESS_STATE"
}
set_constructor_upgrade_phase() { event "phase:$1"; }
strict_constructor_config_recommit() {
  event strict-quiesce
  command rm -f -- "$HARNESS_READY"
  write_quiesced_state
}
validate_committed_activation_vector_quiesced() {
  [ ! -e "$HARNESS_READY" ]
  command cmp -s -- "$HARNESS_STATE" "$HARNESS_QUIESCED"
  event proof-quiesced
}
write_upgrade_journal() {
  local phase=$1 temporary
  [ "$phase" = committed ]
  temporary=$(mktemp "$RUNTIME_ROOT/.outer.XXXXXX")
  jq -cn \\
    --arg sourceCommit "$constructor_upgrade_source_commit" \\
    --arg snapshotRoot /root/kelion/runtime/constructor-upgrade.Harness \\
    --arg stateSha256 "$snapshot_state_sha256" \\
    '{schema:1,kind:"constructor-upgrade",phase:"committed",sourceCommit:$sourceCommit,
      snapshotRoot:$snapshotRoot,stateSha256:$stateSha256}' > "$temporary"
  command sync -f "$temporary"
  event journal-file-fsync
  command mv -f -- "$temporary" "$UPGRADE_JOURNAL"
  event journal-rename
  if [ "$HARNESS_MODE" = kill-after-rename ]; then kill -KILL "$$"; fi
  command sync -f "$RUNTIME_ROOT"
  event committed-durable
}
load_upgrade_journal() {
  [ -f "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ]
  jq -e --arg commit "$constructor_upgrade_source_commit" '
    .schema == 1 and .kind == "constructor-upgrade" and .phase == "committed" and
    .sourceCommit == $commit and
    (.snapshotRoot | strings | test("^/root/kelion/runtime/constructor-upgrade\\\\.[A-Za-z0-9]+$")) and
    (.stateSha256 | strings | test("^[0-9a-f]{64}$")) and
    (keys == ["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"])
  ' "$UPGRADE_JOURNAL" >/dev/null
  upgrade_phase=$(jq -er '.phase' "$UPGRADE_JOURNAL")
  snapshot_root=$HARNESS_SNAPSHOT_ROOT
  event "load:$upgrade_phase"
}
quiesce_committed_activation() {
  command rm -f -- "$HARNESS_READY"
  event ready-retracted
  event quiesce:kelion-codex-worker.timer
  event quiesce:kelion-constructor-publisher.timer
  event quiesce:kelion-constructor-release.timer
  event quiesce:kelion-codex-worker.service
  event quiesce:kelion-constructor-publisher.service
  event quiesce:kelion-constructor-release.service
  write_quiesced_state
  event quiesce-complete
}
clear_upgrade_activation_pending() {
  event controller-pending-cleared
}
finalize_committed_activation() {
  [ ! -e "$HARNESS_READY" ]
  command cmp -s -- "$HARNESS_STATE" "$HARNESS_QUIESCED"
  event restore-begin
  : > "$HARNESS_READY"
  event ready-published
  printf '%s\\n' \\
    'kelion-codex-worker.timer enabled active' \\
    'kelion-constructor-publisher.timer disabled inactive' \\
    'kelion-constructor-release.timer disabled inactive' \\
    'kelion-codex-worker.service static inactive' \\
    'kelion-constructor-publisher.service static inactive' \\
    'kelion-constructor-release.service static inactive' > "$HARNESS_STATE"
  event timer-start:kelion-codex-worker.timer
  if [ "$HARNESS_MODE" = kill ]; then kill -KILL "$$"; fi
  event timer-start:kelion-constructor-publisher.timer
  write_restored_state
  event restore-complete
}
validate_restored_activation_vector() {
  [ -f "$HARNESS_READY" ]
  command cmp -s -- "$HARNESS_STATE" "$HARNESS_EXPECTED"
  restored_proof=1
  event proof-restored-exact
}
sha256sum() { printf '${'c'.repeat(64)}  %s\\n' "$1"; }
clear_upgrade_transaction() {
  load_upgrade_journal
  [ "$upgrade_phase" = committed ]
  [ "$restored_proof" = 1 ]
  event outer-unlink-attempt
  if [ "$HARNESS_MODE" = rm-fail ]; then
    event outer-unlink-failed
    return 90
  fi
  command rm -f -- "$UPGRADE_JOURNAL"
  event outer-unlink
  if [ "$HARNESS_MODE" = fsync-fail ]; then
    event outer-dir-fsync-failed
    return 91
  fi
  command sync -f "$RUNTIME_ROOT"
  event outer-dir-fsync
}
start_model_controller_after_upgrade_commit() {
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ]
  event controller-start-after-outer-clear
}

boot_ownerless_model() {
  [ "$(jq -er '.phase' "$UPGRADE_JOURNAL")" = committed ]
  event boot-owner:0
  command rm -f -- "$HARNESS_READY"
  event boot-ready-retracted
  event boot-stop-disable:kelion-codex-worker.timer
  event boot-stop-disable:kelion-constructor-publisher.timer
  event boot-stop-disable:kelion-constructor-release.timer
  event boot-stop-disable:kelion-codex-worker.service
  event boot-stop-disable:kelion-constructor-publisher.service
  event boot-stop-disable:kelion-constructor-release.service
  write_quiesced_state
  event boot-quiesce-complete
  event boot-outer-committed-refused
  return 73
}

fresh_snapshot_model() {
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ]
  if [ ! -e "$HARNESS_READY" ]; then
    # Modelează adoptarea markerului reactivation rămas după unlink-ul outer
    # observabil, dar al cărui fsync de director a eșuat.
    write_restored_state
    : > "$HARNESS_READY"
    event orphan-marker-recovered
  fi
  [ -f "$HARNESS_READY" ]
  command cmp -s -- "$HARNESS_STATE" "$HARNESS_EXPECTED"
  event fresh-live-vector-valid
  command cp "$HARNESS_STATE" "$RUNTIME_ROOT/fresh-snapshot.state"
  command sync -f "$RUNTIME_ROOT/fresh-snapshot.state"
  event fresh-snapshot-durable
}

if [ "$HARNESS_MODE" = boot-ownerless ]; then
  set +e
  boot_ownerless_model
  boot_status=$?
  exit "$boot_status"
fi
if [ "$HARNESS_MODE" = fresh-check ]; then
  fresh_snapshot_model
  exit 0
fi
if [ -f "$UPGRADE_JOURNAL" ]; then load_upgrade_journal; else upgrade_phase=installed; fi
${executableFlow}
`
  const runHarness = (mode, events) => spawnSync(bashExecutable, ['-c', harness], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_RUNTIME_ROOT: runtimeRoot,
      HARNESS_JOURNAL: journal,
      HARNESS_SNAPSHOT_ROOT: snapshotRoot,
      HARNESS_STATE: state,
      HARNESS_EXPECTED: expected,
      HARNESS_QUIESCED: quiesced,
      HARNESS_READY: ready,
      HARNESS_VECTOR: '1,1,0',
      HARNESS_EVENTS: events,
      HARNESS_MODE: mode,
    },
  })

  const constructorUnits = [
    'kelion-codex-worker.timer',
    'kelion-constructor-publisher.timer',
    'kelion-constructor-release.timer',
    'kelion-codex-worker.service',
    'kelion-constructor-publisher.service',
    'kelion-constructor-release.service',
  ]

  try {
    const crash = runHarness('kill', crashEvents)
    assert.equal(crash.signal, 'SIGKILL', crash.stderr || crash.stdout)
    assert.deepEqual(JSON.parse(readFileSync(journal, 'utf8')), committedDocument,
      'SIGKILL după primul start trebuie să păstreze schema outer committed exactă')
    const crashLog = readFileSync(crashEvents, 'utf8').trim().split(/\r?\n/)
    const currentQuiescedProof = crashLog.lastIndexOf('proof-quiesced')
    const currentDurable = crashLog.lastIndexOf('committed-durable')
    const restore = crashLog.indexOf('restore-begin')
    const readyPublished = crashLog.indexOf('ready-published')
    const firstTimer = crashLog.indexOf('timer-start:kelion-codex-worker.timer')
    assert.ok(crashLog.filter((entry) => entry === 'committed-durable').length >= 2,
      'fresh-ul trebuie să persiste committed și să îl re-publice la intrarea în ramura committed')
    assert.ok(currentQuiescedProof >= 0 && currentDurable > currentQuiescedProof
      && restore > currentDurable && readyPublished > restore && firstTimer > readyPublished,
    'nici ready, restore sau timer start nu poate preceda re-fsync-ul committed al execuției curente')
    assert.equal(crashLog.includes('outer-unlink'), false)

    const boot = runHarness('boot-ownerless', bootEvents)
    assert.equal(boot.status, 73, boot.stderr || boot.stdout)
    assert.deepEqual(JSON.parse(readFileSync(journal, 'utf8')), committedDocument,
      'boot-ul ownerless trebuie să păstreze outer journal committed pentru retry-ul pin-uit')
    const bootLog = readFileSync(bootEvents, 'utf8').trim().split(/\r?\n/)
    const bootReady = bootLog.indexOf('boot-ready-retracted')
    const bootComplete = bootLog.indexOf('boot-quiesce-complete')
    const bootRefusal = bootLog.indexOf('boot-outer-committed-refused')
    assert.ok(bootReady >= 0 && bootComplete > bootReady && bootRefusal > bootComplete)
    for (const unit of constructorUnits) {
      const stopped = bootLog.indexOf(`boot-stop-disable:${unit}`)
      assert.ok(stopped > bootReady && stopped < bootRefusal,
        `boot ownerless trebuie să oprească/dezactiveze ${unit} înainte de refuz`)
    }
    assert.doesNotMatch(bootLog.join('\n'), /restore-begin|ready-published|timer-start|outer-unlink/)
    assert.equal(readFileSync(state, 'utf8'), quiescedState)

    const retry = runHarness('retry', retryEvents)
    assert.equal(retry.status, 0, retry.stderr || retry.stdout)
    const retryLog = readFileSync(retryEvents, 'utf8').trim().split(/\r?\n/)
    const retryQuiescedProof = retryLog.indexOf('proof-quiesced')
    const retryDurable = retryLog.indexOf('committed-durable')
    const retryRestore = retryLog.indexOf('restore-begin')
    const retryProof = retryLog.indexOf('proof-restored-exact')
    const retryUnlink = retryLog.indexOf('outer-unlink')
    const retryFsync = retryLog.indexOf('outer-dir-fsync')
    assert.ok(retryLog.indexOf('ready-retracted') >= 0)
    for (const unit of constructorUnits) {
      const stopped = retryLog.indexOf(`quiesce:${unit}`)
      assert.ok(stopped >= 0 && stopped < retryRestore, `${unit} trebuie quiesced înainte de retry restore`)
    }
    assert.ok(retryQuiescedProof >= 0 && retryDurable > retryQuiescedProof
      && retryRestore > retryDurable && retryProof > retryRestore
      && retryUnlink > retryProof && retryFsync > retryUnlink,
    'retry-ul re-fsyncuiește committed înainte de restore și îl șterge numai după dovada exactă')
    assert.equal(readFileSync(state, 'utf8'), expectedState)
    assert.equal(existsSync(journal), false)

    writeFileSync(journal, `${JSON.stringify(committedDocument)}\n`)
    const renameCrash = runHarness('kill-after-rename', renameCrashEvents)
    assert.equal(renameCrash.signal, 'SIGKILL', renameCrash.stderr || renameCrash.stdout)
    assert.deepEqual(JSON.parse(readFileSync(journal, 'utf8')), committedDocument,
      'rename-ul pre-dir-fsync poate lăsa vizibil numai un document committed strict')
    const renameCrashLog = readFileSync(renameCrashEvents, 'utf8').trim().split(/\r?\n/)
    const renameQuiescedProof = renameCrashLog.indexOf('proof-quiesced')
    const renameFileFsync = renameCrashLog.indexOf('journal-file-fsync')
    const renameVisible = renameCrashLog.indexOf('journal-rename')
    assert.ok(renameQuiescedProof >= 0 && renameFileFsync > renameQuiescedProof
      && renameVisible > renameFileFsync)
    assert.doesNotMatch(renameCrashLog.join('\n'),
      /committed-durable|restore-begin|ready-published|timer-start|outer-unlink/,
      'crash-ul dintre rename și dir-fsync nu poate activa sau declara committed durabil')
    assert.equal(readFileSync(state, 'utf8'), quiescedState)
    assert.equal(existsSync(ready), false)

    const renameRetry = runHarness('retry', renameRetryEvents)
    assert.equal(renameRetry.status, 0, renameRetry.stderr || renameRetry.stdout)
    const renameRetryLog = readFileSync(renameRetryEvents, 'utf8').trim().split(/\r?\n/)
    const renameRetryProofQuiesced = renameRetryLog.indexOf('proof-quiesced')
    const renameRetryFileFsync = renameRetryLog.indexOf('journal-file-fsync')
    const renameRetryVisible = renameRetryLog.indexOf('journal-rename')
    const renameRetryDurable = renameRetryLog.indexOf('committed-durable')
    const renameRetryRestore = renameRetryLog.indexOf('restore-begin')
    const renameRetryExact = renameRetryLog.indexOf('proof-restored-exact')
    const renameRetryUnlink = renameRetryLog.indexOf('outer-unlink')
    assert.ok(renameRetryProofQuiesced >= 0
      && renameRetryFileFsync > renameRetryProofQuiesced
      && renameRetryVisible > renameRetryFileFsync
      && renameRetryDurable > renameRetryVisible
      && renameRetryRestore > renameRetryDurable
      && renameRetryExact > renameRetryRestore
      && renameRetryUnlink > renameRetryExact,
    'retry-ul după crash pre-dir-fsync trebuie să re-publice și să re-fsyncuiească committed înainte de activare')
    assert.equal(readFileSync(state, 'utf8'), expectedState)
    assert.equal(existsSync(ready), true)
    assert.equal(existsSync(journal), false)

    const rmFailure = runHarness('rm-fail', rmFailureEvents)
    assert.equal(rmFailure.status, 90, rmFailure.stderr || rmFailure.stdout)
    assert.deepEqual(JSON.parse(readFileSync(journal, 'utf8')), committedDocument,
      'eșecul unlink trebuie să păstreze outer committed pentru retry pin-uit')
    const rmFailureLog = readFileSync(rmFailureEvents, 'utf8').trim().split(/\r?\n/)
    const rmFailureProof = rmFailureLog.indexOf('proof-restored-exact')
    const rmFailureAttempt = rmFailureLog.indexOf('outer-unlink-attempt')
    const rmFailed = rmFailureLog.indexOf('outer-unlink-failed')
    assert.ok(rmFailureProof >= 0 && rmFailureAttempt > rmFailureProof && rmFailed > rmFailureAttempt)
    assert.equal(rmFailureLog.includes('outer-unlink'), false)
    assert.equal(rmFailureLog.includes('exit-quiesce'), true,
      'outer-ul rămas autorizează cleanup-ul să retragă fail-closed vectorul după unlink eșuat')
    assert.equal(readFileSync(state, 'utf8'), quiescedState)
    assert.equal(existsSync(ready), false)

    rmSync(journal)
    const fsyncFailure = runHarness('fsync-fail', fsyncFailureEvents)
    assert.equal(fsyncFailure.status, 91, fsyncFailure.stderr || fsyncFailure.stdout)
    const fsyncFailureLog = readFileSync(fsyncFailureEvents, 'utf8').trim().split(/\r?\n/)
    const fsyncFailureProof = fsyncFailureLog.indexOf('proof-restored-exact')
    const fsyncFailureUnlink = fsyncFailureLog.indexOf('outer-unlink')
    const fsyncFailed = fsyncFailureLog.indexOf('outer-dir-fsync-failed')
    assert.ok(fsyncFailureProof >= 0 && fsyncFailureUnlink > fsyncFailureProof
      && fsyncFailed > fsyncFailureUnlink)
    assert.equal(fsyncFailureLog.includes('exit-quiesce'), true,
      'markerul reactivation rămas permite retragerea fail-closed chiar dacă outer-ul nu mai este vizibil')
    assert.equal(existsSync(journal), false)
    assert.equal(existsSync(ready), false)
    assert.equal(readFileSync(state, 'utf8'), quiescedState)

    const fresh = runHarness('fresh-check', freshEvents)
    assert.equal(fresh.status, 0, fresh.stderr || fresh.stdout)
    assert.deepEqual(readFileSync(freshEvents, 'utf8').trim().split(/\r?\n/),
      ['orphan-marker-recovered', 'fresh-live-vector-valid', 'fresh-snapshot-durable'],
      'outer absent după fsync eșuat trebuie să adopte markerul înainte de snapshotul fresh')
    assert.equal(readFileSync(state, 'utf8'), expectedState)
    assert.equal(existsSync(ready), true)

    writeFileSync(journal, `${JSON.stringify(committedDocument)}\n`)
    const resurrected = runHarness('retry', resurrectedEvents)
    assert.equal(resurrected.status, 0, resurrected.stderr || resurrected.stdout)
    const resurrectedLog = readFileSync(resurrectedEvents, 'utf8').trim().split(/\r?\n/)
    const resurrectedQuiescedProof = resurrectedLog.indexOf('proof-quiesced')
    const resurrectedDurable = resurrectedLog.indexOf('committed-durable')
    const resurrectedRestore = resurrectedLog.indexOf('restore-begin')
    const resurrectedExact = resurrectedLog.indexOf('proof-restored-exact')
    const resurrectedUnlink = resurrectedLog.indexOf('outer-unlink')
    for (const unit of constructorUnits) {
      const stopped = resurrectedLog.indexOf(`quiesce:${unit}`)
      assert.ok(stopped >= 0 && stopped < resurrectedRestore,
        `outer committed reapărut trebuie să re-quiesce ${unit} înainte de restore`)
    }
    assert.ok(resurrectedQuiescedProof >= 0 && resurrectedDurable > resurrectedQuiescedProof
      && resurrectedRestore > resurrectedDurable && resurrectedExact > resurrectedRestore
      && resurrectedUnlink > resurrectedExact)
    assert.equal(readFileSync(state, 'utf8'), expectedState)
    assert.equal(existsSync(ready), true)
    assert.equal(existsSync(journal), false)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  assert.match(bootUnit,
    /Environment=KELION_RECOVERY_BOOT=1[\s\S]*ExecStart=\/root\/kelion\/bin\/runtime-config-cutover\.sh --recover-only/)
  const earlyBarrier = shellFunction(cutover, 'early_recover_only_barrier')
  assert.match(earlyBarrier,
    /rm -f -- "\$ready_stamp"[\s\S]*sync -f "\$ready_root"[\s\S]*kelion-codex-worker\.timer[\s\S]*kelion-constructor-release\.service/)
  assert.doesNotMatch(earlyBarrier,
    /systemctl\s+(?:start|enable --now)|publish_runtime_ready_stamp|restore_constructor_timers/)
  const earlyCall = cutover.indexOf('\n  early_recover_only_barrier \\')
  const outerGuard = cutover.indexOf('if [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; then', earlyCall)
  assert.ok(earlyCall >= 0 && outerGuard > earlyCall,
    'boot generic trebuie să execute quiesce-ul fail-closed înainte să întâlnească outer journal')
  assert.match(cutover.slice(outerGuard, cutover.indexOf('\nfsync_path() {', outerGuard)),
    /constructor_upgrade_owner" = 1[\s\S]*\.phase == "armed" or \.phase == "installed" or \.phase == "committed"/,
    'apelantul generic fără owner trebuie refuzat și pentru committed după quiesce')
})

test('cutover-ul final al upgrade-ului restage-uiește numai configul worker byte-identic, fără restart backend', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const recommit = shellFunction(upgrade, 'strict_constructor_config_recommit')
  assert.match(recommit, /config_file=\$CONFIG_ROOT\/codex-worker\.env/)
  assert.match(recommit,
    /--recover-only "\$compose" --leave-constructor-quiesced[\s\S]*restore_snapshot_markers/)
  assert.match(recommit,
    /install -o root -g root -m 0600 "\$config_file" "\$cutover_stage\/files\/constructor-config\.codex-worker\.env"/)
  assert.match(recommit,
    /cmp -s -- "\$config_file" "\$cutover_stage\/files\/constructor-config\.codex-worker\.env"/)
  assert.match(recommit,
    /printf [^\n]*constructor-config\.codex-worker\.env[^\n]*> "\$cutover_stage\/manifest"/)
  assert.match(recommit,
    /fsync_path "\$cutover_stage\/files\/constructor-config\.codex-worker\.env"[\s\S]*fsync_path "\$cutover_stage\/manifest"[\s\S]*fsync_path "\$cutover_stage\/files"[\s\S]*fsync_path "\$cutover_stage"/)
  assert.match(recommit,
    /KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1[\s\\]*KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="\$constructor_upgrade_source_commit"[\s\\]*"\$helper" "\$cutover_stage" "\$compose"/)
  assert.doesNotMatch(recommit,
    /runtime\.env|app-secret|gate-secret|worker-secret|publisher-secret|release-secret|recreate_active_release|systemctl\s+(?:restart|try-restart)/)

  const mapper = shellFunction(cutover, 'map_logical')
  const workerMappingStart = mapper.indexOf('constructor-config.codex-worker.env)')
  const workerMappingEnd = mapper.indexOf('\n    constructor-config.constructor-publisher.env)', workerMappingStart)
  assert.ok(workerMappingStart >= 0 && workerMappingEnd > workerMappingStart)
  const workerMapping = mapper.slice(workerMappingStart, workerMappingEnd)
  assert.match(workerMapping, /mapped_target=\$CONFIG_ROOT\/codex-worker\.env; mapped_mode=640/)
  assert.doesNotMatch(workerMapping, /restart_required=1/)

  const restored = shellFunction(upgrade, 'validate_restored_activation_vector')
  assert.match(restored, /validate_ready_stamp/)
  assert.match(restored, /cmp -s -- "\$repo_root\/deploy\/codex-worker\.mjs" \/opt\/kelion-codex\/codex-worker\.mjs/)
  assert.match(restored,
    /cmp -s -- "\$snapshot_root\/marker\.\$index" "\$marker"/)
  assert.match(restored, /unit_file_state=\$\(systemctl show "\$timer" --property=UnitFileState --value\)/)
  assert.match(restored, /active_state=\$\(systemctl show "\$timer" --property=ActiveState --value\)/)
  assert.match(restored,
    /"\$\{snapshot_timer_enabled\[\$index\]\}" = 1[\s\S]*"\$unit_file_state" = enabled[\s\S]*else[\s\S]*"\$unit_file_state" = disabled/)
  assert.match(restored,
    /"\$\{snapshot_timer_active\[\$index\]\}" = 1[\s\S]*"\$active_state" = active[\s\S]*else[\s\S]*"\$active_state" = inactive/)
  assert.match(restored, /validate_service_quiescence/)
})

test('statusul VPS leagă profilul manual de snapshotul HMAC și de runtime-ul modelului', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  const stepStart = workflow.indexOf('- name: Activeaza etapizat sau raporteaza starea')
  const stepEnd = workflow.indexOf('\n      - name:', stepStart + 1)
  assert.ok(stepStart >= 0 && stepEnd > stepStart, 'pasul de status Constructor trebuie delimitat')
  const remote = workflow.slice(stepStart, stepEnd).replace(/^ {10}/gm, '')
  const snapshotStart = remote.indexOf('constructor_model_snapshot() {')
  const fastInstallStart = remote.indexOf('validate_fast_model_install() {', snapshotStart)
  const powerfulInstallStart = remote.indexOf('validate_powerful_model_install() {', fastInstallStart)
  const dropinStart = remote.indexOf('expected_powerful_status_dropin() {', powerfulInstallStart)
  const validatorStart = remote.indexOf('validate_constructor_model_status() {', dropinStart)
  const statusStart = remote.indexOf('\nstatus() {', validatorStart) + 1
  assert.ok(snapshotStart >= 0 && fastInstallStart > snapshotStart
    && powerfulInstallStart > fastInstallStart && dropinStart > powerfulInstallStart
    && validatorStart > dropinStart && statusStart > validatorStart,
  'dovezile modelului trebuie definite înaintea statusului')

  const snapshot = remote.slice(snapshotStart, fastInstallStart)
  assert.match(snapshot, /systemctl is-active --quiet kelion-constructor-model-control\.service/)
  assert.match(snapshot, /control\.sock[\s\S]*0:10050:660/)
  assert.match(snapshot, /constructor-model-control-secret[\s\S]*0:10050:440:1/)
  assert.match(snapshot, /readServiceSecret, signServiceRequest/)
  assert.match(snapshot, /socketPath[\s\S]*path = '\/v1\/model\/state'[\s\S]*method: 'POST'/)
  assert.match(snapshot, /x-kelion-nonce[\s\S]*x-kelion-signature[\s\S]*x-kelion-timestamp/)
  assert.match(snapshot, /response\.statusCode !== 200[\s\S]*contentType !== 'application\/json'/)

  const fastInstall = remote.slice(fastInstallStart, powerfulInstallStart)
  assert.match(fastInstall, /\.install-complete[\s\S]*installer_id=private-ai-contabo-v1/)
  assert.match(fastInstall, /model\.ready[\s\S]*privateai:privateai:600:1/)
  assert.match(fastInstall, /find "\$model_cache" -xdev -type f -size 20419565568c/)
  assert.match(fastInstall, /privateai:privateai:20419565568:1/)

  const powerfulInstall = remote.slice(powerfulInstallStart, dropinStart)
  assert.match(powerfulInstall, /\.max-model-complete[\s\S]*"\$\{#complete_lines\[@\]\}" -eq 20/)
  assert.match(powerfulInstall, /schema=2[\s\S]*default_model=llama\.cpp\/qwen3\.6-35b-a3b-local/)
  assert.match(powerfulInstall, /powerful_model=llama\.cpp\/qwen3\.5-122b-a10b-local/)
  assert.match(powerfulInstall, /fast_model_path=\$fast_model_path/)
  for (const bytes of ['10943552', '49968146912', '26557874144']) {
    assert.match(powerfulInstall, new RegExp(`root:privateai:440:${bytes}:1`))
  }

  const validator = remote.slice(validatorStart, statusStart)
  assert.match(validator, /private-ai-model-switch\.lock[\s\S]*root:privateai:660:1[\s\S]*flock --shared --wait 30 8/)
  assert.match(validator, /\.model == "llama\.cpp\/qwen3\.6-35b-a3b-local"/)
  assert.match(validator, /\.small_model == "llama\.cpp\/qwen3\.6-35b-a3b-local"/)
  assert.match(validator,
    /models \| keys[\s\S]*\["qwen3\.5-122b-a10b-local", "qwen3\.6-35b-a3b-local"\]/)
  assert.match(validator, /snapshot=\$\(constructor_model_snapshot\)/)
  assert.match(validator, /\.defaultProfile == "fast"[\s\S]*\.installedProfiles == \["fast", "powerful"\]/)
  assert.match(validator, /\.activeProfile == "fast" or \.activeProfile == "powerful"/)
  assert.match(validator, /127\.0\.0\.1:24080\/v1\/models/)
  assert.match(validator, /fast:qwen3\.6-35b-a3b-local\)[\s\S]*"\$web_state" = active[\s\S]*"\$dropins"/)
  assert.match(validator,
    /powerful:qwen3\.5-122b-a10b-local\)[\s\S]*"\$web_state" = inactive[\s\S]*expected_powerful_status_dropin/)
  assert.match(validator, /\/proc\/\$llm_pid\/maps/)

  const status = remote.slice(statusStart, remote.indexOf('\ncase "$operation" in', statusStart))
  assert.match(status, /if validate_constructor_model_status; then[\s\S]*opencode-qwen-local=ready[\s\S]*opencode-qwen-local=required/)
})

test('jurnalul exterior al upgrade-ului blochează fiecare mutator după eliberarea lock-ului la crash', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const deploy = read('deploy/deploy.sh')
  const provision = read('.github/workflows/vps-set-env.yml')
  const control = read('.github/workflows/vps-run.yml')

  const pendingPublisher = shellFunction(upgrade, 'publish_unit_pending')
  const pendingValidation = pendingPublisher.indexOf('validate_unit_pending')
  const pendingMove = pendingPublisher.indexOf('mv -f -- "$temporary" "$UNIT_MIGRATION_PENDING"')
  const pendingFsync = pendingPublisher.indexOf('fsync_path "$RUNTIME_ROOT"', pendingMove)
  const readyRemoval = pendingPublisher.indexOf('rm -f -- "$READY_STAMP"', pendingFsync)
  const readyFsync = pendingPublisher.indexOf('fsync_path "$READY_ROOT"', readyRemoval)
  assert.ok(pendingValidation >= 0 && pendingMove > pendingValidation && pendingFsync > pendingMove
    && readyRemoval > pendingFsync && readyFsync > readyRemoval,
  'pending trebuie autentificat și fsync înainte de unlink+fsync ready; crash-ul nu poate lăsa outer-only fără barieră')

  const deployLock = deploy.indexOf('\nflock 8\n')
  const deployOuterGuard = deploy.indexOf('CONSTRUCTOR_UPGRADE_JOURNAL=', deployLock)
  const deployFirstRecovery = deploy.indexOf('\nrecover_lost_post_ponr_quiesce', deployLock)
  assert.ok(deployLock >= 0 && deployOuterGuard > deployLock && deployFirstRecovery > deployOuterGuard,
    'deploy-ul trebuie să refuze outer journal înaintea primului recovery sau mutator')
  assert.match(deploy.slice(deployOuterGuard, deployFirstRecovery),
    /CONSTRUCTOR_UPGRADE_JOURNAL=\$RUNTIME_ROOT\/constructor-upgrade\.journal[\s\S]*\[ ! -e "\$CONSTRUCTOR_UPGRADE_JOURNAL" \] && \[ ! -L "\$CONSTRUCTOR_UPGRADE_JOURNAL" \]/)

  const provisionRemoteStart = provision.indexOf('          exec 9>/root/kelion/publicare.lock')
  const provisionLock = provision.indexOf('          flock -n 9', provisionRemoteStart)
  const provisionOuterGuard = provision.indexOf('constructor_upgrade_journal=', provisionLock)
  const provisionFirstRecovery = provision.indexOf('KELION_CUTOVER_LOCK_HELD=1 /root/kelion/bin/runtime-config-cutover.sh', provisionLock)
  const provisionFirstInstall = provision.indexOf('          install_atomic ', provisionLock)
  assert.ok(provisionLock >= 0 && provisionOuterGuard > provisionLock
    && provisionFirstRecovery > provisionOuterGuard && provisionFirstInstall > provisionOuterGuard,
  'provisionarea trebuie să refuze outer journal înainte de recovery și de primul install atomic')
  assert.match(provision.slice(provisionOuterGuard, Math.min(provisionFirstRecovery, provisionFirstInstall)),
    /constructor_upgrade_journal=\/root\/kelion\/runtime\/constructor-upgrade\.journal[\s\S]*\[ ! -e "\$constructor_upgrade_journal" \] && \[ ! -L "\$constructor_upgrade_journal" \]/)

  const configureStart = control.indexOf('- name: Configureaza Constructorul fara activare prematura')
  const configureEnd = control.indexOf('\n      - name:', configureStart + 1)
  assert.ok(configureStart >= 0 && configureEnd > configureStart)
  const configure = control.slice(configureStart, configureEnd)
  const configureLock = configure.indexOf('flock -n 9')
  const configureOuterGuard = configure.indexOf('constructor_upgrade_journal=', configureLock)
  const configureFirstRecovery = configure.indexOf('deploy_quiesce_journal=', configureLock)
  assert.ok(configureLock >= 0 && configureOuterGuard > configureLock
    && configureFirstRecovery > configureOuterGuard,
  'configure trebuie să refuze outer journal înainte să recupereze ori să reia installerul')
  assert.match(configure.slice(configureOuterGuard, configureFirstRecovery),
    /constructor_upgrade_journal=\/root\/kelion\/runtime\/constructor-upgrade\.journal[\s\S]*(?:\[ ! -e "\$constructor_upgrade_journal" \] && \[ ! -L "\$constructor_upgrade_journal" \]|if \[ -e "\$constructor_upgrade_journal" \] \|\| \[ -L "\$constructor_upgrade_journal" \]; then[\s\S]*exit 1)/)

  const activationStart = control.indexOf('- name: Activeaza etapizat sau raporteaza starea')
  const activationEnd = control.indexOf('\n      - name:', activationStart + 1)
  assert.ok(activationStart >= 0 && activationEnd > activationStart)
  const activation = control.slice(activationStart, activationEnd)
  const workerStart = activation.indexOf('            activate-worker-publisher)')
  const releaseStart = activation.indexOf('            activate-release)', workerStart)
  const statusStart = activation.indexOf('            constructor-status)', releaseStart)
  assert.ok(workerStart >= 0 && releaseStart > workerStart && statusStart > releaseStart)
  assert.match(activation,
    /constructor_upgrade_journal=\/root\/kelion\/runtime\/constructor-upgrade\.journal/)
  for (const [name, branch] of [
    ['activate-worker-publisher', activation.slice(workerStart, releaseStart)],
    ['activate-release', activation.slice(releaseStart, statusStart)],
  ]) {
    const lock = branch.indexOf('flock -n 9')
    const guard = branch.indexOf('if [ -e "$constructor_upgrade_journal"', lock)
    const recovery = branch.indexOf('recover_activation_preflight', lock)
    assert.ok(lock >= 0 && guard > lock && recovery > guard,
      `${name} trebuie să refuze outer journal după lock și înainte de recovery`)
    assert.match(branch.slice(guard, recovery),
      /if \[ -e "\$constructor_upgrade_journal" \] \|\| \[ -L "\$constructor_upgrade_journal" \]; then[\s\S]*exit 1/)
  }

  assert.match(cutover, /^leave_constructor_quiesced=0$/m)
  const ownerContractStart = cutover.indexOf('constructor_upgrade_owner=${KELION_CONSTRUCTOR_UPGRADE_OWNER:-0}')
  const ownerContractEnd = cutover.indexOf('deploy_owner_request_id=', ownerContractStart)
  assert.ok(ownerContractStart >= 0 && ownerContractEnd > ownerContractStart)
  assert.match(cutover.slice(ownerContractStart, ownerContractEnd),
    /constructor_upgrade_source_commit=\$\{KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT:-\}[\s\S]*if \[ "\$constructor_upgrade_owner" = 1 \]; then[\s\S]*\^\[0-9a-f\]\{40\}\$[\s\S]*else[\s\S]*\[ -z "\$constructor_upgrade_source_commit" \][\s\S]*unset KELION_CONSTRUCTOR_UPGRADE_OWNER[\s\S]*unset KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT/,
    'ownerul trebuie să prezinte un source commit canonic, iar apelantul generic nu poate furniza această capabilitate')
  const runtimeLockContract = cutover.indexOf('if [ "${KELION_CUTOVER_LOCK_HELD:-0}" = 1 ]; then')
  const inheritedFdGuard = cutover.indexOf('[ -f /proc/$$/fd/9 ]', runtimeLockContract)
  const inheritedFdPath = cutover.indexOf('readlink /proc/$$/fd/9', inheritedFdGuard)
  const inheritedFdAcl = cutover.indexOf("stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9", inheritedFdPath)
  const inheritedFdIdentity = cutover.indexOf("publication_fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9)", inheritedFdAcl)
  const inheritedRuntimeLock = cutover.indexOf('flock -n 9', runtimeLockContract)
  const directPathGuard = cutover.indexOf('[ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ]', inheritedRuntimeLock)
  const directFdOpen = cutover.indexOf('exec 9<>"$PUBLICATION_LOCK"', directPathGuard)
  const directFdGuard = cutover.indexOf('[ -f /proc/$$/fd/9 ]', directFdOpen)
  const directFdIdentity = cutover.indexOf("publication_fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9)", directFdGuard)
  const directPathIdentity = cutover.indexOf('[ "$publication_fd_identity" = "$(stat -Lc \'%d:%i\' "$PUBLICATION_LOCK")" ]', directFdIdentity)
  const directRuntimeLock = cutover.indexOf('flock -n 9', inheritedRuntimeLock + 1)
  const postFlockGuard = cutover.indexOf('[ ! -L "$PUBLICATION_LOCK" ]', directRuntimeLock)
  const postFlockPath = cutover.indexOf('readlink /proc/$$/fd/9', postFlockGuard)
  const postFlockIdentity = cutover.indexOf('[ "$publication_fd_identity" = "$(stat -Lc \'%d:%i\' "$PUBLICATION_LOCK")" ]', postFlockPath)
  const earlyBarrierCall = cutover.indexOf('\n  early_recover_only_barrier \\')
  assert.ok(runtimeLockContract >= 0 && inheritedFdGuard > runtimeLockContract
    && inheritedFdPath > inheritedFdGuard && inheritedFdAcl > inheritedFdPath
    && inheritedFdIdentity > inheritedFdAcl && inheritedRuntimeLock > inheritedFdIdentity
    && directPathGuard > inheritedRuntimeLock && directFdOpen > directPathGuard
    && directFdGuard > directFdOpen && directFdIdentity > directFdGuard
    && directPathIdentity > directFdIdentity && directRuntimeLock > directPathIdentity
    && postFlockGuard > directRuntimeLock && postFlockPath > postFlockGuard
    && postFlockIdentity > postFlockPath && earlyBarrierCall > postFlockIdentity,
  'recover-only nu poate retrage ready sau opri unități înainte să dețină publication lock-ul canonic')
  const runtimeUpgradeGuard = cutover.indexOf('if [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; then', directRuntimeLock)
  const runtimePendingGuard = cutover.indexOf('if [ -e "$UNIT_MIGRATION_PENDING" ] || [ -L "$UNIT_MIGRATION_PENDING" ]; then', runtimeUpgradeGuard)
  const runtimeFsyncDefinition = cutover.indexOf('\nfsync_path() {', runtimeUpgradeGuard)
  assert.ok(runtimeUpgradeGuard > earlyBarrierCall && runtimePendingGuard > runtimeUpgradeGuard
    && runtimeFsyncDefinition > runtimePendingGuard,
    'apelantul generic poate doar quiesce fail-closed sub lock înainte ca outer journal să fie autentificat; guardul precede restul cutover-ului')
  assert.match(cutover.slice(runtimeUpgradeGuard, runtimePendingGuard),
    /constructor_upgrade_owner" = 1[\s\S]*KELION_CUTOVER_LOCK_HELD[\s\S]*--arg sourceCommit "\$constructor_upgrade_source_commit"[\s\S]*\.kind == "constructor-upgrade"[\s\S]*\.sourceCommit == \$sourceCommit[\s\S]*\.snapshotRoot[\s\S]*\.stateSha256/)
  assert.match(cutover.slice(runtimePendingGuard, runtimeFsyncDefinition),
    /\[ -f "\$UNIT_MIGRATION_PENDING" \] && \[ ! -L "\$UNIT_MIGRATION_PENDING" \][\s\S]*0:0:600:1[\s\S]*wc -l[\s\S]*grep -qx 'schema=1'/,
    'pending-ul trebuie autentificat înaintea selecției ownerului de recovery')
  assert.doesNotMatch(cutover.slice(earlyBarrierCall, runtimeUpgradeGuard),
    /publish_runtime_ready_stamp|restore_constructor_timers|clear_unit_migration_pending|recover_interrupted|mv -f/,
    'între quiesce-ul serializat și guard nu poate exista recovery, restaurare sau publicare')
  const genericRecoveryStart = cutover.indexOf('if [ "$recover_only" = 1 ]; then',
    cutover.indexOf('trap cleanup_cutover EXIT'))
  const retractReady = cutover.indexOf('retract_runtime_ready_stamp_for_recovery', genericRecoveryStart)
  const quiesceFirst = cutover.indexOf('quiesce_units_for_recovery 1', retractReady)
  const pendingRecoveryStart = cutover.indexOf('if [ "$recover_only" = 1 ]; then', quiesceFirst + 1)
  const validatePending = cutover.indexOf('validate_unit_migration_pending', pendingRecoveryStart)
  const genericPendingBranch = cutover.indexOf('\n    else\n      [ "$leave_constructor_quiesced" = 1 ]',
    cutover.indexOf('if [ -f "$UNIT_MIGRATION_PENDING" ]', validatePending))
  const requireExplicitLeave = cutover.indexOf('[ "$leave_constructor_quiesced" = 1 ]', genericPendingBranch)
  const pendingExit = cutover.indexOf('exit 0', requireExplicitLeave)
  const genericReady = cutover.indexOf('publish_runtime_ready_stamp', pendingExit)
  assert.ok(genericRecoveryStart >= 0 && retractReady > genericRecoveryStart
    && quiesceFirst > retractReady && pendingRecoveryStart > quiesceFirst
    && validatePending > pendingRecoveryStart && genericPendingBranch > validatePending
    && requireExplicitLeave > genericPendingBranch && pendingExit > requireExplicitLeave
    && genericReady > pendingExit,
  'recover-only trebuie să retragă ready, să oprească unitățile și să refuze pending fără --leave înainte de orice ready/start')
  assert.match(cutover.slice(requireExplicitLeave, pendingExit),
    /bariera unit-only blochează boot-ul generic până la cutover-ul strict/)
  assert.doesNotMatch(cutover.slice(genericPendingBranch, pendingExit),
    /clear_unit_migration_pending|publish_runtime_ready_stamp|restore_constructor_timers/)

  for (const genericName of [
    'recover_orphaned_reactivation_before_upgrade',
    'start_model_controller_after_upgrade_commit',
  ]) {
    const genericRecovery = shellFunction(upgrade, genericName)
    const outerAbsent = genericRecovery.indexOf('[ ! -e "$UPGRADE_JOURNAL" ]')
    const markerProof = genericRecovery.indexOf('validate_reactivation_journal')
    const genericCall = genericRecovery.indexOf('KELION_CUTOVER_LOCK_HELD=1 "$helper" --recover-only "$compose"')
    assert.ok(outerAbsent >= 0 && markerProof >= 0 && genericCall > outerAbsent && genericCall > markerProof,
      `${genericName} poate fi ownerless numai după dovada că outer-ul upgrade lipsește`)
    assert.doesNotMatch(genericRecovery, /KELION_CONSTRUCTOR_UPGRADE_OWNER=1/)
  }
  const ownerOnlyUpgrade = upgrade
    .replace(shellFunction(upgrade, 'recover_orphaned_reactivation_before_upgrade'), '')
    .replace(shellFunction(upgrade, 'start_model_controller_after_upgrade_commit'), '')
  const inheritedOwnerCalls = [...ownerOnlyUpgrade.matchAll(/KELION_CUTOVER_LOCK_HELD=1/g)]
  assert.ok(inheritedOwnerCalls.length >= 5)
  for (const call of inheritedOwnerCalls) {
    const ownerCall = ownerOnlyUpgrade.slice(call.index, call.index + 340)
    assert.match(ownerCall, /KELION_CONSTRUCTOR_UPGRADE_OWNER=1/,
      'fiecare helper/installer al upgrade-ului trebuie să poarte ownerul explicit sub lockul moștenit')
    assert.match(ownerCall,
      /KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="\$constructor_upgrade_source_commit"/,
      'fiecare owner moștenit trebuie legat de sourceCommit-ul exact al jurnalului exterior')
  }
})

test('pending-ul unit-only separă refresh-ul quiesced de finalizerul gate-committed', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const deploy = read('deploy/deploy.sh')
  const owner = shellFunction(cutover, 'strict_pending_deploy_recovery_owner')
  assert.match(owner,
    /recover_only" = 1[\s\S]*boot_recovery" = 0[\s\S]*KELION_CUTOVER_LOCK_HELD:-0[\s\S]*validate_deploy_quiesce_journal[\s\S]*deploy_quiesce_owned_by_caller/)
  assert.match(owner,
    /leave_constructor_quiesced" = 1[\s\S]*deploy_quiesce_proof" = 0[\s\S]*phase" = gate-prepared[\s\S]*GATE_JOURNAL[\s\S]*\.commit == \$commit/)
  assert.match(owner,
    /deploy_quiesce_proof" = 1[\s\S]*phase" = gate-committed[\s\S]*! -e "\$GATE_JOURNAL"[\s\S]*deploy_quiesce_generation_proof committed/)
  assert.match(owner,
    /discard_unmutated_gate_prepared" = 1[\s\S]*phase" = gate-prepared[\s\S]*discard_gate_request_id[\s\S]*discard_gate_active_commit/)

  const ownerDefinition = cutover.indexOf('strict_pending_deploy_recovery_owner() {')
  const pendingGuard = cutover.indexOf('if [ -f "$UNIT_MIGRATION_PENDING" ]', ownerDefinition)
  const genericRecovery = cutover.indexOf('if [ "$recover_only" = 1 ]; then',
    cutover.indexOf('trap cleanup_cutover EXIT'))
  assert.ok(ownerDefinition >= 0 && pendingGuard > ownerDefinition && genericRecovery > pendingGuard,
    'ownerul pending trebuie autentificat înaintea oricărui recovery tranzacțional')
  assert.match(cutover.slice(pendingGuard, genericRecovery),
    /constructor_upgrade_owner" != 1[\s\S]*recover_only" = 1[\s\S]*strict_pending_deploy_recovery_owner[\s\S]*die 'bariera unit-only ține recovery-ul generic quiesced până la cutover-ul strict'/)

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-pending-deploy-owner-'))
  try {
    const journal = join(sandbox, 'deploy.journal')
    const gateJournal = join(sandbox, 'gate.journal')
    writeFileSync(journal, '{}\n', { mode: 0o600 })
    const harness = `
validate_deploy_quiesce_journal() { [ "$JOURNAL_VALID" = 1 ]; }
deploy_quiesce_owned_by_caller() {
  [ "$OWNER_VALID" = 1 ] \
    && [ "$deploy_owner_request_id" = "$OUTER_REQUEST" ] \
    && [ "$deploy_owner_commit" = "$OUTER_COMMIT" ]
}
deploy_quiesce_generation_proof() { [ "\${1:-}" = "$PROOF_SCOPE" ]; }
stat() { printf '0:0:600:1\\n'; }
jq() {
  if [ "\${1:-}" = -er ] && [ "\${2:-}" = .phase ]; then printf '%s\\n' "$PHASE"; return 0; fi
  local request='' commit='' active=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --arg ] && [ "$#" -ge 3 ]; then
      case "$2" in
        requestId) request=$3 ;;
        commit) commit=$3 ;;
        active) active=$3 ;;
      esac
      shift 3
    else
      shift
    fi
  done
  [ -z "$request" ] || [ "$request" = "$OUTER_REQUEST" ] || return 1
  [ -z "$commit" ] || [ "$commit" = "$OUTER_COMMIT" ] || return 1
  [ -z "$active" ] || [ "$active" = "$OUTER_ACTIVE" ] || return 1
}
${owner}
strict_pending_deploy_recovery_owner`
    const runOwner = ({ phase = 'gate-prepared', recover = 1, leave = 1, proof = 0,
      boot = 0, inherited = 1, journalValid = 1, ownerValid = 1, gate = true,
      special = 0, proofScope = 'committed',
      ownerRequest = 'ebf1d8cb-ecdc-4b8b-b98e-c053269af5d3',
      ownerCommit = 'aadb55932d41ac26635df90028276e25ba9f51af',
      discardRequest = 'ebf1d8cb-ecdc-4b8b-b98e-c053269af5d3',
      discardCommit = 'aadb55932d41ac26635df90028276e25ba9f51af',
      discardActive = '10c7ce5b06307e953db9184f0ecb57e6ca60ad38' } = {}) => {
      if (gate) writeFileSync(gateJournal, '{}\n', { mode: 0o600 })
      else rmSync(gateJournal, { force: true })
      return spawnSync(bashExecutable, ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PHASE: phase,
        recover_only: String(recover),
        leave_constructor_quiesced: String(leave),
        deploy_quiesce_proof: String(proof),
        boot_recovery: String(boot),
        KELION_CUTOVER_LOCK_HELD: String(inherited),
        DEPLOY_QUIESCE_JOURNAL: journal,
        GATE_JOURNAL: gateJournal,
        JOURNAL_VALID: String(journalValid),
        OWNER_VALID: String(ownerValid),
        PROOF_SCOPE: proofScope,
        OUTER_REQUEST: 'ebf1d8cb-ecdc-4b8b-b98e-c053269af5d3',
        OUTER_COMMIT: 'aadb55932d41ac26635df90028276e25ba9f51af',
        OUTER_ACTIVE: '10c7ce5b06307e953db9184f0ecb57e6ca60ad38',
        discard_unmutated_gate_prepared: String(special),
        deploy_owner_request_id: ownerRequest,
        deploy_owner_commit: ownerCommit,
        discard_gate_request_id: discardRequest,
        discard_gate_commit: discardCommit,
        discard_gate_active_commit: discardActive,
      },
    })
    }
    const prepared = runOwner()
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout)
    const committed = runOwner({ phase: 'gate-committed', leave: 0, proof: 1, gate: false })
    assert.equal(committed.status, 0, committed.stderr || committed.stdout)
    const incident = runOwner({ leave: 0, proof: 1, special: 1 })
    assert.equal(incident.status, 0, incident.stderr || incident.stdout)
    for (const denied of [
      { phase: 'gate-committed' },
      { phase: 'gate-committed', leave: 0, proof: 0, gate: false },
      { phase: 'gate-committed', leave: 0, proof: 1, gate: true },
      { phase: 'gate-prepared', leave: 0, proof: 1, gate: false },
      { boot: 1 },
      { inherited: 0 },
      { journalValid: 0 },
      { ownerValid: 0 },
      { leave: 0, proof: 1, special: 1, ownerRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { leave: 0, proof: 1, special: 1, ownerCommit: 'b'.repeat(40) },
      { leave: 0, proof: 1, special: 1, discardRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { leave: 0, proof: 1, special: 1, discardCommit: 'b'.repeat(40) },
      { leave: 0, proof: 1, special: 1, discardActive: 'c'.repeat(40) },
    ]) assert.notEqual(runOwner(denied).status, 0, JSON.stringify(denied))
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  const refreshStart = deploy.indexOf('refresh_constructor_gate() (')
  const refreshEnd = deploy.indexOf('\n)\nif [ "$resume_after_gate_commit"', refreshStart)
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart)
  const refresh = deploy.slice(refreshStart, refreshEnd)
  const helperCalls = [...refresh.matchAll(/"\$ROOT\/bin\/runtime-config-cutover\.sh" --recover-only "\$ROOT\/config\/compose\.production\.yml" --leave-constructor-quiesced/g)]
  assert.equal(helperCalls.length, 2, 'refresh-ul și cleanup-ul lui trebuie să folosească același recovery strict')
  for (const call of helperCalls) {
    const prefix = refresh.slice(Math.max(0, call.index - 320), call.index)
    assert.match(prefix, /KELION_CUTOVER_LOCK_HELD=1[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="\$KELION_RELEASE_REQUEST_ID"[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_COMMIT="\$COMMIT_SHA"/)
  }

  const proof = shellFunction(cutover, 'deploy_quiesce_generation_proof')
  assert.match(proof, /proof_configs=\([\s\S]*codex-worker\.env[\s\S]*constructor-publisher\.env[\s\S]*constructor-release\.env[\s\S]*\)/)
  assert.equal((proof.match(/for index in "\$\{!proof_configs\[@\]\}"/g) ?? []).length, 2,
    'ambele generații trebuie să verifice explicit toate cele trei configuri gate')
  const restore = shellFunction(deploy, 'restore_constructor_after_release')
  assert.match(restore,
    /KELION_DEPLOY_QUIESCE_PROOF=1[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID[\s\S]*--recover-only[^\n]*compose\.production\.yml/)
})

test('recovery-ul incidentului gate-prepared retrage numai jurnalul și txn nemutate înainte de finalizare', () => {
  const cutover = read('deploy/lib/runtime-config-cutover.sh')
  const discard = shellFunction(cutover, 'discard_unmutated_gate_prepared_refresh')
  const validateTxn = shellFunction(cutover, 'validate_unmutated_gate_transaction')
  const withdrawTxn = shellFunction(cutover, 'withdraw_gate_transaction_durably')
  const removeTombstone = shellFunction(cutover, 'remove_discarded_gate_tombstone')
  const validateTombstone = shellFunction(cutover, 'validate_discarded_gate_tombstone')
  const validateGateGc = shellFunction(cutover, 'validate_discarded_gate_gc')
  const removeGateGc = shellFunction(cutover, 'remove_discarded_gate_gc')
  const strictQuiesce = shellFunction(cutover, 'validate_live_constructor_units_quiesced')
  const clearOuterJournal = shellFunction(cutover, 'clear_deploy_quiesce_journal')
  assert.match(discard,
    /phase == "gate-prepared"[\s\S]*activeBefore == \$active[\s\S]*deploy_quiesce_generation_proof old[\s\S]*validate_live_constructor_units_quiesced/)
  assert.match(discard,
    /validate_unmutated_gate_transaction "\$gate_root" "\$helper_sha"[\s\S]*rm -f -- "\$GATE_JOURNAL"[\s\S]*fsync_path "\$RUNTIME_ROOT"[\s\S]*withdraw_gate_transaction_durably "\$gate_root" "\$failed_commit"/)
  assert.match(discard,
    /keys \| sort[\s\S]*gateSha256[\s\S]*targetGateSha256[\s\S]*requestId == \$requestId[\s\S]*commit == \$commit[\s\S]*activeBefore == \$active/)
  assert.match(validateTxn,
    /recovery-helper\.sh[\s\S]*recovery-compose\.yml[\s\S]*cmp -s[\s\S]*helper_sha[\s\S]*expected_helper_sha/)
  assert.match(validateTxn,
    /codex-worker\.env[\s\S]*constructor-publisher\.env[\s\S]*constructor-release\.env/)
  assert.match(validateTxn,
    /targetGateSha256\[\$key\][\s\S]*sha256sum "\$source"[\s\S]*"\$actual" = "\$expected"/)
  const unlinkGate = discard.indexOf('rm -f -- "$GATE_JOURNAL"')
  const fsyncGate = discard.indexOf('fsync_path "$RUNTIME_ROOT"', unlinkGate)
  const withdrawGate = discard.indexOf('withdraw_gate_transaction_durably "$gate_root" "$failed_commit"', fsyncGate)
  assert.ok(unlinkGate >= 0 && fsyncGate > unlinkGate && withdrawGate > fsyncGate,
    'jurnalul gate trebuie retras și fsync-uit înaintea retragerii tranzacției')
  assert.match(withdrawTxn,
    /sha256sum "\$gate_root\/recovery-helper\.sh"[\s\S]*constructor-gate-discarded\.\$failed_commit\.\$helper_sha[\s\S]*validate_unmutated_gate_transaction "\$gate_root" "\$helper_sha"[\s\S]*mv -T -- "\$gate_root" "\$tombstone"[\s\S]*fsync_path "\$RUNTIME_ROOT"[\s\S]*remove_discarded_gate_tombstone "\$tombstone" "\$failed_commit"/)
  assert.match(removeTombstone,
    /validate_discarded_gate_tombstone[\s\S]*sha256sum "\$candidate\/recovery-helper\.sh"[\s\S]*constructor-gate-gc\.\$failed_commit\.\$helper_sha[\s\S]*mv -T -- "\$candidate" "\$gc_root"[\s\S]*fsync_path "\$RUNTIME_ROOT"[\s\S]*remove_discarded_gate_gc "\$gc_root" "\$failed_commit"/,
  'tombstone-ul integral trebuie redenumit și fsync-uit ca GC autentificat înainte de rm recursiv')
  assert.match(validateTombstone,
    /constructor-gate-discarded[\s\S]*BASH_REMATCH\[1\][\s\S]*BASH_REMATCH\[2\][\s\S]*0:0:700[\s\S]*realpath -e[\s\S]*validate_unmutated_gate_transaction/)
  assert.match(validateGateGc,
    /constructor-gate-gc\\\.\(\[0-9a-f\]\{40\}\)[\s\S]*BASH_REMATCH\[1\][\s\S]*failed_commit[\s\S]*0:0:700[\s\S]*realpath -e[\s\S]*canonical" = "\$candidate[\s\S]*candidate_device=\$\(stat -Lc '%d'[\s\S]*runtime_device=\$\(stat -Lc '%d'[\s\S]*candidate_device" = "\$runtime_device[\s\S]*mountpoint -q -- "\$candidate"[\s\S]*mount_rc" -eq 32/,
  'GC-ul de retry este autentificat numai prin numele tuplei și inode-ul root-only canonic')
  assert.match(validateGateGc,
    /mount_targets=\$\(findmnt -n -r -o TARGET\) \|\| return 1[\s\S]*while IFS= read -r mount_target[\s\S]*"\$candidate"\|"\$candidate"\/\*\) return 1/,
  'GC-ul trebuie să refuze bind mounts pe candidat sau descendenți chiar când st_dev coincide')
  assert.match(removeGateGc,
    /identity_before=\$\(stat -Lc '%d:%i'[\s\S]*validate_discarded_gate_gc "\$candidate" "\$failed_commit"[\s\S]*identity_after=\$\(stat -Lc '%d:%i'[\s\S]*identity_after" = "\$identity_before[\s\S]*rm -rf --one-file-system -- "\$candidate"[\s\S]*fsync_path "\$RUNTIME_ROOT"/,
  'ștergerea GC revalidează device:inode imediat înainte de rm one-file-system')
  assert.match(discard,
    /constructor-gate-gc\.\*[\s\S]*validate_discarded_gate_gc[\s\S]*gc_roots\+=[\s\S]*tombstones\[@\][\s\S]*candidates\[@\][\s\S]*gc_roots\[@\][\s\S]*remove_discarded_gate_gc/,
  'retry-ul trebuie să accepte cel mult un singur artefact dintre txn, tombstone și GC')
  assert.match(discard,
    /constructor-gate-txn\.\* \\[\s\S]*constructor-gate-discarded\.\* \\[\s\S]*constructor-gate-gc\.\*[\s\S]*un artefact gate a reapărut/,
  'postcondiția trebuie să respingă inclusiv reapariția quarantine-ului GC')
  const inventoryBeforeFinalFsync = discard.indexOf('un artefact gate a reapărut înainte de finalizarea discardului')
  const finalArtifactFsync = discard.indexOf('fsync_path "$RUNTIME_ROOT"', inventoryBeforeFinalFsync)
  const inventoryAfterFinalFsync = discard.indexOf('un artefact gate a reapărut după fsync-ul final al discardului', finalArtifactFsync)
  const finalOwnerProof = discard.indexOf('deploy_quiesce_owned_by_caller', inventoryAfterFinalFsync)
  assert.ok(inventoryBeforeFinalFsync >= 0 && finalArtifactFsync > inventoryBeforeFinalFsync
    && inventoryAfterFinalFsync > finalArtifactFsync && finalOwnerProof > inventoryAfterFinalFsync,
  'txn/tombstone/GC trebuie reinventariate după fsync și înainte de pending/finalizare')
  assert.match(strictQuiesce,
    /for unit in "\$\{constructor_timers\[@\]\}"[\s\S]*for unit in "\$\{constructor_services\[@\]\}"[\s\S]*"\$count" -eq 6[\s\S]*validate_constructor_quiesce_barrier/)
  assert.match(clearOuterJournal,
    /rm -f -- "\$DEPLOY_QUIESCE_JOURNAL"[\s\S]*deploy_quiesce_journal_unlinked=1[\s\S]*fsync_path "\$RUNTIME_ROOT"/)
  assert.doesNotMatch(clearOuterJournal, /recovery_in_progress=0/,
    'după unlink cleanup-ul rămâne armat până la controller și timere validate')
  assert.doesNotMatch(discard, /clear_unit_migration_pending|publish_runtime_ready_stamp|restore_constructor_timers|clear_deploy_quiesce_journal/)

  const ensure = cutover.indexOf('if ! ensure_constructor_marker_root_durable; then')
  const call = cutover.indexOf('discard_unmutated_gate_prepared_refresh \\', ensure)
  const genericGate = cutover.indexOf('\nrecover_interrupted_gate_refresh\n', call)
  assert.ok(ensure >= 0 && call > ensure && genericGate > call,
    'discardul exact trebuie rulat după preflight și înaintea recovery-ului gate generic')
  const pendingBranch = cutover.indexOf('if [ -f "$UNIT_MIGRATION_PENDING" ]; then', genericGate)
  const clearPending = cutover.indexOf('clear_unit_migration_pending', pendingBranch)
  const publishReady = cutover.indexOf('publish_runtime_ready_stamp', clearPending)
  const clearOuter = cutover.indexOf('clear_deploy_quiesce_journal', publishReady)
  const restoreController = cutover.indexOf('restore_runtime_controller_or_quiesce', clearOuter)
  const restoreTimers = cutover.indexOf('restore_constructor_timers', restoreController)
  assert.ok(pendingBranch > genericGate && clearPending > pendingBranch && publishReady > clearPending
    && clearOuter > publishReady && restoreController > clearOuter && restoreTimers > restoreController,
  'pending-ul rămâne până la dovada standard, apoi outer dispare înainte de controller și timere')

  const sandbox = mkdtempSync(join(tmpdir(), 'kelion-gate-prepared-discard-'))
  try {
    const runtime = join(sandbox, 'runtime')
    const gateRoot = join(runtime, 'constructor-gate-txn.Incident')
    const helperBody = '#!/bin/sh\nexit 0\n'
    const helperSha = createHash('sha256').update(helperBody).digest('hex')
    const tombstone = join(runtime,
      `constructor-gate-discarded.aadb55932d41ac26635df90028276e25ba9f51af.${helperSha}`)
    const gateGc = join(runtime,
      `constructor-gate-gc.aadb55932d41ac26635df90028276e25ba9f51af.${helperSha}`)
    const gateJournal = join(runtime, 'constructor-gate-refresh.journal')
    const outer = join(runtime, 'constructor-deploy-quiesce.journal')
    const pending = join(runtime, 'constructor-unit-migration.pending')
    const compose = join(sandbox, 'compose.production.yml')
    const calls = join(sandbox, 'calls.log')
    const gateJournalBody = '{"gate":true}\n'
    const resetState = ({ withJournal = true, withGate = true, withPending = true,
      withTombstone = false, withGateGc = false } = {}) => {
      rmSync(runtime, { recursive: true, force: true })
      mkdirSync(runtime)
      if (withGate) {
        mkdirSync(gateRoot)
        writeFileSync(join(gateRoot, 'recovery-helper.sh'), helperBody, { mode: 0o500 })
      }
      if (withTombstone) {
        mkdirSync(tombstone)
        writeFileSync(join(tombstone, 'recovery-helper.sh'), helperBody, { mode: 0o500 })
      }
      if (withGateGc) {
        mkdirSync(gateGc)
        writeFileSync(join(gateGc, 'partial-fragment'), 'partial\n', { mode: 0o600 })
      }
      if (withJournal) writeFileSync(gateJournal, gateJournalBody, { mode: 0o600 })
      writeFileSync(outer, '{"outer":true}\n', { mode: 0o600 })
      if (withPending) writeFileSync(pending, 'schema=1\n', { mode: 0o600 })
      writeFileSync(calls, '')
    }
    writeFileSync(compose, 'services: {}\n', { mode: 0o444 })
    const harness = `set -euo pipefail
RUNTIME_ROOT=$1
GATE_ROOT=$2
GATE_JOURNAL=$3
DEPLOY_QUIESCE_JOURNAL=$4
UNIT_MIGRATION_PENDING=$5
compose_file=$6
CALLS=$7
TOMBSTONE=$8
GATE_GC=$9
JOURNAL=$RUNTIME_ROOT/runtime-config-cutover.journal
ACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-activation.journal
ACTIVATION_PENDING=$RUNTIME_ROOT/constructor-activation.pending
READY_STAMP=$RUNTIME_ROOT/runtime-config-recovery.ready
DESTRUCTIVE_RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
CONFIG_ROOT=$(dirname "$compose_file")
discard_unmutated_gate_prepared=1
recover_only=1
leave_constructor_quiesced=0
boot_recovery=$BOOT_RECOVERY
deploy_quiesce_proof=$DEPLOY_PROOF
discard_gate_request_id=$DISCARD_REQUEST
discard_gate_commit=$DISCARD_COMMIT
discard_gate_active_commit=$DISCARD_ACTIVE
deploy_owner_request_id=$OWNER_REQUEST
deploy_owner_commit=$OWNER_COMMIT
recovery_in_progress=0
fsync_count=0
die() { printf 'die:%s\\n' "$1" >> "$CALLS"; exit 91; }
jq() {
  if [ "\${1:-}" = -er ] && [ "\${2:-}" = .transactionRoot ]; then printf '%s\\n' "$GATE_ROOT"; return 0; fi
  if [ "\${1:-}" = -er ] && [ "\${2:-}" = .helperSha256 ]; then printf '%064d\\n' 0; return 0; fi
  local request='' commit='' active='' last="\${!#}"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --arg ] && [ "$#" -ge 3 ]; then
      case "$2" in
        requestId) request=$3 ;;
        commit) commit=$3 ;;
        active) active=$3 ;;
      esac
      shift 3
    else
      shift
    fi
  done
  if [ "$last" = "$DEPLOY_QUIESCE_JOURNAL" ]; then
    [ "$request" = "$OUTER_REQUEST" ] && [ "$commit" = "$OUTER_COMMIT" ] \
      && [ "$active" = "$OUTER_ACTIVE" ]
  elif [ "$last" = "$GATE_JOURNAL" ]; then
    [ "$commit" = "$OUTER_COMMIT" ]
  else
    return 1
  fi
}
stat() { printf '0:0:600:1\\n'; }
deploy_quiesce_owned_by_caller() {
  [ "$OWNER_VALID" = 1 ] && [ "$deploy_owner_request_id" = "$OUTER_REQUEST" ] \
    && [ "$deploy_owner_commit" = "$OUTER_COMMIT" ]
}
deploy_quiesce_generation_proof() {
  printf 'proof:%s\\n' "$1" >> "$CALLS"
  [ "$PROOF_VALID" = 1 ] && [ "$1" = old ]
}
validate_unit_migration_pending() {
  if [ -e "$UNIT_MIGRATION_PENDING" ] || [ -L "$UNIT_MIGRATION_PENDING" ]; then
    [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ]
  fi
}
validate_live_constructor_units_quiesced() {
  printf 'quiesce-six\\n' >> "$CALLS"
  [ "$QUIESCE_VALID" = 1 ]
}
validate_live_runtime_contract() { [ "$LIVE_VALID" = 1 ]; }
validate_unmutated_gate_transaction() {
  printf 'txn:%s:%s\\n' "$1" "\${2:-}" >> "$CALLS"
  [ "$TXN_VALID" = 1 ] && [ "$1" = "$GATE_ROOT" ] && [ -d "$GATE_ROOT" ]
}
validate_discarded_gate_tombstone() {
  [ "$1" = "$TOMBSTONE" ] && [ "$2" = "$DISCARD_COMMIT" ] \
    && [ -d "$TOMBSTONE" ] && [ ! -L "$TOMBSTONE" ]
}
validate_discarded_gate_gc() {
  [[ "$1" =~ ^$RUNTIME_ROOT/constructor-gate-gc\\.$DISCARD_COMMIT\\.[0-9a-f]{64}$ ]] \
    && [ "$2" = "$DISCARD_COMMIT" ] && [ -d "$1" ] && [ ! -L "$1" ]
}
fsync_path() {
  fsync_count=$((fsync_count + 1))
  printf 'fsync:%s:%s\\n' "$fsync_count" "$1" >> "$CALLS"
  [ "$FSYNC_FAIL_AT" -eq 0 ] || [ "$fsync_count" -ne "$FSYNC_FAIL_AT" ] || return 1
  if [ "$RESURRECT_GC_AT" -ne 0 ] && [ "$fsync_count" -eq "$RESURRECT_GC_AT" ]; then
    mkdir "$GATE_GC"
    printf 'resurrected\\n' > "$GATE_GC/power-loss-fragment"
  fi
}
rm() {
  printf 'rm:%s\\n' "$*" >> "$CALLS"
  if [ "$FAIL_GATE_RM" = 1 ] && [ "\${!#}" = "$GATE_JOURNAL" ]; then return 1; fi
  if [ "$FAIL_GC_RM" = 1 ] && [ "\${!#}" = "$GATE_GC" ]; then return 1; fi
  command rm "$@"
}
mv() {
  printf 'mv:%s\\n' "$*" >> "$CALLS"
  if [ "$FAIL_TXN_RENAME" = 1 ] && [ "\${!#}" = "$TOMBSTONE" ]; then return 1; fi
  if [ "$FAIL_GC_RENAME" = 1 ] && [ "\${!#}" = "$GATE_GC" ]; then return 1; fi
  command mv "$@"
}
${removeGateGc}
${removeTombstone}
${withdrawTxn}
${discard}
discard_unmutated_gate_prepared_refresh "$CALL_REQUEST" "$CALL_COMMIT" "$CALL_ACTIVE" "$CALL_COMPOSE"`
    const canonical = {
      request: 'ebf1d8cb-ecdc-4b8b-b98e-c053269af5d3',
      commit: 'aadb55932d41ac26635df90028276e25ba9f51af',
      active: '10c7ce5b06307e953db9184f0ecb57e6ca60ad38',
    }
    const runDiscard = ({ boot = 0, proof = 1, ownerValid = 1, proofValid = 1,
      quiesceValid = 1, txnValid = 1, liveValid = 1, failGateRm = 0,
      fsyncFailAt = 0, resurrectGcAt = 0, failTxnRename = 0, failGcRename = 0, failGcRm = 0,
      ownerRequest = canonical.request, ownerCommit = canonical.commit,
      discardRequest = canonical.request, discardCommit = canonical.commit,
      discardActive = canonical.active, callRequest = canonical.request,
      callCommit = canonical.commit, callActive = canonical.active,
      callCompose = compose, outerRequest = canonical.request,
      outerCommit = canonical.commit, outerActive = canonical.active } = {}) => spawnSync(
      bashExecutable,
      ['-c', harness, 'incident', runtime, gateRoot, gateJournal, outer, pending, compose, calls, tombstone, gateGc],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          BOOT_RECOVERY: String(boot),
          DEPLOY_PROOF: String(proof),
          OWNER_VALID: String(ownerValid),
          PROOF_VALID: String(proofValid),
          QUIESCE_VALID: String(quiesceValid),
          TXN_VALID: String(txnValid),
          LIVE_VALID: String(liveValid),
          FAIL_GATE_RM: String(failGateRm),
          FSYNC_FAIL_AT: String(fsyncFailAt),
          RESURRECT_GC_AT: String(resurrectGcAt),
          FAIL_TXN_RENAME: String(failTxnRename),
          FAIL_GC_RENAME: String(failGcRename),
          FAIL_GC_RM: String(failGcRm),
          OWNER_REQUEST: ownerRequest,
          OWNER_COMMIT: ownerCommit,
          DISCARD_REQUEST: discardRequest,
          DISCARD_COMMIT: discardCommit,
          DISCARD_ACTIVE: discardActive,
          CALL_REQUEST: callRequest,
          CALL_COMMIT: callCommit,
          CALL_ACTIVE: callActive,
          CALL_COMPOSE: callCompose,
          OUTER_REQUEST: outerRequest,
          OUTER_COMMIT: outerCommit,
          OUTER_ACTIVE: outerActive,
        },
      },
    )

    resetState()
    const success = runDiscard()
    assert.equal(success.status, 0, success.stderr || success.stdout)
    assert.equal(existsSync(gateJournal), false)
    assert.equal(existsSync(gateRoot), false)
    assert.equal(existsSync(tombstone), false)
    assert.equal(existsSync(gateGc), false)
    assert.equal(existsSync(pending), true, 'pending-ul trebuie lăsat finalizerului standard')
    assert.equal(existsSync(outer), true, 'outer journal trebuie lăsat finalizerului standard')
    const trace = readFileSync(calls, 'utf8')
    assert.match(trace,
      /proof:old[\s\S]*quiesce-six[\s\S]*txn:[^\n]+[\s\S]*proof:old[\s\S]*quiesce-six[\s\S]*rm:-f --[^\n]+[\s\S]*fsync:1:[^\n]+[\s\S]*mv:-T --[^\n]+[\s\S]*fsync:2:[^\n]+[\s\S]*mv:-T --[^\n]+constructor-gate-gc[^\n]+[\s\S]*fsync:3:[^\n]+[\s\S]*rm:-rf --[^\n]+constructor-gate-gc[^\n]+[\s\S]*fsync:4:[^\n]+[\s\S]*proof:old[\s\S]*quiesce-six/)
    const idempotent = runDiscard()
    assert.equal(idempotent.status, 0, idempotent.stderr || idempotent.stdout)
    rmSync(pending)
    assert.equal(runDiscard().status, 0, 'reluarea după finalizer trebuie să accepte pending absent numai cu contract live')
    assert.notEqual(runDiscard({ liveValid: 0 }).status, 0)

    for (const denied of [
      { boot: 1 },
      { proof: 0 },
      { ownerValid: 0 },
      { proofValid: 0 },
      { quiesceValid: 0 },
      { callRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { callCommit: 'b'.repeat(40) },
      { callActive: 'c'.repeat(40) },
      { callCompose: `${compose}.wrong` },
      { ownerRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { ownerCommit: 'b'.repeat(40) },
      { discardRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { discardCommit: 'b'.repeat(40) },
      { discardActive: 'c'.repeat(40) },
      { outerRequest: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { outerCommit: 'b'.repeat(40) },
      { outerActive: 'c'.repeat(40) },
    ]) {
      resetState()
      assert.notEqual(runDiscard(denied).status, 0, JSON.stringify(denied))
      assert.equal(existsSync(gateJournal), true, 'o tuplă/probă respinsă nu poate retrage jurnalul gate')
      assert.equal(existsSync(gateRoot), true, 'o tuplă/probă respinsă nu poate retrage tranzacția gate')
    }

    resetState()
    assert.notEqual(runDiscard({ failGateRm: 1 }).status, 0)
    assert.equal(existsSync(gateJournal), true)
    assert.equal(existsSync(gateRoot), true)
    assert.equal(runDiscard().status, 0, 'retry după eșecul unlink-ului gate trebuie să conveargă')

    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 1 }).status, 0)
    assert.equal(existsSync(gateJournal), false)
    assert.equal(existsSync(gateRoot), true)
    assert.equal(runDiscard().status, 0, 'retry cu jurnal absent și txn prezent trebuie să conveargă')
    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 1 }).status, 0)
    writeFileSync(gateJournal, gateJournalBody, { mode: 0o600 })
    assert.equal(runDiscard().status, 0, 'retry cu jurnal resurrectat și txn prezent trebuie să conveargă')

    resetState()
    assert.notEqual(runDiscard({ failTxnRename: 1 }).status, 0)
    assert.equal(existsSync(gateJournal), false)
    assert.equal(existsSync(gateRoot), true)
    assert.equal(runDiscard().status, 0, 'retry după eșecul retragerii txn trebuie să conveargă')

    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 2 }).status, 0)
    assert.equal(existsSync(gateRoot), false)
    assert.equal(existsSync(tombstone), true)
    assert.equal(runDiscard().status, 0, 'retry după rename fără fsync trebuie să consume tombstone-ul')

    resetState()
    assert.notEqual(runDiscard({ failGcRename: 1 }).status, 0)
    assert.equal(existsSync(tombstone), true)
    assert.equal(existsSync(gateGc), false)
    assert.equal(runDiscard().status, 0,
      'retry după eșecul rename-ului tombstone→GC trebuie să conveargă')

    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 3 }).status, 0)
    assert.equal(existsSync(gateRoot), false)
    assert.equal(existsSync(tombstone), false)
    assert.equal(existsSync(gateGc), true)
    rmSync(join(gateGc, 'recovery-helper.sh'), { force: true })
    assert.equal(runDiscard().status, 0,
      'retry după rename GC fără fsync trebuie să consume chiar și quarantine-ul rămas parțial')

    resetState()
    assert.notEqual(runDiscard({ failGcRm: 1 }).status, 0)
    assert.equal(existsSync(tombstone), false)
    assert.equal(existsSync(gateGc), true)
    rmSync(join(gateGc, 'recovery-helper.sh'), { force: true })
    assert.equal(runDiscard().status, 0,
      'retry după eșecul rm al quarantine-ului GC parțial trebuie să conveargă')

    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 4 }).status, 0)
    assert.equal(existsSync(gateRoot), false)
    assert.equal(existsSync(tombstone), false)
    assert.equal(existsSync(gateGc), false)
    assert.equal(runDiscard().status, 0,
      'retry după fsync-ul final eșuat cu GC absent trebuie să fie idempotent')
    resetState()
    assert.notEqual(runDiscard({ fsyncFailAt: 4 }).status, 0)
    assert.equal(existsSync(gateGc), false)
    mkdirSync(gateGc)
    writeFileSync(join(gateGc, 'power-loss-fragment'), 'partial\n', { mode: 0o600 })
    assert.equal(runDiscard().status, 0,
      'retry după resurrectarea GC-ului post-rm trebuie să-l consume ca quarantine, nu ca recovery data')

    resetState({ withJournal: false, withGate: false, withTombstone: true })
    assert.equal(runDiscard().status, 0, 'retry după resurrectarea tombstone-ului trebuie să-l consume durabil')

    resetState({ withJournal: false, withGate: false, withGateGc: true })
    assert.equal(runDiscard().status, 0,
      'retry-ul poate elimina un GC parțial numai sub outer exact și pending prezent')
    resetState({ withJournal: false, withGate: false })
    assert.notEqual(runDiscard({ resurrectGcAt: 1 }).status, 0,
      'un artefact GC reapărut după fsync trebuie detectat înainte de consumarea pending-ului')
    assert.equal(existsSync(gateGc), true)
    resetState({ withJournal: false, withGate: false, withPending: false, withGateGc: true })
    assert.notEqual(runDiscard().status, 0,
      'un GC parțial fără pending nu poate primi autoritate de cleanup')
    assert.equal(existsSync(gateGc), true)

    resetState({ withTombstone: true })
    assert.notEqual(runDiscard().status, 0,
      'jurnalul gate și tombstone-ul nu pot fi acceptate simultan')
    assert.equal(existsSync(gateJournal), true)
    assert.equal(existsSync(gateRoot), true)
    assert.equal(existsSync(tombstone), true)

    resetState({ withGateGc: true })
    assert.notEqual(runDiscard().status, 0,
      'jurnalul gate și quarantine-ul GC nu pot fi acceptate simultan')
    assert.equal(existsSync(gateJournal), true)
    assert.equal(existsSync(gateRoot), true)
    assert.equal(existsSync(gateGc), true)

    const foreignTombstone = join(runtime,
      `constructor-gate-discarded.${canonical.commit}.${'f'.repeat(64)}`)
    resetState({ withJournal: false, withGate: false })
    mkdirSync(foreignTombstone)
    writeFileSync(join(foreignTombstone, 'recovery-helper.sh'), helperBody, { mode: 0o500 })
    assert.notEqual(runDiscard().status, 0, 'un tombstone străin trebuie refuzat fail-closed')
    assert.equal(existsSync(foreignTombstone), true, 'tombstone-ul străin nu poate fi șters')

    resetState({ withJournal: false, withGate: false })
    writeFileSync(tombstone, 'corrupt\n', { mode: 0o600 })
    assert.notEqual(runDiscard().status, 0, 'un tombstone corupt trebuie refuzat fail-closed')
    assert.equal(existsSync(tombstone), true, 'tombstone-ul corupt nu poate fi șters')

    const foreignGateGc = join(runtime,
      `constructor-gate-gc.${'b'.repeat(40)}.${helperSha}`)
    resetState({ withJournal: false, withGate: false })
    mkdirSync(foreignGateGc)
    assert.notEqual(runDiscard().status, 0, 'un GC cu commit străin trebuie refuzat fail-closed')
    assert.equal(existsSync(foreignGateGc), true)

    resetState({ withJournal: false, withGate: false })
    writeFileSync(gateGc, 'corrupt-inode\n', { mode: 0o600 })
    assert.notEqual(runDiscard().status, 0, 'un GC care nu este director canonic trebuie refuzat')
    assert.equal(existsSync(gateGc), true)

    resetState({ withJournal: false, withGate: false })
    symlinkSync(join(runtime, 'missing-gc-target'), gateGc)
    assert.notEqual(runDiscard().status, 0, 'un GC dangling trebuie refuzat fail-closed')
    assert.equal(existsSync(gateGc), false)
    assert.equal(lstatSync(gateGc).isSymbolicLink(), true, 'GC-ul dangling nu poate fi șters')

    const secondGateGc = join(runtime,
      `constructor-gate-gc.${canonical.commit}.${'e'.repeat(64)}`)
    resetState({ withJournal: false, withGate: false, withGateGc: true })
    mkdirSync(secondGateGc)
    assert.notEqual(runDiscard().status, 0, 'mai multe GC-uri fac reluarea ambiguă și fail-closed')
    assert.equal(existsSync(gateGc), true)
    assert.equal(existsSync(secondGateGc), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  const gcSafetySandbox = mkdtempSync(join(tmpdir(), 'kelion-gate-gc-safety-'))
  try {
    const runtime = join(gcSafetySandbox, 'runtime')
    const candidate = join(runtime,
      `constructor-gate-gc.${'a'.repeat(40)}.${'b'.repeat(64)}`)
    const calls = join(gcSafetySandbox, 'calls.log')
    const identityCalls = join(gcSafetySandbox, 'identity.calls')
    mkdirSync(runtime)
    mkdirSync(candidate, { mode: 0o700 })
    const sandboxValidateGateGc = validateGateGc.replace(
      '^/root/kelion/runtime/constructor-gate-gc\\.',
      '^$RUNTIME_ROOT/constructor-gate-gc\\.',
    )
    assert.notEqual(sandboxValidateGateGc, validateGateGc,
      'validatorul GC trebuie relocat exclusiv în harnessul sandbox')
    const gcSafetyHarness = `set -u
RUNTIME_ROOT=$1
CANDIDATE=$2
CALLS=$3
IDENTITY_CALLS=$4
stat() {
  local format=$2 path="\${!#}" count
  case "$format" in
    '%u:%g:%a') printf '0:0:700\\n' ;;
    '%d')
      if [ "$path" = "$CANDIDATE" ]; then printf '%s\\n' "$CANDIDATE_DEVICE"
      else printf '%s\\n' "$RUNTIME_DEVICE"; fi
      ;;
    '%d:%i')
      printf 'x\\n' >> "$IDENTITY_CALLS"
      count=$(wc -l < "$IDENTITY_CALLS")
      if [ "$count" -gt 1 ] && [ "$IDENTITY_RACE" = 1 ]; then printf '41:101\\n'
      else printf '41:100\\n'; fi
      ;;
    *) return 1 ;;
  esac
}
realpath() { printf '%s\\n' "\${!#}"; }
mountpoint() {
  [ "$MOUNT_RC" -ne 0 ] || return 0
  return "$MOUNT_RC"
}
findmnt() {
  [ "$FINDMNT_RC" -eq 0 ] || return "$FINDMNT_RC"
  case "$FINDMNT_TARGET" in
    none) printf '/\\n' ;;
    exact) printf '%s\\n' "$CANDIDATE" ;;
    descendant) printf '%s/nested-bind\\n' "$CANDIDATE" ;;
    sibling) printf '%s-sibling\\n' "$CANDIDATE" ;;
    *) return 93 ;;
  esac
}
rm() {
  printf 'rm:%s\\n' "$*" >> "$CALLS"
  command rm "$@"
}
fsync_path() { printf 'fsync:%s\\n' "$1" >> "$CALLS"; }
${sandboxValidateGateGc}
${removeGateGc}
case "$5" in
  validate) validate_discarded_gate_gc "$CANDIDATE" "$FAILED_COMMIT" ;;
  remove) remove_discarded_gate_gc "$CANDIDATE" "\${FAILED_COMMIT}" ;;
  *) exit 92 ;;
esac`
    const failedCommit = 'a'.repeat(40)
    const runGcSafety = (operation, { candidateDevice = 41, runtimeDevice = 41,
      mountRc = 32, findmntRc = 0, findmntTarget = 'none', identityRace = 0 } = {}) => {
      writeFileSync(calls, '')
      writeFileSync(identityCalls, '')
      return spawnSync(bashExecutable,
        ['-c', gcSafetyHarness, 'gc-safety', runtime, candidate, calls, identityCalls, operation], {
          encoding: 'utf8',
          env: {
            ...process.env,
            CANDIDATE_DEVICE: String(candidateDevice),
            RUNTIME_DEVICE: String(runtimeDevice),
            MOUNT_RC: String(mountRc),
            FINDMNT_RC: String(findmntRc),
            FINDMNT_TARGET: findmntTarget,
            IDENTITY_RACE: String(identityRace),
            FAILED_COMMIT: failedCommit,
          },
        })
    }
    const validGc = runGcSafety('validate')
    assert.equal(validGc.status, 0, validGc.stderr || validGc.stdout)
    assert.notEqual(runGcSafety('validate', { candidateDevice: 42 }).status, 0,
      'un GC de pe alt st_dev trebuie refuzat')
    assert.notEqual(runGcSafety('validate', { mountRc: 0 }).status, 0,
      'un mountpoint GC trebuie refuzat')
    assert.notEqual(runGcSafety('validate', { mountRc: 1 }).status, 0,
      'rc=1 nu este contractul util-linux pentru not-a-mountpoint și trebuie refuzat')
    assert.notEqual(runGcSafety('validate', { mountRc: 2 }).status, 0,
      'o eroare mountpoint nu poate fi reinterpretată ca not-a-mountpoint')
    assert.notEqual(runGcSafety('validate', { findmntRc: 1 }).status, 0,
      'eșecul inventarului findmnt trebuie propagat fail-closed')
    assert.notEqual(runGcSafety('validate', { findmntTarget: 'exact' }).status, 0,
      'un bind mount pe GC trebuie refuzat chiar dacă st_dev coincide')
    assert.notEqual(runGcSafety('validate', { findmntTarget: 'descendant' }).status, 0,
      'un bind mount sub GC trebuie refuzat chiar dacă st_dev coincide')
    assert.equal(runGcSafety('validate', { findmntTarget: 'sibling' }).status, 0,
      'un target cu simplu prefix textual, dar în afara GC-ului, nu este descendent')
    assert.notEqual(runGcSafety('remove', { identityRace: 1 }).status, 0,
      'schimbarea device:inode între validare și rm trebuie să fie fail-closed')
    assert.equal(existsSync(candidate), true)
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /^rm:/m)

    const removedGc = runGcSafety('remove')
    assert.equal(removedGc.status, 0, removedGc.stderr || removedGc.stdout)
    assert.equal(existsSync(candidate), false)
    assert.match(readFileSync(calls, 'utf8'), /rm:-rf --one-file-system --/,
      'ștergerea GC validată nu poate traversa un filesystem străin')
  } finally {
    rmSync(gcSafetySandbox, { recursive: true, force: true })
  }

  const outerSandbox = mkdtempSync(join(tmpdir(), 'kelion-outer-journal-durability-'))
  try {
    const runtime = join(outerSandbox, 'runtime')
    const outer = join(runtime, 'constructor-deploy-quiesce.journal')
    const calls = join(outerSandbox, 'calls.log')
    mkdirSync(runtime)
    const outerHarness = `set -u
RUNTIME_ROOT=$1
DEPLOY_QUIESCE_JOURNAL=$2
CALLS=$3
recovery_in_progress=1
deploy_quiesce_journal_unlinked=0
rm() {
  printf 'rm:%s\\n' "$*" >> "$CALLS"
  [ "$FAIL_OUTER_RM" = 0 ] || return 1
  command rm "$@"
}
fsync_path() {
  printf 'fsync:%s\\n' "$1" >> "$CALLS"
  [ "$FAIL_OUTER_FSYNC" = 0 ]
}
${clearOuterJournal}
clear_deploy_quiesce_journal
rc=$?
printf 'state:%s:%s:%s\\n' "$rc" "$recovery_in_progress" "$deploy_quiesce_journal_unlinked" >> "$CALLS"
exit "$rc"`
    const runClearOuter = ({ failRm = 0, failFsync = 0 } = {}) => spawnSync(
      bashExecutable, ['-c', outerHarness, 'outer', runtime, outer, calls], {
        encoding: 'utf8',
        env: {
          ...process.env,
          FAIL_OUTER_RM: String(failRm),
          FAIL_OUTER_FSYNC: String(failFsync),
        },
      })

    writeFileSync(outer, '{}\n', { mode: 0o600 })
    writeFileSync(calls, '')
    assert.notEqual(runClearOuter({ failRm: 1 }).status, 0)
    assert.equal(existsSync(outer), true, 'eșecul unlink-ului outer trebuie să păstreze jurnalul')

    assert.notEqual(runClearOuter({ failFsync: 1 }).status, 0)
    assert.equal(existsSync(outer), false, 'eșecul fsync vine după unlink-ul outer')
    assert.match(readFileSync(calls, 'utf8'), /state:1:1:1/,
      'cleanup-ul rămâne armat după unlink până la dovada controllerului și a vectorului live')

    writeFileSync(outer, '{}\n', { mode: 0o600 })
    assert.equal(runClearOuter().status, 0,
      'retry după resurrectarea integrală a outer journal trebuie să conveargă')
    assert.equal(existsSync(outer), false)
    assert.match(readFileSync(calls, 'utf8'), /state:0:1:1/,
      'clear-ul outer nu poate declara singur recovery-ul complet')
  } finally {
    rmSync(outerSandbox, { recursive: true, force: true })
  }
})

test('workflow-ul dedicat recuperează exclusiv incidentul gate-prepared verificat', () => {
  const workflow = read('.github/workflows/vps-recovery.yml')
  const classifyStart = workflow.indexOf('- name: Separă recovery-ul generic de incidentul gate-prepared')
  const incidentStart = workflow.indexOf('- name: Recuperează exact incidentul gate-prepared aadb')
  const genericStart = workflow.indexOf('- name: Recovery generic pe VPS', incidentStart)
  assert.ok(classifyStart >= 0 && incidentStart > classifyStart && genericStart > incidentStart)
  const classify = workflow.slice(classifyStart, incidentStart)
  const incident = workflow.slice(incidentStart, genericStart)
  const checkout = workflow.slice(workflow.lastIndexOf('- uses: actions/checkout@', incidentStart), incidentStart)

  assert.match(workflow,
    /if: github\.event_name == 'push' && github\.event\.before == 'aadb55932d41ac26635df90028276e25ba9f51af'/)
  assert.match(classify,
    /failed_commit=aadb55932d41ac26635df90028276e25ba9f51af[\s\S]*active_commit=10c7ce5b06307e953db9184f0ecb57e6ca60ad38[\s\S]*request=ebf1d8cb-ecdc-4b8b-b98e-c053269af5d3[\s\S]*ci_run=33316869492[\s\S]*build_run=33317102554[\s\S]*failed_run=33317466950[\s\S]*failed_job=99273467144/)
  assert.match(classify,
    /git rev-parse HEAD\^\)" = "\$failed_commit"[\s\S]*git rev-list --count "\$failed_commit\.\.\$hotfix"\)" -eq 1[\s\S]*git rev-list --parents -n 1 "\$hotfix"[\s\S]*"\$remote_master" = "\$hotfix"/)
  assert.match(classify,
    /"\$\{#changed\[@\]\}" -eq 5[\s\S]*M\\t\.github\/workflows\/vps-recovery\.yml[\s\S]*M\\tdeploy\/deploy\.sh[\s\S]*M\\tdeploy\/instaleaza-constructor\.sh[\s\S]*M\\tdeploy\/lib\/constructor-publication\.test\.mjs[\s\S]*M\\tdeploy\/lib\/runtime-config-cutover\.sh/)
  assert.equal((classify.match(/\.total_count == 3/g) ?? []).length, 2,
    'atât CI-ul incidentului, cât și CI-ul hotfixului trebuie să aibă exact trei joburi')
  assert.equal((classify.match(/\["container-isolation", "release-train-preflight", "verify"\]/g) ?? []).length, 2)
  assert.match(classify,
    /actions\/workflows\/pr-verify\.yml\/runs\?branch=master&event=push[\s\S]*\.head_sha == \$sha[\s\S]*\.event == "push"[\s\S]*\.conclusion == "success"/)

  assert.match(checkout,
    /if: needs\.classify\.outputs\.incident == 'true'[\s\S]*ref: \$\{\{ needs\.classify\.outputs\.hotfix_commit \}\}[\s\S]*fetch-depth: 2[\s\S]*persist-credentials: false/)
  assert.match(incident,
    /sha256sum deploy\/lib\/runtime-config-cutover\.sh[\s\S]*\[\[ "\$GITHUB_RUN_ID" =~ \^\[1-9\]\[0-9\]\*\$ \]\][\s\S]*\[\[ "\$GITHUB_RUN_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$ \]\][\s\S]*remote_stage="\/root\/kelion-gate-recovery\.\$\{GITHUB_RUN_ID\}\.\$\{GITHUB_RUN_ATTEMPT\}"[\s\S]*runtime-config-cutover\.incoming/)
  assert.equal((incident.match(/\^\/root\/kelion-gate-recovery\\\.\[1-9\]\[0-9\]\*\\\.\[1-9\]\[0-9\]\*\$/g) ?? []).length, 3,
    'cleanup-ul, stagingul și recovery-ul trebuie să accepte exclusiv stage-ul run.attempt')
  assert.match(incident,
    /exec 9<"\$publication_lock"[\s\S]*flock -n 9[\s\S]*phase=incident-proof/)
  assert.match(incident,
    /phase=helper-install[\s\S]*install -o root -g root -m 0500 "\$incoming" "\$helper"[\s\S]*phase=helper-recovery[\s\S]*KELION_CUTOVER_LOCK_HELD=1 \\[\s\S]*KELION_DEPLOY_QUIESCE_PROOF=1 \\[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="\$request" \\[\s\S]*KELION_DEPLOY_QUIESCE_OWNER_COMMIT="\$failed_commit" \\[\s\S]*"\$helper" --discard-unmutated-gate-prepared \\[\s\S]*"\$request" "\$failed_commit" "\$active_commit" "\$compose"/)

  const alreadyComplete = incident.indexOf('if [ ! -e "$outer" ] && [ ! -L "$outer" ]; then')
  const helperInstall = incident.indexOf('phase=helper-install')
  assert.ok(alreadyComplete >= 0 && helperInstall > alreadyComplete,
    'ramura idempotentă trebuie să iasă înainte să instaleze sau să invoce helperul')
  assert.match(incident.slice(alreadyComplete, helperInstall),
    /validate_complete_poststate[\s\S]*sync -f "\$runtime"[\s\S]*validate_complete_poststate[\s\S]*emit_complete_receipt already-complete[\s\S]*exit 0/)
  const inventoryStart = incident.indexOf('gate_transaction_count() {')
  const noArtifactsStart = incident.indexOf('assert_no_gate_recovery_artifacts() {', inventoryStart)
  const completeStart = incident.indexOf('validate_complete_poststate() {', inventoryStart)
  const receiptStart = incident.indexOf('emit_complete_receipt() {', completeStart)
  assert.ok(inventoryStart >= 0 && noArtifactsStart > inventoryStart
    && completeStart > noArtifactsStart && receiptStart > completeStart)
  const inventory = incident.slice(inventoryStart, noArtifactsStart)
  const noArtifacts = incident.slice(noArtifactsStart, incident.indexOf('validate_constructor_vector() {', noArtifactsStart))
  const completePoststate = incident.slice(completeStart, receiptStart)
  assert.match(inventory,
    /"\$runtime"\/constructor-gate-txn\.\* \\[\s\S]*"\$runtime"\/constructor-gate-discarded\.\* \\[\s\S]*"\$runtime"\/constructor-gate-gc\.\*[\s\S]*\[ ! -e "\$candidate" \] && \[ ! -L "\$candidate" \][\s\S]*\[ -d "\$candidate" \][\s\S]*\[ ! -L "\$candidate" \]/,
  'inventarul global trebuie să refuze inclusiv un txn, tombstone sau GC străin/dangling')
  assert.match(inventory,
    /\[ -d "\$candidate" \] \|\| return 1[\s\S]*\[ ! -L "\$candidate" \] \|\| return 1[\s\S]*canonical=\$\(realpath -e -- "\$candidate"\) \|\| return 1[\s\S]*\[ "\$canonical" = "\$candidate" \] \|\| return 1[\s\S]*acl=\$\(stat -Lc '%u:%g:%a' "\$candidate"\) \|\| return 1[\s\S]*\[ "\$acl" = '0:0:700' \] \|\| return 1/,
  'fiecare predicat din command substitution trebuie să propage explicit eșecul')
  assert.match(noArtifacts,
    /"\$runtime"\/constructor-gate-txn\.\* \\[\s\S]*"\$runtime"\/constructor-gate-discarded\.\* \\[\s\S]*"\$runtime"\/constructor-gate-gc\.\*[\s\S]*\[ ! -e "\$candidate" \][\s\S]*\[ ! -L "\$candidate" \]/,
  'poststarea completă refuză global orice txn, tombstone ori GC, inclusiv dangling')
  assert.match(noArtifacts,
    /\[ ! -e "\$candidate" \] \|\| return 1[\s\S]*\[ ! -L "\$candidate" \] \|\| return 1/,
  'absența artefactelor trebuie propagată explicit chiar și fără errexit')
  assert.match(completePoststate,
    /for cleared in "\$outer" "\$gate" "\$unit_pending"[\s\S]*\[ ! -e "\$cleared" \][\s\S]*\[ ! -L "\$cleared" \][\s\S]*assert_no_gate_recovery_artifacts/,
  'already-complete cere absență fizică și de symlink pentru toate jurnalele și toate artefactele gate')
  assert.match(incident,
    /transaction_count=\$\(gate_transaction_count\) \|\| \{[\s\S]*phase=incident-artifact-inventory[\s\S]*on_err "\$LINENO" 1[\s\S]*\}/,
  'callerul inventarului trebuie să propage assignment-ul eșuat înainte de preflight')
  assert.match(incident,
    /event:"incident_recovery_complete"[\s\S]*gate_recovery_artifacts:"absent"/,
  'receiptul final trebuie să afirme explicit absența tuturor artefactelor gate')

  const artifactInventory = inventory.replace(/^ {10}/gm, '')
  const noArtifactFunction = noArtifacts.replace(/^ {10}/gm, '')
  const artifactSandbox = mkdtempSync(join(tmpdir(), 'kelion-workflow-gate-inventory-'))
  try {
    const runArtifactProbe = (operation) => spawnSync(bashExecutable, ['-c', `set -u
runtime=$1
${artifactInventory}
${noArtifactFunction}
case "$2" in
  count) gate_transaction_count ;;
  absent) assert_no_gate_recovery_artifacts ;;
  *) exit 90 ;;
esac`, 'gate-artifacts', artifactSandbox, operation], { encoding: 'utf8' })
    const emptyCount = runArtifactProbe('count')
    assert.equal(emptyCount.status, 0, emptyCount.stderr || emptyCount.stdout)
    assert.equal(emptyCount.stdout, '0')
    assert.equal(runArtifactProbe('absent').status, 0)

    const malformed = join(artifactSandbox, 'constructor-gate-gc.malformed')
    writeFileSync(malformed, 'not-a-directory\n', { mode: 0o600 })
    assert.notEqual(runArtifactProbe('count').status, 0,
      'un artefact GC care nu este director nu poate deveni count valid')
    assert.notEqual(runArtifactProbe('absent').status, 0,
      'already-complete refuză artefactul GC malformed')
    rmSync(malformed)

    const dangling = join(artifactSandbox, 'constructor-gate-txn.Dangling')
    symlinkSync(join(artifactSandbox, 'missing-target'), dangling)
    assert.notEqual(runArtifactProbe('count').status, 0,
      'un artefact gate dangling trebuie să propage eșecul inventarului')
    assert.notEqual(runArtifactProbe('absent').status, 0,
      'already-complete refuză explicit symlinkul dangling')
  } finally {
    rmSync(artifactSandbox, { recursive: true, force: true })
  }

  const topologyStart = incident.indexOf('validate_managed_topology() {')
  const topologyEnd = incident.indexOf('\n\n          validate_public_proof() {', topologyStart)
  assert.ok(topologyStart >= 0 && topologyEnd > topologyStart)
  const topologyIndented = incident.slice(topologyStart, topologyEnd)
  const topology = topologyIndented.replace(/^ {10}/gm, '')
  for (const inventory of ['legacy_proxy_inventory', 'active_inventory', 'role_inventory',
    'inactive_running_inventory', 'candidate_inventory']) {
    assert.match(topology, new RegExp(`${inventory}=\\$\\(docker ps [\\s\\S]*?\\) \\|\\| return 1`),
      `${inventory} trebuie capturat înainte de parsare și să propage eroarea Docker`)
  }
  assert.doesNotMatch(topology, /mapfile[^\n]*< <\(docker ps/,
    'process substitution ar ascunde statusul docker ps')
  assert.match(topology,
    /legacy_proxy_inventory=\$\(docker ps -aq --filter 'name=\^\/kelion-caddy\$'\) \|\| return 1[\s\S]*case "\$\{#legacy_proxy_ids\[@\]\}" in[\s\S]*0\) ;;[\s\S]*1\)[\s\S]*legacy_proxy_running=\$\(docker inspect[\s\S]*\|\| return 1[\s\S]*legacy_proxy_restart_policy=\$\(docker inspect[\s\S]*\|\| return 1[\s\S]*false[\s\S]*no[\s\S]*\*\) return 1/,
  'kelion-caddy absent este dovedit prin inventar 0/1, iar inspectul singur nu poate masca eroarea')

  const topologySandbox = mkdtempSync(join(tmpdir(), 'kelion-workflow-topology-'))
  try {
    const upstream = join(topologySandbox, 'kelion-upstream.caddy')
    writeFileSync(upstream,
      'reverse_proxy app-blue:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}',
      { mode: 0o644 })
    const topologyHarness = `set -u
upstream=$1
active_commit=10c7ce5b06307e953db9184f0ecb57e6ca60ad38
active_slot=''
inactive_slot=''
docker() {
  local command=$1 option='' args="$*" role=''
  shift
  case "$command" in
    inspect)
      case "$args" in
        *legacy-caddy-id*)
          [ "$FAIL_CADDY_INSPECT" = 0 ] || return 44
          case "$args" in
            *State.Running*) printf 'false\\n' ;;
            *HostConfig.RestartPolicy.Name*) printf 'no\\n' ;;
            *) return 1 ;;
          esac
          ;;
        *State.Health.Status*) printf 'healthy\\n' ;;
        *HostConfig.RestartPolicy.Name*) printf 'unless-stopped\\n' ;;
        *com.kelion.commit*) printf '%s\\n' "$active_commit" ;;
        *State.Running*) printf 'true\\n' ;;
        *) return 1 ;;
      esac
      ;;
    ps)
      option=\${1:-}
      if [[ "$args" == *'name=^/kelion-caddy$'* ]]; then
        [ "$FAIL_CADDY_INVENTORY" = 0 ] || return 43
        case "$CADDY_COUNT" in
          0) return 0 ;;
          1) printf 'legacy-caddy-id\\n' ;;
          2) printf 'legacy-caddy-id\\nlegacy-caddy-id-2\\n' ;;
          *) return 1 ;;
        esac
        return 0
      fi
      if [[ "$args" == *'label=com.kelion.slot=green'* ]]; then
        if [ "$option" = -q ] && [ "$FAIL_INACTIVE_PS" = 1 ]; then return 42; fi
        return 0
      fi
      case "$args" in
        *'label=com.kelion.role=app'*) role=app ;;
        *'label=com.kelion.role=browser-worker'*) role=browser-worker ;;
        *'label=com.kelion.role=browser-egress'*) role=browser-egress ;;
        *'label=com.kelion.role=converter-gateway'*) role=converter-gateway ;;
        *'label=com.kelion.role=converter-parser'*) role=converter-parser ;;
      esac
      if [ -n "$role" ]; then printf 'id-%s\\n' "$role"
      else printf 'id-app\\nid-browser-worker\\nid-browser-egress\\nid-converter-gateway\\nid-converter-parser\\n'; fi
      ;;
    *) return 1 ;;
  esac
}
${topology}
validate_managed_topology`
    const runTopology = ({ failInactive = 0, failCaddyInventory = 0,
      failCaddyInspect = 0, caddyCount = 0 } = {}) => spawnSync(
      bashExecutable, ['-c', topologyHarness, 'topology', upstream], {
        encoding: 'utf8',
        env: {
          ...process.env,
          FAIL_INACTIVE_PS: String(failInactive),
          FAIL_CADDY_INVENTORY: String(failCaddyInventory),
          FAIL_CADDY_INSPECT: String(failCaddyInspect),
          CADDY_COUNT: String(caddyCount),
        },
      })
    const topologyOk = runTopology()
    assert.equal(topologyOk.status, 0, topologyOk.stderr || topologyOk.stdout)
    const stoppedLegacy = runTopology({ caddyCount: 1 })
    assert.equal(stoppedLegacy.status, 0, stoppedLegacy.stderr || stoppedLegacy.stdout)
    const topologyDockerFailure = runTopology({ failInactive: 1 })
    assert.notEqual(topologyDockerFailure.status, 0,
      'docker ps eșuat pe slotul inactiv nu poate fi reinterpretat ca inventar gol valid')
    assert.notEqual(runTopology({ failCaddyInventory: 1 }).status, 0,
      'eșecul inventarului kelion-caddy nu poate dovedi absența lui')
    assert.notEqual(runTopology({ caddyCount: 2 }).status, 0,
      'mai multe containere legacy cu același nume trebuie refuzate')
    assert.notEqual(runTopology({ caddyCount: 1, failCaddyInspect: 1 }).status, 0,
      'un kelion-caddy inventariat nu poate fi considerat absent când inspect eșuează')
  } finally {
    rmSync(topologySandbox, { recursive: true, force: true })
  }
  assert.match(incident,
    /event:"incident_recovery_complete"[\s\S]*phase=postcondition[\s\S]*validate_complete_poststate[\s\S]*sync -f "\$runtime"[\s\S]*validate_complete_poststate[\s\S]*emit_complete_receipt recovered/)
  assert.match(incident,
    /cleanup\(\)[\s\S]*bash -s -- "\$remote_stage"[\s\S]*rm -rf -- "\$stage"[\s\S]*trap cleanup EXIT/)
  assert.doesNotMatch(incident, /set\s+-x|printenv|declare\s+-p|export\s+-p/)
})

test('telemetria upgrade-ului Constructor este structurată și nu divulgă mediul', () => {
  const upgrade = read('deploy/upgrade-constructor.sh')
  const reporter = shellFunction(upgrade, 'report_constructor_upgrade_failure')
  const capture = shellFunction(upgrade, 'capture_constructor_upgrade_failure')
  const pinnedProviderMetadata = '$config.provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and'
  assert.equal(upgrade.split(pinnedProviderMetadata).length - 1, 1,
    'singura apariție npm permisă este cheia de schemă fixată a providerului local')
  const upgradeWithoutPinnedProviderMetadata = upgrade.replace(pinnedProviderMetadata, '')
  assert.doesNotMatch(upgradeWithoutPinnedProviderMetadata,
    /CODEX_WORKER_SECRET|CONSTRUCTOR_(?:PUBLISHER|RELEASE)_SECRET|SYNC_GITHUB_TOKEN|PUBLISHER_GITHUB_TOKEN|RELEASE_GITHUB_TOKEN|GHCR_READ_TOKEN|OPENAI_(?:API|ADMIN)_KEY|\bpayload\b|\bapt(?:-get)?\b|\bnpm\b/i)
  assert.doesNotMatch(reporter,
    /BASH_COMMAND|set\s+-x|printenv|declare\s+-p|export\s+-p|printf[^\n]*(?:token|secret|value|env)/i)

  const canary = `CANARY-UPGRADE-${process.pid}-${Date.now()}`
  const sourceCommit = '89abcdef0123456789abcdef0123456789abcdef'
  const probe = spawnSync(bashExecutable, ['-c', `
set -Eeuo pipefail
constructor_upgrade_phase=artifact-publication
constructor_upgrade_failure_line=0
constructor_upgrade_source_commit=${sourceCommit}
activation_restore_started=0
cleanup_unpublished_stage() { :; }
${reporter}
${capture}
trap 'capture_constructor_upgrade_failure "$LINENO"' ERR
trap report_constructor_upgrade_failure EXIT
false
`], {
    encoding: 'utf8',
    env: { ...process.env, CANARY_SECRET: canary },
  })
  assert.equal(probe.status, 1, probe.stderr || probe.stdout)
  assert.equal(probe.stdout, '')
  const events = probe.stderr.trim().split(/\r?\n/).filter((line) => line.startsWith('{'))
  assert.equal(events.length, 1, probe.stderr)
  const event = JSON.parse(events[0])
  assert.deepEqual({ ...event, line: 0 }, {
    ok: false,
    event: 'constructor_upgrade_failure',
    phase: 'artifact-publication',
    line: 0,
    exit_code: 1,
    source_commit: sourceCommit,
  })
  assert.ok(Number.isInteger(event.line) && event.line > 0)
  assert.doesNotMatch(probe.stdout + probe.stderr, new RegExp(canary))
  assert.doesNotMatch(probe.stdout + probe.stderr, /CANARY_SECRET|BASH_COMMAND|(?:^|\n)false(?:\n|$)/)
})

// Instalatorul si controllerul valideaza aceleasi artefacte private-ai, dar prin
// mecanisme diferite: primul dupa nume de cont, al doilea numeric. Cand cele doua
// contracte diverg, detectInstalledProfiles intoarce [] pe orice gazda unde
// `privateai` nu are exact uid-ul hardcodat, controllerul raporteaza `unavailable`
// si claim-ul raspunde 503 constructor_model_not_ready - fara ca vreun test sa cada,
// pentru ca suita controllerului injecteaza un dublu peste fastArtifactsInstalled.
// Testul de fata compara direct cele doua contracte, nu logica fiecaruia separat.
test('contractul de proprietate al artefactelor private-ai este acelasi in installer si in controller', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  const controller = read('deploy/constructor-model-control.mjs')

  // Installerul ramane sursa de adevar si valideaza dupa nume de cont.
  assert.match(installer, /privateai:privateai:600:1/)
  assert.match(installer, /privateai:privateai:20419565568:1/)

  const fastArtifacts = controller.slice(
    controller.indexOf('function fastArtifactsInstalled('),
    controller.indexOf('function discoverFastModelPath('),
  )
  assert.ok(fastArtifacts.length > 0, 'fastArtifactsInstalled nu a putut fi izolata')

  // Controllerul nu are voie sa compare proprietarul cu un uid/gid literal:
  // identitatile conturilor difera de la o gazda la alta, iar 10050 este gid-ul
  // grupului kelion-app, nu al contului privateai.
  const numericOwnerComparison = /\b(?:uid|gid)\s*===\s*\d+/
  assert.doesNotMatch(
    fastArtifacts,
    numericOwnerComparison,
    'proprietarul artefactelor private-ai este comparat cu un identificator numeric fix',
  )

  // Trebuie rezolvat la rulare, exact contul pe care il cere installerul.
  assert.match(fastArtifacts, /privateAiIdentity\(\)/)
  const identity = controller.slice(
    controller.indexOf('function privateAiIdentity('),
    controller.indexOf('function fastArtifactsInstalled('),
  )
  assert.match(identity, /\/etc\/passwd[\s\S]*privateai:/)
  assert.match(identity, /\/etc\/group[\s\S]*privateai:/)
})
