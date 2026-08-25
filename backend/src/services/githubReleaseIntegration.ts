import { config } from '../config.js'

type FetchLike = typeof fetch
type CheckState = 'passed' | 'pending' | 'failed' | 'unknown'

export interface ReleaseSnapshot {
  integration: 'ready' | 'setup_required' | 'unavailable'
  setupInstructions: string | null
  pr: null | { number: number; title: string; url: string; state: 'open' | 'closed'; merged: boolean }
  checks: CheckState
  approval: 'approved' | 'required' | 'unknown'
  merge: 'ready' | 'blocked' | 'merged' | 'unknown'
  nextAction: string
}

function configured(): boolean {
  return config.githubReleaseOAuthToken.length > 0 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.githubRepo)
}

function headers(): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${config.githubReleaseOAuthToken}`,
    'x-github-api-version': '2022-11-28',
  }
}

function prNumber(url: string | null): number | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const expected = `/${config.githubRepo}/pull/`
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !parsed.pathname.startsWith(expected)) return null
    const value = Number(parsed.pathname.slice(expected.length))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch { return null }
}

function setup(): ReleaseSnapshot {
  return {
    integration: 'setup_required', setupInstructions: 'Configurează OAuth GitHub server-side pentru Admin (GITHUB_RELEASE_OAUTH_TOKEN_FILE), cu acces limitat la acest repository și permisiuni Pull requests: write, Checks: read și Contents: write. Tokenul nu ajunge în browser.',
    pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Conectează integrarea GitHub în secret store; apoi reîncarcă acest panou.',
  }
}

async function github(path: string, fetcher: FetchLike): Promise<Response> {
  return fetcher(`https://api.github.com/repos/${config.githubRepo}${path}`, { headers: headers(), signal: AbortSignal.timeout(10_000) })
}

export async function readReleaseSnapshot(prUrl: string | null, fetcher: FetchLike = fetch): Promise<ReleaseSnapshot> {
  if (!configured()) return setup()
  const number = prNumber(prUrl)
  if (!number) return { integration: 'ready', setupInstructions: null, pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Așteaptă ca workerul să deschidă un PR sau selectează un ordin care are PR.' }
  try {
    const [prResponse, reviewsResponse] = await Promise.all([
      github(`/pulls/${number}`, fetcher), github(`/pulls/${number}/reviews`, fetcher),
    ])
    if (!prResponse.ok) throw new Error('github_pr_unreadable')
    const pr = await prResponse.json() as Record<string, unknown>
    const head = pr.head as { sha?: unknown } | undefined
    const checks = typeof head?.sha === 'string'
      ? await github(`/commits/${encodeURIComponent(head.sha)}/check-runs`, fetcher)
      : new Response(null, { status: 500 })
    const checkBody = checks.ok ? await checks.json() as { check_runs?: Array<{ conclusion?: string | null; status?: string }> } : null
    const checkRuns = checkBody?.check_runs ?? []
    const checkState: CheckState = !checks.ok ? 'unknown' : checkRuns.some((c) => c.status !== 'completed') ? 'pending' : checkRuns.length === 0 ? 'unknown' : checkRuns.every((c) => c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped') ? 'passed' : 'failed'
    const reviews = reviewsResponse.ok ? await reviewsResponse.json() as Array<{ state?: string }> : []
    const approved = reviews.some((r) => r.state === 'APPROVED')
    const merged = pr.merged === true
    const mergeable = pr.mergeable === true
    const merge: ReleaseSnapshot['merge'] = merged ? 'merged' : checkState === 'passed' && approved && mergeable ? 'ready' : checkState === 'unknown' ? 'unknown' : 'blocked'
    return {
      integration: 'ready', setupInstructions: null,
      pr: { number, title: typeof pr.title === 'string' ? pr.title.slice(0, 240) : `PR #${number}`, url: typeof pr.html_url === 'string' ? pr.html_url : prUrl!, state: pr.state === 'closed' ? 'closed' : 'open', merged },
      checks: checkState, approval: approved ? 'approved' : 'required', merge,
      nextAction: merged ? 'PR-ul este integrat; așteaptă dovada separată de deploy live.' : checkState !== 'passed' ? 'Așteaptă sau repară verificările GitHub înainte de review.' : !approved ? 'Aprobă PR-ul din Keleon; GitHub poate aplica reguli suplimentare.' : merge === 'ready' ? 'Integrează PR-ul din Keleon; deploy-ul rămâne separat și verificat.' : 'GitHub încă nu permite merge-ul; citește starea PR-ului.',
    }
  } catch {
    return { integration: 'unavailable', setupInstructions: null, pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Integrarea GitHub nu poate fi citită acum. Verifică permisiunile OAuth și reîncearcă; nu presupune starea PR-ului.' }
  }
}

export async function actOnRelease(prUrl: string | null, action: 'approve' | 'merge', fetcher: FetchLike = fetch): Promise<{ ok: boolean; error?: string }> {
  if (!configured()) return { ok: false, error: 'github_integration_setup_required' }
  const number = prNumber(prUrl)
  if (!number) return { ok: false, error: 'invalid_pr_url' }
  const snapshot = await readReleaseSnapshot(prUrl, fetcher)
  if (snapshot.integration !== 'ready' || !snapshot.pr || snapshot.pr.merged) return { ok: false, error: 'release_not_actionable' }
  const endpoint = action === 'approve' ? `/pulls/${number}/reviews` : `/pulls/${number}/merge`
  const body = action === 'approve' ? { event: 'APPROVE' } : { merge_method: 'squash' }
  try {
    const response = await fetcher(`https://api.github.com/repos/${config.githubRepo}${endpoint}`, { method: action === 'approve' ? 'POST' : 'PUT', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
    return response.ok ? { ok: true } : { ok: false, error: action === 'approve' ? 'github_approval_rejected' : 'github_merge_rejected' }
  } catch { return { ok: false, error: 'github_unavailable' } }
}
