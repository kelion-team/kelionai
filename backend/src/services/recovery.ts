// ── PUNCTE DE RECUPERARE (Adrian, 27 iul: „salvare pe serverul Linux, clar
// recuperabilă" + „meniu de recovery în admin, unde vezi versiunile salvate cu
// detalii clare") ────────────────────────────────────────────────────────────
// Un punct de recuperare = un tag git `backup-<data>-<sha>` pe un commit din
// master. Tag-ul e sursa de adevăr (e pe GitHub ȘI oglindit pe VPS de cronul
// backup-versiuni.sh, care materializează .bundle + .tar.gz pentru fiecare tag).
// Aici: listăm tag-urile (cu data, sha, nota) și creăm unul nou din admin.
const REPO = 'kelion-team/kelionai'
const API = `https://api.github.com/repos/${REPO}`

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${(process.env.GITHUB_TOKEN ?? '').trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

export interface RecoveryPoint {
  tag: string
  sha: string // commitul (scurt)
  date: string // ISO
  note: string
}

// Parsează data din numele tag-ului (backup-2026-07-27-1115-3500603) ca rezervă
// când tag-ul nu e adnotat (fără dată proprie).
function dateFromTagName(tag: string): string {
  const m = tag.match(/backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/)
  if (!m) return ''
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`
}

export async function listRecoveryPoints(): Promise<RecoveryPoint[]> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return []
  try {
    const r = await fetch(`${API}/git/matching-refs/tags/backup-`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return []
    const refs = (await r.json()) as { ref: string; object: { sha: string; type: string } }[]
    const points = await Promise.all(
      refs.map(async (ref) => {
        const tag = ref.ref.replace('refs/tags/', '')
        let sha = ref.object.sha
        let date = dateFromTagName(tag)
        let note = ''
        // Tag adnotat → aducem obiectul pentru mesaj + dată + commitul real.
        if (ref.object.type === 'tag') {
          try {
            const tr = await fetch(`${API}/git/tags/${ref.object.sha}`, {
              headers: ghHeaders(),
              signal: AbortSignal.timeout(12_000),
            })
            if (tr.ok) {
              const t = (await tr.json()) as { message?: string; tagger?: { date?: string }; object?: { sha?: string } }
              note = String(t.message ?? '').trim()
              if (t.tagger?.date) date = t.tagger.date
              if (t.object?.sha) sha = t.object.sha
            }
          } catch {
            /* rămân valorile din nume */
          }
        }
        return { tag, sha: sha.slice(0, 7), date, note }
      }),
    )
    return points.sort((a, b) => (a.date < b.date ? 1 : -1))
  } catch {
    return []
  }
}

export async function createRecoveryPoint(note: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return { ok: false, error: 'github_token_missing' }
  try {
    // 1. Vârful lui master.
    const mr = await fetch(`${API}/git/refs/heads/master`, { headers: ghHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!mr.ok) return { ok: false, error: `master_ref_${mr.status}` }
    const commitSha = String(((await mr.json()) as { object: { sha: string } }).object.sha)
    const short = commitSha.slice(0, 7)
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
    const tag = `backup-${stamp}-${short}`
    const message = (note.trim() || `Punct de recuperare ${stamp} (creat din admin)`).slice(0, 500)
    // 2. Obiectul-tag adnotat (păstrează mesajul + data).
    const to = await fetch(`${API}/git/tags`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        tag,
        message,
        object: commitSha,
        type: 'commit',
        tagger: { name: 'Kelion Recovery', email: 'contact@kelionai.app', date: now.toISOString() },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!to.ok) return { ok: false, error: `tag_obj_${to.status}: ${(await to.text()).slice(0, 200)}` }
    const tagObjSha = String(((await to.json()) as { sha: string }).sha)
    // 3. Ref-ul care face tag-ul vizibil (și pe care VPS-ul îl materializează).
    const rr = await fetch(`${API}/git/refs`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: tagObjSha }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!rr.ok) return { ok: false, error: `ref_${rr.status}: ${(await rr.text()).slice(0, 200)}` }
    return { ok: true, tag }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}

// ── ȘTERGEREA UNUI PUNCT (Adrian, 27 iul: „la stânga de restaurează, buton
// roșu șterge") ──────────────────────────────────────────────────────────────
// Șterge tag-ul de pe GitHub (sursa de adevăr a listei). Commit-ul rămâne în
// istoricul git — doar eticheta de backup dispare din meniu; oglinda .bundle
// de pe VPS o curăță cronul de backup la următoarea trecere.
export async function deleteRecoveryPoint(tag: string): Promise<{ ok: boolean; error?: string }> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return { ok: false, error: 'github_token_missing' }
  if (!/^backup-[A-Za-z0-9._-]+$/.test(tag)) return { ok: false, error: 'tag_invalid' }
  try {
    const r = await fetch(`${API}/git/refs/tags/${tag}`, {
      method: 'DELETE',
      headers: ghHeaders(),
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok && r.status !== 404) return { ok: false, error: `sterge_${r.status}: ${(await r.text()).slice(0, 150)}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}

// ── RESTAURAREA REALĂ (Adrian, 27 iul: „pune și butoanele de selecție în admin,
// să se poată selecta") ──────────────────────────────────────────────────────
// Aduce master EXACT la starea commitului din spatele unui tag de backup, cu un
// commit NOU (arborele vechi, părinte = vârful curent) — deci ÎNAINTE, nu prin
// rescrierea istoriei: invariantul „producția = master" rămâne intact, iar
// publicarea pe VPS pornește singură din push-ul pe master.
export async function restoreToPoint(
  tag: string,
): Promise<{ ok: boolean; sha?: string; via?: 'push' | 'pr'; error?: string }> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return { ok: false, error: 'github_token_missing' }
  if (!/^backup-[A-Za-z0-9._-]+$/.test(tag)) return { ok: false, error: 'tag_invalid' }
  const j = async (r: Response): Promise<Record<string, unknown>> =>
    (await r.json()) as Record<string, unknown>
  const t = (ms: number): AbortSignal => AbortSignal.timeout(ms)
  try {
    // 1. Tag-ul → commitul lui (tag adnotat → dereferențiere la commit).
    const rr = await fetch(`${API}/git/ref/tags/${tag}`, { headers: ghHeaders(), signal: t(12_000) })
    if (!rr.ok) return { ok: false, error: `tag_negasit_${rr.status}` }
    const refObj = (await j(rr)).object as { sha: string; type: string }
    let commitSha = refObj.sha
    if (refObj.type === 'tag') {
      const tr = await fetch(`${API}/git/tags/${refObj.sha}`, { headers: ghHeaders(), signal: t(12_000) })
      if (!tr.ok) return { ok: false, error: `tag_obiect_${tr.status}` }
      commitSha = ((await j(tr)).object as { sha: string }).sha
    }
    // 2. Arborele commitului salvat + vârful curent al lui master.
    const [cr, mr] = await Promise.all([
      fetch(`${API}/git/commits/${commitSha}`, { headers: ghHeaders(), signal: t(12_000) }),
      fetch(`${API}/git/refs/heads/master`, { headers: ghHeaders(), signal: t(12_000) }),
    ])
    if (!cr.ok) return { ok: false, error: `commit_${cr.status}` }
    if (!mr.ok) return { ok: false, error: `master_${mr.status}` }
    const treeSha = ((await j(cr)).tree as { sha: string }).sha
    const headSha = ((await j(mr)).object as { sha: string }).sha
    if (headSha === commitSha) return { ok: true, sha: commitSha.slice(0, 7), via: 'push' }
    // 3. Commitul de restaurare: arborele salvat, părinte = vârful curent.
    const nc = await fetch(`${API}/git/commits`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        message: `RESTAURARE: aplicatia adusa la starea ${tag} (din panoul Recuperare)`,
        tree: treeSha,
        parents: [headSha],
      }),
      signal: t(15_000),
    })
    if (!nc.ok) return { ok: false, error: `commit_nou_${nc.status}: ${(await nc.text()).slice(0, 200)}` }
    const newSha = String((await j(nc)).sha)
    // 4. Împinge master la commitul nou (fast-forward). Dacă ramura e protejată
    //    la push direct, calea de rezervă: ramură + PR + merge — același rezultat.
    const up = await fetch(`${API}/git/refs/heads/master`, {
      method: 'PATCH',
      headers: ghHeaders(),
      body: JSON.stringify({ sha: newSha, force: false }),
      signal: t(15_000),
    })
    if (up.ok) return { ok: true, sha: newSha.slice(0, 7), via: 'push' }
    const branch = `restore/${tag}-${Date.now().toString(36)}`
    const br = await fetch(`${API}/git/refs`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newSha }),
      signal: t(12_000),
    })
    if (!br.ok) return { ok: false, error: `ramura_${br.status}: ${(await br.text()).slice(0, 200)}` }
    const pr = await fetch(`${API}/pulls`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        title: `RESTAURARE la ${tag}`,
        head: branch,
        base: 'master',
        body: `Restaurare comandată din panoul Recuperare: master adus la starea ${tag}.`,
      }),
      signal: t(15_000),
    })
    if (!pr.ok) return { ok: false, error: `pr_${pr.status}: ${(await pr.text()).slice(0, 200)}` }
    const prNum = Number((await j(pr)).number)
    const mg = await fetch(`${API}/pulls/${prNum}/merge`, {
      method: 'PUT',
      headers: ghHeaders(),
      body: JSON.stringify({ merge_method: 'merge' }),
      signal: t(20_000),
    })
    if (!mg.ok) return { ok: false, error: `merge_${mg.status}: ${(await mg.text()).slice(0, 200)}` }
    const merged = String(((await j(mg)) as { sha?: string }).sha ?? newSha)
    return { ok: true, sha: merged.slice(0, 7), via: 'pr' }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}
