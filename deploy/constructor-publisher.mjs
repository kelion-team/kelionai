#!/usr/bin/env node
// Publisher separat: primește exclusiv patch-uri cu porți verzi, recreează
// commitul într-un worktree fără credentialele executorului OpenCode,
// revalidează porțile, apoi
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
  renameSync,
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
const CANONICAL_CI_WORKFLOW = '.github/workflows/pr-verify.yml'
const MAX_PATCH = 16 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PUBLISHER_FAILURE_CODES = new Set([
  'stale_base',
  'ci_failed',
  'local_gate_failed',
  'pr_closed',
  'branch_protection_invalid',
  'github_auth_required',
  'merged_unverifiable',
  'master_diverged',
  'publisher_failed',
])

function canonicalWorkflowRunPath(value) {
  return typeof value === 'string' && (
    value === CANONICAL_CI_WORKFLOW
    || (value.startsWith(`${CANONICAL_CI_WORKFLOW}@`) && /^@[A-Za-z0-9._/-]{1,300}$/.test(value.slice(CANONICAL_CI_WORKFLOW.length)))
  )
}

function publisherError(code, message) {
  if (!PUBLISHER_FAILURE_CODES.has(code)) fail('Cod de eroare publisher invalid')
  const error = new Error(message)
  error.publisherCode = code
  return error
}

function publisherFailureCode(error) {
  if (error instanceof Error && PUBLISHER_FAILURE_CODES.has(error.publisherCode)) return error.publisherCode
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/Commitul recuperat nu este în master/i.test(message)) return 'master_diverged'
  if (/Merge-ul recuperat nu are controalele obligatorii verzi/i.test(message)) return 'merged_unverifiable'
  if (/Baza handoff-ului.*master|Master s-a schimbat/i.test(message)) return 'stale_base'
  if (/control CI obligatoriu.*eșuat|controalele obligatorii verzi/i.test(message)) return 'ci_failed'
  if (/Porțile offline ale publisherului au eșuat/i.test(message)) return 'local_gate_failed'
  if (/PR-ul a fost închis fără merge/i.test(message)) return 'pr_closed'
  if (/Protecția ramurii master|branch protection/i.test(message)) return 'branch_protection_invalid'
  if (/Credentială GitHub invalidă|GitHub .*HTTP (?:401|403)\b|GitHub .*\/protection.*HTTP 404\b/i.test(message)) return 'github_auth_required'
  return 'publisher_failed'
}

function gitAuthFailed(result) {
  return /(?:authentication failed|could not read username|http basic: access denied|http (?:401|403)|permission denied)/i.test(
    `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`,
  )
}

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
  if (result.status !== 0) {
    if (args[0] === 'ls-remote' && gitAuthFailed(result)) throw publisherError('github_auth_required', 'GitHub a refuzat autentificarea la citirea ramurii remote')
    fail(`Git a refuzat operația ${args[0]}`)
  }
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

/** Remove material only after the backend durably acknowledged either merge or
 * retirement/requeue. Until that point the immutable handoff remains the
 * publisher's recovery source. */
