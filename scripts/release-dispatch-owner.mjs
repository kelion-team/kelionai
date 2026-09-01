#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { deterministicUuid } from '../deploy/lib/github-fixed-client.mjs'

const SHA = /^[0-9a-f]{40}$/
const TASK_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const TASK = new RegExp(`^codex-(${TASK_UUID})$`)
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const CONSTRUCTOR_PR_BODY = 'Patch produs în sandbox, revalidat de publisherul izolat și supus tuturor controalelor obligatorii.'
const BUILD_PATH = '.github/workflows/build-images.yml'

function fail(message) {
  throw new Error(message)
}

function positiveRunId(value, label) {
  const text = String(value ?? '')
  const number = Number(text)
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(number)) {
    fail(`${label} este invalid`)
  }
  return number
}

function exactWorkflowPath(value, path) {
  return value === path || (typeof value === 'string' && value.startsWith(`${path}@`))
}

function paginatedEntries(value, key, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    fail(`Snapshotul paginat ${label} este invalid`)
  }
  const entries = []
  for (const page of value) {
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page[key]) || page[key].length > 100) {
      fail(`Pagina ${label} este invalidă`)
    }
    entries.push(...page[key])
  }
  return entries
}

export function canonicalProductionRunId(workflowRunPages, title, headSha, currentRunId) {
  const normalizedSha = String(headSha ?? '').toLowerCase()
  const current = positiveRunId(currentRunId, 'Runul production curent')
  if (!SHA.test(normalizedSha) || typeof title !== 'string' || title.length < 1 || title.length > 500) {
    fail('Identitatea production-release este invalidă')
  }
  const matching = paginatedEntries(workflowRunPages, 'workflow_runs', 'runurilor production-release')
    .filter((run) => run?.event === 'workflow_dispatch'
      && run?.display_title === title
      && run?.head_branch === 'master'
      && String(run?.head_sha ?? '').toLowerCase() === normalizedSha)
  const ids = matching.map((run) => positiveRunId(run?.id, 'Runul production canonic'))
  return Math.min(current, ...ids)
}

export function canonicalCiRunIdFromBuild(buildRun, candidateSha, buildRunId) {
  const normalizedSha = String(candidateSha ?? '').toLowerCase()
  const expectedBuildRunId = positiveRunId(buildRunId, 'Build run ID')
  if (!SHA.test(normalizedSha) || !buildRun || typeof buildRun !== 'object' || Array.isArray(buildRun)) {
    fail('Snapshotul buildului canonic este invalid')
  }
  if (
    buildRun.id !== expectedBuildRunId
    || String(buildRun.head_sha ?? '').toLowerCase() !== normalizedSha
    || buildRun.head_branch !== 'master'
    || buildRun.event !== 'workflow_run'
    || buildRun.conclusion !== 'success'
    || !exactWorkflowPath(buildRun.path, BUILD_PATH)
  ) fail('Buildul curent nu este buildul canonic al candidatului')
  const match = new RegExp(`^build-release-([1-9][0-9]*)-${normalizedSha}$`).exec(String(buildRun.display_title ?? ''))
  if (!match) fail('Titlul buildului canonic este invalid')
  return positiveRunId(match[1], 'CI run ID')
}

export function exactCanonicalBuildRunId(workflowRunPages, candidateSha, ciRunId, buildRunId) {
  const normalizedSha = String(candidateSha ?? '').toLowerCase()
  const ci = positiveRunId(ciRunId, 'CI run ID')
  const currentBuild = positiveRunId(buildRunId, 'Build run ID')
  if (!SHA.test(normalizedSha)) fail('Commitul buildului canonic este invalid')
  const title = `build-release-${ci}-${normalizedSha}`
  const matching = paginatedEntries(workflowRunPages, 'workflow_runs', 'buildurilor release')
    .filter((run) => String(run?.head_sha ?? '').toLowerCase() === normalizedSha
      && run?.head_branch === 'master'
      && run?.event === 'workflow_run'
      && run?.conclusion === 'success'
      && exactWorkflowPath(run?.path, BUILD_PATH)
      && run?.display_title === title)
  const ids = [...new Set(matching.map((run) => positiveRunId(run?.id, 'Buildul release canonic')))]
  if (ids.length !== 1 || ids[0] !== currentBuild) {
    fail('Candidatul nu are exact un build release canonic')
  }
  return currentBuild
}

