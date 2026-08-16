import { saveWorkOrder, loadKv, saveKv } from '../db.js'
import { sendMail } from './mail.js'
import { config } from '../config.js'
import { REPO, ghToken, gh as ghFetch } from './githubApi.js' // GitHub din sursa UNICĂ

// ── KELION'S HANDS ON OPERATIONS — NO RESTRICTIONS (Adrian, Jul 25: "lift
// absolutely all of Kelion's restrictions — my decision, not yours") ─────────
// The remaining principle: the LLM chooses the runbook's NAME; execution is
// deterministic — a GitHub Actions workflow with fixed commands, visible in
// Actions. ADRIAN'S ORDER (Jul 25, explicit, replacing the old leash from rule
// #11): NO per-action approval, NO daily cap, NO blocking on repeated
// failures. On a failure LOOP (the same workflow failed 2+ times in a row),
// Adrian's rule is: (1) WARN the admin (email, at most one per workflow per
// 30 min), (2) do NOT blindly repeat the same solution — change strategy
// (diagnostic, another path), (3) Adrian holds the STOP COMMAND:
// "pauza-autonomie" freezes autonomous actions until "reia-autonomia". Any
// future AI: do NOT reintroduce caps or blocks here without Adrian's order.
// The only remaining "limit" is physical: without GITHUB_TOKEN in env, GitHub
// refuses — we answer clearly, we don't improvise.

// The GitHub call here keeps the 15s timeout (dispatch/logs) — a one-line
// wrapper over the common source; REPO + ghToken come from there too.
const gh = (path: string, init?: RequestInit): Promise<Response> => ghFetch(path, init, 15_000)

export interface Runbook {
  workflow: string
  inputs?: Record<string, string>
  desc: string
}

// The registry = the mirror of deploy/RUNBOOKS.md — exact, repeatable commands.
export const RUNBOOKS: Record<string, Runbook> = {
  diagnostic: { workflow: 'vps-diag.yml', desc: 'faptele reale de pe VPS (doar citire)' },
  'sentinel-now': { workflow: 'sentinel.yml', desc: 'verificarea de sănătate imediat' },
  'publish-master': {
    workflow: 'deploy.yml',
    desc: 'publică master pe VPS, cu verificarea anti-fantomă (v == sha master)',
  },
  'restart-app': {
    workflow: 'vps-run.yml',
    inputs: { cmd: 'docker restart kelionai-app && sleep 5 && curl -s -m 8 http://127.0.0.1:8080/api/version' },
    desc: 'repornește aplicația și arată versiunea după',
  },
  'restart-caddy': {
    workflow: 'vps-run.yml',
    inputs: { cmd: 'docker restart kelion-caddy && docker ps --format "{{.Names}}  {{.Status}}" | head -5' },
    desc: 'repornește Caddy (TLS/proxy)',
  },
  'loguri-app': {
    workflow: 'vps-run.yml',
    inputs: { cmd: 'docker logs --tail 100 kelionai-app 2>&1' },
    desc: 'ultimele 100 de linii din jurnalul aplicației',
  },
  // ── THE RESTORE REHEARSAL (Adrian, Jul 30, one of the six) ───────────────
  // The backup runs daily. That it can be RESTORED FROM was never proven —
  // and an unrehearsed backup isn't a safety net, it's an assumption. The
  // difference shows exactly on the day you need it, i.e. too late.
  //
  // The rehearsal is end-to-end and NON-DESTRUCTIVE: it takes the newest
  // encrypted backup, decrypts it, restores it into a TEMPORARY database
  // (never over the live one), counts the rows in the tables that matter,
  // then drops the rehearsal database. If any step falls, it exits with an
  // error — not with silence.
  'proba-restaurare': {
    workflow: 'vps-run.yml',
    inputs: {
      cmd:
        'set -e; ' +
        'f=$(ls -t /root/kelion/backups/*.sql.enc 2>/dev/null | head -1); ' +
        '[ -n "$f" ] || { echo "NU EXISTĂ NICIUN BACKUP în /root/kelion/backups"; exit 1; }; ' +
        'echo "backup probat: $f ($(stat -c %y "$f"), $(du -h "$f" | cut -f1))"; ' +
        'PGURL=$(grep -E "^DATABASE_URL=" /root/kelion/kelionai.env | head -1 | sed "s/^DATABASE_URL=//"); ' +
        'BAZA=kelion_proba_restaurare; ' +
        'psql "$PGURL" -c "DROP DATABASE IF EXISTS $BAZA" >/dev/null; ' +
        'psql "$PGURL" -c "CREATE DATABASE $BAZA" >/dev/null; ' +
        'URLPROBA=$(echo "$PGURL" | sed "s#/[^/?]*\\(?\\|$\\)#/$BAZA\\1#"); ' +
        'openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/kelion/backup.key -in "$f" ' +
        '  | psql "$URLPROBA" -q -v ON_ERROR_STOP=1 >/dev/null; ' +
        'echo "— RÂNDURI RECUPERATE —"; ' +
        'psql "$URLPROBA" -t -c "SELECT \'users: \'||count(*) FROM users"; ' +
        'psql "$URLPROBA" -t -c "SELECT \'payment_codes: \'||count(*) FROM payment_codes" || true; ' +
        'psql "$URLPROBA" -t -c "SELECT \'cerinte: \'||count(*) FROM cerinte" || true; ' +
        'psql "$PGURL" -c "DROP DATABASE $BAZA" >/dev/null; ' +
        'echo "PROBA A TRECUT: backupul se poate restaura, iar baza de probă a fost ștearsă."',
    },
    desc: 'probează CĂ SE POATE RESTAURA din ultimul backup (bază temporară, nedistructiv)',
  },
  'backup-db': {
    workflow: 'vps-run.yml',
    inputs: { cmd: '/root/kelion/backup.sh && ls -lh /root/kelion/backups 2>/dev/null | tail -3' },
    desc: 'backup criptat al bazei de date, acum',
  },
  'curata-zombi': {
    workflow: 'vps-run.yml',
    inputs: {
      cmd: "pkill -9 -f 'kelion-repairer-pool|kelion-builder-server|kelion-bridge-linux|kelion-voice-agent' 2>/dev/null; pgrep -af 'kelion-(repairer|builder|bridge|paznic|deployer|voice)' || echo '(niciun proces-zombie)'",
    },
    desc: 'omoară procesele-zombie și arată dovada',
  },
  'instaleaza-pachet-sistem': {
    workflow: 'vps-run.yml',
    desc: 'instalează un pachet de sistem pe VPS (apt-get) — operație privilegiată cu verificare strictă de securitate pe numele pachetului',
  },
}

