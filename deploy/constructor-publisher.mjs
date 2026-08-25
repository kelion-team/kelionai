#!/usr/bin/env node
// Publisher separat: primește exclusiv patch-uri cu porți verzi, recreează
// commitul într-un worktree fără credentiale Codex, revalidează porțile, apoi
// poate împinge numai refs/heads/codex/<task UUID> și deschide/îmbina un PR.

import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  assertLoopbackApi,
  canonicalJson,
  fail,
  loadSystemdCredential,
  postInternal,
  sha256,
  signedServiceHeaders,
  startLease,
  strictJobIdentity,
  systemdCredentialPath,
} from './lib/constructor-service-client.mjs'
import { githubRequest, validateRepository } from './lib/github-fixed-client.mjs'

const API = assertLoopbackApi(process.env.KELION_CONSTRUCTOR_API ?? 'http://127.0.0.1:8080/')
const ENABLED = process.env.CONSTRUCTOR_PUBLISHER_EXEC_ENABLED === '1'
const ENABLE_MARKER = process.env.CONSTRUCTOR_PUBLISHER_ENABLE_MARKER ?? '/etc/kelion/constructor-publisher.enabled'
const REPOSITORY = process.env.KELION_GITHUB_REPOSITORY ?? ''
const REPO = resolve(process.env.CONSTRUCTOR_PUBLISHER_REPO ?? '/var/lib/kelion-publisher/repo')
const STATE = resolve(process.env.CONSTRUCTOR_PUBLISHER_STATE ?? '/var/lib/kelion-publisher/state')
const HANDOFF_READY = resolve(process.env.CODEX_HANDOFF_READY ?? '/var/lib/kelion-constructor-handoff/ready')
const GATE_IMAGE = process.env.KELION_CODEX_GATE_IMAGE ?? ''
const REQUIRED_CHECKS = (process.env.CONSTRUCTOR_REQUIRED_CHECKS ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean)
const AUTHOR_NAME = process.env.CONSTRUCTOR_GIT_AUTHOR_NAME ?? ''
const AUTHOR_EMAIL = process.env.CONSTRUCTOR_GIT_AUTHOR_EMAIL ?? ''
const SIGNING_FINGERPRINT = process.env.CONSTRUCTOR_GIT_SIGNING_FINGERPRINT ?? ''
const ASKPASS = resolve(process.env.CONSTRUCTOR_GITHUB_ASKPASS ?? '/opt/kelion-constructor/github-askpass.sh')
const PREFIX = 'x-constructor-publisher'
const MAX_PATCH = 16 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function gitEnv(extra = {}) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  }
}

function git(args, cwd, options = {}) {
  return spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: options.env ?? gitEnv(),
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 512 * 1024,
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
  })
}

function gitOutput(args, cwd, env = gitEnv()) {
  const result = git(args, cwd, { env })
  if (result.status !== 0) fail(`Git a refuzat operația ${args[0]}`)
  return String(result.stdout ?? '').trim()
}

function assertEnabledLayout() {
  if (!ENABLED || !existsSync(ENABLE_MARKER)) fail('Publisherul este dezactivat explicit')
  if (process.platform !== 'linux' || process.getuid?.() === 0) fail('Publisherul rulează numai non-root pe Linux')
  validateRepository(REPOSITORY)
  if (REPO !== '/var/lib/kelion-publisher/repo' || STATE !== '/var/lib/kelion-publisher/state' || HANDOFF_READY !== '/var/lib/kelion-constructor-handoff/ready') {
    fail('Layout publisher necanonic')
  }
  if (REQUIRED_CHECKS.length < 2 || new Set(REQUIRED_CHECKS).size !== REQUIRED_CHECKS.length) fail('Lista controalelor CI este invalidă')
  if (!/^[A-Za-z0-9 ._-]{2,80}$/.test(AUTHOR_NAME) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(AUTHOR_EMAIL)) fail('Identitatea Git a publisherului este invalidă')
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(SIGNING_FINGERPRINT)) fail('Fingerprintul cheii de semnare Git este invalid')
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/codex-gates@sha256:[0-9a-f]{64}$/.test(GATE_IMAGE)) fail('Imagine gate nefixată prin digest')
  const remote = gitOutput(['remote', 'get-url', 'origin'], REPO)
  if (remote !== `https://github.com/${REPOSITORY}.git`) fail('Remote publisher necanonic')
  const dangerous = git(['config', '--local', '--get-regexp', '^(credential\\.|http\\..*\\.extraheader|filter\\.|core\\.hooksPath|core\\.fsmonitor|include\\.|includeIf\\.)'], REPO)
  if (dangerous.status === 0 && String(dangerous.stdout ?? '').trim()) fail('Config Git executabil sau de credentiale')
  const askpass = statSync(ASKPASS)
  if (!askpass.isFile() || (askpass.mode & 0o022) !== 0 || askpass.uid !== 0) fail('Askpass trebuie să fie root-owned și read-only')
}