export function exactCanonicalArtifactId(artifactPages, artifactName, buildRunId, candidateSha) {
  const build = positiveRunId(buildRunId, 'Build run ID')
  const normalizedSha = String(candidateSha ?? '').toLowerCase()
  if (!SHA.test(normalizedSha) || typeof artifactName !== 'string' || artifactName.length < 1 || artifactName.length > 255) {
    fail('Identitatea artefactului release este invalidă')
  }
  const matching = paginatedEntries(artifactPages, 'artifacts', 'artefactelor release')
    .filter((artifact) => artifact?.name === artifactName)
  if (matching.length !== 1) fail('Buildul canonic nu are exact un artefact release')
  const artifact = matching[0]
  if (
    artifact.expired !== false
    || artifact?.workflow_run?.id !== build
    || artifact?.workflow_run?.head_branch !== 'master'
    || String(artifact?.workflow_run?.head_sha ?? '').toLowerCase() !== normalizedSha
  ) fail('Artefactul release nu aparține buildului canonic')
  return positiveRunId(artifact.id, 'Artifact ID')
}

function pullPages(value) {
  if (!Array.isArray(value) || value.length > 100) fail('Snapshotul PR-urilor asociate este invalid')
  if (value.every((entry) => Array.isArray(entry))) {
    const pages = value
    if (pages.some((page) => page.length > 100)) fail('Pagina PR-urilor asociate depășește limita')
    return pages.flat()
  }
  return value
}

export function exactAssociatedPullNumber(value) {
  const pulls = pullPages(value)
  if (
    pulls.length !== 1
    || !pulls[0]
    || typeof pulls[0] !== 'object'
    || Array.isArray(pulls[0])
    || !Number.isSafeInteger(pulls[0].number)
    || pulls[0].number <= 0
  ) fail('Commitul candidat nu are exact un PR asociat canonic')
  return pulls[0].number
}

function constructorMarker(pr) {
  return String(pr?.title ?? '').startsWith('Constructor ')
    || String(pr?.head?.ref ?? '').startsWith('codex/')
}

function exactMergedPull(pr, associatedPullNumber, repository, candidateSha) {
  return pr?.number === associatedPullNumber
    && pr?.state === 'closed'
    && pr?.merged === true
    && typeof pr?.merged_at === 'string'
    && Number.isFinite(Date.parse(pr.merged_at))
    && String(pr?.merge_commit_sha ?? '').toLowerCase() === candidateSha
    && pr?.base?.ref === 'master'
    && pr?.base?.repo?.full_name === repository
    && pr?.head?.repo?.full_name === repository
    && pr?.draft === false
}

function exactConstructorPull(pr, taskId, taskUuid) {
  return pr?.head?.ref === `codex/${taskUuid}`
    && pr?.title === `Constructor ${taskId}`
    && pr?.body === CONSTRUCTOR_PR_BODY
}

/**
 * Separă dispatcherul generic de release-ul deținut deja de Constructor.
 * Namespace-ul Constructor este fail-closed: orice marker parțial oprește
 * dispatchul generic în loc să inventeze un UUID concurent.
 */
