// ── PAPER GITHUB, FOR TESTS ONLY ────────────────────────────────────────────
//
// The guard tests in `autonomie.test.ts` check WHEN Kelion refuses to work
// (pause, missing token, forbidden branch). They don't check what happens
// when it actually works — i.e. exactly the part that ships code to production.
//
// This engine answers like the GitHub API: it keeps refs, files, PRs, tags
// and workflow dispatches in memory, and records EVERY request (method, path,
// body). That way a test can say not just "it worked", but "it asked for
// EXACTLY this": a branch from master's tip, base64 content, a PR with base
// master, a squash merge.
//
// What it does NOT know THROWS 599 with the path in the body — a new route
// can't slip unseen through a "green" test.

export interface CerereGh {
  method: string
  path: string // without the /repos/owner/repo prefix
  body: unknown
}

export interface FakeGitHub {
  cereri: CerereGh[]
  refs: Map<string, string> // 'heads/master' → sha
  fisiere: Map<string, { sha: string; continut: string }> // 'branch:path'
  pruri: Map<number, { head: string; title: string; merged: boolean }>
  taguri: string[]
  dispatches: { workflow: string; ref: string }[]
  /** The runs returned for any /actions/... query. */
  rulari: { name?: string; status?: string; conclusion?: string | null }[]
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  cereriPe(fragment: string): CerereGh[]
}

const raspuns = (cod: number, corp: unknown): Response =>
  new Response(corp === undefined ? '' : JSON.stringify(corp), {
    status: cod,
    headers: { 'Content-Type': 'application/json' },
  })

export function creeazaFakeGitHub(shaMaster = 'a'.repeat(40)): FakeGitHub {
  const g: FakeGitHub = {
    cereri: [],
    refs: new Map([['heads/master', shaMaster]]),
    fisiere: new Map(),
    pruri: new Map(),
    taguri: [],
    dispatches: [],
    rulari: [],
    fetch: async () => raspuns(599, { error: 'neinițializat' }),
    cereriPe: (fragment) => g.cereri.filter((c) => c.path.includes(fragment)),
  }
  let urmatorulPr = 100
  let contorCommit = 0

  g.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url)
    const prefix = 'https://api.github.com/repos/kelion-team/kelionai'
    if (!url.startsWith(prefix)) return raspuns(599, { error: `URL în afara GitHub: ${url}` })
    const cale = url.slice(prefix.length)
    const method = (init?.method ?? 'GET').toUpperCase()
    const corp = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    g.cereri.push({ method, path: cale, body: corp })

    const c = (corp ?? {}) as Record<string, string>
    let m: RegExpMatchArray | null

    // ── Refs (branches + tags) ──
    if ((m = cale.match(/^\/git\/refs?\/(.+)$/)) && method === 'GET') {
      const cheie = decodeURIComponent(m[1])
      const sha = g.refs.get(cheie)
      return sha ? raspuns(200, { ref: `refs/${cheie}`, object: { sha } }) : raspuns(404, { message: 'Not Found' })
    }
    if (cale === '/git/refs' && method === 'POST') {
      const cheie = String(c.ref ?? '').replace(/^refs\//, '')
      if (g.refs.has(cheie)) return raspuns(422, { message: 'Reference already exists' })
      g.refs.set(cheie, String(c.sha ?? ''))
      if (cheie.startsWith('tags/')) g.taguri.push(cheie.slice('tags/'.length))
      return raspuns(201, { ref: `refs/${cheie}`, object: { sha: c.sha } })
    }
    if (cale === '/git/tags' && method === 'POST') {
      return raspuns(201, { sha: `tagobj${g.taguri.length}`, tag: c.tag, message: c.message })
    }

    // ── File content ──
    if ((m = cale.match(/^\/contents\/(.+?)(\?ref=(.+))?$/)) && method === 'GET') {
      const cheie = `${decodeURIComponent(m[3] ?? 'master')}:${decodeURIComponent(m[1])}`
      const f = g.fisiere.get(cheie)
      return f ? raspuns(200, { sha: f.sha, content: f.continut }) : raspuns(404, { message: 'Not Found' })
    }
    if ((m = cale.match(/^\/contents\/(.+)$/)) && method === 'PUT') {
      const ramura = String(c.branch ?? 'master')
      if (!g.refs.has(`heads/${ramura}`)) return raspuns(404, { message: 'Branch not found' })
      const cheie = `${ramura}:${decodeURIComponent(m[1])}`
      const vechi = g.fisiere.get(cheie)
      // GitHub requires the current sha on OVERWRITE; without it it answers 409.
      if (vechi && c.sha !== vechi.sha) return raspuns(409, { message: 'sha does not match' })
      contorCommit++
      g.fisiere.set(cheie, { sha: `blob${contorCommit}`, continut: String(c.content ?? '') })
      return raspuns(200, { commit: { sha: `commit${contorCommit}`.padEnd(40, '0') } })
    }

    // ── PRs ──
    if (cale === '/pulls' && method === 'POST') {
      const nr = urmatorulPr++
      if (String(c.base) !== 'master') return raspuns(422, { message: 'base must be master' })
      if (!g.refs.has(`heads/${c.head}`)) return raspuns(422, { message: 'head does not exist' })
      g.pruri.set(nr, { head: String(c.head), title: String(c.title ?? ''), merged: false })
      return raspuns(201, { number: nr, html_url: `https://github.com/kelion-team/kelionai/pull/${nr}` })
    }
    if ((m = cale.match(/^\/pulls\/(\d+)$/)) && method === 'GET') {
      const pr = g.pruri.get(Number(m[1]))
      return pr
        ? raspuns(200, { number: Number(m[1]), title: pr.title, head: { sha: `head${m[1]}` } })
        : raspuns(404, { message: 'Not Found' })
    }
    if ((m = cale.match(/^\/pulls\/(\d+)\/merge$/)) && method === 'PUT') {
      const nr = Number(m[1])
      const pr = g.pruri.get(nr)
      if (!pr) return raspuns(404, { message: 'Not Found' })
      if (pr.merged) return raspuns(405, { message: 'Pull Request is not mergeable' })
      pr.merged = true
      const sha = `merge${nr}`.padEnd(40, '0')
      g.refs.set('heads/master', sha) // deploy starts from the push into master
      return raspuns(200, { sha, merged: true, message: 'Pull Request successfully merged' })
    }

    // ── Actions (informational: checks + deploy loop) ──
    if (cale.startsWith('/actions/') && cale.includes('/dispatches') && method === 'POST') {
      const wf = cale.match(/workflows\/([^/]+)\/dispatches/)?.[1] ?? ''
      g.dispatches.push({ workflow: wf, ref: String(c.ref ?? '') })
      return raspuns(200, { ok: true }) // successful dispatch = 200 (GitHub docs)
    }
    if (cale.startsWith('/actions/') && method === 'GET') {
      return raspuns(200, { workflow_runs: g.rulari })
    }

    return raspuns(599, { error: `fake-github: rută neacoperită „${method} ${cale}"` })
  }

  return g
}