function readHandoff(job) {
  const handoffId = String(job.handoffId ?? '').toLowerCase()
  const baseCommit = String(job.baseCommit ?? '').toLowerCase()
  const patchSha256 = String(job.patchSha256 ?? '').toLowerCase()
  const receiptSha256 = String(job.gateReceiptSha256 ?? '').toLowerCase()
  if (!UUID.test(handoffId) || !/^[0-9a-f]{40}$/.test(baseCommit) || !/^[0-9a-f]{64}$/.test(patchSha256) || !/^[0-9a-f]{64}$/.test(receiptSha256)) {
    fail('Claim-ul publisherului nu conține handoff valid')
  }
  const root = realpathSync(HANDOFF_READY)
  const directory = resolve(root, handoffId)
  if (!directory.startsWith(`${root}/`) || realpathSync(directory) !== directory) fail('Handoff în afara spool-ului')
  const entries = readdirSync(directory).sort()
  if (entries.join(',') !== 'patch.diff,receipt.json') fail('Handoff-ul conține fișiere neașteptate')
  const patchPath = join(directory, 'patch.diff')
  const receiptPath = join(directory, 'receipt.json')
  for (const path of [directory, patchPath, receiptPath]) {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || (path === directory ? !info.isDirectory() : !info.isFile()) || (info.mode & 0o007) !== 0 || (info.mode & 0o020) !== 0) {
      fail('Permisiuni handoff invalide')
    }
  }
  const patchInfo = statSync(patchPath)
  const receiptInfo = statSync(receiptPath)
  if (patchInfo.size < 1 || patchInfo.size > MAX_PATCH || receiptInfo.size < 2 || receiptInfo.size > 16_384) fail('Dimensiune handoff invalidă')
  const patch = readFileSync(patchPath)
  const receiptBytes = readFileSync(receiptPath)
  if (sha256(patch) !== patchSha256 || sha256(receiptBytes) !== receiptSha256) fail('Hash handoff diferit de claim')
  const receipt = JSON.parse(receiptBytes.toString('utf8'))
  if (
    canonicalJson(receipt) + '\n' !== receiptBytes.toString('utf8')
    || receipt.schema !== 1
    || receipt.kind !== 'kelion-constructor-handoff'
    || receipt.jobId !== String(job.jobId)
    || receipt.taskId !== job.taskId
    || receipt.handoffId !== handoffId
    || receipt.baseCommit !== baseCommit
    || receipt.patchSha256 !== patchSha256
    || receipt.gateImage !== GATE_IMAGE
    || !Number.isFinite(Date.parse(receipt.passedAt))
  ) fail('Receipt handoff necanonic sau nelegat de claim')
  return { directory, patch, receipt, baseCommit, patchSha256 }
}

function gateArgs(worktree) {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  return [
    'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=all',
    '--security-opt=no-new-privileges', '--pids-limit=512', '--memory=4g', '--cpus=2',
    '--userns=keep-id', '--user', `${uid}:${gid}`,
    '--tmpfs', `/work:rw,nosuid,nodev,size=6g,uid=${uid},gid=${gid}`,
    '--mount', `type=bind,src=${worktree},dst=/source,ro=true`,
    '--env', 'HOME=/nonexistent', '--env', 'CI=1', GATE_IMAGE,
  ]
}

function runIgnoringOutput(command, args, env, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env, stdio: 'ignore', windowsHide: true })
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) child.kill('SIGTERM')
    }, timeoutMs)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectPromise(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(code ?? 1)
    })
  })
}