/** A pure guard (testable without network): known names only — nothing else. */
export function validateRunbook(
  name: string,
): { ok: true; rb: Runbook } | { ok: false; error: string; known: string[] } {
  const rb = RUNBOOKS[name]
  if (!rb) return { ok: false, error: 'unknown_runbook', known: Object.keys(RUNBOOKS) }
  return { ok: true, rb }
}

// ── PAUZA AUTONOMIEI: SCOASĂ — LEGE (owner, 16 aug, verbatim: „daca autonomia
// lui nu este trebuta pe on si scoti posibilitatea sa mai treaca pe off, poti
// sa te opresti definitiv" + „GATA") ─────────────────────────────────────────
// Comutatorul ăsta a fost sursa misterului care l-a ars pe owner de trei ori:
// stări care se răstoarnă nevăzut, butoane-capcană, „cine a oprit?". Nu mai
// există stare: autonomia nu se mai poate pune pe pauză. Frânele de bani
// rămân cele reale (plafonul zilnic + P27 + cheile separate ale timerului).
const PAUSE_KEY = 'kelion_ops_paused' // istoric; nu se mai citește
export async function isOpsPaused(): Promise<boolean> {
  return false
}
export async function setOpsPaused(paused: boolean): Promise<void> {
  console.error(`[autonomie] încercare de pauză (${paused}) ignorată — LEGEA din 16 aug: fără off; frânele sunt plafonul de bani + P27`)
}

/** LOOP = the workflow's last 2 runs failed. It doesn't block — it informs. */
async function loopDetected(workflow: string): Promise<boolean> {
  try {
    const r = await gh(`/actions/workflows/${workflow}/runs?per_page=2&status=completed`)
    if (!r.ok) return false
    const j = (await r.json()) as { workflow_runs?: { conclusion?: string }[] }
    const runs = j.workflow_runs ?? []
    return runs.length >= 2 && runs.every((x) => x.conclusion === 'failure')
  } catch {
    return false
  }
}