function cleanupAcknowledgedHandoff(handoffIdRaw) {
  const handoffId = String(handoffIdRaw ?? '').toLowerCase()
  if (!UUID.test(handoffId)) fail('Identificator handoff invalid la retenție')
  const root = realpathSync(HANDOFF_READY)
  const directory = resolve(root, handoffId)
  if (!directory.startsWith(`${root}/`)) fail('Retenție handoff în afara spool-ului')
  if (existsSync(directory)) {
    const info = lstatSync(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Retenție handoff pe țintă necanonică')
    const retiredRoot = realpathSync(resolve(root, '..', 'retired'))
    const retired = resolve(retiredRoot, handoffId)
    if (!retired.startsWith(`${retiredRoot}/`) || existsSync(retired)) fail('Coliziune la retenția handoff')
    // Publisherul poate muta intrarea prin directoarele părinte partajate, dar
    // nu poate modifica patch-ul 0440/directorul 0750. Workerul proprietar
    // șterge recursiv numai după această retragere atomică.
    renameSync(directory, retired)
  }
  const ackRoot = resolve(root, '..', 'ack')
  const ack = resolve(ackRoot, `${handoffId}.recorded`)
  if (!ack.startsWith(`${ackRoot}/`)) fail('Retenție ACK în afara spool-ului')
  if (existsSync(ack)) {
    const info = lstatSync(ack)
    if (info.isSymbolicLink() || !info.isFile()) fail('Retenție ACK pe țintă necanonică')
    try {
      rmSync(ack, { force: false })
    } catch (error) {
      // Materialul voluminos a fost deja eliminat; un ACK mic rămas este
      // vizibil în jurnal și nu poate recrea sau publica un handoff.
      console.warn(`[constructor-publisher] ACK-ul ${handoffId} nu a putut fi curățat: ${String(error).slice(0, 160)}`)
    }
  }
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

function runIgnoringOutput(command, args, env, timeoutMs, terminateGraceMs = 5_000, hardSettleMs = 2_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env, stdio: 'ignore', windowsHide: true })
    let settled = false
    let timedOut = false
    let killTimer
    let hardSettleTimer
    const clearTimers = () => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (hardSettleTimer) clearTimeout(hardSettleTimer)
    }
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (settled) return
        child.kill('SIGKILL')
        hardSettleTimer = setTimeout(() => {
          if (settled) return
          settled = true
          child.removeAllListeners()
          child.unref()
          clearTimers()
          resolvePromise(124)
        }, hardSettleMs)
      }, terminateGraceMs)
    }, timeoutMs)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimers()
      rejectPromise(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimers()
      resolvePromise(timedOut ? 124 : (code ?? 1))
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
  // `ssh-keygen -y` reproduce si comentariul cheii, cand acesta exista - iar
  // cheile generate cu -C il au aproape intotdeauna. Pastram doar tipul si
  // blobul; comentariul nu face parte din identitatea criptografica.
  const publicKeyRaw = String(publicKeyResult.stdout ?? '').trim()
  const publicKey = publicKeyRaw.split(/\s+/).slice(0, 2).join(' ')
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
    let gateCode
    try {
      gateCode = await runIgnoringOutput('/usr/bin/podman', gateArgs(worktree), { PATH: '/usr/bin:/bin', HOME: '/var/lib/kelion-publisher', XDG_RUNTIME_DIR: '/run/kelion-publisher', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, 45 * 60_000)
    } catch {
      throw publisherError('local_gate_failed', 'Porțile offline ale publisherului nu au putut porni')
    }
    if (gateCode !== 0) throw publisherError('local_gate_failed', 'Porțile offline ale publisherului au eșuat')
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

async function publisherUpstreamPreflight(token) {
  const [repository, workflow, workflowFile, protectionPolicy] = await Promise.all([
    github(token, `/repos/${REPOSITORY}`),
    github(token, `/repos/${REPOSITORY}/actions/workflows/pr-verify.yml`),
    github(token, `/repos/${REPOSITORY}/contents/.github/workflows/pr-verify.yml?ref=master`),
    validateProtection(token),
  ])
  const permissions = repository?.permissions ?? {}
  if (repository?.full_name !== REPOSITORY || ![permissions.push, permissions.maintain, permissions.admin].some((value) => value === true)) {
    throw publisherError('github_auth_required', 'Credentiala publisher nu are rol write/maintain/admin pe repository-ul exact')
  }
  if (workflow?.path !== CANONICAL_CI_WORKFLOW || workflow?.state !== 'active') {
    throw publisherError('branch_protection_invalid', 'Workflow-ul CI canonic nu este activ')
  }
  if (
    workflowFile?.type !== 'file'
    || workflowFile?.path !== CANONICAL_CI_WORKFLOW
    || !/^[0-9a-f]{40}$/.test(String(workflowFile?.sha ?? '').toLowerCase())
    || Number(workflowFile?.size) <= 0
  ) throw publisherError('branch_protection_invalid', 'Conținutul workflow-ului CI canonic nu poate fi verificat pe master')
  return protectionPolicy
}

async function reportPublisherPreflightFailure(hmac, error) {
  const code = publisherFailureCode(error)
  await postInternal({
    api: API,
    secret: hmac,
    prefix: PREFIX,
    path: '/api/internal/constructor-publisher/heartbeat',
    body: { state: 'degraded', detail: `publisher upstream preflight: ${code}` },
  }).catch(() => undefined)
}

function currentHeadApprovalCount(reviews, headCommit, submittedNoLaterThan = null) {
  return currentHeadApprovedReviews(reviews, headCommit, submittedNoLaterThan).length
}

function currentHeadApprovedReviews(reviews, headCommit, submittedNoLaterThan = null) {
  const decisive = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])
  const cutoff = submittedNoLaterThan === null ? null : Date.parse(submittedNoLaterThan)
  if (submittedNoLaterThan !== null && !Number.isFinite(cutoff)) fail('Timestampul merge-ului recuperat este invalid')
  const latestByReviewer = new Map()
  const ordered = [...reviews]
    .filter((review) =>
      review?.commit_id === headCommit
      && decisive.has(String(review?.state ?? ''))
      && Number.isSafeInteger(Number(review?.id))
      && Number(review.id) > 0
      && Number.isSafeInteger(Number(review?.user?.id))
      && Number(review.user.id) > 0
      && (cutoff === null || (
        Number.isFinite(Date.parse(String(review?.submitted_at ?? '')))
        && Date.parse(String(review.submitted_at)) <= cutoff
      )),
    )
    .sort((left, right) => Number(left.id) - Number(right.id))
  for (const review of ordered) latestByReviewer.set(Number(review.user.id), review)
  return [...latestByReviewer.values()].filter((review) => review.state === 'APPROVED')
}

async function eligibleCurrentHeadApprovalCount(token, reviews, headCommit, submittedNoLaterThan = null) {
  const approved = currentHeadApprovedReviews(reviews, headCommit, submittedNoLaterThan)
  let eligible = 0
  for (const review of approved) {
    const login = review?.user?.login
    const id = Number(review?.user?.id)
    if (typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
      throw publisherError('branch_protection_invalid', 'Identitatea reviewerului GitHub este invalidă')
    }
    const permission = await github(token, `/repos/${REPOSITORY}/collaborators/${encodeURIComponent(login)}/permission`)
    if (Number(permission?.user?.id) !== id || String(permission?.user?.login ?? '').toLowerCase() !== login.toLowerCase()) {
      throw publisherError('branch_protection_invalid', 'Dovada permisiunii reviewerului nu corespunde identității review-ului')
    }
    if (['write', 'maintain', 'admin'].includes(String(permission?.permission ?? ''))) eligible += 1
  }
  return eligible
}