function prepareCommitSigning() {
  const keyPath = systemdCredentialPath(
    'github-publisher-signing-key',
    process.env.GITHUB_PUBLISHER_SIGNING_KEY_FILE,
    32_768,
  )
  const sshEnv = {
    PATH: '/usr/bin:/bin',
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    SSH_ASKPASS_REQUIRE: 'never',
    SSH_AUTH_SOCK: '',
  }
  const fingerprintResult = spawnSync('/usr/bin/ssh-keygen', ['-lf', keyPath, '-E', 'sha256'], {
    env: sshEnv,
    encoding: 'utf8',
    maxBuffer: 16_384,
    timeout: 5_000,
    windowsHide: true,
  })
  const fingerprintOutput = String(fingerprintResult.stdout ?? '').trim()
  const fingerprintMatch = fingerprintOutput.match(/^\d+ (SHA256:[A-Za-z0-9+/]{43}) .+ \(ED25519\)$/)
  if (
    fingerprintResult.status !== 0
    || fingerprintMatch?.[1] !== SIGNING_FINGERPRINT
  ) fail('Cheia de semnare Git nu corespunde fingerprintului ED25519 configurat')

  const publicKeyResult = spawnSync('/usr/bin/ssh-keygen', ['-y', '-f', keyPath], {
    env: sshEnv,
    encoding: 'utf8',
    maxBuffer: 16_384,
    timeout: 5_000,
    windowsHide: true,
  })
  const publicKey = String(publicKeyResult.stdout ?? '').trim()
  if (publicKeyResult.status !== 0 || !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
    fail('Cheia de semnare Git trebuie să fie ED25519 și necriptată pentru serviciul izolat')
  }
  const allowedSigners = join(STATE, 'allowed-signers')
  writeFileSync(allowedSigners, `${AUTHOR_EMAIL} ${publicKey}\n`, { mode: 0o600 })
  chmodSync(allowedSigners, 0o600)
  return { keyPath, allowedSigners }
}

