import { Buffer } from 'node:buffer'
import { isOpsPaused, alertAdminLoop } from './runbooks.js'
import { createRecoveryPoint } from './recovery.js'
import { ghToken, gh } from './githubApi.js' // token + GitHub fetch from the SINGLE source

// ── KELION'S COMPLETE CODE LOOP — NO GATES (Adrian, Jul 25: "lift absolutely
// all of Kelion's restrictions — my decision, not yours"; "full autonomy") ────
// Kelion writes code on a branch → opens a PR → MERGES IT HIMSELF → deploy.yml
// publishes automatically with the anti-phantom check. NOTHING blocks him: the
// pr-verify check (build+tests) runs INFORMATIVELY only — the merge doesn't
// wait for it (Adrian's order). Any future AI: do NOT add gates here without
// his explicit order. The token comes from env (GITHUB_TOKEN) and is never
// returned in responses.

const NO_TOKEN = JSON.stringify({
  error: 'github_token_missing',
  hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env și redeploy.',
})
const PAUSED = JSON.stringify({
  error: 'paused_by_owner',
  hint: 'Adrian a oprit autonomia („pauza-autonomie"); se reia doar cu „reia-autonomia" de la el',
})

/**
 * Normalizes the branch name into safe git form (Jul 25 incident: Kelion,
 * working in Romanian, named a branch with DIACRITICS and the strict guard
 * blocked his fix delivery — "the branch-validation defect". We don't reject:
 * we repair).
 */
export function normalizeBranch(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  return ascii
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-/.]+|[-/.]+$/g, '')
    .slice(0, 120)
}

/** Branch name valid AFTER normalization.
 *
 *  HARDENED (Jul 30, two holes caught by tests on the strongest tool's guard
 *  in the software):
 *   • `main` was NOT blocked — only `master`. Today the default branch is
 *     master, so it couldn't be exploited, but it was a LATENT hole: if the
 *     repo ever moved to `main`, Kelion could have written DIRECTLY to
 *     production, bypassing the rule "publishing must go through a PR".
 *   • `///` passed validation (it matched the allowed character set). On the
 *     real path normalization emptied it, but a guard doesn't lean on someone
 *     else: we now require at least one letter or digit.
 */
export function isValidBranch(name: string): boolean {
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(name)) return false
  if (!/[A-Za-z0-9]/.test(name)) return false // "///" or "---" are not names
  if (name.includes('..')) return false
  // The publishing branches are NEVER written directly — not under another
  // name either.
  const jos = name.toLowerCase()
  return jos !== 'master' && jos !== 'main'
}