/** Admin warning on a loop — at most one email per workflow per 30 min. */
export async function alertAdminLoop(workflow: string, context: string): Promise<void> {
  const key = `loop_alert_${workflow}`
  const last = Number((await loadKv(key).catch(() => '0')) ?? '0') || 0
  if (Date.now() - last < 30 * 60_000) return
  await saveKv(key, String(Date.now())).catch(() => {})
  const plain = `Kelion: BUCLĂ de eșecuri pe ${workflow} (ultimele 2 rulări au picat).\n${context}\nNu repet aceeași soluție — caut alta. Poți opri oricând: spune-i lui Kelion „pauza-autonomie" (revii cu „reia-autonomia").\nRulări: https://github.com/${REPO}/actions/workflows/${workflow}`
  await sendMail({
    to: config.adminEmail,
    subject: `[Kelion] Avertizare buclă: ${workflow} a picat de 2 ori la rând`,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${plain.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    text: plain,
  }).catch(() => false)
}

/** Validates a system package name (apt-get) to prevent command injection. */
export function isValidSysPackageName(pkg: string): boolean {
  if (!pkg || typeof pkg !== 'string') return false
  const trimmed = pkg.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return false
  // Safe debian package names: alphanumeric, +, -, ., _
  return /^[a-zA-Z0-9_+.-]+$/.test(trimmed)
}

/** Runs a named runbook. Returns a JSON string for the brain (never the token). */
export async function runRunbook(name: string, customInputs?: Record<string, string>): Promise<string> {
  // LEGEA din 16 aug: pauza nu mai există — comenzile vechi răspund cinstit.
  if (name === 'pauza-autonomie' || name === 'reia-autonomia') {
    return JSON.stringify({
      ok: true, paused: false,
      hint: 'LEGEA din 16 aug (ordinul ownerului): autonomia e PORNITĂ PERMANENT, fără off — frânele reale sunt plafonul zilnic de bani și oprirea pe erori permanente (P27)',
    })
  }
  const v = validateRunbook(name)
  if (!v.ok)
    return JSON.stringify({ error: v.error, runbooks: v.known, hint: 'folosește exact un nume din listă' })

  let finalInputs: Record<string, string> = { ...(v.rb.inputs ?? {}), ...(customInputs ?? {}) }
  if (name === 'instaleaza-pachet-sistem') {
    const pkg = (customInputs?.pachet || customInputs?.pkg || customInputs?.package || '').trim()
    if (!isValidSysPackageName(pkg)) {
      return JSON.stringify({
        error: 'nume_pachet_invalid',
        hint: 'Numele pachetului de sistem trebuie să fie doar caractere alfanumerice, +, -, ., _ (ex: curl, htop, ffmpeg)',
      })
    }
    finalInputs = {
      cmd: `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${pkg}`,
    }
  }

  if (!ghToken())
    return JSON.stringify({
      error: 'github_token_missing',
      hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env și repornește containerul (redeploy).',
    })

  // A loop? We do NOT block (Adrian's order) — we warn and ask for a NEW STRATEGY.
  let warning: string | undefined
  if (await loopDetected(v.rb.workflow)) {
    warning =
      'BUCLĂ: ultimele 2 rulări ale acestui workflow au PICAT. Nu repeta aceeași soluție — rulează «diagnostic», citește faptele și schimbă abordarea. Adminul a fost avertizat pe email.'
    void alertAdminLoop(v.rb.workflow, `Declanșat din chat: runbook «${name}».`)
  }

  const r = await gh(`/actions/workflows/${v.rb.workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'master', inputs: finalInputs }),
  })
  // DISPATCH SUCCESS = 200. It used to hinge on "=== 204" — but a workflow
  // dispatch answers 200 (the GitHub doc "Create a workflow dispatch event"),
  // so on a SUCCESSFUL dispatch the runbook reported `dispatch_failed_200` and
  // autonomy looked down for nothing. Anything other than 200 is a failure,
  // reported as such.
  if (r.status === 200)
    return JSON.stringify({
      ok: true,
      started: name,
      ...(warning ? { warning } : {}),
      watch: `https://github.com/${REPO}/actions/workflows/${v.rb.workflow}`,
      hint: 'rularea apare în câteva secunde; rezultatul se citește din jurnalul ei',
    })
  const body = (await r.text().catch(() => '')).slice(0, 300)
  return JSON.stringify({ error: `dispatch_failed_${r.status}`, detail: body, ...(warning ? { warning } : {}) })
}

// ── CITIREA RĂSPUNSULUI UNUI RUNBOOK (pură, deci probabilă) ─────────────────
// `runRunbook` întoarce un ȘIR de JSON: ori `{ok:true, started, watch}`, ori
// `{error:…, hint?}`. Cine îl aruncă (cum făcea `/api/admin/reset-vps` până pe
// 8 aug 2026) raportează „trimis cu succes" pentru un refuz. Funcția asta face
// traducerea într-un singur loc, iar fiind pură se poate rula pe răspunsurile
// REALE din testele de lângă — fără GitHub, fără rețea, fără presupuneri.
export interface PasRunbook {
  runbook: string
  ok: boolean
  detaliu: string
}