async function recreateCommit(handoff, identity, signing) {
  const workRoot = mkdtempSync(join(STATE, '.publish-'))
  const worktree = join(workRoot, 'worktree')
  const branch = `codex/${identity.taskId.slice('codex-'.length)}`
  try {
    if (git(['worktree', 'add', '--detach', worktree, handoff.baseCommit], REPO).status !== 0) fail('Nu am putut crea worktree publisher')
    const applied = git(['apply', '--index', '--binary', '--whitespace=error-all', '--'], worktree, { input: handoff.patch, encoding: 'buffer', maxBuffer: MAX_PATCH })
    if (applied.status !== 0) fail('Patch-ul nu se aplică exact peste baza declarată')
    const canonicalPatch = git(['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', handoff.baseCommit, '--'], worktree, { maxBuffer: MAX_PATCH })
    if (canonicalPatch.status !== 0 || sha256(Buffer.from(String(canonicalPatch.stdout ?? ''), 'utf8')) !== handoff.patchSha256) fail('Patch-ul recreat nu are hash-ul declarat')
    const gateCode = await runIgnoringOutput('/usr/bin/podman', gateArgs(worktree), { PATH: '/usr/bin:/bin', HOME: '/var/lib/kelion-publisher', XDG_RUNTIME_DIR: '/run/kelion-publisher', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, 45 * 60_000)
    if (gateCode !== 0) fail('Porțile offline ale publisherului au eșuat')
    const commitEnv = gitEnv({
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      GIT_AUTHOR_DATE: handoff.receipt.passedAt,
      GIT_COMMITTER_DATE: handoff.receipt.passedAt,
    })
    const signingConfig = [
      '-c', 'gpg.format=ssh',
      '-c', `user.signingkey=${signing.keyPath}`,
    ]
    if (git([...signingConfig, 'commit', '--no-verify', '-S', '-m', `Constructor ${identity.taskId}`], worktree, { env: commitEnv }).status !== 0) {
      fail('Commitul semnat al publisherului a eșuat')
    }
    const headCommit = gitOutput(['rev-parse', 'HEAD'], worktree, commitEnv)
    if (!/^[0-9a-f]{40}$/.test(headCommit)) fail('SHA commit invalid')
    const verified = git([
      '-c', 'gpg.format=ssh',
      '-c', `gpg.ssh.allowedSignersFile=${signing.allowedSigners}`,
      'verify-commit', headCommit,
    ], worktree, { env: commitEnv })
    if (verified.status !== 0) fail('Semnătura commitului publisherului nu poate fi verificată local')
    return { workRoot, worktree, branch, headCommit }
  } catch (error) {
    git(['worktree', 'remove', '--force', '--', worktree], REPO)
    rmSync(workRoot, { recursive: true, force: true })
    throw error
  }
}

function tokenPath() {
  return loadSystemdCredential('github-publisher-token', process.env.GITHUB_PUBLISHER_TOKEN_FILE)
}

const github = (token, path, method = 'GET', body = undefined) =>
  githubRequest(token, REPOSITORY, path, method, body)

async function validateProtection(token) {
  const [protection, requiredSignatures] = await Promise.all([
    github(token, `/repos/${REPOSITORY}/branches/master/protection`),
    github(token, `/repos/${REPOSITORY}/branches/master/protection/required_signatures`),
  ])
  const contexts = new Set([
    ...(protection?.required_status_checks?.contexts ?? []),
    ...(protection?.required_status_checks?.checks ?? []).map((item) => item.context),
  ])
  const reviews = protection?.required_pull_request_reviews
  if (
    protection?.required_status_checks?.strict !== true
    || !REQUIRED_CHECKS.every((name) => contexts.has(name))
    || protection?.enforce_admins?.enabled !== true
    || !Number.isSafeInteger(reviews?.required_approving_review_count)
    || reviews.required_approving_review_count < 1
    || reviews.dismiss_stale_reviews !== true
    || protection?.required_conversation_resolution?.enabled !== true
    || protection?.required_linear_history?.enabled !== true
    || requiredSignatures?.enabled !== true
    || protection?.allow_force_pushes?.enabled !== false
    || protection?.allow_deletions?.enabled !== false
  ) fail('Protecția ramurii master nu corespunde politicii Constructor')
}

async function pushBranch(tokenFile, built) {
  const remoteRef = git(['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${built.branch}`], REPO)
  if (remoteRef.status === 0) {
    const existing = String(remoteRef.stdout ?? '').trim().split(/\s+/)[0]
    if (existing !== built.headCommit) fail('Ramura Constructor există cu alt commit')
    return
  }
  const env = gitEnv({ GIT_ASKPASS: ASKPASS, KELION_GITHUB_TOKEN_FILE: tokenFile })
  const pushed = git(['push', 'origin', `HEAD:refs/heads/${built.branch}`], built.worktree, { env, timeout: 180_000 })
  if (pushed.status !== 0) fail('Push-ul ramurii Constructor a eșuat')
}

async function openOrReusePr(token, branch, headCommit, taskId) {
  const owner = REPOSITORY.split('/')[0]
  const query = `/repos/${REPOSITORY}/pulls?state=all&base=master&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`
  const existing = await github(token, query)
  const matching = Array.isArray(existing) ? existing.filter((pr) => pr?.head?.sha === headCommit && pr?.base?.ref === 'master') : []
  if (matching.length > 1) fail('Mai multe PR-uri corespund aceluiași handoff')
  if (matching.length === 1) return matching[0]
  return github(token, `/repos/${REPOSITORY}/pulls`, 'POST', {
    title: `Constructor ${taskId}`,
    head: branch,
    base: 'master',
    body: 'Patch produs în sandbox, revalidat de publisherul izolat și supus tuturor controalelor obligatorii.',
    draft: false,
  })
}

async function waitForGreen(token, prNumber, headCommit, renew) {
  const deadline = Date.now() + 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
    if (pr?.state !== 'open' || pr?.head?.sha !== headCommit || pr?.base?.ref !== 'master') fail('PR-ul și-a schimbat identitatea')
    const checks = await github(token, `/repos/${REPOSITORY}/commits/${headCommit}/check-runs?per_page=100`)
    const byName = new Map((checks?.check_runs ?? []).map((check) => [check.name, check]))
    const required = REQUIRED_CHECKS.map((name) => byName.get(name))
    const failed = required.some((check) => check && check.status === 'completed' && check.conclusion !== 'success')
    if (failed) fail('Un control CI obligatoriu a eșuat')
    const reviews = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}/reviews?per_page=100`)
    const approved = Array.isArray(reviews) && reviews.some((review) =>
      review?.state === 'APPROVED' && review?.commit_id === headCommit,
    )
    if (required.every((check) => check?.status === 'completed' && check?.conclusion === 'success') && approved) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))
  }
  fail('Timeout așteptând controalele CI obligatorii și aprobarea umană')
}

async function requiredChecksAreGreen(token, headCommit) {
  const checks = await github(token, `/repos/${REPOSITORY}/commits/${headCommit}/check-runs?per_page=100`)
  const byName = new Map((checks?.check_runs ?? []).map((check) => [check.name, check]))
  return REQUIRED_CHECKS.every((name) => {
    const check = byName.get(name)
    return check?.status === 'completed' && check?.conclusion === 'success'
  })
}

async function recoverMergedPr(token, job, identity) {
  if (job.prNumber == null && job.headCommit == null && job.prUrl == null) return null
  const prNumber = Number(job.prNumber)
  const headCommit = String(job.headCommit ?? '').toLowerCase()
  const prUrl = String(job.prUrl ?? '')
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || !/^[0-9a-f]{40}$/.test(headCommit) || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}`) {
    fail('Receiptul PR din claim este invalid')
  }
  const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
  if (pr?.head?.sha !== headCommit || pr?.base?.ref !== 'master' || pr?.html_url !== prUrl) fail('PR-ul recuperat și-a schimbat identitatea')
  if (pr?.merged !== true) {
    if (pr?.state !== 'open') fail('PR-ul a fost închis fără merge')
    return null
  }
  const commit = String(pr?.merge_commit_sha ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit) || !await requiredChecksAreGreen(token, headCommit)) fail('Merge-ul recuperat nu are controalele obligatorii verzi')
  const comparison = await github(token, `/repos/${REPOSITORY}/compare/${commit}...master`)
  if (!['ahead', 'identical'].includes(comparison?.status) || comparison?.merge_base_commit?.sha !== commit) fail('Commitul recuperat nu este în master')
  return { prNumber, prUrl, headCommit, commit }
}