async function paginatedReviews(token, prNumber) {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    const reviews = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}/reviews?per_page=100&page=${page}`)
    if (!Array.isArray(reviews)) fail('Lista review-urilor GitHub este invalidă')
    all.push(...reviews)
    if (reviews.length < 100) return all
  }
  fail('Paginarea review-urilor GitHub a depășit fereastra sigură')
}

function hasExactRequiredCheckNames(contexts, requiredChecks) {
  return contexts.size === requiredChecks.length
    && requiredChecks.every((name) => contexts.has(name))
}

function emptyNamedActorSet(value) {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return ['users', 'teams', 'apps'].every((key) => Array.isArray(value[key]) && value[key].length === 0)
}

async function paginatedActiveBranchRules(token) {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    let rules
    try {
      rules = await github(token, `/repos/${REPOSITORY}/rules/branches/master?per_page=100&page=${page}`)
    } catch {
      throw publisherError('branch_protection_invalid', 'Regulile active aplicabile ramurii master nu pot fi citite')
    }
    if (!Array.isArray(rules)) {
      throw publisherError('branch_protection_invalid', 'Regulile active aplicabile ramurii master sunt necitibile')
    }
    all.push(...rules)
    if (rules.length < 100) return all
  }
  throw publisherError('branch_protection_invalid', 'Paginarea regulilor active pentru master nu este exhaustivă')
}

async function validateProtection(token) {
  const [protection, requiredSignatures, activeBranchRules] = await Promise.all([
    github(token, `/repos/${REPOSITORY}/branches/master/protection`),
    github(token, `/repos/${REPOSITORY}/branches/master/protection/required_signatures`),
    paginatedActiveBranchRules(token),
  ])
  if (activeBranchRules.length !== 0) {
    throw publisherError('branch_protection_invalid', 'Un ruleset activ nesuportat se aplică ramurii master')
  }
  const configuredContexts = protection?.required_status_checks?.contexts
  const configuredChecks = protection?.required_status_checks?.checks ?? []
  if (
    !Array.isArray(configuredContexts)
    || !Array.isArray(configuredChecks)
    || configuredContexts.some((value) => typeof value !== 'string' || value.length === 0)
    || configuredChecks.some((item) => typeof item?.context !== 'string' || item.context.length === 0)
  ) throw publisherError('branch_protection_invalid', 'Lista controalelor protejate este invalidă')
  const contexts = new Set([
    ...configuredContexts,
    ...configuredChecks.map((item) => item.context),
  ])
  const requiredChecks = REQUIRED_CHECKS.map((name) => {
    const matching = configuredChecks.filter((item) => item?.context === name)
    if (matching.length !== 1) {
      throw publisherError('branch_protection_invalid', `Protecția nu fixează o singură sursă pentru controlul ${name}`)
    }
    const configuredAppId = matching[0]?.app_id
    const appId = Number(configuredAppId)
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw publisherError('branch_protection_invalid', `App ID invalid pentru controlul ${name}`)
    }
    return { name, appId }
  })
  const reviews = protection?.required_pull_request_reviews
  // Pe repository-urile personale GitHub nu trimite deloc aceste campuri:
  // mecanismul de ocolire nu exista acolo, deci absenta lui este echivalenta
  // cu setul gol. Normalizam explicit aici; emptyNamedActorSet ramane
  // fail-closed pentru orice alt undefined neasteptat.
  const bypass = reviews?.bypass_pull_request_allowances ?? null
  const dismissalRestrictions = reviews?.dismissal_restrictions ?? null
  if (
    protection?.required_status_checks?.strict !== true
    || !hasExactRequiredCheckNames(contexts, REQUIRED_CHECKS)
    || protection?.enforce_admins?.enabled !== true
    || !Number.isSafeInteger(reviews?.required_approving_review_count)
    || reviews.required_approving_review_count < 1
    || reviews.dismiss_stale_reviews !== true
    || reviews.require_code_owner_reviews !== false
    || reviews.require_last_push_approval !== false
    || !emptyNamedActorSet(dismissalRestrictions)
    // Pe repository-urile personale GitHub nu expune deloc bypass allowances:
    // campul vine null, iar mecanismul nu exista, deci nimeni nu poate ocoli.
    // emptyNamedActorSet trateaza deja null ca set gol, ca la dismissal.
    || !emptyNamedActorSet(bypass)
    || protection?.required_conversation_resolution?.enabled !== true
    || protection?.required_linear_history?.enabled !== true
    || requiredSignatures?.enabled !== true
    || !emptyNamedActorSet(protection?.restrictions)
    || protection?.allow_force_pushes?.enabled !== false
    || protection?.allow_deletions?.enabled !== false
  ) throw publisherError('branch_protection_invalid', 'Protecția ramurii master nu corespunde politicii Constructor')
  return {
    requiredApprovalCount: reviews.required_approving_review_count,
    requiredChecks,
  }
}

async function pushBranch(tokenFile, built) {
  const env = gitEnv({ GIT_ASKPASS: ASKPASS, KELION_GITHUB_TOKEN_FILE: tokenFile })
  const remoteRef = git(['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${built.branch}`], REPO, { env })
  if (remoteRef.status === 0) {
    const existing = String(remoteRef.stdout ?? '').trim().split(/\s+/)[0]
    if (existing !== built.headCommit) fail('Ramura Constructor există cu alt commit')
    return
  }
  if (gitAuthFailed(remoteRef)) throw publisherError('github_auth_required', 'GitHub a refuzat autentificarea la citirea ramurii Constructor')
  const pushed = git(['push', 'origin', `HEAD:refs/heads/${built.branch}`], built.worktree, { env, timeout: 180_000 })
  if (pushed.status !== 0) {
    if (gitAuthFailed(pushed)) throw publisherError('github_auth_required', 'GitHub a refuzat autentificarea la push')
    fail('Push-ul ramurii Constructor a eșuat')
  }
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

async function retirePublication(token, tokenFile, identity, publication, code, protectionPolicy) {
  if (!publication) {
    return {
      merged: null,
      proof: {
        branch: null,
        headCommit: null,
        prNumber: null,
        cleanupReceiptSha256: receiptHash({
          schema: 1,
          kind: 'publisher-retirement',
          jobId: identity.jobId,
          taskId: identity.taskId,
          code,
          branch: null,
          headCommit: null,
          prNumber: null,
        }),
      },
    }
  }
  const { branch, headCommit, prNumber } = publication
  if (prNumber !== null) {
    const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
    if (
      pr?.head?.sha !== headCommit
      || pr?.base?.ref !== 'master'
      || pr?.html_url !== `https://github.com/${REPOSITORY}/pull/${prNumber}`
    ) fail('PR-ul nu poate fi retras deoarece identitatea lui s-a schimbat')
    if (pr?.merged === true) {
      const merged = await recoverMergedPr(token, {
        branch,
        prNumber,
        prUrl: pr.html_url,
        headCommit,
      }, identity, protectionPolicy)
      if (!merged) fail('PR-ul apare merged fără receipt recuperabil')
      return { merged, proof: null }
    }
    if (pr?.state === 'open') {
      const closed = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`, 'PATCH', { state: 'closed' })
      if (closed?.state !== 'closed' || closed?.merged === true) fail('GitHub nu a confirmat închiderea PR-ului eșuat')
    } else if (pr?.state !== 'closed') {
      fail('Starea PR-ului retras este invalidă')
    }
  }
  const env = gitEnv({ GIT_ASKPASS: ASKPASS, KELION_GITHUB_TOKEN_FILE: tokenFile })
  const removed = git(['push', 'origin', '--delete', branch], REPO, { env, timeout: 180_000 })
  if (removed.status !== 0) {
    const stillThere = git(['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], REPO, { env })
    if (gitAuthFailed(removed) || gitAuthFailed(stillThere)) {
      throw publisherError('github_auth_required', 'GitHub a refuzat ștergerea ramurii retrase')
    }
    if (stillThere.status === 0) fail('Ramura PR-ului retras există încă pe GitHub')
  }
  const verifyRemoved = git(['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], REPO, { env })
  if (gitAuthFailed(verifyRemoved)) throw publisherError('github_auth_required', 'GitHub a refuzat verificarea ramurii retrase')
  if (verifyRemoved.status === 0) fail('Ramura PR-ului retras nu a fost ștearsă')
  const cleanupReceiptSha256 = receiptHash({
    schema: 1,
    kind: 'publisher-retirement',
    jobId: identity.jobId,
    taskId: identity.taskId,
    code,
    branch,
    headCommit,
    prNumber,
    prClosed: prNumber !== null,
    branchDeleted: true,
  })
  return {
    merged: null,
    proof: { branch, headCommit, prNumber, cleanupReceiptSha256 },
  }
}

async function paginatedCheckRuns(token, headCommit) {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(token, `/repos/${REPOSITORY}/commits/${headCommit}/check-runs?filter=all&per_page=100&page=${page}`)
    const runs = response?.check_runs
    if (!Array.isArray(runs)) fail('Lista check-run-urilor GitHub este invalidă')
    all.push(...runs)
    if (runs.length < 100) return all
  }
  fail('Paginarea check-run-urilor GitHub a depășit fereastra sigură')
}

function checkCoordinates(check, repository = REPOSITORY) {
  try {
    const url = new URL(String(check?.details_url ?? ''))
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]*)\/job\/([1-9][0-9]*)$/)
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'github.com'
      || url.username
      || url.password
      || url.search
      || url.hash
      || !match
      || match[1] !== repository
    ) return null
    const runId = Number(match[2])
    const jobId = Number(match[3])
    return Number.isSafeInteger(runId) && Number.isSafeInteger(jobId)
      ? { runId, jobId }
      : null
  } catch { return null }
}

async function paginatedRunJobs(token, runId) {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`)
    const jobs = response?.jobs
    if (!Array.isArray(jobs)) fail('Lista joburilor runului CI este invalidă')
    all.push(...jobs)
    if (jobs.length < 100) return all
  }
  fail('Paginarea joburilor runului CI a depășit fereastra sigură')
}

