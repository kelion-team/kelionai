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
