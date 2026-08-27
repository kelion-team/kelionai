#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { evaluateBranchProtection, evaluateLiveSample, evaluateReleaseEvidence, parseDeployTitle } from './lib/vps-release-verification.mjs'

const repository = process.env.GITHUB_REPOSITORY ?? ''
const token = process.env.GH_TOKEN ?? ''
const origin = String(process.env.PUBLIC_APP_ORIGIN ?? '').replace(/\/$/, '')
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {}
const pollSeconds = Math.min(60, Math.max(15, Number(process.env.RELEASE_VERIFIER_POLL_SECONDS) || 55))
const waitMinutes = Math.min(120, Math.max(1, Number(process.env.RELEASE_VERIFIER_WAIT_MINUTES) || 90))
const monitorSeconds = Math.min(600, Math.max(40, Number(process.env.RELEASE_VERIFIER_MONITOR_SECONDS) || 120))
const maxCalls = Math.min(600, Math.max(40, Number(process.env.RELEASE_VERIFIER_MAX_API_CALLS) || 300))
const INCIDENT = '<!-- kelion-release-verifier-incident:v1 -->'
const SHA = /^[0-9a-f]{40}$/
const GITHUB_API_ORIGIN = 'https://api.github.com' // hardcod-permis: endpoint oficial imuabil al API-ului GitHub
let calls = 0
let checkRunId = null
let started = Date.now()

if (!repository.includes('/') || !token || !origin.startsWith('https://')) throw new Error('release verifier configuration missing')

async function api(path, options = {}) {
  calls += 1
  if (calls > maxCalls) throw new Error('api_call_budget_exhausted')
  const response = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
    ...options,
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`github_${response.status}:${body.slice(0, 300)}`)
  return body ? JSON.parse(body) : null
}

const repoPath = `/repos/${repository}`

async function targetCommit() {
  const explicit = String(process.env.RELEASE_VERIFIER_COMMIT ?? '')
  if (explicit) return explicit
  const title = event?.workflow_run?.display_title
  const identity = parseDeployTitle(title)
  if (identity) return identity.commit
  if (SHA.test(String(event?.after ?? ''))) return event.after
  return (await api(`${repoPath}/git/ref/heads/master`)).object.sha
}

async function heartbeat(commit, phase, detail, conclusion = null) {
  const output = { title: conclusion ? `Release ${conclusion}` : `Verificare release: ${phase}`, summary: `${detail}\n\nSHA: ${commit}\nElapsed: ${Math.floor((Date.now() - started) / 1000)}s\nAPI calls: ${calls}/${maxCalls}` }
  if (!checkRunId) {
    const created = await api(`${repoPath}/check-runs`, { method: 'POST', body: JSON.stringify({ name: 'release-verifier', head_sha: commit, status: conclusion ? 'completed' : 'in_progress', ...(conclusion ? { conclusion } : {}), started_at: new Date(started).toISOString(), output }) })
    checkRunId = created.id
  } else {
    await api(`${repoPath}/check-runs/${checkRunId}`, { method: 'PATCH', body: JSON.stringify({ status: conclusion ? 'completed' : 'in_progress', ...(conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}), output }) })
  }
  process.stdout.write(`[heartbeat] ${new Date().toISOString()} ${phase}: ${detail}\n`)
}

async function incident(commit, missing, evidence, error = null) {
  const title = `[Release verifier] ${commit.slice(0, 12)} unverified`
  const body = `${INCIDENT}\n## Release blocat\n\n- Commit: \`${commit}\`\n- Lipsuri: \`${missing.join(', ') || 'internal-error'}\`\n- Owner: \`Kelion release verifier -> L2 remediation\`\n- Deadline feedback: \`${new Date(Date.now() + 60_000).toISOString()}\`\n- Run corelat: \`${process.env.GITHUB_RUN_ID ?? 'unknown'}\`\n- Eroare: \`${String(error ?? 'none').replace(/[`\r\n]/g, ' ').slice(0, 400)}\`\n\n\`\`\`json\n${JSON.stringify(evidence).slice(0, 20_000)}\n\`\`\``
  const issues = await api(`${repoPath}/issues?state=open&per_page=100`)
  const existing = issues.find((item) => item.title === title && item.body?.includes(INCIDENT))
  if (existing) await api(`${repoPath}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ body }) })
  else await api(`${repoPath}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) })
}