export function classifyReleaseDispatchOwner({ associatedPullPages, pullRequest, commit, repository, candidateSha }) {
  const normalizedRepository = String(repository ?? '')
  const normalizedSha = String(candidateSha ?? '').toLowerCase()
  if (!REPOSITORY.test(normalizedRepository) || !SHA.test(normalizedSha)) fail('Identitatea repository/commit este invalidă')
  if (!commit || typeof commit !== 'object' || Array.isArray(commit)) fail('Snapshotul commitului este invalid')
  if (String(commit.sha ?? '').toLowerCase() !== normalizedSha) fail('Snapshotul commitului nu corespunde candidatului')
  const associatedPullNumber = exactAssociatedPullNumber(associatedPullPages)
  if (!pullRequest || typeof pullRequest !== 'object' || Array.isArray(pullRequest)) fail('Snapshotul PR-ului complet este invalid')
  if (!exactMergedPull(pullRequest, associatedPullNumber, normalizedRepository, normalizedSha)) {
    fail('PR-ul asociat nu dovedește merge-ul exact al candidatului')
  }

  const subject = String(commit?.commit?.message ?? '')
  const subjectMatch = TASK.exec(subject.startsWith('Constructor ') ? subject.slice('Constructor '.length) : '')
  const commitMarked = subject.startsWith('Constructor ')
  const pullMarked = constructorMarker(pullRequest)
  if (!commitMarked && !pullMarked) return 'generic'

  if (
    !subjectMatch
    || commit?.commit?.verification?.verified !== true
  ) fail('Ownership-ul release-ului Constructor este ambiguu')

  const taskId = `codex-${subjectMatch[1]}`
  if (!exactConstructorPull(pullRequest, taskId, subjectMatch[1])) {
    fail('Ownership-ul release-ului Constructor este invalid')
  }
  return 'constructor'
}

export function genericReleaseRequestId(repository, candidateSha, ciRunId) {
  const normalizedRepository = String(repository ?? '').toLowerCase()
  const normalizedSha = String(candidateSha ?? '').toLowerCase()
  const ci = positiveRunId(ciRunId, 'CI run ID')
  if (
    !REPOSITORY.test(normalizedRepository)
    || !SHA.test(normalizedSha)
  ) fail('Tupla release-ului generic este invalidă')
  return deterministicUuid(`kelion-generic-release-v2\n${normalizedRepository}\n${normalizedSha}\n${ci}`)
}

function main() {
  const [operation, ...args] = process.argv.slice(2)
  if (operation === 'associated-pr' && args.length === 1) {
    const associatedPullPages = JSON.parse(readFileSync(args[0], 'utf8'))
    process.stdout.write(`${exactAssociatedPullNumber(associatedPullPages)}\n`)
    return
  }
  if (operation === 'owner' && args.length === 5) {
    const [pullsPath, pullPath, commitPath, repository, candidateSha] = args
    const associatedPullPages = JSON.parse(readFileSync(pullsPath, 'utf8'))
    const pullRequest = JSON.parse(readFileSync(pullPath, 'utf8'))
    const commit = JSON.parse(readFileSync(commitPath, 'utf8'))
    process.stdout.write(`${classifyReleaseDispatchOwner({ associatedPullPages, pullRequest, commit, repository, candidateSha })}\n`)
    return
  }
  if (operation === 'canonical-production-run' && args.length === 4) {
    const [pagesPath, title, headSha, currentRunId] = args
    const workflowRunPages = JSON.parse(readFileSync(pagesPath, 'utf8'))
    process.stdout.write(`${canonicalProductionRunId(workflowRunPages, title, headSha, currentRunId)}\n`)
    return
  }
  if (operation === 'build-ci' && args.length === 3) {
    const [buildPath, candidateSha, buildRunId] = args
    const buildRun = JSON.parse(readFileSync(buildPath, 'utf8'))
    process.stdout.write(`${canonicalCiRunIdFromBuild(buildRun, candidateSha, buildRunId)}\n`)
    return
  }
  if (operation === 'canonical-build' && args.length === 4) {
    const [pagesPath, candidateSha, ciRunId, buildRunId] = args
    const workflowRunPages = JSON.parse(readFileSync(pagesPath, 'utf8'))
    process.stdout.write(`${exactCanonicalBuildRunId(workflowRunPages, candidateSha, ciRunId, buildRunId)}\n`)
    return
  }
  if (operation === 'canonical-artifact' && args.length === 4) {
    const [pagesPath, artifactName, buildRunId, candidateSha] = args
    const artifactPages = JSON.parse(readFileSync(pagesPath, 'utf8'))
    process.stdout.write(`${exactCanonicalArtifactId(artifactPages, artifactName, buildRunId, candidateSha)}\n`)
    return
  }
  if (operation === 'request-id' && args.length === 3) {
    process.stdout.write(`${genericReleaseRequestId(...args)}\n`)
    return
  }
  fail('Operația release-dispatch-owner este invalidă')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