async function workflowSourceSha(token, ref) {
  const source = await github(token, `/repos/${REPOSITORY}/contents/${CANONICAL_CI_WORKFLOW}?ref=${encodeURIComponent(ref)}`)
  if (source?.type !== 'file' || !/^[0-9a-f]{40}$/.test(String(source?.sha ?? ''))) {
    throw publisherError('ci_failed', 'Sursa workflow-ului CI canonic nu poate fi verificată')
  }
  return source.sha
}

function checkMatchesPullRequestIdentity(check, prNumber, headCommit, headBranch, requireAssociation) {
  if (check?.head_sha !== headCommit) return false
  if (!Array.isArray(check?.pull_requests) || check.pull_requests.length === 0) return !requireAssociation
  return check.pull_requests.every((pr) =>
    Number(pr?.number) === prNumber
    && pr?.head?.sha === headCommit
    && pr?.head?.ref === headBranch
    && pr?.head?.repo?.url === `https://api.github.com/repos/${REPOSITORY}`
    && pr?.base?.ref === 'master'
    && pr?.base?.repo?.url === `https://api.github.com/repos/${REPOSITORY}`)
}

function requiredCheckRuns(checkRuns, policies, completedNoLaterThan = null) {
  const cutoff = completedNoLaterThan === null ? null : Date.parse(completedNoLaterThan)
  if (completedNoLaterThan !== null && !Number.isFinite(cutoff)) fail('Timestampul merge-ului recuperat este invalid')
  return policies.map((policy) => {
    const matching = checkRuns
      .filter((check) =>
        check?.name === policy.name
        && Number.isSafeInteger(Number(check?.id))
        && Number(check.id) > 0
        && Number(check?.app?.id) === policy.appId
        && (cutoff === null || (
          Number.isFinite(Date.parse(String(check?.started_at ?? '')))
          && Date.parse(String(check.started_at)) <= cutoff
        )),
      )
      .sort((left, right) => Number(left.id) - Number(right.id))
    return matching.at(-1)
  })
}

function requiredCheckRunsAreGreen(checkRuns, policies, completedNoLaterThan = null) {
  const cutoff = completedNoLaterThan === null ? null : Date.parse(completedNoLaterThan)
  const selected = requiredCheckRuns(checkRuns, policies, completedNoLaterThan)
  return selected.every((check) => {
    if (check?.status !== 'completed' || check?.conclusion !== 'success') return false
    if (cutoff === null) return true
    const completedAt = Date.parse(String(check?.completed_at ?? ''))
    return Number.isFinite(completedAt) && completedAt <= cutoff
  })
}

