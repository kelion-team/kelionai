// ── SURSĂ UNICĂ pentru apelul REST GitHub (token din env + fetch cu antete) ───
// github.ts (bucla de cod: repo_write/open_pr/merge_pr) și runbooks.ts (dispatch
// de workflow-uri + jurnale) aveau FIECARE o copie identică a perechii
// ghToken()/gh(). Acum una singură (principiul permanent: unic, fără duplicate).
// Tokenul vine din env (GITHUB_TOKEN) și nu se întoarce niciodată în răspunsuri.
// Timeout-ul e parametru: github folosea 20s, runbooks 15s — comportament păstrat.
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
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}
