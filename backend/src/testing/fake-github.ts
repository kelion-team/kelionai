// ── GITHUB DE HÂRTIE, DOAR PENTRU TESTE ─────────────────────────────────────
//
// Testele de gardă din `autonomie.test.ts` verifică CÂND Kelion refuză să
// lucreze (pauză, token lipsă, ramură interzisă). Nu verifică ce se întâmplă
// când chiar lucrează — adică exact partea care duce cod în producție.
//
// Motorul ăsta răspunde ca API-ul GitHub: ține ref-uri, fișiere, PR-uri, tag-uri
// și dispecerizări de workflow în memorie, și înregistrează FIECARE cerere
// (metodă, cale, corp). Așa testul poate spune nu doar „a mers", ci „a cerut
// EXACT asta": ramură din vârful lui master, conținut base64, PR cu baza
// master, merge prin squash.
//
// Ce NU cunoaște ARUNCĂ 599 cu calea în corp — o rută nouă nu poate trece
// nevăzută printr-un test „verde".

export interface CerereGh {
  method: string
  path: string // fără prefixul /repos/owner/repo
  body: unknown
}

export interface FakeGitHub {
  cereri: CerereGh[]
  refs: Map<string, string> // 'heads/master' → sha
  fisiere: Map<string, { sha: string; continut: string }> // 'ramura:cale'
  pruri: Map<number, { head: string; title: string; merged: boolean }>
  taguri: string[]
  dispatches: { workflow: string; ref: string }[]
  /** Rulările întoarse pentru orice interogare de tip /actions/... */
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

    // ── Ref-uri (ramuri + tag-uri) ──
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

    // ── Conținut de fișier ──
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
      // GitHub cere sha-ul curent la SUPRASCRIERE; fără el răspunde 409.
      if (vechi && c.sha !== vechi.sha) return raspuns(409, { message: 'sha does not match' })
      contorCommit++
      g.fisiere.set(cheie, { sha: `blob${contorCommit}`, continut: String(c.content ?? '') })
      return raspuns(200, { commit: { sha: `commit${contorCommit}`.padEnd(40, '0') } })
    }

    // ── PR-uri ──
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
      g.refs.set('heads/master', sha) // publicarea pornește din push-ul în master
      return raspuns(200, { sha, merged: true, message: 'Pull Request successfully merged' })
    }

    // ── Acțiuni (informativ: verificări + buclă de deploy) ──
    if (cale.startsWith('/actions/') && cale.includes('/dispatches') && method === 'POST') {
      const wf = cale.match(/workflows\/([^/]+)\/dispatches/)?.[1] ?? ''
      g.dispatches.push({ workflow: wf, ref: String(c.ref ?? '') })
      return raspuns(200, { ok: true }) // dispatch reușit = 200 (docul GitHub)
    }
    if (cale.startsWith('/actions/') && method === 'GET') {
      return raspuns(200, { workflow_runs: g.rulari })
    }

    return raspuns(599, { error: `fake-github: rută neacoperită „${method} ${cale}"` })
  }

  return g
}