/** New branch from master's tip (idempotent: reuses it if it already exists). */
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
 * Writes/updates ONE file on a branch (creates the branch from master if it
 * doesn't exist). The content is the file's COMPLETE text, not a diff.
 */
export async function repoWrite(
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  branch = normalizeBranch(branch)
  if (!isValidBranch(branch))
    return JSON.stringify({ error: 'invalid_branch', hint: "folosește un nume simplu, ex. 'kelion/fix-microfon' (nu master)" })
  const err = await ensureBranch(branch)
  if (err) return JSON.stringify({ error: err })
  // The existing sha (if the file exists on the branch) — required by the API
  // on update.
  let sha: string | undefined
  let marimeVeche = 0
  const cur = await gh(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`)
  if (cur.ok) {
    const j = (await cur.json()) as { sha?: string; size?: number }
    sha = j.sha
    marimeVeche = Number(j.size ?? 0)
  }
  // ── ANTI-TRUNCATION GUARD ──────────────────────────────────────────────────
  //
  // Jul 31 2026, 12:36. Kelion opened and self-merged PR #613: "exclude a
  // model from the constructor's ladder" — a two-line change. It went into
  // master with 2 insertions and **1036 deletions**, and
  // `deploy/constructor-agent.mjs` was left with 14 lines out of 1049. His
  // diagnosis was correct (the model really was returning empty answers to 11
  // orders in a row); the execution gutted the file.
  //
  // Cause: `repo_write` asks for the COMPLETE CONTENT, but the model's output
  // is capped. On a big file, the answer gets cut — and what gets written is a
  // stump, with a commit and message that sound right.
  //
  // This guard had EXISTED for a long time, but in the VPS constructor
  // (`deploy/constructor-agent.mjs`, `toolWrite`), written after a previous
  // incident of the same kind. The path from the app — this one — never got
  // the same lesson. A guard placed in a single spot protects a single spot.
  //
  // 50% is the constructor's threshold, kept identical on purpose: two
  // different thresholds for the same danger would mean one of them is wrong.
  const PRAG_MINIM_OCTETI = 2_000
  const marimeNoua = Buffer.byteLength(content, 'utf8')
  if (marimeVeche > PRAG_MINIM_OCTETI && marimeNoua < marimeVeche * 0.5)
    return JSON.stringify({
      error: 'refuzat_ciuntire',
      detail:
        `Ai trimis ${marimeNoua} octeți peste un fișier de ${marimeVeche} (${Math.round((marimeNoua / marimeVeche) * 100)}%). ` +
        'Pare tăiat de plafonul de ieșire, nu o ștergere intenționată. ' +
        'repo_write cere fișierul ÎNTREG: citește-l cu read_source, schimbă DOAR ce trebuie, și retrimite-l complet. ' +
        'Dacă chiar vrei să ștergi conținutul, fă-o într-un pas separat, explicit.',
    })
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

/** Opens a PR from the given branch to master. */
export async function repoOpenPR(branch: string, title: string, body: string): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  branch = normalizeBranch(branch)
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
 * Immediate MERGE (squash) — no waiting (Adrian's order). The result includes,
 * INFORMATIVELY only, the pr-verify check state if it already exists.
 */
export async function repoMergePR(prNumber: number): Promise<string> {
  if (!ghToken()) return NO_TOKEN
  if (await isOpsPaused()) return PAUSED
  if (!Number.isInteger(prNumber) || prNumber <= 0) return JSON.stringify({ error: 'invalid_pr_number' })
  // Info (not a gate): what the build/test check says so far + the PR title
  // (for the checkpoint description below).
  let verify = 'necunoscut'
  let prTitle = ''
  try {
    const pr = await gh(`/pulls/${prNumber}`)
    if (pr.ok) {
      const pj = (await pr.json()) as { head?: { sha?: string }; title?: string }
      prTitle = String(pj.title ?? '').slice(0, 160)
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
    /* informative — we proceed anyway */
  }

  // ── AUTOMATIC CHECKPOINT BEFORE THE RISKY OPERATION (Autonomy stage 3,
  // owner order Jul 29: "before difficult operations a save is made so one can
  // return to the previous step, with a full description") ───────────────────
  // Merging a PR goes TO PRODUCTION (deploy.yml starts on the push to master).
  // So BEFORE merging we save master's CURRENT state as an annotated recovery
  // point, with a clear description of what's about to change. If the deploy
  // breaks something, the owner (or Kelion) returns EXACTLY to the prior state
  // from the Recovery panel (restoreToPoint). Best-effort: a failed checkpoint
  // does NOT block the merge (the backup-versions cron makes points every 10
  // min anyway) — but it's clearly reported, so it's known whether the net
  // exists or not.
  let checkpoint: string | undefined
  let checkpointError: string | undefined
  try {
    const cp = await createRecoveryPoint(
      `Checkpoint AUTO înainte de merge PR #${prNumber}${prTitle ? `: ${prTitle}` : ''}. ` +
        'Salvează starea PRODUCȚIEI de dinainte de această schimbare — revenire din panoul Recuperare dacă deploy-ul strică ceva.',
    )
    if (cp.ok) checkpoint = cp.tag
    else checkpointError = cp.error
  } catch (e) {
    checkpointError = String((e as Error).message ?? e).slice(0, 120)
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
  // Deploy loop? (the last 2 publishes failed) — we do NOT block, we inform +
  // alert the admin (Adrian's rule: warning + new strategy, not stop).
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
    /* informative */
  }
  return JSON.stringify({
    ok: true,
    merged: j.merged === true,
    sha: j.sha?.slice(0, 7),
    verify,
    // The pre-merge checkpoint: tells the owner he can return to it (the tag)
    // if the deploy breaks something; or warns if it couldn't be created (the
    // net is missing on this change).
    ...(checkpoint
      ? { checkpoint, checkpointHint: `Am salvat starea de dinainte ca punct de recuperare „${checkpoint}" — revenire din panoul Recuperare dacă e nevoie.` }
      : { checkpointWarning: `NU am putut crea checkpoint înainte de merge (${checkpointError ?? 'necunoscut'}) — există totuși punctele automate la 10 min.` }),
    ...(deployWarning ? { warning: deployWarning } : {}),
    hint: 'deploy.yml pornește singur pe push-ul în master; dovada = live v == sha-ul nou',
  })
}