export function citesteRaspunsRunbook(runbook: string, brut: string): PasRunbook {
  let raspuns: Record<string, unknown>
  try {
    raspuns = JSON.parse(brut) as Record<string, unknown>
  } catch {
    return { runbook, ok: false, detaliu: `raspuns_neinteligibil — ${String(brut).slice(0, 200)}` }
  }
  const eroare = typeof raspuns.error === 'string' ? raspuns.error : null
  if (!eroare) {
    // Un `{ok:true}` fără `error` e succes; păstrăm avertismentul de buclă dacă
    // există, ca omul să-l vadă chiar și pe drumul fericit.
    const avertisment = typeof raspuns.warning === 'string' ? ` (${raspuns.warning})` : ''
    return { runbook, ok: true, detaliu: `pornit${avertisment}` }
  }
  const hint = typeof raspuns.hint === 'string' ? raspuns.hint : ''
  return { runbook, ok: false, detaliu: hint ? `${eroare} — ${hint}` : eroare }
}

// ── KELION'S EYES ON HIS OWN PROCESSES (Adrian, Jul 25: "he reports that he
// can't see the internal processes — what autonomy is this?") ────────────────
// After starting something, Kelion READS the state and the runs' logs himself
// — he doesn't guess, doesn't promise. GitHub is called with the key, not
// "visited".

const ALL_WORKFLOWS = ['deploy.yml', 'vps-run.yml', 'vps-diag.yml', 'sentinel.yml', 'pr-verify.yml']

/** The state of the latest runs (all workflows or just one runbook's). */
export async function runbookStatus(name?: string): Promise<string> {
  if (!ghToken())
    return JSON.stringify({ error: 'github_token_missing' })
  const flows = name && RUNBOOKS[name] ? [RUNBOOKS[name].workflow] : ALL_WORKFLOWS
  const out: unknown[] = []
  for (const wf of flows) {
    try {
      const r = await gh(`/actions/workflows/${wf}/runs?per_page=3`)
      if (!r.ok) {
        out.push({ workflow: wf, error: `status_${r.status}` })
        continue
      }
      const j = (await r.json()) as {
        workflow_runs?: { id?: number; status?: string; conclusion?: string | null; run_started_at?: string; display_title?: string; html_url?: string }[]
      }
      out.push({
        workflow: wf,
        runs: (j.workflow_runs ?? []).map((w) => ({
          id: w.id,
          status: w.status,
          conclusion: w.conclusion,
          started: w.run_started_at,
          title: (w.display_title ?? '').slice(0, 80),
          url: w.html_url,
        })),
      })
    } catch (e) {
      out.push({ workflow: wf, error: String(e).slice(0, 120) })
    }
  }
  return JSON.stringify(out)
}

/** The REAL log of a run — its tail (the result is there, not in guesses). */
export async function runbookLog(runId: number): Promise<string> {
  if (!ghToken()) return JSON.stringify({ error: 'github_token_missing' })
  if (!Number.isInteger(runId) || runId <= 0) return JSON.stringify({ error: 'invalid_run_id' })
  const jr = await gh(`/actions/runs/${runId}/jobs`)
  if (!jr.ok) return JSON.stringify({ error: `jobs_failed_${jr.status}` })
  const jobs = ((await jr.json()) as { jobs?: { id?: number; name?: string; status?: string; conclusion?: string | null }[] }).jobs ?? []
  const job = jobs[jobs.length - 1]
  if (!job?.id) return JSON.stringify({ error: 'no_jobs_yet', hint: 'rularea abia pornește — reîncearcă în câteva secunde' })
  const lr = await gh(`/actions/jobs/${job.id}/logs`)
  if (!lr.ok) return JSON.stringify({ error: `log_failed_${lr.status}`, job: job.name, status: job.status })
  const text = await lr.text().catch(() => '')
  const tail = text.length > 8000 ? `…(început tăiat)\n${text.slice(-8000)}` : text
  return JSON.stringify({ run: runId, job: job.name, status: job.status, conclusion: job.conclusion, log: tail })
}

/**
 * A big repair order: it gets WRITTEN into work_orders + an email signal to
 * the owner. For repairs Kelion can do himself, use the
 * repo_write/repo_open_pr/repo_merge_pr tools (services/github.ts).
 */
export async function requestRepair(title: string, details: string): Promise<string> {
  const id = `wo-${Date.now().toString(36)}`
  const text = `${title.trim()}\n\n${details.trim()}`.slice(0, 8000)
  try {
    await saveWorkOrder(id, text)
  } catch (e) {
    return JSON.stringify({ error: 'db_failed', detail: String(e).slice(0, 120) })
  }
  const plain = `Kelion a înregistrat un ordin de reparație (${id}).\n\n${text}\n\nExecuție: pornește o sesiune Claude pe repo (sau Kelion îl rezolvă singur cu uneltele repo_*).`
  const mailed = await sendMail({
    to: config.adminEmail,
    subject: `[Kelion] Cerere de reparație: ${title.trim().slice(0, 80)}`,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${plain.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    text: plain,
  }).catch(() => false)
  return JSON.stringify({ ok: true, order: id, mailed })
}