async function canonicalRequiredCheckRuns(
  token,
  prNumber,
  headCommit,
  headBranch,
  baseCommit,
  checkRuns,
  policies,
  completedNoLaterThan = null,
) {
  if (!/^[0-9a-f]{40}$/.test(baseCommit)) throw publisherError('stale_base', 'Commitul bazei PR nu este canonic')
  if (!/^[A-Za-z0-9._/-]{1,240}$/.test(headBranch)) throw publisherError('ci_failed', 'Ramura head a PR-ului nu este canonică')
  const selected = requiredCheckRuns(checkRuns, policies, completedNoLaterThan)
  if (selected.some((check) => !check)) return { checks: selected, provenance: null }
  const coordinates = selected.map(checkCoordinates)
  if (coordinates.some((coordinate) => coordinate === null)) {
    throw publisherError('ci_failed', 'Un control obligatoriu nu provine dintr-un job GitHub Actions canonic')
  }
  const runIds = new Set(coordinates.map((coordinate) => coordinate.runId))
  if (runIds.size !== 1) throw publisherError('ci_failed', 'Controalele obligatorii provin din runuri CI diferite')
  const suiteIds = new Set(selected.map((check) => Number(check?.check_suite?.id)))
  if (suiteIds.size !== 1 || !Number.isSafeInteger([...suiteIds][0]) || [...suiteIds][0] <= 0) {
    throw publisherError('ci_failed', 'Controalele obligatorii nu aparțin aceluiași check suite canonic')
  }
  const suiteId = [...suiteIds][0]
  for (const check of selected) {
    if (!checkMatchesPullRequestIdentity(
      check,
      prNumber,
      headCommit,
      headBranch,
      completedNoLaterThan === null,
    )) {
      throw publisherError('ci_failed', 'Check-runul obligatoriu nu este legat de identitatea exactă a PR-ului')
    }
  }
  const runId = coordinates[0].runId
  const [workflow, run, jobs, headWorkflowSha, baseWorkflowSha] = await Promise.all([
    github(token, `/repos/${REPOSITORY}/actions/workflows/pr-verify.yml`),
    github(token, `/repos/${REPOSITORY}/actions/runs/${runId}`),
    paginatedRunJobs(token, runId),
    workflowSourceSha(token, headCommit),
    workflowSourceSha(token, baseCommit),
  ])
  if (
    Number(run?.id) !== runId
    || !Number.isSafeInteger(Number(workflow?.id))
    || Number(workflow.id) <= 0
    || workflow?.path !== CANONICAL_CI_WORKFLOW
    || workflow?.state !== 'active'
    || Number(run?.workflow_id) !== Number(workflow.id)
    || Number(run?.check_suite_id) !== suiteId
    || !canonicalWorkflowRunPath(run?.path)
    || run?.event !== 'pull_request'
    || run?.head_sha !== headCommit
    || run?.head_branch !== headBranch
    || run?.repository?.full_name !== REPOSITORY
    || headWorkflowSha !== baseWorkflowSha
  ) throw publisherError('ci_failed', 'Runul controalelor obligatorii nu are proveniența CI canonică')
  if (completedNoLaterThan !== null) {
    const cutoff = Date.parse(completedNoLaterThan)
    const createdAt = Date.parse(String(run?.created_at ?? ''))
    if (!Number.isFinite(cutoff) || !Number.isFinite(createdAt) || createdAt > cutoff) {
      throw publisherError('merged_unverifiable', 'Runul CI recuperat a început după merge')
    }
  }
  for (let index = 0; index < selected.length; index += 1) {
    const check = selected[index]
    const coordinate = coordinates[index]
    const policy = policies[index]
    const matching = jobs.filter((job) =>
      Number(job?.id) === coordinate.jobId
      && Number(job?.run_id) === runId
      && job?.head_sha === headCommit
      && job?.name === policy.name
      && job?.check_run_url === `https://api.github.com/repos/${REPOSITORY}/check-runs/${check.id}`,
    )
    if (matching.length !== 1) throw publisherError('ci_failed', `Jobul CI canonic ${policy.name} nu corespunde check-runului`)
  }
  return {
    checks: selected,
    provenance: {
      schema: 1,
      workflowId: Number(workflow.id),
      runId,
      suiteId,
      checks: policies.map((policy, index) => ({
        name: policy.name,
        appId: policy.appId,
        checkRunId: Number(selected[index].id),
        jobId: coordinates[index].jobId,
      })),
    },
  }
}

async function waitForGreen(token, prNumber, headCommit, protectionPolicy, renew) {
  const deadline = Date.now() + 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
    if (pr?.state !== 'open') throw publisherError('pr_closed', 'PR-ul a fost închis fără merge')
    if (pr?.base?.ref !== 'master') throw publisherError('stale_base', 'Baza PR-ului nu mai este master')
    if (pr?.head?.sha !== headCommit) fail('PR-ul și-a schimbat identitatea')
    const checks = await paginatedCheckRuns(token, headCommit)
    const canonical = await canonicalRequiredCheckRuns(
      token, prNumber, headCommit, String(pr?.head?.ref ?? ''), String(pr?.base?.sha ?? '').toLowerCase(), checks, protectionPolicy.requiredChecks,
    )
    const required = canonical.checks
    const failed = required.some((check) => check && check.status === 'completed' && check.conclusion !== 'success')
    if (failed) throw publisherError('ci_failed', 'Un control CI obligatoriu a eșuat')
    const reviews = await paginatedReviews(token, prNumber)
    const approvalCount = await eligibleCurrentHeadApprovalCount(token, reviews, headCommit)
    if (
      required.every((check) => check?.status === 'completed' && check?.conclusion === 'success')
      && approvalCount >= protectionPolicy.requiredApprovalCount
    ) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))
  }
  fail('Timeout așteptând controalele CI obligatorii și aprobarea umană')
}

async function requiredChecksAreGreen(token, prNumber, headCommit, headBranch, baseCommit, policies, completedNoLaterThan = null) {
  const checks = await paginatedCheckRuns(token, headCommit)
  const canonical = await canonicalRequiredCheckRuns(token, prNumber, headCommit, headBranch, baseCommit, checks, policies, completedNoLaterThan)
  return {
    green: requiredCheckRunsAreGreen(checks, policies, completedNoLaterThan),
    provenance: canonical.provenance,
  }
}

