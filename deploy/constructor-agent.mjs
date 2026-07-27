#!/usr/bin/env node
// ── CONSTRUCTORUL LUI KELION — agentul de construcție de pe VPS ─────────────
// (Adrian, 27 iul: „Kelion trebuie să poată crea orice soft îi cere admin,
// orice modificare, orice îmbunătățire".)
//
// CE FACE: ia UN ordin din coadă (API-ul aplicației, auth x-bridge-secret),
// clonează repo-ul proaspăt în ATELIER (/root/kelion/atelier), lasă un model
// de codare (API OpenRouter — plată per-folosire, NU CLI pe abonament) să
// exploreze/scrie/verifice prin unelte, impune BUILD + TESTE verzi, apoi
// împinge ramura și deschide PR-ul. Merge-ul rămâne la Adrian.
//
// DE CE E JOB, NU DEMON: ecosistemul vechi (bridge/builder, procese claude
// permanente) ardea abonamentul și a produs phantom-deploy-uri — vezi
// AI-HANDOFF §6. Aici: pornit de cron, flock (unul singur), timeout dur din
// constructor-worker.sh, plafoane de pași și tokeni. Se termină și moare.
//
// PLAFOANE (env, cu valori implicite): CONSTRUCTOR_MODEL,
// CONSTRUCTOR_MAX_STEPS (60), CONSTRUCTOR_MAX_TOKENS (900000).
import { execSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ENVFILE = '/root/kelion/kelionai.env'
const ATELIER = '/root/kelion/atelier'
const APP = 'http://127.0.0.1:8080'
const REPO = 'kelion-team/kelionai'

// env-ul aplicației, citit direct din fișier (cronul nu are mediul shell-ului)
const env = {}
for (const line of fs.readFileSync(ENVFILE, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const BRIDGE = env.BRIDGE_SECRET ?? ''
const ORKEY = env.OPENROUTER_API_KEY ?? ''
const GHTOKEN = env.GITHUB_TOKEN ?? ''
const MODEL = env.CONSTRUCTOR_MODEL || 'anthropic/claude-sonnet-4.5'
const MAX_STEPS = Number(env.CONSTRUCTOR_MAX_STEPS || 60)
const MAX_TOKENS = Number(env.CONSTRUCTOR_MAX_TOKENS || 900_000)

const logLines = []
function log(s) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`
  console.log(line)
  logLines.push(line)
}

async function api(pathname, init = {}) {
  const r = await fetch(`${APP}${pathname}`, {
    ...init,
    headers: { 'x-bridge-secret': BRIDGE, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  return r.json().catch(() => null)
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ATELIER, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

// ── Uneltele modelului — tot ce atinge discul stă ÎNCHIS în atelier ─────────
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])
function safePath(p) {
  const full = path.resolve(ATELIER, p)
  if (!full.startsWith(ATELIER + path.sep) && full !== ATELIER) throw new Error('cale în afara atelierului')
  if (full.includes(`${path.sep}.git${path.sep}`) || full.endsWith(`${path.sep}.git`)) throw new Error('.git interzis')
  return full
}
function toolLs(dir) {
  const full = safePath(dir || '.')
  const out = []
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (IGNORE.has(e.name)) continue
    out.push(e.isDirectory() ? `${e.name}/` : `${e.name} (${fs.statSync(path.join(full, e.name)).size}b)`)
  }
  return out.sort().join('\n') || '(gol)'
}
function toolRead(p) {
  const t = fs.readFileSync(safePath(p), 'utf8')
  if (t.length > 120_000) return `${t.slice(0, 120_000)}\n...[trunchiat: fișierul are ${t.length} caractere]`
  return t
    .split('\n')
    .map((l, i) => `${i + 1}\t${l}`)
    .join('\n')
}
function toolWrite(p, content) {
  const full = safePath(p)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return `scris: ${p} (${content.length} caractere)`
}
// Comenzi PERMISE explicit — nimic altceva nu se execută (atelierul nu e un
// shell liber; buildul și testele sunt singurele verificări de care e nevoie).
const RUN_ALLOWED = new Set([
  'npm --prefix backend ci',
  'npm --prefix backend run build',
  'npm --prefix backend test',
  'npm --prefix frontend ci',
  'npm --prefix frontend run build',
  'git status --porcelain',
  'git diff --stat',
])
function toolRun(cmd) {
  const c = String(cmd ?? '').trim()
  if (!RUN_ALLOWED.has(c)) return `comandă nepermisă. Permise: ${[...RUN_ALLOWED].join(' | ')}`
  try {
    const out = sh(c, { timeout: 10 * 60_000 })
    return out.slice(-8000) || '(ok, fără ieșire)'
  } catch (e) {
    return `EȘEC (exit ${e.status ?? '?'})\n${String((e.stdout ?? '') + (e.stderr ?? '')).slice(-8000)}`
  }
}

const TOOLS = [
  { type: 'function', function: { name: 'ls', description: 'Listează un director din repo (fără node_modules/.git/dist).', parameters: { type: 'object', properties: { dir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'read', description: 'Citește un fișier din repo, cu numere de linie.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'Scrie CONȚINUTUL COMPLET al unui fișier (rescriere integrală, nu diff).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'run', description: 'Rulează o comandă de verificare din lista permisă (npm ci/build/test pe backend/frontend, git status/diff).', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'finish', description: 'Termină lucrarea: dai titlul + corpul PR-ului (română). Cheam-o DOAR după build verde (și teste verzi pe backend dacă l-ai atins).', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } } },
]

const SYSTEM = `Ești CONSTRUCTORUL lui Kelionai — lucrătorul de cod autonom al proiectului, pe serverul lui.
Repo: backend/ (Node+Fastify+TS), frontend/ (React+Vite+TS), deploy/ (scripturi VPS), bridge/ (istoric). AI-HANDOFF.md = sursa de adevăr; citește-l (măcar secțiunile relevante) înainte de orice lucrare netrivială.
REGULILE CASEI (obligatorii):
- Rescrii curat modulul responsabil — FĂRĂ petice band-aid.
- write = conținutul COMPLET al fișierului; citește fișierul înainte să-l rescrii.
- Stilul existent: comentarii în română, în stilul fișierului; potrivește idiomul codului din jur.
- Calea chat/voce rămâne low-latency; nu atingi contoare financiare și nu ștergi date.
- Schimbări STRICT în perimetrul ordinului — nimic „din zbor".
VERIFICARE OBLIGATORIE înainte de finish: "npm --prefix backend ci" apoi "npm --prefix backend run build" (+ "npm --prefix backend test" dacă ai atins backend/); "npm --prefix frontend ci" + "npm --prefix frontend run build" dacă ai atins frontend/. Buildul picat = repari și reverifici, nu chemi finish.
Bugetul de pași/tokeni e limitat: fii chirurgical, nu reciti fișiere mari degeaba.
La final: finish cu titlu + corp de PR în română (ce, de ce, dovada verificării).`

// REZISTENT LA MODELELE GRATUITE (jobul #2, 27 iul, cauza reală din log:
// „Unexpected end of JSON input" — endpointul :free a întors corp gol/trunchiat
// la rate-limit și agentul crăpa pe r.json() fără nicio reîncercare). Acum:
// corp gol, JSON rupt, 429 sau 5xx → reîncearcă cu pauze crescătoare; abia
// după 4 încercări ratate jobul pică de-adevăratelea.
async function llm(messages) {
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ORKEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 16_000 }),
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = `OpenRouter ${r.status}: ${text.slice(0, 300)}`
        if (r.status === 429 || r.status >= 500) throw new Error(lastErr) // tranzitoriu → retry
        throw Object.assign(new Error(lastErr), { fatal: true }) // 4xx real → fără retry
      }
      if (!text.trim()) throw new Error('corp gol de la OpenRouter')
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`JSON rupt de la OpenRouter (${text.length} caractere)`)
      }
      // RĂSPUNS GOL VALID (jobul #2, 27 iul, a doua cauză reală din log:
      // „EȘEC: răspuns gol de la model" — 200 cu JSON corect dar mesaj FĂRĂ
      // content și FĂRĂ tool_calls; modelele free fac asta sub sarcină). E tot
      // tranzitoriu → intră în aceeași scară de reîncercări, nu pică jobul.
      const m0 = parsed?.choices?.[0]?.message
      if (!m0 || (!String(m0.content ?? '').trim() && !m0.tool_calls?.length)) {
        throw new Error(
          parsed?.error
            ? `eroare în corp: ${JSON.stringify(parsed.error).slice(0, 180)}`
            : 'răspuns gol de la model (200 fără mesaj)',
        )
      }
      return parsed
    } catch (e) {
      if (e?.fatal) throw e
      lastErr = String(e?.message ?? e)
      if (attempt === 4) break
      const wait = attempt * 15_000 // 15s, 30s, 45s — modelele free respiră greu
      log(`llm încercarea ${attempt} a picat (${lastErr.slice(0, 120)}) — reîncerc în ${wait / 1000}s`)
      await new Promise((res) => setTimeout(res, wait))
    }
  }
  throw new Error(lastErr || 'OpenRouter indisponibil după 4 încercări')
}

async function main() {
  if (!BRIDGE || !ORKEY || !GHTOKEN) {
    log('lipsesc BRIDGE_SECRET/OPENROUTER_API_KEY/GITHUB_TOKEN din kelionai.env — ies')
    return
  }
  const claim = await api('/api/constructor/next')
  if (!claim?.job) return // coada goală sau pauza-autonomie — tăcere totală
  const job = claim.job
  log(`ordin #${job.id} (încercarea ${job.attempts}): ${job.orderText.slice(0, 160)}`)

  const report = (status, extra = {}) =>
    api('/api/constructor/report', {
      method: 'POST',
      body: JSON.stringify({ id: job.id, status, log: logLines.join('\n'), ...extra }),
    })

  try {
    // Atelier proaspăt = exact master-ul de ACUM, nimic rămas din jobul trecut.
    fs.rmSync(ATELIER, { recursive: true, force: true })
    execFileSync('git', ['clone', '--depth', '50', `https://x-access-token:${GHTOKEN}@github.com/${REPO}.git`, ATELIER], { stdio: 'pipe', timeout: 120_000 })
    const baseSha = sh('git rev-parse --short=7 HEAD').trim()
    log(`atelier clonat pe ${baseSha}`)

    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `ORDINUL DE CONSTRUCȚIE (de la owner):\n\n${job.orderText}` },
    ]
    let tokens = 0
    let finish = null
    for (let step = 1; step <= MAX_STEPS && !finish; step++) {
      const resp = await llm(messages)
      tokens += Number(resp.usage?.total_tokens ?? 0)
      if (tokens > MAX_TOKENS) throw new Error(`plafon de tokeni depășit (${tokens})`)
      const msg = resp.choices?.[0]?.message
      if (!msg) throw new Error('răspuns gol de la model')
      // COMPATIBILITATE COHERE (jobul #2, 27 iul, cauza reală din log:
      // „invalid message at index 9: must have non-empty content or tool
      // calls"): modelul întoarce uneori mesaje de asistent cu content NULL și
      // fără tool_calls — GPT/Claude le înghit, Cohere refuză TOATĂ conversația
      // la pasul următor. Normalizăm: content mereu string; mesaj complet gol →
      // umplem cu un marcaj inofensiv ca istoricul să rămână valid.
      const clean = { role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '' }
      if (msg.tool_calls?.length) {
        // A DOUA capcană Cohere (jobul #2, pasul 18): la re-trimiterea
        // istoricului, argumentele uneltelor TREBUIE să fie JSON de obiect
        // stringificat — un „arguments" gol/rupt pica TOATĂ conversația.
        // Normalizăm: orice nu parsează ca obiect devine '{}'.
        clean.tool_calls = msg.tool_calls.map((c) => {
          let a = c.function?.arguments
          try {
            const p = JSON.parse(a || '{}')
            a = JSON.stringify(p && typeof p === 'object' && !Array.isArray(p) ? p : {})
          } catch {
            a = '{}'
          }
          return { ...c, function: { ...c.function, arguments: a } }
        })
      }
      if (!clean.content && !clean.tool_calls) clean.content = '(pas fără conținut)'
      messages.push(clean)
      const calls = msg.tool_calls ?? []
      if (!calls.length) {
        // modelul a vorbit fără unealtă — îl împingem înapoi la lucru
        messages.push({ role: 'user', content: 'Continuă cu uneltele (ls/read/write/run) sau cheamă finish. Nu povesti — lucrează.' })
        continue
      }
      for (const c of calls) {
        let args = {}
        try {
          args = JSON.parse(c.function?.arguments || '{}')
        } catch {
          /* argumente stricate → unealta răspunde cu eroare */
        }
        let result = ''
        try {
          if (c.function.name === 'ls') result = toolLs(String(args.dir ?? '.'))
          else if (c.function.name === 'read') result = toolRead(String(args.path ?? ''))
          else if (c.function.name === 'write') result = toolWrite(String(args.path ?? ''), String(args.content ?? ''))
          else if (c.function.name === 'run') result = toolRun(String(args.cmd ?? ''))
          else if (c.function.name === 'finish') {
            finish = { title: String(args.title ?? '').slice(0, 120), body: String(args.body ?? '') }
            result = 'lucrarea se închide — verific și public'
          } else result = 'unealtă necunoscută'
        } catch (e) {
          result = `EROARE: ${e.message}`
        }
        if (c.function.name !== 'read') log(`pas ${step}: ${c.function.name} ${String(args.path ?? args.cmd ?? args.dir ?? '').slice(0, 80)}`)
        messages.push({ role: 'tool', tool_call_id: c.id, content: result.slice(0, 100_000) })
      }
    }
    if (!finish) throw new Error('plafon de pași atins fără finish')

    // VERIFICAREA NOASTRĂ, nu pe încredere: ce s-a atins trebuie să compileze.
    const changed = sh('git status --porcelain').trim()
    if (!changed) throw new Error('finish fără nicio modificare de fișier')
    const touchedBackend = /(^|\n).{3}backend\//.test(changed)
    const touchedFrontend = /(^|\n).{3}frontend\//.test(changed)
    log(`modificări:\n${sh('git diff --stat').trim().slice(-1500)}`)
    const verify = []
    if (touchedBackend) verify.push('npm --prefix backend ci', 'npm --prefix backend run build', 'npm --prefix backend test')
    if (touchedFrontend) verify.push('npm --prefix frontend ci', 'npm --prefix frontend run build')
    for (const cmd of verify) {
      log(`verific: ${cmd}`)
      const out = toolRun(cmd)
      if (/^EȘEC/.test(out)) throw new Error(`verificarea a picat la „${cmd}":\n${out.slice(-2000)}`)
    }

    const branch = `kelion/job-${job.id}`
    sh(`git checkout -B ${branch}`)
    sh('git add -A')
    execFileSync('git', ['-c', 'user.name=Kelion Constructor', '-c', 'user.email=contact@kelionai.app', 'commit', '-m', finish.title], { cwd: ATELIER, stdio: 'pipe' })
    execFileSync('git', ['push', '-u', 'origin', branch, '--force'], { cwd: ATELIER, stdio: 'pipe', timeout: 60_000 })
    log(`ramura ${branch} împinsă`)

    const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GHTOKEN}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({
        title: finish.title,
        head: branch,
        base: 'master',
        body: `${finish.body}\n\n---\nOrdin #${job.id} · construit automat de Constructorul lui Kelion (bază ${baseSha}, verificare build/teste în atelier). Merge-ul îl dă ownerul.`,
      }),
    }).then((r) => r.json())
    const prUrl = pr?.html_url
    if (!prUrl) throw new Error(`PR-ul nu s-a deschis: ${JSON.stringify(pr).slice(0, 300)}`)
    log(`PR deschis: ${prUrl} (tokeni: ${tokens})`)
    await report('done', { branch, prUrl, tokens })
  } catch (e) {
    log(`EȘEC: ${e.message}`)
    await report('failed', {})
  }
}

main().catch((e) => {
  console.error('constructor-agent fatal:', e)
  process.exit(1)
})
