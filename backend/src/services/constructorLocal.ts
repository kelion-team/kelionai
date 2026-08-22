// ── CONSTRUCTORUL LOCAL FREE (rezerva la Devin) — owner, 22 aug ────────────────
//
// Ordinul owner-ului: „Devin principal; când pică, treci AUTOMAT pe un model
// puternic FREE pe serverul Linux (VPS), iar când Devin revine, întoarce-te pe
// Devin — comutarea rapidă, nu 3 ore."
//
// De ce AȘA (patch JSON validat, NU tool-calling): un model local pe CPU (fără
// GPU) nu e fiabil la bucla de function-calling. În schimb, îi cerem un OBIECT
// JSON strict {branch, files[], pr} — modelul citește întâi fișierele cerute,
// apoi întoarce conținutul COMPLET al fișierelor de schimbat, iar APLICAȚIA îl
// aplică determinist prin uneltele reale (repo_write) + deschide PR
// (repo_open_pr). Fiabil și pe CPU, fără să depindem de tool-calling.
//
// Model + gazdă din ENV (LEGEA anti-hardcodare): CONSTRUCTOR_OLLAMA_MODEL +
// OLLAMA_API_BASE. Free = rulează pe VPS-ul pe care deja îl plătești; zero API
// plătit. Ce NU pot verifica din dev-sandbox: că Ollama chiar răspunde pe VPS —
// se probează live după deploy (fără GPU, e mai lent, dar capabil real).

// `uneltele` se importă LAZY în construiesteLocal (dynamic import) ca să evităm
// orice ciclu/ordine de init cu autonomie.ts (care importă dinamic dispecerul).

const OLLAMA_BASE = process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434' // hardcod-permis: gazda Ollama LOCALĂ implicită pe VPS, suprascrisă de env
const OLLAMA_MODEL = process.env.CONSTRUCTOR_OLLAMA_MODEL || 'qwen3-coder:30b' // hardcod-permis: modelul free implicit pe VPS, suprascris de env
// Timp de răspuns generos: pe CPU fără GPU un pas poate dura minute (owner știe).
const OLLAMA_TIMEOUT_MS = Number(process.env.CONSTRUCTOR_OLLAMA_TIMEOUT_MS) || 8 * 60_000
const MAX_FISIERE_CITITE = 12
const MAX_OCTETI_FISIER = 24_000

/** Numele modelului local activ (pentru afișaj: „care constructor lucrează"). */
export function numeModelLocal(): string {
  return OLLAMA_MODEL
}

/** Probă VIE, măsurată: Ollama de pe VPS răspunde și are modelul? Întoarce
 *  {ok, motiv} — folosit ca să decidem dacă rezerva locală poate prelua. */
