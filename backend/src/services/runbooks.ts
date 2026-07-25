import { loadKv, saveKv, saveWorkOrder } from '../db.js'
import { sendMail } from './mail.js'
import { config } from '../config.js'

// ── MÂINILE LUI KELION PE OPERAȚIUNI — CU LESĂ (Adrian, 25 iul: „DA!") ───────
// Principiul §14.b: LLM-ul alege DOAR numele runbook-ului; execuția e 100%
// deterministă — un workflow GitHub Actions cu comenzi fixe, vizibil în
// Actions. Lesa (regula #11): plafon zilnic (AUTONOMY_DAILY_MAX, implicit 20),
// `publish-master` DOAR cu aprobarea explicită a ownerului în conversație,
// stop la 2 eșecuri la rând pe același workflow (nu retry orb).
// Fără GITHUB_TOKEN în env, totul răspunde FAIL CLOSED cu instrucțiuni clare.

const REPO = 'kelion-team/kelionai'
const API = `https://api.github.com/repos/${REPO}`

export interface Runbook {
  workflow: string
  inputs?: Record<string, string>
  needsAffirm?: boolean
  desc: string
}

// Registrul = oglinda lui deploy/RUNBOOKS.md. Doar comenzi EXACTE, nimic liber:
// Kelion NU poate trimite cmd arbitrar — doar numele de aici.
export const RUNBOOKS: Record<string, Runbook> = {
  diagnostic: { workflow: 'vps-diag.yml', desc: 'faptele reale de pe VPS (doar citire)' },
  'sentinel-now': { workflow: 'sentinel.yml', desc: 'verificarea de sănătate imediat' },
  'publish-master': {
    workflow: 'deploy.yml',
    needsAffirm: true,
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

/** Gardă pură (testabilă fără rețea): ce are voie să ruleze și cu ce aprobare. */
export function validateRunbook(
  name: string,
  ownerAffirmed: boolean,
): { ok: true; rb: Runbook } | { ok: false; error: string; known?: string[] } {
  const rb = RUNBOOKS[name]
  if (!rb) return { ok: false, error: 'unknown_runbook', known: Object.keys(RUNBOOKS) }
  if (rb.needsAffirm && !ownerAffirmed)
    return {
      ok: false,
      error: 'needs_owner_affirm',
      known: undefined,
    }
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

/** Lesa 3: ultimele 2 rulări ale workflow-ului au picat amândouă? → stop. */
async function lastTwoFailed(workflow: string): Promise<boolean> {
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

/** Lesa 2: plafonul zilnic de rulări pornite de Kelion (kv_state, supraviețuiește restartului). */
async function underDailyCap(): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10)
  const key = `runbook_runs_${day}`
  const n = Number((await loadKv(key).catch(() => '0')) ?? '0') || 0
  if (n >= config.autonomyDailyMax) return false
  await saveKv(key, String(n + 1)).catch(() => {})
  return true
}

/**
 * Rulează un runbook numit. Întoarce JSON-string pentru creier (niciodată tokenul).
 */
export async function runRunbook(name: string, ownerAffirmed: boolean): Promise<string> {
  const v = validateRunbook(name, ownerAffirmed)
  if (!v.ok) {
    if (v.error === 'unknown_runbook')
      return JSON.stringify({ error: v.error, runbooks: v.known, hint: 'folosește exact un nume din listă' })
    return JSON.stringify({
      error: 'needs_owner_affirm',
      hint: 'publish-master pornește DOAR după ce ownerul aprobă explicit ÎN ACEASTĂ conversație (da/publică). Cere-i aprobarea, apoi recheamă cu owner_affirmed=true.',
    })
  }
  if (!ghToken())
    return JSON.stringify({
      error: 'github_token_missing',
      hint: 'FAIL CLOSED: pune GITHUB_TOKEN (fin-granulat, repo kelionai, Actions:write) în /root/kelion/kelionai.env și repornește containerul (redeploy).',
    })
  if (!(await underDailyCap()))
    return JSON.stringify({ error: 'daily_cap_reached', hint: `lesa: max ${config.autonomyDailyMax} rulări/zi — restul manual, de owner` })
  if (await lastTwoFailed(v.rb.workflow))
    return JSON.stringify({
      error: 'leash_two_failures',
      hint: `ultimele 2 rulări ale ${v.rb.workflow} au picat — NU reîncerc orb (regula #11). Rulează «diagnostic», citește faptele, spune ownerului ce e stricat.`,
    })
  const r = await gh(`/actions/workflows/${v.rb.workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'master', inputs: v.rb.inputs ?? {} }),
  })
  if (r.status === 204)
    return JSON.stringify({
      ok: true,
      started: name,
      watch: `https://github.com/${REPO}/actions/workflows/${v.rb.workflow}`,
      hint: 'rularea apare în câteva secunde; rezultatul se citește din jurnalul ei',
    })
  const body = (await r.text().catch(() => '')).slice(0, 300)
  return JSON.stringify({ error: `dispatch_failed_${r.status}`, detail: body })
}

/**
 * request_repair renăscut (fără builder-LLM pe VPS): ordinul se SCRIE în
 * work_orders + semnal pe email către owner; execuția o face o sesiune Claude
 * pornită de owner — nu un proces permanent care arde bani.
 */
export async function requestRepair(title: string, details: string): Promise<string> {
  const id = `wo-${Date.now().toString(36)}`
  const text = `${title.trim()}\n\n${details.trim()}`.slice(0, 8000)
  try {
    await saveWorkOrder(id, text)
  } catch (e) {
    return JSON.stringify({ error: 'db_failed', detail: String(e).slice(0, 120) })
  }
  // Semnal către owner — best effort: ordinul rămâne salvat chiar dacă mailul pică.
  const plain = `Kelion a înregistrat un ordin de reparație (${id}).\n\n${text}\n\nExecuție: pornește o sesiune Claude pe repo (branch nou → PR → merge = aprobarea ta).`
  const mailed = await sendMail({
    to: config.adminEmail,
    subject: `[Kelion] Cerere de reparație: ${title.trim().slice(0, 80)}`,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${plain.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
    text: plain,
  }).catch(() => false)
  return JSON.stringify({ ok: true, order: id, mailed, hint: 'ordinul e salvat; ownerul decide când pornește reparația' })
}
