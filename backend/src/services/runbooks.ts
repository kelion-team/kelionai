import { saveWorkOrder, loadKv, saveKv } from '../db.js'
import { sendMail } from './mail.js'
import { config } from '../config.js'

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

const REPO = 'kelion-team/kelionai'
const API = `https://api.github.com/repos/${REPO}`

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
    signal: AbortSignal.timeout(15_000),
  })
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
  if (r.status === 204)
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