export async function probaOllamaLocal(): Promise<{ ok: boolean; motiv?: string }> {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return { ok: false, motiv: `ollama /api/tags HTTP ${r.status}` }
    const j = (await r.json()) as { models?: { name?: string }[] }
    const nume = (j.models ?? []).map((m) => m.name ?? '')
    const are = nume.some((n) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL.split(':')[0]))
    if (!are) return { ok: false, motiv: `modelul ${OLLAMA_MODEL} nu e tras pe VPS (ollama pull ${OLLAMA_MODEL}); prezente: ${nume.join(', ') || 'niciunul'}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, motiv: `ollama inaccesibil pe ${OLLAMA_BASE}: ${String(e).slice(0, 120)}` }
  }
}

/** Un apel la modelul local, cu ieșire JSON forțată (format:'json'). */
async function ollamaJson(prompt: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`ollama chat HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`)
  const j = (await r.json()) as { message?: { content?: string } }
  const brut = String(j.message?.content ?? '').trim()
  try {
    return JSON.parse(brut) as Record<string, unknown>
  } catch {
    // Model care a pus text în jurul JSON-ului — luăm primul obiect {...}.
    const m = /\{[\s\S]*\}/.exec(brut)
    if (m) return JSON.parse(m[0]) as Record<string, unknown>
    throw new Error(`ollama nu a întors JSON valid: ${brut.slice(0, 200)}`)
  }
}

/** Rezultatul unei ture de constructor local. */
export interface RezultatLocal {
  ok: boolean
  prUrl?: string
  motiv?: string
}

/** Constructorul LOCAL: rezolvă ordinul cu modelul free de pe VPS și deschide PR.
 *  Determinist: modelul dă un patch JSON, aplicația îl aplică prin unelte reale. */
export async function construiesteLocal(orderText: string, jobId: number): Promise<RezultatLocal> {
  const proba = await probaOllamaLocal()
  if (!proba.ok) return { ok: false, motiv: `rezerva locală indisponibilă: ${proba.motiv}` }

  const { uneltele } = await import('./autonomie.js')
  const branch = `kelion/local-job-${jobId}`

  // PASUL 1 — modelul cere fișierele de care are nevoie (din arborele repo).
  let arbore = ''
  try {
    arbore = (await uneltele('list_source', {})).slice(0, 8000)
  } catch { /* fără arbore, modelul lucrează pe ce știe */ }
  const cerere1 = [
    'You are the Kelionai LOCAL constructor. Repo: kelion-team/kelionai. Task from the owner:',
    orderText.slice(0, 4000),
    '',
    'Repository file tree (partial):',
    arbore,
    '',
    'Return STRICT JSON: {"read": ["repo/relative/path", ...]} — up to ' + MAX_FISIERE_CITITE + ' existing files you must read before writing the fix. No prose.',
  ].join('\n')
  let deCitit: string[] = []
  try {
    const r1 = await ollamaJson(cerere1)
    deCitit = (Array.isArray(r1.read) ? r1.read : []).filter((p): p is string => typeof p === 'string').slice(0, MAX_FISIERE_CITITE)
  } catch (e) {
    return { ok: false, motiv: `pasul 1 (ce citește) a eșuat: ${String(e).slice(0, 160)}` }
  }

  // Aplicația citește fișierele cerute (unealta reală, nu modelul).
  const continut: string[] = []
  for (const p of deCitit) {
    try {
      const txt = await uneltele('read_source', { path: p })
      continut.push(`FILE: ${p}\n${txt.slice(0, MAX_OCTETI_FISIER)}`)
    } catch { /* fișier inexistent/necitibil — îl sărim */ }
  }

  // PASUL 2 — modelul dă patch-ul complet.
  const cerere2 = [
    'You are the Kelionai LOCAL constructor. Repo: kelion-team/kelionai. Task from the owner:',
    orderText.slice(0, 4000),
    '',
    'Current content of the relevant files:',
    continut.join('\n\n---\n\n').slice(0, 90_000),
    '',
    'Return STRICT JSON only, no prose:',
    '{"files":[{"path":"repo/relative/path","content":"FULL new file content","message":"short commit msg"}],',
    ' "pr":{"title":"...","body":"what changed and why"}}',
    'Rules: content is the COMPLETE new file, not a diff. Keep it minimal and correct. No hardcoded money/model values.',
  ].join('\n')
  let files: { path: string; content: string; message: string }[] = []
  let pr = { title: `Local constructor: ordin #${jobId}`, body: 'Reparație produsă de constructorul local (rezervă la Devin).' }
  try {
    const r2 = await ollamaJson(cerere2)
    files = (Array.isArray(r2.files) ? r2.files : [])
      .filter((f): f is { path: string; content: string; message: string } =>
        !!f && typeof (f as Record<string, unknown>).path === 'string' && typeof (f as Record<string, unknown>).content === 'string')
      .slice(0, 20)
    const prR = r2.pr as { title?: string; body?: string } | undefined
    if (prR?.title) pr = { title: String(prR.title).slice(0, 120), body: String(prR.body ?? pr.body).slice(0, 4000) }
  } catch (e) {
    return { ok: false, motiv: `pasul 2 (patch-ul) a eșuat: ${String(e).slice(0, 160)}` }
  }
  if (!files.length) return { ok: false, motiv: 'modelul local n-a produs niciun fișier de schimbat' }

  // Aplicăm patch-ul cu uneltele REALE (repo_write) — determinist.
  for (const f of files) {
    if (!f.path || f.path === 'master' || f.path.includes('..')) continue
    const rez = await uneltele('repo_write', {
      branch,
      path: f.path,
      content: f.content,
      message: (f.message || `local fix ordin #${jobId}`).slice(0, 120),
    })
    if (/error|refuz|fail/i.test(rez) && !/ok/i.test(rez)) {
      return { ok: false, motiv: `repo_write a picat pe ${f.path}: ${rez.slice(0, 160)}` }
    }
  }

  // Deschidem PR-ul (repo_open_pr) — la fel ca Devin, ownerul aprobă.
  const prRez = await uneltele('repo_open_pr', { branch, title: pr.title, body: pr.body })
  const url = /"?(?:html_url|url|prUrl)"?\s*[:=]\s*"?(https:\/\/github\.com\/[^\s"]+)/i.exec(prRez)?.[1]
    ?? /(https:\/\/github\.com\/kelion-team\/kelionai\/pull\/\d+)/.exec(prRez)?.[1]
  if (!url) return { ok: false, motiv: `PR nedeschis: ${prRez.slice(0, 200)}` }
  return { ok: true, prUrl: url }
}
