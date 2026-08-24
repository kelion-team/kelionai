import { GITHUB_API as API, ghToken } from './githubApi.js'
import { config } from '../config.js'
// ── RECOVERY POINTS (Adrian, 27 Jul: "save on the Linux server, clearly
// recoverable" + "a recovery menu in admin, where you see the saved versions
// with clear details") ─────────────────────────────────────────────────────
// A recovery point = a git tag `backup-<date>-<sha>` on a master commit.
// The tag is the source of truth (it is on GitHub AND mirrored on the VPS by
// the backup-versiuni.sh cron, which materializes .bundle + .tar.gz for each
// tag). Here: we list the tags (with date, sha, note) and create a new one
// from admin.
function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ghToken()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

export interface RecoveryPoint {
  tag: string
  sha: string // the commit (short)
  date: string // ISO
  note: string
}

// Parses the date from the tag name (backup-2026-07-27-1115-3500603) as a
// fallback when the tag is not annotated (no date of its own).
function dateFromTagName(tag: string): string {
  const m = tag.match(/backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/)
  if (!m) return ''
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`
}

// AUDIT ADMIN (3 aug, Recuperare): token lipsă / GitHub ne-ok / timeout —
// toate colapsau în [] și panoul afișa „Nicio versiune salvată încă", în
// tabul de siguranță unde ownerul decide dacă are la ce să se întoarcă
// (tiparul „Cardul: necreat"). null = citirea a picat; [] = GitHub chiar a
// răspuns cu zero taguri.
export async function listRecoveryPoints(): Promise<RecoveryPoint[] | null> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return null
  try {
    const r = await fetch(`${API}/git/matching-refs/tags/backup-`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const refs = (await r.json()) as { ref: string; object: { sha: string; type: string } }[]
    const points = await Promise.all(
      refs.map(async (ref) => {
        const tag = ref.ref.replace('refs/tags/', '')
        let sha = ref.object.sha
        let date = dateFromTagName(tag)
        let note = ''
        // Annotated tag → we fetch the object for the message + date + real commit.
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
            /* the values from the name remain */
          }
        }
        return { tag, sha: sha.slice(0, 7), date, note }
      }),
    )
    return points.sort((a, b) => (a.date < b.date ? 1 : -1))
  } catch {
    return null
  }
}

export async function createRecoveryPoint(note: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) return { ok: false, error: 'github_token_missing' }
  try {
    // 1. The tip of master.
    const mr = await fetch(`${API}/git/refs/heads/master`, { headers: ghHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!mr.ok) return { ok: false, error: `master_ref_${mr.status}` }
    const commitSha = String(((await mr.json()) as { object: { sha: string } }).object.sha)
    const short = commitSha.slice(0, 7)
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
    const tag = `backup-${stamp}-${short}`
    const message = (note.trim() || `Punct de recuperare ${stamp} (creat din admin)`).slice(0, 500)
    // 2. The annotated tag object (keeps the message + date).
    const to = await fetch(`${API}/git/tags`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        tag,
        message,
        object: commitSha,
        type: 'commit',
        tagger: { name: 'Kelion Recovery', email: config.product.supportEmail, date: now.toISOString() },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!to.ok) return { ok: false, error: `tag_obj_${to.status}: ${(await to.text()).slice(0, 200)}` }
    const tagObjSha = String(((await to.json()) as { sha: string }).sha)
    // 3. The ref that makes the tag visible (and that the VPS materializes).
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

// ── THE REAL RESTORE (Adrian, 27 Jul: "add the selection buttons in admin
// too, so it can be selected") ──────────────────────────────────────────────
// Brings master EXACTLY to the state of the commit behind a backup tag, with
// a NEW commit (the old tree, parent = current tip) — so FORWARD, not by
// rewriting history: the "production = master" invariant stays intact, and
// publishing to the VPS starts by itself from the push to master.
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
    // 1. The tag → its commit (annotated tag → dereference to the commit).
    const rr = await fetch(`${API}/git/ref/tags/${tag}`, { headers: ghHeaders(), signal: t(12_000) })
    if (!rr.ok) return { ok: false, error: `tag_negasit_${rr.status}` }
    const refObj = (await j(rr)).object as { sha: string; type: string }
    let commitSha = refObj.sha
    if (refObj.type === 'tag') {
      const tr = await fetch(`${API}/git/tags/${refObj.sha}`, { headers: ghHeaders(), signal: t(12_000) })
      if (!tr.ok) return { ok: false, error: `tag_obiect_${tr.status}` }
      commitSha = ((await j(tr)).object as { sha: string }).sha
    }
    // 2. The saved commit's tree + the current tip of master.
    const [cr, mr] = await Promise.all([
      fetch(`${API}/git/commits/${commitSha}`, { headers: ghHeaders(), signal: t(12_000) }),
      fetch(`${API}/git/refs/heads/master`, { headers: ghHeaders(), signal: t(12_000) }),
    ])
    if (!cr.ok) return { ok: false, error: `commit_${cr.status}` }
    if (!mr.ok) return { ok: false, error: `master_${mr.status}` }
    const treeSha = ((await j(cr)).tree as { sha: string }).sha
    const headSha = ((await j(mr)).object as { sha: string }).sha
    if (headSha === commitSha) return { ok: true, sha: commitSha.slice(0, 7), via: 'push' }
    // 3. The restore commit: the saved tree, parent = current tip.
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
    // 4. Push master to the new commit (fast-forward). If the branch is
    //    protected against direct pushes, the fallback path: branch + PR +
    //    merge — same result.
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