async function runJobs(runId) {
  return (await api(`${repoPath}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs
}

async function snapshot(commit) {
  const masterHead = (await api(`${repoPath}/git/ref/heads/master`)).object.sha
  const protection = evaluateBranchProtection(await api(`${repoPath}/branches/master/protection`))
  const ciRuns = (await api(`${repoPath}/actions/workflows/pr-verify.yml/runs?head_sha=${commit}&event=push&per_page=20`)).workflow_runs
  let ci = ciRuns.find((run) => run.head_sha === commit && run.event === 'push' && run.conclusion === 'success') ?? ciRuns.find((run) => run.head_sha === commit)
  if (ci?.conclusion === 'success') {
    const jobs = await runJobs(ci.id)
    const required = ['verify', 'container-isolation']
    if (!required.every((name) => jobs.some((job) => job.name === name && job.conclusion === 'success'))) ci = { ...ci, conclusion: 'invalid_jobs' }
  }
  const buildTitle = ci?.id ? `build-release-${ci.id}-${commit}` : null
  const builds = (await api(`${repoPath}/actions/workflows/build-images.yml/runs?event=workflow_run&per_page=100`)).workflow_runs
  const build = builds.find((run) => run.display_title === buildTitle)
  let artifactVerified = false
  if (build?.conclusion === 'success') {
    const artifacts = (await api(`${repoPath}/actions/runs/${build.id}/artifacts?per_page=100`)).artifacts
    artifactVerified = artifacts.some((artifact) => artifact.name === `release-images-${commit}` && artifact.expired === false)
  }
  const deploys = (await api(`${repoPath}/actions/workflows/deploy.yml/runs?event=workflow_dispatch&per_page=100`)).workflow_runs
  const deploy = deploys.find((run) => {
    const identity = parseDeployTitle(run.display_title)
    return identity?.commit === commit && identity?.ciRunId === ci?.id && identity?.buildRunId === build?.id
  })
  const identity = parseDeployTitle(deploy?.display_title)
  let deployIdentityValid = Boolean(identity && deploy?.event === 'workflow_dispatch' && deploy?.head_branch === 'master')
  if (deploy?.conclusion === 'success') {
    const jobs = await runJobs(deploy.id)
    deployIdentityValid &&= jobs.some((job) => job.name === 'release' && job.conclusion === 'success')
  }
  return { commit, masterHead, branchProtection: protection, ci: ci ? { id: ci.id, status: ci.status, conclusion: ci.conclusion } : null, build: build ? { id: build.id, status: build.status, conclusion: build.conclusion } : null, artifactVerified, deploy: deploy ? { id: deploy.id, status: deploy.status, conclusion: deploy.conclusion } : null, deployIdentityValid }
}

async function liveEndpoint(path) {
  try {
    const response = await fetch(`${origin}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } })
    return { status: response.status, body: await response.json().catch(() => null) }
  } catch (error) {
    return { status: 0, body: null, error: String(error).slice(0, 200) }
  }
}

async function liveSample(commit) {
  const [version, ready, live, health, proof] = await Promise.all(['/api/version', '/readyz', '/livez', '/health', '/api/release-proof'].map(liveEndpoint))
  const raw = { version, ready, live, health, proof }
  return { ...evaluateLiveSample(raw, commit), at: new Date().toISOString(), statuses: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.status])) }
}

async function rollbackContract(commit) {
  const source = await api(`${repoPath}/contents/deploy/deploy.sh?ref=${commit}`)
  const text = Buffer.from(source.content, 'base64').toString('utf8')
  return ['rollback_switch()', 'verify_public_previous_version()', 'write_release_request_ledger success', 'release_cutover_committed=1'].every((marker) => text.includes(marker))
}

async function main() {
  const commit = await targetCommit()
  if (!SHA.test(commit)) throw new Error('invalid_target_commit')
  await heartbeat(commit, 'started', 'owner=release-verifier; deadline=60s; fail-closed')
  const deadline = started + waitMinutes * 60_000
  let evidence
  while (Date.now() < deadline) {
    evidence = await snapshot(commit)
    const pending = !evidence.ci || evidence.ci.status !== 'completed' || !evidence.build || evidence.build.status !== 'completed' || !evidence.deploy || evidence.deploy.status !== 'completed'
    if (!pending) break
    await heartbeat(commit, 'waiting-evidence', `ci=${evidence.ci?.status ?? 'missing'}; build=${evidence.build?.status ?? 'missing'}; deploy=${evidence.deploy?.status ?? 'missing'}`)
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000))
  }
  evidence = await snapshot(commit)
  evidence.rollbackContractVerified = await rollbackContract(commit)
  evidence.liveSamples = []
  if (evidence.deploy?.conclusion === 'success') {
    const sampleCount = 3
    const interval = Math.max(20, Math.floor(monitorSeconds / (sampleCount - 1)))
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = await liveSample(commit)
      evidence.liveSamples.push(sample)
      await heartbeat(commit, 'post-deploy-monitor', `sample=${index + 1}/${sampleCount}; ok=${sample.ok}; missing=${sample.missing.join(',') || 'none'}`)
      if (index + 1 < sampleCount) await new Promise((resolve) => setTimeout(resolve, interval * 1000))
    }
  }
  const verdict = evaluateReleaseEvidence(evidence)
  if (!verdict.delivered) {
    await incident(commit, verdict.missing, evidence)
    await heartbeat(commit, 'unverified', `missing=${verdict.missing.join(',')}`, 'failure')
    process.exitCode = 1
    return
  }
  await heartbeat(commit, 'delivered', `ci=${evidence.ci.id}; build=${evidence.build.id}; deploy=${evidence.deploy.id}; live=${commit}`, 'success')
}

main().catch(async (error) => {
  const commit = await targetCommit().catch(() => '0'.repeat(40))
  const evidence = { commit, error: String(error).slice(0, 500), calls, elapsedSeconds: Math.floor((Date.now() - started) / 1000) }
  await incident(commit, ['verifier-internal-error'], evidence, error).catch(() => undefined)
  await heartbeat(commit, 'internal-error', String(error).slice(0, 300), 'failure').catch(() => undefined)
  process.exitCode = 1
})
