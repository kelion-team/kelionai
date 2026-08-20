// ── DEVIN — CONSTRUCTORUL EXTERN (owner, 20 aug 2026: „punel pe devin cu cheie") ──
//
// Kelion = dispecerul + fața care raportează. Devin = mâinile care scriu cod și
// deschid PR-ul pe GitHub-ul nostru. Owner-ul aprobă PR-ul, deploy-ul existent
// (cron auto-publicare → deploy.sh) publică. Nimic nu se auto-merge.
//
// Acest fișier e DOAR clientul HTTP către API-ul Devin (`/v1/sessions`). Cheia
// vine din env (`config.devinKey`) — NU se scrie niciodată în cod, în log sau în
// chat. Endpoint-ul de bază e configurabil (implicit oficial), ca să nu fie un
// URL bătut în cuie fără scăpare.
//
// COST: fiecare sesiune pleacă cu `max_acu_limit` (plafon per sesiune, direct în
// API) — Devin NU poate depăși plafonul. Valoarea vine din env `DEVIN_MAX_ACU`;
// implicitul e o plasă de siguranță joasă, ca o sesiune scăpată să nu usture.

import { config } from '../config.js'

const BASE = process.env.DEVIN_API_BASE || 'https://api.devin.ai/v1' // hardcod-permis: endpoint oficial Devin, suprascris de env DEVIN_API_BASE
// Plafon ACU per sesiune (prag de COST → din env, nu inventat). Implicit jos.
const MAX_ACU = ((): number => {
  const n = Number(process.env.DEVIN_MAX_ACU)
  return Number.isFinite(n) && n > 0 ? n : 10 // hardcod-permis: plasă de siguranță implicită (ACU/sesiune), suprascrisă de env DEVIN_MAX_ACU
})()

export interface SesiuneDevinNoua {
  sessionId: string
  /** URL-ul sesiunii Devin (interfața), pentru monitor/istoric. */
  url: string | null
}

export interface StareDevin {
  /** Starea brută raportată de Devin (`status_enum`: working/blocked/finished…). */
  status: string
  /** true doar când sesiunea s-a ÎNCHEIAT (finished/completed/expired/blocked). */
  gata: boolean
  /** Linkul PR-ului, dacă Devin l-a deschis (extras defensiv — vezi mai jos). */
  prUrl: string | null
  /** ACU consumat până acum, dacă API-ul îl dă — pentru bara REALĂ, nu inventată. */
  acu: number | null
  /** Răspunsul brut, pentru dispecer (câmpuri pe care nu le mapăm încă). */
  brut: Record<string, unknown>
}

export function devinDisponibil(): boolean {
  return Boolean(config.devinKey)
}

function anteturi(): Record<string, string> {
  if (!config.devinKey) throw new Error('devin_fara_cheie: DEVIN_API_KEY lipsește din env (pune-o în secrete + rulează vps-set-env)')
  return {
    Authorization: `Bearer ${config.devinKey}`,
    'Content-Type': 'application/json',
  }
}

/** Deschide o sesiune Devin cu o cerință. `idempotent:true` + o cheie stabilă a
 *  ordinului fac ca o reîncercare să NU pornească o a doua sesiune (bani dubli). */
export async function creeazaSesiuneDevin(
  prompt: string,
  opts?: { title?: string; idempotentKey?: string; maxAcu?: number },
): Promise<SesiuneDevinNoua> {
  const corp: Record<string, unknown> = {
    prompt,
    idempotent: true,
    max_acu_limit: opts?.maxAcu ?? MAX_ACU,
  }
  if (opts?.title) corp.title = opts.title
  const r = await fetch(`${BASE}/sessions`, { method: 'POST', headers: anteturi(), body: JSON.stringify(corp) })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`devin_creare_esuata: HTTP ${r.status} ${text.slice(0, 200)}`)
  }
  const j = (await r.json()) as Record<string, unknown>
  const sessionId = String(j.session_id ?? j.sessionId ?? '')
  if (!sessionId) throw new Error(`devin_fara_session_id: răspuns neașteptat ${JSON.stringify(j).slice(0, 200)}`)
  return { sessionId, url: (typeof j.url === 'string' ? j.url : null) }
}

/** Extrage un URL de PR din răspunsul sesiunii, defensiv: câmpul exact poate
 *  varia între versiunile API-ului, așa că verificăm mai multe locuri și, în
 *  ultimă instanță, un link github …/pull/N din tot payload-ul. NULL = încă
 *  n-a deschis PR (nu inventăm unul). */
function extragePrUrl(j: Record<string, unknown>): string | null {
  const pr = j.pull_request ?? j.pullRequest ?? (j.structured_output as Record<string, unknown> | undefined)?.pull_request
  if (pr && typeof pr === 'object') {
    const u = (pr as Record<string, unknown>).url ?? (pr as Record<string, unknown>).html_url
    if (typeof u === 'string' && u) return u
  }
  if (typeof j.pull_request_url === 'string' && j.pull_request_url) return j.pull_request_url
  const m = JSON.stringify(j).match(/https:\/\/github\.com\/[^"'\s]+\/pull\/\d+/)
  return m ? m[0] : null
}

const STARI_INCHEIATE = new Set(['finished', 'completed', 'expired', 'blocked', 'stopped', 'suspended'])

/** Starea unei sesiuni — pentru bara REALĂ pe monitor și pentru „gata → PR". */
export async function stareSesiuneDevin(sessionId: string): Promise<StareDevin> {
  const r = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, { headers: anteturi() })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`devin_stare_esuata: HTTP ${r.status} ${text.slice(0, 200)}`)
  }
  const j = (await r.json()) as Record<string, unknown>
  const status = String(j.status_enum ?? j.status ?? 'unknown')
  const acuRaw = j.acu_consumed ?? j.acu ?? (j.usage as Record<string, unknown> | undefined)?.acu
  const acu = typeof acuRaw === 'number' && Number.isFinite(acuRaw) ? acuRaw : null
  return {
    status,
    gata: STARI_INCHEIATE.has(status.toLowerCase()),
    prUrl: extragePrUrl(j),
    acu,
    brut: j,
  }
}

// (Un „trimiteMesajDevin" pentru follow-up într-o sesiune se adaugă când
//  dispecerul chiar are nevoie — cu endpoint-ul confirmat LIVE. Nu bag cod
//  speculativ, neconsumat: poarta verifica-exporturi îl demască oricum.)
