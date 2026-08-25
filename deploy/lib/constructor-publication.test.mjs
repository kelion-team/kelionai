import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLease } from './constructor-service-client.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

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
  assert.match(release, /readyPayload\?\.ready === true && readyPayload\?\.release\?\.sideEffectsActive === true/)
  assert.match(release, /!readyResponse\.ok \|\| !activeReady/)
})

test('cheia privată de semnare rămâne root-only și ajunge la publisher numai prin LoadCredential', () => {
  const workflow = read('.github/workflows/vps-run.yml')
  assert.match(workflow, /chown root:root "[$]signing_key"; chmod 0400 "[$]signing_key"/)
  assert.doesNotMatch(workflow, /chown root:kelion-publisher "[$]signing_key"|chmod 0440 "[$]signing_key"/)
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
  assert.match(publisher, /ReadOnlyPaths=\/var\/lib\/kelion-constructor-handoff/)
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
  }
})

test('installerul canonic lasă toate serviciile dezactivate și nu creează secrete', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  assert.match(installer, /KELION_CONSTRUCTOR_INSTALL/)
  assert.match(installer, /systemd-analyze verify/)
  assert.match(installer, /kelion-worker\.config\.toml/)
  assert.match(installer, /rm -f --[\s\S]*codex-worker\.enabled[\s\S]*constructor-publisher\.enabled[\s\S]*constructor-release\.enabled/)
  assert.doesNotMatch(installer, /systemctl\s+(?:enable|start|restart)|openssl\s+rand|ghp_|github_pat_|CODEX_HOME=.*login/)
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
  assert.match(workflow, /run-name: production-\$\{\{ inputs\.release_request_id \}\}/)
  assert.match(workflow, /release_request_id:[\s\S]*required: true/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /CANDIDATE_SHA[\s\S]*origin\/master/)
  assert.match(workflow, /pr-verify\.yml\/runs[\s\S]*build-images\.yml\/runs/)
  assert.doesNotMatch(workflow, /pull_request_target|continue-on-error/)
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
