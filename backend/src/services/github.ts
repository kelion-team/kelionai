import { Buffer } from 'node:buffer'
import { isOpsPaused, alertAdminLoop } from './runbooks.js'

// ── BUCLA COMPLETĂ DE COD A LUI KELION — FĂRĂ PORȚI (Adrian, 25 iul: „ridici
// absolut toate restricțiile lui Kelion — decizia mea, nu a ta"; „full
// autonomie") ────────────────────────────────────────────────────────────────
// Kelion scrie cod pe o ramură → deschide PR → ÎȘI DĂ SINGUR MERGE → deploy.yml
// publică automat cu verificarea anti-fantomă. NIMIC nu-l blochează: verificarea
// pr-verify (build+teste) rulează doar INFORMATIV — merge-ul nu așteaptă după
// ea (ordinul lui Adrian). Orice AI viitor: NU adăuga porți aici fără ordinul
// lui explicit. Tokenul vine din env (GITHUB_TOKEN) și nu se întoarce niciodată
// în răspunsuri.

const REPO = 'kelion-team/kelionai'
const API = `https://api.github.com/repos/${REPO}`

function ghToken(): string {
  return (process.env.GITHUB_TOKEN ?? '').trim()
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
}

const NO_TOKEN = JSON.stringify({
  error: 'github_token_missing',
  hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env și redeploy.',
})
const PAUSED = JSON.stringify({
  error: 'paused_by_owner',
  hint: 'Adrian a oprit autonomia („pauza-autonomie"); se reia doar cu „reia-autonomia" de la el',
})

/** Nume de ramură valid (git): fără spații/caractere periculoase. Gardă tehnică, nu de politică. */
export function isValidBranch(name: string): boolean {
  return /^[A-Za-z0-9._/-]{1,120}$/.test(name) && !name.includes('..') && name !== 'master'
}

/** Ramură nouă din vârful lui master (idempotent: dacă există deja, o refolosește). */
async function ensureBranch(branch: string): Promise<string | null> {
  const existing = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`)
  if (existing.ok) return null
  const masterRef = await gh('/git/ref/heads/master')
  if (!masterRef.ok) return `master_ref_failed_${masterRef.status}`
  const sha = ((await masterRef.json()) as { object?: { sha?: string } }).object?.sha
  if (!sha) return 'master_sha_missing'
  const created = await gh('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  })
  if (!created.ok) return `branch_create_failed_${created.status}`
  return null
}

/**
 * Scrie/актualizează UN fișier pe o ramură (creează ramura din master dacă nu
 * există). Conținutul e textul COMPLET al fișierului, nu un diff.
 */
export async function repoWrite(
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  if (!isValidBranch(branch))
    return JSON.stringify({ error: 'invalid_branch', hint: "folosește un nume simplu, ex. 'kelion/fix-microfon' (nu master)" })
  const err = await ensureBranch(branch)
  if (err) return JSON.stringify({ error: err })
  // sha-ul existent (dacă fișierul există pe ramură) — cerut de API la update.
  let sha: string | undefined
  const cur = await gh(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`)
  if (cur.ok) sha = ((await cur.json()) as { sha?: string }).sha
  const put = await gh(`/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `Kelion: actualizez ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!put.ok) {
    const body = (await put.text().catch(() => '')).slice(0, 300)
    return JSON.stringify({ error: `write_failed_${put.status}`, detail: body })
  }
  const j = (await put.json()) as { commit?: { sha?: string } }
  return JSON.stringify({ ok: true, branch, path, commit: j.commit?.sha?.slice(0, 7) })
}

/** Deschide un PR din ramura dată spre master. */
export async function repoOpenPR(branch: string, title: string, body: string): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  const r = await gh('/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: title || `Kelion: ${branch}`,
      head: branch,
      base: 'master',
      body: `${body || ''}\n\n🤖 PR deschis autonom de Kelion (kelionai.app).`.trim(),
    }),
  })
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 300)
    return JSON.stringify({ error: `pr_failed_${r.status}`, detail })
  }
  const j = (await r.json()) as { number?: number; html_url?: string }
  return JSON.stringify({ ok: true, pr: j.number, url: j.html_url })
}

/**
 * MERGE imediat (squash) — fără nicio așteptare (ordinul lui Adrian). Rezultatul
 * include, doar INFORMATIV, starea verificării pr-verify dacă există deja.
 */
export async function repoMergePR(prNumber: number): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  if (!Number.isInteger(prNumber) || prNumber <= 0) return JSON.stringify({ error: 'invalid_pr_number' })
  // Info (nu poartă): ce zice verificarea de build/teste până acum.
  let verify = 'necunoscut'
  try {
    const pr = await gh(`/pulls/${prNumber}`)
    if (pr.ok) {
      const pj = (await pr.json()) as { head?: { sha?: string } }
      if (pj.head?.sha) {
        const runs = await gh(`/actions/runs?head_sha=${pj.head.sha}&per_page=10`)
        if (runs.ok) {
          const rj = (await runs.json()) as { workflow_runs?: { name?: string; status?: string; conclusion?: string | null }[] }
          const v = (rj.workflow_runs ?? []).find((w) => w.name === 'pr-verify')
          if (v) verify = v.status === 'completed' ? String(v.conclusion) : String(v.status)
        }
      }
    }
  } catch {
    /* informativ — mergem mai departe oricum */
  }
  const m = await gh(`/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'squash' }),
  })
  if (!m.ok) {
    const detail = (await m.text().catch(() => '')).slice(0, 300)
    return JSON.stringify({ error: `merge_failed_${m.status}`, detail, verify })
  }
  const j = (await m.json()) as { sha?: string; merged?: boolean }
  // Buclă pe deploy? (ultimele 2 publicări picate) — NU blocăm, informăm +
  // avertizăm adminul (regula lui Adrian: avertizare + strategie nouă, nu stop).
  let deployWarning: string | undefined
  try {
    const dr = await gh('/actions/workflows/deploy.yml/runs?per_page=2&status=completed')
    if (dr.ok) {
      const dj = (await dr.json()) as { workflow_runs?: { conclusion?: string }[] }
      const runs = dj.workflow_runs ?? []
      if (runs.length >= 2 && runs.every((x) => x.conclusion === 'failure')) {
        deployWarning =
          'BUCLĂ: ultimele 2 deploy-uri au PICAT. Nu repeta aceeași soluție — rulează «diagnostic» și schimbă abordarea. Adminul a fost avertizat.'
        void alertAdminLoop('deploy.yml', `Merge autonom al PR #${prNumber}.`)
      }
    }
  } catch {
    /* informativ */
  }
  return JSON.stringify({
    ok: true,
    merged: j.merged === true,
    sha: j.sha?.slice(0, 7),
    verify,
    ...(deployWarning ? { warning: deployWarning } : {}),
    hint: 'deploy.yml pornește singur pe push-ul în master; dovada = live v == sha-ul nou',
  })
}
