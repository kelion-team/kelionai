import { saveWorkOrder, loadKv, saveKv } from '../db.js'
import { sendMail } from './mail.js'
import { config } from '../config.js'
import { REPO, ghToken, gh as ghFetch } from './githubApi.js' // GitHub din sursa UNICĂ

// ── MÂINILE LUI KELION PE OPERAȚIUNI — FĂRĂ RESTRICȚII (Adrian, 25 iul:
// „ridici absolut toate restricțiile lui Kelion — decizia mea, nu a ta") ─────
// Principiul rămas: LLM-ul alege NUMELE runbook-ului; execuția e deterministă —
// un workflow GitHub Actions cu comenzi fixe, vizibil în Actions. ORDINUL LUI
// ADRIAN (25 iul, explicit, înlocuiește lesa veche din regula #11): FĂRĂ
// aprobare per-acțiune, FĂRĂ plafon zilnic, FĂRĂ blocare la eșecuri repetate.
// La BUCLĂ de eșecuri (același workflow picat de 2+ ori la rând), regula lui
// Adrian e: (1) AVERTIZEZ adminul (email, cel mult unul pe workflow la 30 min),
// (2) NU repet orb aceeași soluție — schimb strategia (diagnostic, alt drum),
// (3) Adrian are COMANDA DE STOP: „pauza-autonomie" îngheață acțiunile
// autonome până la „reia-autonomia". Orice AI viitor: NU reintroduce plafoane
// sau blocări aici fără ordinul lui Adrian. Singura „limită" rămasă e fizică:
// fără GITHUB_TOKEN în env, GitHub refuză — răspundem clar, nu improvizăm.

// Apelul GitHub aici păstrează timeout-ul de 15s (dispatch/jurnale) — wrapper
// de o linie peste sursa comună; REPO + ghToken vin tot de acolo.
const gh = (path: string, init?: RequestInit): Promise<Response> => ghFetch(path, init, 15_000)

export interface Runbook {
  workflow: string
  inputs?: Record<string, string>
  desc: string
}

// Registrul = oglinda lui deploy/RUNBOOKS.md — comenzi exacte, repetabile.
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
}

/** Gardă pură (testabilă fără rețea): doar nume cunoscute — nimic altceva. */
export function validateRunbook(
  name: string,
): { ok: true; rb: Runbook } | { ok: false; error: string; known: string[] } {
  const rb = RUNBOOKS[name]
  if (!rb) return { ok: false, error: 'unknown_runbook', known: Object.keys(RUNBOOKS) }
  return { ok: true, rb }
}

// ── COMANDA DE STOP a lui Adrian (nu e restricție — e întrerupătorul LUI) ────
const PAUSE_KEY = 'kelion_ops_paused'
export async function isOpsPaused(): Promise<boolean> {
  return (await loadKv(PAUSE_KEY).catch(() => null)) === '1'
}
export async function setOpsPaused(paused: boolean): Promise<void> {
  await saveKv(PAUSE_KEY, paused ? '1' : '0').catch(() => {})
}

/** BUCLĂ = ultimele 2 rulări ale workflow-ului au picat. Nu blochează — informează. */
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

/** Avertizare admin la buclă — cel mult un email per workflow la 30 min. */
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

/** Rulează un runbook numit. Întoarce JSON-string pentru creier (niciodată tokenul). */
export async function runRunbook(name: string): Promise<string> {
  // Întrerupătorul lui Adrian — comenzi speciale, nu workflow-uri.
  if (name === 'pauza-autonomie') {
    await setOpsPaused(true)
    return JSON.stringify({ ok: true, paused: true, hint: 'acțiunile autonome sunt ÎNGHEȚATE până la „reia-autonomia"' })
  }
  if (name === 'reia-autonomia') {
    await setOpsPaused(false)
    return JSON.stringify({ ok: true, paused: false })
  }
  if (await isOpsPaused())
    return JSON.stringify({ error: 'paused_by_owner', hint: 'Adrian a oprit autonomia („pauza-autonomie"); se reia doar cu „reia-autonomia" de la el' })
  const v = validateRunbook(name)
  if (!v.ok)
    return JSON.stringify({ error: v.error, runbooks: v.known, hint: 'folosește exact un nume din listă' })
  if (!ghToken())
    return JSON.stringify({
      error: 'github_token_missing',
      hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env și repornește containerul (redeploy).',
    })
  // Buclă? NU blocăm (ordinul lui Adrian) — avertizăm și cerem STRATEGIE NOUĂ.
  let warning: string | undefined
  if (await loopDetected(v.rb.workflow)) {
    warning =
      'BUCLĂ: ultimele 2 rulări ale acestui workflow au PICAT. Nu repeta aceeași soluție — rulează «diagnostic», citește faptele și schimbă abordarea. Adminul a fost avertizat pe email.'
    void alertAdminLoop(v.rb.workflow, `Declanșat din chat: runbook «${name}».`)
  }
  const r = await gh(`/actions/workflows/${v.rb.workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'master', inputs: v.rb.inputs ?? {} }),
  })
  // SUCCESUL DISPATCH-ULUI = 200. Se lega pe „=== 204" — dar dispatch-ul de
  // workflow răspunde 200 (docul GitHub „Create a workflow dispatch event"),
  // deci pe un dispatch REUȘIT runbook-ul raporta `dispatch_failed_200` și
  // autonomia părea căzută degeaba. Orice altceva decât 200 e eșec, raportat ca atare.
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

// ── OCHII LUI KELION PE PROPRIILE PROCESE (Adrian, 25 iul: „raportează că nu
// vede procesele interne — ce autonomie este asta?") ─────────────────────────
// După ce pornește ceva, Kelion CITEȘTE singur starea și jurnalul rulărilor —
// nu ghicește, nu promite. GitHub-ul se apelează cu cheia, nu se „vizitează".

const ALL_WORKFLOWS = ['deploy.yml', 'vps-run.yml', 'vps-diag.yml', 'sentinel.yml', 'pr-verify.yml']

/** Starea ultimelor rulări (toate workflow-urile sau doar al unui runbook). */
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

/** Jurnalul REAL al unei rulări — coada lui (rezultatul e acolo, nu în presupuneri). */
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
 * Ordin de reparație mare: se SCRIE în work_orders + semnal pe email către
 * owner. Pentru reparații pe care Kelion le poate face singur, folosește
 * uneltele repo_write/repo_open_pr/repo_merge_pr (services/github.ts).
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