function sameProtectionPolicy(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

async function revalidateBeforeMerge(token, prNumber, headCommit, expectedPolicy) {
  const currentPolicy = await validateProtection(token)
  if (!sameProtectionPolicy(currentPolicy, expectedPolicy)) {
    throw publisherError('branch_protection_invalid', 'Protecția ramurii master s-a schimbat înainte de merge')
  }
  const [pr, checks, reviews] = await Promise.all([
    github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`),
    paginatedCheckRuns(token, headCommit),
    paginatedReviews(token, prNumber),
  ])
  if (pr?.state !== 'open') throw publisherError('pr_closed', 'PR-ul a fost închis fără merge')
  if (pr?.base?.ref !== 'master') throw publisherError('stale_base', 'Baza PR-ului nu mai este master înainte de merge')
  if (pr?.head?.sha !== headCommit) fail('PR-ul și-a schimbat identitatea înainte de merge')
  const canonical = await canonicalRequiredCheckRuns(
    token, prNumber, headCommit, String(pr?.head?.ref ?? ''), String(pr?.base?.sha ?? '').toLowerCase(), checks, currentPolicy.requiredChecks,
  )
  if (!requiredCheckRunsAreGreen(checks, currentPolicy.requiredChecks)) {
    throw publisherError('publisher_failed', 'Controalele obligatorii nu mai sunt complet verzi imediat înainte de merge')
  }
  if (await eligibleCurrentHeadApprovalCount(token, reviews, headCommit) < currentPolicy.requiredApprovalCount) {
    throw publisherError('publisher_failed', 'Pragul de aprobări nu mai este îndeplinit imediat înainte de merge')
  }
  if (pr?.mergeable !== true) {
    throw publisherError('publisher_failed', 'GitHub nu mai confirmă că PR-ul este mergeable imediat înainte de merge')
  }
  return canonical.provenance
}

async function recoverMergedPr(token, job, identity, protectionPolicy) {
  if (job.prNumber == null && job.headCommit == null && job.prUrl == null) return null
  const prNumber = Number(job.prNumber)
  const headCommit = String(job.headCommit ?? '').toLowerCase()
  const prUrl = String(job.prUrl ?? '')
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || !/^[0-9a-f]{40}$/.test(headCommit) || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}`) {
    fail('Receiptul PR din claim este invalid')
  }
  const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
  const expectedBranch = `codex/${identity.taskId.slice('codex-'.length)}`
  if (pr?.base?.ref !== 'master') throw publisherError('stale_base', 'Baza PR-ului recuperat nu mai este master')
  if (
    pr?.head?.sha !== headCommit
    || pr?.head?.ref !== expectedBranch
    || pr?.head?.repo?.full_name !== REPOSITORY
    || pr?.base?.repo?.full_name !== REPOSITORY
    || pr?.html_url !== prUrl
  ) fail('PR-ul recuperat și-a schimbat identitatea')
  if (pr?.merged !== true) {
    if (pr?.state !== 'open') throw publisherError('pr_closed', 'PR-ul a fost închis fără merge')
    return null
  }
  if (
    !Number.isSafeInteger(protectionPolicy?.requiredApprovalCount)
    || protectionPolicy.requiredApprovalCount < 1
    || !Array.isArray(protectionPolicy?.requiredChecks)
    || protectionPolicy.requiredChecks.length !== REQUIRED_CHECKS.length
  ) {
    throw publisherError('branch_protection_invalid', 'Pragul de aprobare pentru recovery este invalid')
  }
  const commit = String(pr?.merge_commit_sha ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('Commitul merge recuperat este invalid')
  const recoveredChecks = await requiredChecksAreGreen(
    token,
    prNumber,
    headCommit,
    expectedBranch,
    String(pr?.base?.sha ?? '').toLowerCase(),
    protectionPolicy.requiredChecks,
    pr?.merged_at,
  )
  if (!recoveredChecks.green || recoveredChecks.provenance === null) {
    throw publisherError('merged_unverifiable', 'Merge-ul recuperat nu avea controalele obligatorii verzi înainte de merge')
  }
  const reviews = await paginatedReviews(token, prNumber)
  const approvalCount = await eligibleCurrentHeadApprovalCount(token, reviews, headCommit, pr?.merged_at)
  if (approvalCount < protectionPolicy.requiredApprovalCount) {
    throw publisherError('merged_unverifiable', 'Merge-ul recuperat nu avea pragul de aprobări umane pe head-ul exact')
  }
  const comparison = await github(token, `/repos/${REPOSITORY}/compare/${commit}...master`)
  if (!['ahead', 'identical'].includes(comparison?.status) || comparison?.merge_base_commit?.sha !== commit) {
    throw publisherError('master_diverged', 'Commitul recuperat nu este în master')
  }
  return { prNumber, prUrl, headCommit, commit, ciProvenance: recoveredChecks.provenance }
}

function publicationFromClaim(job, identity) {
  const values = [job.branch, job.headCommit, job.prNumber, job.prUrl]
  if (values.every((value) => value === null || value === undefined)) return null
  const branch = String(job.branch ?? '')
  const headCommit = String(job.headCommit ?? '').toLowerCase()
  const prNumber = Number(job.prNumber)
  const prUrl = String(job.prUrl ?? '')
  if (
    branch !== `codex/${identity.taskId.slice('codex-'.length)}`
    || !/^[0-9a-f]{40}$/.test(headCommit)
    || !Number.isSafeInteger(prNumber)
    || prNumber <= 0
    || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}`
  ) fail('Publicația din claim nu are identitatea canonică')
  return { branch, headCommit, prNumber }
}

function receiptHash(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'))
}

async function runOnce() {
  const hmac = loadSystemdCredential('constructor-publisher-secret', process.env.CONSTRUCTOR_PUBLISHER_SECRET_FILE)
  let githubCredential
  let signing
  try {
    assertEnabledLayout()
    mkdirSync(STATE, { recursive: true, mode: 0o700 })
    githubCredential = tokenPath()
    // Derivarea cheii publice e un self-check local al credentialei private și
    // precedă orice heartbeat ready, chiar când coada este goală.
    signing = prepareCommitSigning()
    await publisherUpstreamPreflight(githubCredential.value)
  } catch (error) {
    await reportPublisherPreflightFailure(hmac.value, error)
    throw error
  }
  const authenticatedGitEnv = gitEnv({
    GIT_ASKPASS: ASKPASS,
    KELION_GITHUB_TOKEN_FILE: githubCredential.path,
  })
  const claim = await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: '/api/internal/constructor-publisher/jobs/claim', body: {} })
  if (!claim?.job) return
  const identity = strictJobIdentity(claim.job)
  const leasePath = `/api/internal/constructor-publisher/jobs/${identity.jobId}/lease`
  const renewLease = () => postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  const stopLease = startLease({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  let built
  let protectionPolicy = null
  // Dacă lease-ul anterior a ajuns deja la pr_opened, artefactele GitHub sunt
  // parte din claim. Ele trebuie cunoscute înainte de recovery, altfel un
  // stale/closed/CI failure ar încerca să le retragă cu o dovadă goală.
  let publication = publicationFromClaim(claim.job, identity)
  try {
    await stopLease.assert()
    protectionPolicy = await validateProtection(githubCredential.value)
    const recovered = await recoverMergedPr(githubCredential.value, claim.job, identity, protectionPolicy)
    if (recovered) {
      await stopLease.assert()
      const mergedReceipt = receiptHash({ schema: 1, kind: 'publisher-merge', jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, checks: [...REQUIRED_CHECKS].sort(), ciProvenance: recovered.ciProvenance })
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'merged', headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, receiptSha256: mergedReceipt } })
      writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, ciProvenance: recovered.ciProvenance, mergedReceipt })}\n`, { mode: 0o600 })
      cleanupAcknowledgedHandoff(claim.job.handoffId)
      return
    }
    const fetched = git(['fetch', '--prune', '--no-tags', 'origin', '+refs/heads/master:refs/remotes/origin/master'], REPO, { env: authenticatedGitEnv, timeout: 180_000 })
    if (fetched.status !== 0) {
      if (gitAuthFailed(fetched)) throw publisherError('github_auth_required', 'GitHub a refuzat autentificarea la fetch')
      fail('Fetch public origin/master a eșuat')
    }
    await stopLease.assert()
    const handoff = readHandoff({ ...claim.job, ...identity })
    if (gitOutput(['rev-parse', 'origin/master^{commit}'], REPO) !== handoff.baseCommit) {
      throw publisherError('stale_base', 'Baza handoff-ului nu mai este vârful master; rebase automat interzis')
    }
    built = await recreateCommit(handoff, identity, signing)
    await stopLease.assert()
    await pushBranch(githubCredential.path, built)
    publication = { branch: built.branch, headCommit: built.headCommit, prNumber: null }
    await stopLease.assert()
    const pr = await openOrReusePr(githubCredential.value, built.branch, built.headCommit, identity.taskId)
    const prNumber = Number(pr?.number)
    const prUrl = String(pr?.html_url ?? '')
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}`) fail('Răspuns PR invalid')
    publication = { branch: built.branch, headCommit: built.headCommit, prNumber }
    const openedReceipt = receiptHash({ schema: 1, kind: 'publisher-pr', jobId: identity.jobId, taskId: identity.taskId, baseCommit: handoff.baseCommit, patchSha256: handoff.patchSha256, branch: built.branch, headCommit: built.headCommit, prNumber, prUrl })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'pr_opened', branch: built.branch, headCommit: built.headCommit, prNumber, prUrl, receiptSha256: openedReceipt } })
    await waitForGreen(githubCredential.value, prNumber, built.headCommit, protectionPolicy, renewLease)
    await stopLease.assert()
    if (gitOutput(['ls-remote', 'origin', 'refs/heads/master'], REPO, authenticatedGitEnv).split(/\s+/)[0] !== handoff.baseCommit) {
      throw publisherError('stale_base', 'Master s-a schimbat înainte de merge; revalidare necesară')
    }
    const ciProvenance = await revalidateBeforeMerge(githubCredential.value, prNumber, built.headCommit, protectionPolicy)
    if (ciProvenance === null) throw publisherError('publisher_failed', 'Proveniența CI canonică lipsește înainte de merge')
    await stopLease.assert()
    const merged = await github(githubCredential.value, `/repos/${REPOSITORY}/pulls/${prNumber}/merge`, 'PUT', { sha: built.headCommit, merge_method: 'rebase' })
    const commit = String(merged?.sha ?? '').toLowerCase()
    if (merged?.merged !== true || !/^[0-9a-f]{40}$/.test(commit)) fail('GitHub nu a confirmat merge-ul exact')
    const master = await github(githubCredential.value, `/repos/${REPOSITORY}/git/ref/heads/master`)
    if (master?.object?.sha !== commit) fail('Master nu indică exact commitul de merge')
    await stopLease.assert()
    const mergedReceipt = receiptHash({ schema: 1, kind: 'publisher-merge', jobId: identity.jobId, taskId: identity.taskId, headCommit: built.headCommit, prNumber, commit, checks: [...REQUIRED_CHECKS].sort(), ciProvenance })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'merged', headCommit: built.headCommit, prNumber, commit, receiptSha256: mergedReceipt } })
    writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, headCommit: built.headCommit, prNumber, commit, ciProvenance, mergedReceipt })}\n`, { mode: 0o600 })
    cleanupAcknowledgedHandoff(claim.job.handoffId)
  } catch (error) {
    let code = publisherFailureCode(error)
    const rebuild = new Set(['stale_base', 'ci_failed', 'local_gate_failed', 'pr_closed'])
    let retirement = null
    if (rebuild.has(code)) {
      try {
        const retired = await retirePublication(
          githubCredential.value,
          githubCredential.path,
          identity,
          publication,
          code,
          protectionPolicy,
        )
        if (retired.merged) {
          const recovered = retired.merged
          const mergedReceipt = receiptHash({ schema: 1, kind: 'publisher-merge', jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, checks: [...REQUIRED_CHECKS].sort(), ciProvenance: recovered.ciProvenance })
          await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'merged', headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, receiptSha256: mergedReceipt } })
          writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, headCommit: recovered.headCommit, prNumber: recovered.prNumber, commit: recovered.commit, ciProvenance: recovered.ciProvenance, mergedReceipt })}\n`, { mode: 0o600 })
          cleanupAcknowledgedHandoff(claim.job.handoffId)
          return
        }
        retirement = retired.proof
      } catch (cleanupError) {
        code = publisherFailureCode(cleanupError)
      }
    }
    let failureRecorded = false
    try {
      await postInternal({
        api: API,
        secret: hmac.value,
        prefix: PREFIX,
        path: `/api/internal/constructor-publisher/jobs/${identity.jobId}/event`,
        body: {
          taskId: identity.taskId,
          leaseId: identity.leaseId,
          event: 'failed',
          code,
          ...(retirement ?? {}),
        },
      })
      failureRecorded = true
    } catch {
      // Păstrează handoff-ul pentru reconciliere; eroarea originală rămâne cea
      // raportată de oneshot, iar lease-ul expiră durabil.
    }
    if (failureRecorded && retirement && rebuild.has(code)) {
      cleanupAcknowledgedHandoff(claim.job.handoffId)
    }
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

async function selfTest() {
  const selfTestRepository = 'example/project'
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
  for (const code of PUBLISHER_FAILURE_CODES) {
    if (publisherFailureCode(publisherError(code, code)) !== code) fail(`Clasificarea publisherului a pierdut ${code}`)
  }
  const distinctGitHubIds = checkCoordinates({
    id: 9003,
    details_url: `https://github.com/${selfTestRepository}/actions/runs/7001/job/8002`,
  }, selfTestRepository)
  if (distinctGitHubIds?.runId !== 7001 || distinctGitHubIds.jobId !== 8002) {
    fail('ID-ul jobului GitHub a fost confundat cu ID-ul check-runului')
  }
  const detachedAfterMerge = { head_sha: 'a'.repeat(40), pull_requests: [] }
  if (checkMatchesPullRequestIdentity(detachedAfterMerge, 42, 'a'.repeat(40), 'codex/task', true)) {
    fail('Un check fără asocierea PR a fost acceptat înainte de merge')
  }
  if (!checkMatchesPullRequestIdentity(detachedAfterMerge, 42, 'a'.repeat(40), 'codex/task', false)) {
    fail('Recovery-ul a depins de asocierea PR volatilă după merge')
  }
  const exactAssociation = {
    number: 42,
    head: { sha: 'a'.repeat(40), ref: 'codex/task', repo: { url: `https://api.github.com/repos/${REPOSITORY}` } },
    base: { ref: 'master', repo: { url: `https://api.github.com/repos/${REPOSITORY}` } },
  }
  if (checkMatchesPullRequestIdentity({
    head_sha: 'a'.repeat(40),
    pull_requests: [exactAssociation, { ...exactAssociation, number: 99 }],
  }, 42, 'a'.repeat(40), 'codex/task', false)) {
    fail('Recovery-ul a acceptat o asociere explicită la un PR străin')
  }
  if (publisherFailureCode(new Error('Baza handoff-ului nu mai este vârful master')) !== 'stale_base') fail('Schimbarea bazei nu este stale_base')
  if (publisherFailureCode(new Error('Master s-a schimbat înainte de merge')) !== 'stale_base') fail('Schimbarea master nu este stale_base')
  if (currentHeadApprovalCount([
    { id: 1, user: { id: 7 }, state: 'APPROVED', commit_id: 'head' },
    { id: 2, user: { id: 7 }, state: 'CHANGES_REQUESTED', commit_id: 'head' },
  ], 'head') !== 0) fail('Un review vechi APPROVED a suprascris decizia curentă')
  if (currentHeadApprovalCount([
    { id: 4, user: { id: 7 }, state: 'APPROVED', commit_id: 'head' },
    { id: 3, user: { id: 7 }, state: 'CHANGES_REQUESTED', commit_id: 'head' },
    { id: 5, user: { id: 8 }, state: 'APPROVED', commit_id: 'head' },
  ], 'head') !== 2) fail('Reducerul review-urilor curente este invalid')
  if (currentHeadApprovalCount([
    { id: 6, user: { id: 9 }, state: 'APPROVED', commit_id: 'head', submitted_at: '2026-08-26T09:00:00Z' },
    { id: 7, user: { id: 10 }, state: 'APPROVED', commit_id: 'head', submitted_at: '2026-08-26T09:02:00Z' },
  ], 'head', '2026-08-26T09:01:00Z') !== 1) fail('Recovery-ul a numărat o aprobare trimisă după merge')
  const checkPolicy = [
    { name: 'verify', appId: 41 },
    { name: 'container-isolation', appId: 99 },
  ]
  const configuredWithExtraRequiredCheck = new Set(['verify', 'container-isolation', 'security-scan'])
  if (hasExactRequiredCheckNames(configuredWithExtraRequiredCheck, checkPolicy.map((policy) => policy.name))) {
    fail('Protecția cu un control obligatoriu suplimentar a fost acceptată')
  }
  if (!emptyNamedActorSet({ users: [], teams: [], apps: [] })
    || emptyNamedActorSet({ users: [{ login: 'owner' }], teams: [], apps: [] })
    || emptyNamedActorSet(undefined)) {
    fail('Restricțiile branch policy nu sunt proiectate fail-closed')
  }
  const historicalChecks = [
    { id: 1, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success', started_at: '2026-08-26T08:55:00Z', completed_at: '2026-08-26T09:00:00Z' },
    { id: 2, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success', started_at: '2026-08-26T09:02:00Z', completed_at: '2026-08-26T09:03:00Z' },
    { id: 3, name: 'container-isolation', app: { id: 99 }, status: 'completed', conclusion: 'success', started_at: '2026-08-26T08:56:00Z', completed_at: '2026-08-26T09:00:00Z' },
  ]
  if (!requiredCheckRunsAreGreen(historicalChecks, checkPolicy, '2026-08-26T09:01:00Z')) {
    fail('Recovery-ul nu a păstrat controalele verzi terminate înainte de merge')
  }
  const pendingAtMerge = [
    ...historicalChecks,
    { id: 4, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success', started_at: '2026-08-26T09:00:30Z', completed_at: '2026-08-26T09:02:00Z' },
  ]
  if (requiredCheckRunsAreGreen(pendingAtMerge, checkPolicy, '2026-08-26T09:01:00Z')) {
    fail('Recovery-ul a acceptat un control care era încă activ la momentul merge-ului')
  }
  for (const policy of checkPolicy) {
    const wrongApp = historicalChecks.map((check) => check.name === policy.name ? { ...check, app: { id: policy.appId + 1 } } : check)
    if (requiredCheckRunsAreGreen(wrongApp, checkPolicy, '2026-08-26T09:01:00Z')) {
      fail(`Recovery-ul a acceptat controlul ${policy.name} de la alt GitHub App decât cel protejat`)
    }
  }
  if (sameProtectionPolicy(
    { requiredApprovalCount: 2, requiredChecks: checkPolicy },
    { requiredChecks: checkPolicy, requiredApprovalCount: 2 },
  ) !== true) fail('Politica echivalentă nu are reprezentare canonică stabilă')
  if (sameProtectionPolicy(
    { requiredApprovalCount: 1, requiredChecks: checkPolicy },
    { requiredApprovalCount: 2, requiredChecks: checkPolicy },
  )) fail('Schimbarea pragului de aprobare nu a invalidat politica')
  const timeoutCode = await runIgnoringOutput(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { PATH: process.env.PATH ?? '' },
    50,
    50,
    500,
  )
  if (timeoutCode !== 124) fail('Timeoutul porții locale nu escaladează la SIGKILL')
  process.stdout.write('constructor-publisher self-test: TRECE\n')
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') await selfTest()
else if (mode === '--once') {
  const activationMarkerExists = existsSync(ENABLE_MARKER)
  if (!ENABLED && !activationMarkerExists) process.stdout.write('constructor-publisher: dezactivat\n')
  else await runOnce()
} else fail(`Mod necunoscut: ${mode}`)