function receiptHash(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'))
}

async function runOnce() {
  assertEnabledLayout()
  mkdirSync(STATE, { recursive: true, mode: 0o700 })
  const hmac = loadSystemdCredential('constructor-publisher-secret', process.env.CONSTRUCTOR_PUBLISHER_SECRET_FILE)
  const githubCredential = tokenPath()
  const authenticatedGitEnv = gitEnv({
    GIT_ASKPASS: ASKPASS,
    KELION_GITHUB_TOKEN_FILE: githubCredential.path,
  })
  const claim = await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: '/api/internal/constructor-publisher/jobs/claim', body: {} })
  if (!claim?.job) return
  const identity = strictJobIdentity(claim.job)
  const signing = prepareCommitSigning()
  const leasePath = `/api/internal/constructor-publisher/jobs/${identity.jobId}/lease`
  const renewLease = () => postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  const stopLease = startLease({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  let built
  try {
    await stopLease.assert()
    await validateProtection(githubCredential.value)
    const recovered = await recoverMergedPr(githubCredential.value, claim.job, identity)
    if (recovered) {
      await stopLease.assert()
      const mergedReceipt = receiptHash({ schema: 1, kind: 'publisher-merge', jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, checks: [...REQUIRED_CHECKS].sort() })
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'merged', headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, receiptSha256: mergedReceipt } })
      writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, mergedReceipt })}\n`, { mode: 0o600 })
      return
    }
    const fetched = git(['fetch', '--prune', '--no-tags', 'origin', '+refs/heads/master:refs/remotes/origin/master'], REPO, { env: authenticatedGitEnv, timeout: 180_000 })
    if (fetched.status !== 0) fail('Fetch public origin/master a eșuat')
    await stopLease.assert()
    const handoff = readHandoff({ ...claim.job, ...identity })
    if (gitOutput(['rev-parse', 'origin/master^{commit}'], REPO) !== handoff.baseCommit) fail('Baza handoff-ului nu mai este vârful master; rebase automat interzis')
    built = await recreateCommit(handoff, identity, signing)
    await stopLease.assert()
    await pushBranch(githubCredential.path, built)
    await stopLease.assert()
    const pr = await openOrReusePr(githubCredential.value, built.branch, built.headCommit, identity.taskId)
    const prNumber = Number(pr?.number)
    const prUrl = String(pr?.html_url ?? '')
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}`) fail('Răspuns PR invalid')
    const openedReceipt = receiptHash({ schema: 1, kind: 'publisher-pr', jobId: identity.jobId, taskId: identity.taskId, baseCommit: handoff.baseCommit, patchSha256: handoff.patchSha256, branch: built.branch, headCommit: built.headCommit, prNumber, prUrl })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'pr_opened', branch: built.branch, headCommit: built.headCommit, prNumber, prUrl, receiptSha256: openedReceipt } })
    await waitForGreen(githubCredential.value, prNumber, built.headCommit, renewLease)
    await stopLease.assert()
    if (gitOutput(['ls-remote', 'origin', 'refs/heads/master'], REPO, authenticatedGitEnv).split(/\s+/)[0] !== handoff.baseCommit) fail('Master s-a schimbat înainte de merge; revalidare necesară')
    const merged = await github(githubCredential.value, `/repos/${REPOSITORY}/pulls/${prNumber}/merge`, 'PUT', { sha: built.headCommit, merge_method: 'squash' })
    const commit = String(merged?.sha ?? '').toLowerCase()
    if (merged?.merged !== true || !/^[0-9a-f]{40}$/.test(commit)) fail('GitHub nu a confirmat merge-ul exact')
    const master = await github(githubCredential.value, `/repos/${REPOSITORY}/git/ref/heads/master`)
    if (master?.object?.sha !== commit) fail('Master nu indică exact commitul de merge')
    await stopLease.assert()
    const mergedReceipt = receiptHash({ schema: 1, kind: 'publisher-merge', jobId: identity.jobId, taskId: identity.taskId, headCommit: built.headCommit, prNumber, commit, checks: [...REQUIRED_CHECKS].sort() })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'merged', headCommit: built.headCommit, prNumber, commit, receiptSha256: mergedReceipt } })
    writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, headCommit: built.headCommit, prNumber, commit, mergedReceipt })}\n`, { mode: 0o600 })
  } catch (error) {
    const code = error instanceof Error && /protecția|protection/i.test(error.message) ? 'branch_protection_invalid' : 'publisher_failed'
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'failed', code } }).catch(() => undefined)
    throw error
  } finally {
    await stopLease().catch(() => undefined)
    if (built) {
      git(['worktree', 'remove', '--force', '--', built.worktree], REPO)
      rmSync(built.workRoot, { recursive: true, force: true })
      git(['worktree', 'prune'], REPO)
    }
  }
}

function selfTest() {
  const body = { z: 1, a: true }
  const headers = signedServiceHeaders('0'.repeat(32), PREFIX, 'POST', '/api/internal/constructor-publisher/jobs/claim', body, '1787536800', '123e4567-e89b-42d3-a456-426614174000')
  if (!/^v1=[0-9a-f]{64}$/.test(headers[`${PREFIX}-signature`])) fail('HMAC publisher invalid')
  const id = strictJobIdentity({ jobId: '42', taskId: 'codex-123e4567-e89b-42d3-a456-426614174000', leaseId: '123e4567-e89b-42d3-a456-426614174001', leaseSeconds: 120 })
  if (`codex/${id.taskId.slice(6)}` !== 'codex/123e4567-e89b-42d3-a456-426614174000') fail('Branch publisher necanonic')
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(`SHA256:${'A'.repeat(43)}`)) fail('Validator fingerprint invalid')
  const environment = gitEnv()
  for (const forbidden of ['CODEX_HOME', 'OPENAI_API_KEY', 'VPS_SSH_KEY', 'GITHUB_TOKEN']) {
    if (forbidden in environment) fail(`Mediul Git conține ${forbidden}`)
  }
  process.stdout.write('constructor-publisher self-test: TRECE\n')
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') selfTest()
else if (mode === '--once') {
  if (!ENABLED || !existsSync(ENABLE_MARKER)) process.stdout.write('constructor-publisher: dezactivat\n')
  else await runOnce()
} else fail(`Mod necunoscut: ${mode}`)
