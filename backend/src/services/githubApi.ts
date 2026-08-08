// ── SINGLE SOURCE for the GitHub REST call (env token + fetch with headers) ─
// github.ts (the code loop: repo_write/open_pr/merge_pr) and runbooks.ts
// (workflow dispatch + journals) EACH had an identical copy of the
// ghToken()/gh() pair. Now just one (the permanent principle: unique, no
// duplicates). The token comes from env (GITHUB_TOKEN) and is never returned
// in responses. The timeout is a parameter: github used 20s, runbooks 15s —
// behaviour preserved.
export const REPO = 'kelion-team/kelionai'
export const GITHUB_API = `https://api.github.com/repos/${REPO}`

export function ghToken(): string {
  return (process.env.GITHUB_TOKEN ?? '').trim()
}

export async function gh(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}
