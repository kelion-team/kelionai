#!/usr/bin/env node
// CONSTRUCTORUL HEADLESS KELION (server Contabo, systemd: kelion-builder).
// Ruleaza INVIZIBIL pe server — zero ferestre, nici pe laptop, nici pe server.
//
// Flux profesional (livrare continua cu poarta de aprobare):
//   1. Trage ordinele de lucru (GET /api/bridge/workorders).
//   2. Pentru fiecare: ruleaza `claude -p` in repo, il lasa sa editeze + compileze
//      + testeze. NU publica.
//   3. STAGEAZA un release (POST /api/bridge/stage-release) cu ce s-a schimbat.
//   4. Adrian aproba din tab-ul Admin "Release-uri".
//   5. Constructorul vede aprobarea (GET /api/bridge/approved-releases) si abia
//      ATUNCI face deploy: PR → merge în master → dispatch deploy.yml (pipeline
//      GitHub/Railway, NU railway up direct).
//
// MONITOR LIVE (ordinul lui Adrian, 4 iul: "trebuie sa vad live cu ce te ocupi
// pe monitor"): constructorul NU mai lucreaza mut. Claude ruleaza cu
// --output-format stream-json, iar fiecare pas real (fisier citit, fisier
// modificat, comanda rulata) e tradus intr-o linie umana si impins imediat pe
// monitorul lui Adrian (POST /api/bridge/activity), cu bara procesului
// avansand pe etape (POST /api/bridge/progress). Doar PASII apar pe monitor —
// niciodata textul intern al modelului (regula: fara note interne scurse).
//
// SIGURANTA: nimic nu ajunge live fara aprobarea umana (pasul 4). Executia de
// build ruleaza doar in repo-ul proiectului.
//
// Mediu (din /root/kelion/claude.env): BRIDGE_SECRET, CLAUDE_CODE_OAUTH_TOKEN,
// RAILWAY_TOKEN (pentru deploy). Repo la /root/kelion/app (clona proiectului).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const BASE = process.env.KELION_BASE || 'https://kelionai.app'
// Clona reală de pe VPS e /root/kelion/repo (dovedit în jurnalul bridge-deploy);
// vechiul default /root/kelion/app nu există pe serverul actual → orice spawn
// cu cwd-ul ăla pică cu ENOENT („Error: spawn git ENOENT" în chat, 11 iul).
// Alegem PRIMUL director care chiar există.
const REPO =
  [process.env.KELION_REPO, '/root/kelion/repo', '/root/kelion/app']
    .filter(Boolean)
    .find((d) => existsSync(d)) || '/root/kelion/repo'
const SECRET = (process.env.BRIDGE_SECRET || readSecret()).trim()
function readSecret() {
  try { return readFileSync('/root/kelion/bridge-secret.txt', 'utf8') } catch { return '' }
}
if (!SECRET) { console.error('BRIDGE_SECRET lipsa'); process.exit(1) }
const H = { 'content-type': 'application/json', 'x-bridge-secret': SECRET }

// ── MOTORUL DE LUCRU (ordinul lui Adrian, 11 iul): munca NU mai consumă
// abonamentul Claude Max — ăla rămâne DOAR pentru chatul adminului și demo.
// Constructorul lucrează pe Kimi (primar), apoi GLM (secundar), cu revenire
// automată (treapta golită se reîncearcă după 30 min). Config Kimi din docs-ul
// lor oficial pentru Claude Code (api.kimi.com/coding/, model kimi-for-coding);
// GLM: endpoint-ul z.ai NU mapează numele de model claude noi — trimiterea lui
// `claude-fable-5` a dat „400 [1211] Unknown Model" (12 iul, cauza reală a
// picării verificatorului). Se cere modelul NATIV al planului GLM Coding:
// `glm-4.6`. Cheile: fișiere pe VPS, puse prin vps-keys.yml. AVARIE: fără NICIO
// cheie pe disc, cade pe Max cu anunț tare în jurnal (mai bine reparații pe Max
// decât reparații moarte) — dar cu cheile puse, Max nu e atins de muncă.
const GLM_MODEL = 'glm-4.6'
const WORK_TIERS = [
  {
    name: 'kimi',
    keyFile: '/root/kelion/kimi-key.txt',
    base: 'https://api.kimi.com/coding/',
    model: 'kimi-for-coding',
    extraEnv: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144' },
  },
  { name: 'glm', keyFile: '/root/kelion/glm-key.txt', base: 'https://api.z.ai/api/anthropic', model: GLM_MODEL },
]
const WORK_COOLDOWN_MS = 30 * 60_000
const workDownUntil = Object.create(null)
const workKeyOf = (t) => {
  try { return readFileSync(t.keyFile, 'utf8').trim() || null } catch { return null }
}
// SISTEM DE URMĂRIRE A TREPTELOR (Adrian, 12 iul: „sistem de urmărit când sunt
// repuse valorile noi, interogare când se alocă prin cheie, revenire la
// ordinea prestabilită automat"). „max" e virtual aici (workTier() → null
// înseamnă „a căzut pe Max", avaria din comentariul de mai sus) — ordinea
// preferată completă pentru calculul direcției e ['kimi','glm','max'].
// Anthropic/Max scos (Adrian, 12 iul): „oprit" = fără cheie de lucru (nu mai
// există treaptă Anthropic sub Kimi/GLM).
const WORK_ORDER = ['kimi', 'glm', 'oprit']
let lastWorkTierReported = null
let lastWorkQuotaReason = null
function reportWorkTierChange(from, to) {
  const fromIdx = from ? WORK_ORDER.indexOf(from) : -1
  const toIdx = WORK_ORDER.indexOf(to)
  const action = fromIdx === -1 ? 'boot' : toIdx < fromIdx ? 'revert' : 'switch'
  void api('/api/bridge/tier-event', 'POST', {
    worker: 'work',
    from,
    to,
    action,
    reason: lastWorkQuotaReason,
  }).catch(() => {})
}
function workTier() {
  let picked = null
  for (const t of WORK_TIERS) {
    if ((workDownUntil[t.name] ?? 0) > Date.now()) continue
    if (workKeyOf(t)) {
      picked = t
      break
    }
  }
  const name = picked ? picked.name : 'oprit'
  if (name !== lastWorkTierReported) {
    const from = lastWorkTierReported
    lastWorkTierReported = name
    reportWorkTierChange(from, name)
  }
  return picked
}
// Semnăturile de cotă golită — DOAR pe canalele de eroare, niciodată pe textul
// normal al modelului.
const WORK_QUOTA_RE = /usage limit|usage credits|credit balance|rate.?limit|quota|429/i
function workQuotaHit(tierName, errText) {
  if (!errText || !WORK_QUOTA_RE.test(String(errText))) return false
  workDownUntil[tierName] = Date.now() + WORK_COOLDOWN_MS
  lastWorkQuotaReason = String(errText).slice(0, 300)
  console.log(`[munca] treapta „${tierName}" e golită — comut pe următoarea, revin în ${WORK_COOLDOWN_MS / 60_000} min.`)
  return true
}
// MOTORUL ACTIV pe interfața admin (Adrian, 11 iul: „să fie afișat permanent
// care constructor lucrează"): la fiecare pornire de lucru, constructorul
// raportează serverului treapta folosită; se retrimite doar la schimbare.
let lastEngineReported = ''
function reportEngine(name) {
  if (!name || name === lastEngineReported) return
  lastEngineReported = name
  void api('/api/bridge/work-engine', 'POST', { engine: name }).catch(() => {})
}
// Env-ul treptei de lucru: baza + cheia compatibile Anthropic. IMPORTANT:
// scoatem CLAUDE_CODE_OAUTH_TOKEN (autentificarea pe abonament) ca CLI-ul să
// nu poată ocoli cheia de rezervă și să lucreze pe furiș tot pe Max.
function workEnv(tier) {
  if (!tier) return process.env
  const key = workKeyOf(tier)
  if (!key) return process.env
  const env = {
    ...process.env,
    ...(tier.extraEnv ?? {}),
    ANTHROPIC_BASE_URL: tier.base,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_AUTH_TOKEN: key,
  }
  // ROUTARE, NU „îngrădire de model" (regresia #166 — cauza reală a „nu se
  // apucă de nimic"): dacă lăsăm CLAUDE_CODE_OAUTH_TOKEN în env cât timp treapta
  // e Kimi/GLM, CLI-ul intră în modul abonament și trimite cererea la Anthropic
  // cu modelul treptei (`kimi-for-coding`/`glm-4.6`) → „Unknown Model" → spawn
  // picat, ZERO fișiere. Îl scoatem DOAR aici, unde chiar avem cheie de treaptă
  // (același lucru pe care-l face `claude-munca` cu `env -u`); când nu-i nicio
  // cheie, workEnv întoarce process.env neatins → fallback-ul pe Max rămâne.
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  return env
}

async function api(path, method = 'GET', body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}

// ── Linia live catre monitor: coada serializata (ordinea pasilor se pastreaza,
// un pas pe ~0.7s ca sa nu inece serverul), fire-and-forget — o cadere de retea
// nu opreste niciodata constructia.
const actQueue = []
let draining = false
function say(line) {
  if (!line || line === actQueue[actQueue.length - 1]) return
  actQueue.push(line)
  if (!draining) void drain()
}
async function drain() {
  draining = true
  while (actQueue.length) {
    const line = actQueue.shift()
    await api('/api/bridge/activity', 'POST', { line }).catch(() => {})
    if (actQueue.length) await new Promise((r) => setTimeout(r, 700))
  }
  draining = false
}

// Bara procesului 0→100% (preluare → executie → verificare → gata/deploy).
function pushProgress(pct, label, file = '') {
  void api('/api/bridge/progress', 'POST', { pct, label, file }).catch(() => {})
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: REPO, env: process.env, ...opts })
    let out = ''
    const t = setTimeout(() => c.kill('SIGKILL'), opts.timeoutMs || 86400000) // BLOCAJ SCOS: fără cuțit de timp
    c.stdout?.on('data', (d) => (out += d))
    c.stderr?.on('data', (d) => (out += d))
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out }) })
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
  })
}

// ── AUTO-SINCRONIZARE MODEL (Adrian, 12 iul: „nu rămân fixe, trebuie să se
// auto-sincronizeze cu modelul") ──────────────────────────────────────────
// Un nume de model hardcodat se strică la fiecare update al furnizorului (exact
// ce s-a întâmplat: `claude-fable-5` a devenit „400 Unknown Model" pe GLM). În
// loc de asta, interogăm endpoint-ul standard `/v1/models` al fiecărei trepte
// (cu cheia de pe disc) și alegem SINGURI modelul potrivit: cel mai nou glm-X.Y
// pentru GLM, modelul de cod pentru Kimi. Cache 6h (nu batem endpoint-ul la
// fiecare job) + fallback sigur dacă interogarea pică. Max (fără base) rămâne pe
// modelul claude cerut.
const MODEL_CACHE = Object.create(null) // tierName -> { model, at }
const MODEL_TTL_MS = 6 * 60 * 60 * 1000
const MODEL_FALLBACK = { glm: 'glm-4.6', kimi: 'kimi-for-coding' }
function verNum(id) {
  const m = String(id).match(/(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : 0
}
function pickBestModel(tierName, ids) {
  if (tierName === 'glm') {
    const glms = ids.filter((id) => /^glm-/i.test(id)).sort((a, b) => verNum(b) - verNum(a))
    return glms[0] || null
  }
  if (tierName === 'kimi') {
    return ids.find((id) => /coding/i.test(id)) || ids.find((id) => /^kimi/i.test(id)) || null
  }
  return null
}
async function resolveTierModel(tier) {
  if (!tier || !tier.base) return null // Max → modelul claude cerut, nu se atinge
  const cached = MODEL_CACHE[tier.name]
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.model
  let model = tier.model || MODEL_FALLBACK[tier.name] || null
  try {
    const key = workKeyOf(tier)
    if (key) {
      const url = tier.base.replace(/\/+$/, '') + '/v1/models'
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${key}`,
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (r.ok) {
        const j = await r.json()
        const ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean)
        const picked = pickBestModel(tier.name, ids)
        if (picked) {
          if (picked !== model) console.log(`[model] ${tier.name}: auto-sincronizat pe „${picked}"`)
          model = picked
        }
      }
    }
  } catch {
    /* interogare picată — păstrăm fallback-ul, nu blocăm munca */
  }
  MODEL_CACHE[tier.name] = { model, at: Date.now() }
  return model
}

// Claude in mod streaming: fiecare eveniment (tool_use) ajunge la onEvent PE
// MASURA ce se intampla; rezultatul final (textul cu SUMAR:) se intoarce la final.
function runClaudeLive(prompt, onEvent, timeoutMs) {
  return new Promise((resolve) => {
    void (async () => {
    // Treapta de LUCRU curentă (Kimi → GLM). ANTHROPIC/MAX SCOS COMPLET (Adrian,
    // 12 iul: „renunț la Anthropic, rămâne Kimi și GLM"): fără cheie de lucru NU
    // mai cădem pe Max — ne oprim și anunțăm, ca să nu atingem niciodată Anthropic.
    const tier = workTier()
    if (!tier) {
      console.log('[munca] OPRIT: nicio cheie de lucru (Kimi/GLM) pe disc — NU pornesc pe Anthropic (scos). Pune cheile prin vps-keys.')
      reportEngine('oprit')
      resolve({ code: -1, out: 'FĂRĂ CHEIE DE LUCRU (Kimi/GLM). Anthropic e scos — nu pornesc nimic. Pune cheile prin vps-keys.' })
      return
    }
    reportEngine(tier.name)
    // Modelul = al TREPTEI active (Kimi/GLM), auto-sincronizat de pe endpoint;
    // niciodată un model Anthropic (scos).
    const model = (await resolveTierModel(tier)) ?? tier.model ?? MODEL_FALLBACK[tier.name]
    const c = spawn('claude', [
      '-p', prompt,
      '--model', model,
      // CAPACITATE MAXIMĂ (Adrian, 12 iul: „cele 2 modele la capacitate maximă"):
      // ambele trepte de lucru (Kimi + GLM, același spawn) primesc TOT setul de
      // unelte de editare + căutare + execuție. Lipsa lui Grep/Glob/MultiEdit era
      // o gaură reală: promptul îi spune modelului „caută cu grep/glob" înainte
      // să editeze, dar acele unelte NU erau permise → blocate în headless →
      // constructorul ieșea „fără fișiere". Acum are ce-i trebuie ca să editeze.
      '--allowedTools', 'Read,Edit,Write,MultiEdit,NotebookEdit,Bash,Glob,Grep,LS',
      // DREPT EFECTIV DE EDITARE (Adrian: „nu au drepturi de editare, dă-le ce
      // ți-am cerut"): a permite uneltele în listă NU e același lucru cu dreptul
      // de a scrie pe disc. În headless, poarta de permisiuni blochează Edit/
      // Write dacă modul nu le acceptă explicit. `acceptEdits` = auto-accept la
      // toate editările → modelul chiar poate modifica fișiere, nu doar „cere".
      '--permission-mode', 'acceptEdits',
      '--output-format', 'stream-json', '--verbose',
    ], { cwd: REPO, env: workEnv(tier) })
    let buf = ''
    let finalText = ''
    let errText = ''
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs)
    c.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result' && typeof ev.result === 'string') {
            // Cotă golită → doar pe eroare reală (is_error), nu pe text normal.
            if (ev.is_error && tier) workQuotaHit(tier.name, ev.result)
            finalText = ev.result
          }
          onEvent(ev)
        } catch { /* linie partiala/non-JSON — ignorata */ }
      }
    })
    c.stderr.on('data', (d) => (errText += d))
    c.on('close', (code) => {
      clearTimeout(t)
      // Treapta golită se marchează → următoarea încercare a supervizorului
      // (re-asignarea existentă) pornește deja pe treapta următoare.
      if (tier && errText) workQuotaHit(tier.name, errText)
      resolve({ code, out: finalText })
    })
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
    })()
  })
}

// Un tool_use → o linie umana pentru monitor. Numai actiuni, niciodata textul
// intern al modelului.
function baseName(p) { return String(p || '').split('/').pop() || '' }
function toolLine(t) {
  const i = t.input || {}
  switch (t.name) {
    case 'Read': return `📖 Citesc ${baseName(i.file_path)}`
    case 'Edit':
    case 'MultiEdit': return `✏️ Modific ${baseName(i.file_path)}`
    case 'Write': return `📝 Scriu ${baseName(i.file_path)}`
    case 'Bash': return `💻 Rulez: ${String(i.description || i.command || '').replace(/\s+/g, ' ').slice(0, 70)}`
    case 'Grep':
    case 'Glob': return `🔍 Caut în cod: ${String(i.pattern || '').slice(0, 50)}`
    default: return `🛠️ ${t.name}`
  }
}
// Fisierul "in lucru" pentru bara — doar cand pasul chiar atinge un fisier.
function toolFile(t) {
  const i = t.input || {}
  return t.name === 'Edit' || t.name === 'Write' || t.name === 'MultiEdit' || t.name === 'Read'
    ? baseName(i.file_path)
    : ''
}

// ── DOVADA (ordinul lui Adrian, 5 iul: „la nimic din ce zici că faci nu aduci
// dovada") ─────────────────────────────────────────────────────────────────
// Constructorul NU mai crede pe cuvânt raportul modelului. După execuție
// verifică EL însuși: git diff (ce fișiere s-au schimbat efectiv) + npm run
// build în backend ȘI frontend + npm test în backend, rulate de constructor.
// Rezultatul real (fișiere, exit code-uri, coada erorii) intră în release și
// pleacă lui Adrian în chat — iar „Gata" se spune DOAR când dovada există;
// altfel se spune cinstit ce a picat.
async function verifyWork() {
  const diff = (await run('git', ['diff', '--stat'])).out.trim()
  const summary = diff.split('\n').pop()?.trim() || '' // „3 files changed, 41 insertions(+)…"
  const be = await run('npm', ['run', 'build'], { cwd: REPO + '/backend' })
  const fe = await run('npm', ['run', 'build'], { cwd: REPO + '/frontend' })
  const te = await run('npm', ['test'], { cwd: REPO + '/backend' })
  const verdict = (r) => (r.code === 0 ? 'OK' : `PICĂ (exit ${r.code})`)
  const proof = `${summary || 'NICIUN fișier modificat'}; build backend: ${verdict(be)}; build frontend: ${verdict(fe)}; test backend: ${verdict(te)}`
  const detail =
    '--- DOVADA (verificată de constructor, nu pe cuvântul modelului) ---\n' +
    `git diff --stat:\n${diff || '(gol — niciun fișier modificat)'}\n\n` +
    `npm run build (backend) → exit ${be.code}${be.code !== 0 ? `\n${be.out.slice(-1500)}` : ''}\n` +
    `npm run build (frontend) → exit ${fe.code}${fe.code !== 0 ? `\n${fe.out.slice(-1500)}` : ''}\n` +
    `npm test (backend) → exit ${te.code}${te.code !== 0 ? `\n${te.out.slice(-1500)}` : ''}`
  const builtOk = be.code === 0 && fe.code === 0 && te.code === 0
  // BLOCAJ SCOS (Adrian: „scoate absolut TOATE" — fără excepții): poarta nu mai
  // gâtuie nimic. `ok` e mereu true; dovada (diff + build-uri) pleacă în continuare
  // lui Adrian ca informație, dar NU mai blochează stagearea release-ului.
  return { ok: true, changed: diff !== '', proof, detail, builtOk }
}

// ── GIT: comit + branch + push (pipeline GitHub, NU railway up) ────────────
// Constructorul trebuie să ducă schimbările în GitHub înainte ca deploy.yml
// să le poată publica. Fiecare release stagnează pe branch-ul lui propriu;
// deployerul face PR → merge → dispatch deploy.yml.
async function gitConfig(key) {
  const r = await run('git', ['config', '--get', key])
  return r.code === 0 ? r.out.trim() : ''
}
async function ensureGitUser() {
  const name = await gitConfig('user.name')
  const email = await gitConfig('user.email')
  if (!name) await run('git', ['config', 'user.name', 'Kelion Builder'])
  if (!email) await run('git', ['config', 'user.email', 'builder@kelionai.app'])
}
async function gitCurrentBranch() {
  const r = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.code === 0 ? r.out.trim() : 'master'
}
async function gitHasChanges() {
  const r = await run('git', ['status', '--porcelain'])
  return r.code === 0 && r.out.trim().length > 0
}
async function gitEnsureCleanStart() {
  // Dacă repo-ul are deja schimbări locale de la o rulare anterioară eșuată,
  // nu le amestecăm cu noul ordin. Le resetăm pe cele necomise, dar păstrăm
  // fișierele noi (untracked) pentru ca operatorul uman să le decidă soarta.
  await run('git', ['reset', '--mixed'])
  await run('git', ['checkout', '.'])
}
async function createWorkBranch(baseBranch) {
  await ensureGitUser()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const branch = `builder/auto-${timestamp}`
  const r = await run('git', ['checkout', '-b', branch, baseBranch])
  if (r.code !== 0) throw new Error(`Nu am putut crea branch-ul ${branch}: ${r.out.slice(-300)}`)
  return branch
}
async function commitAll(message) {
  await run('git', ['add', '-A'])
  const r = await run('git', ['commit', '-m', message, '--no-verify'])
  if (r.code !== 0) throw new Error(`Commit eșuat: ${r.out.slice(-300)}`)
  return r
}
async function pushBranch(branch) {
  const r = await run('git', ['push', '-u', 'origin', branch])
  if (r.code !== 0) throw new Error(`Push eșuat pentru ${branch}: ${r.out.slice(-300)}`)
}

async function prepareReleaseBranch(title) {
  say('📦 Pregătesc branch-ul pentru pipeline (commit → push)')
  pushProgress(85, 'Pregătesc branch')
  await ensureGitUser()
  const base = await gitCurrentBranch()
  // Salvăm schimbările locale într-un branch nou, indiferent de branch-ul de bază.
  const branch = await createWorkBranch(base)
  await commitAll(`builder: ${title.slice(0, 100)}`)
  await pushBranch(branch)
  say(`📤 Branch creat și push-uit: ${branch}`)
  return branch
}

// ── VERIFICATOR INDEPENDENT GLM (Adrian, 11 iul: „dai la GLM") ─────────────
// După ce constructorul trece dovada mecanică, un agent SEPARAT, forțat pe GLM,
// demonizează lucrarea: citește diff-ul critic, re-rulează build-urile și
// testele, caută cazuri-limită. Returnează verdict structurat TRECE/PICĂ.
// DOAR ce trece ajunge la ready-deploy; ce pică se întoarce la reparat.
function glmEnv() {
  let key
  try { key = readFileSync('/root/kelion/glm-key.txt', 'utf8').trim() || null } catch { key = null }
  if (!key) return null
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_AUTH_TOKEN: key,
  }
  // ROUTARE, NU „îngrădire de model" (aceeași regresie #166 ca la workEnv):
  // cu CLAUDE_CODE_OAUTH_TOKEN prezent, verificatorul intră în modul abonament
  // și trimite `glm-4.6` la Anthropic → „Unknown Model" → verificatorul pică
  // mereu. Îl scoatem aici, unde avem cheie GLM reală (glmEnv întoarce null dacă
  // n-o are, deci nu se ajunge aici fără cheie).
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  return env
}

function runClaudeGLMVerifier(prompt, onEvent, timeoutMs) {
  return new Promise((resolve) => {
    void (async () => {
    const env = glmEnv()
    if (!env) {
      resolve({ code: -1, out: 'LIPSA_CHEIE_GLM: /root/kelion/glm-key.txt nu există sau e gol' })
      return
    }
    say('🔬 Verificator independent pornit pe GLM')
    // Model AUTO-SINCRONIZAT de pe endpoint-ul GLM (nu hardcodat) — `glm-4.6` e
    // doar fallback dacă interogarea /v1/models pică.
    const glmTier = WORK_TIERS.find((t) => t.name === 'glm')
    const model = (await resolveTierModel(glmTier)) || GLM_MODEL
    const c = spawn('claude', [
      '-p', prompt,
      '--model', model,
      // CAPACITATE MAXIMĂ ȘI LA VERIFICARE (Adrian, 12 iul: „ambele au atribut de
      // edit și de verificare"): verificatorul nu mai e read-only — primește TOT
      // setul de unelte, ca să poată nu doar citi/verifica, ci și edita/repara
      // ce găsește. Ambele modele (Kimi + GLM) au acum ambele atribute: și
      // editare (poarta de muncă), și verificare (poarta asta) — complet.
      '--allowedTools', 'Read,Edit,Write,MultiEdit,NotebookEdit,Bash,Glob,Grep,LS',
      // DREPT EFECTIV DE EDITARE și la verificare — acceptEdits, ca verificatorul
      // să poată repara ce găsește, nu doar să raporteze.
      '--permission-mode', 'acceptEdits',
      '--output-format', 'stream-json', '--verbose',
    ], { cwd: REPO, env })
    let buf = ''
    let finalText = ''
    let errText = ''
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs)
    c.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result' && typeof ev.result === 'string') finalText = ev.result
          onEvent(ev)
        } catch { /* linie parțială/non-JSON — ignorată */ }
      }
    })
    c.stderr.on('data', (d) => (errText += d))
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out: finalText || errText }) })
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
    })()
  })
}

function parseVerifierVerdict(text) {
  if (!text) return { pass: false, reason: 'Verificatorul nu a returnat text', details: '' }
  const m = text.match(/VERDICT:\s*(TRECE|PIC[ĂA])/i)
  if (!m) return { pass: false, reason: 'Verificatorul nu a returnat verdict structurat (lipsește „VERDICT:")', details: text.slice(-2000) }
  const pass = m[1].toUpperCase().startsWith('TRECE')
  const reasonMatch = text.match(/MOTIVE:\s*([\s\S]*?)(?:\nRISCURI:|\nRECOMAND[AĂ]RI:|\n---|$)/i)
  const reason = reasonMatch ? reasonMatch[1].trim().slice(0, 800) : '(fără motive detaliate)'
  return { pass, reason, details: text.slice(-3000) }
}

async function runIndependentVerifier(orderText, builderSummary, verificationResult) {
  const { proof, detail } = verificationResult
  const prompt =
    `Ești VERIFICATOR INDEPENDENT în proiectul Kelionai. Nu editezi nimic — doar demonizezi lucrarea constructorului.\n\n` +
    `Sarcina constructorului: "${orderText}"\n` +
    `Sumarul constructorului: ${builderSummary}\n` +
    `Dovada mecanică: ${proof}\n\n` +
    `Detalii complete (diff + build + test):\n${detail}\n\n` +
    `Misiunea ta:\n` +
    `1. Citește diff-ul complet (\`git diff\`) și fișierele modificate relevante.\n` +
    `2. Rulează încă o dată \`npm run build\` în backend/ și frontend/ și \`npm test\` în backend/ (confirmă sau infirmă rezultatele constructorului).\n` +
    `3. Gândește-te la cazuri-limită: input-uri goale/null, erori, securitate, regresii, race conditions, side-effects.\n` +
    `4. Dă un verdict structurat EXACT în formatul:\n\n` +
    `VERDICT: TRECE\n` +
    `sau\n` +
    `VERDICT: PICĂ\n\n` +
    `MOTIVE:\n` +
    `- (puncte clare; pentru PICĂ: ce e greșit și de ce; pentru TRECE: ce ai verificat)\n\n` +
    `RISCURI:\n` +
    `- (riscuri reziduale, chiar dacă TRECE)\n\n` +
    `RECOMANDĂRI (doar dacă PICĂ):\n` +
    `- (cum să repare constructorul)\n\n` +
    `La final, repetă verdictul pe o linie nouă: VERDICT: TRECE sau VERDICT: PICĂ.`
  let steps = 0
  let lastFile = ''
  const res = await runClaudeGLMVerifier(prompt, (ev) => {
    if (ev.type !== 'assistant') return
    const blocks = ev.message?.content
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue
      steps++
      const f = toolFile(b)
      if (f) lastFile = f
      say(toolLine(b))
      pushProgress(Math.min(98, 90 + steps), 'Verificare independentă GLM', lastFile)
    }
  }, 86400000)
  if (res.code !== 0) {
    return { pass: false, reason: `Verificatorul GLM s-a terminat cu exit ${res.code}: ${res.out.slice(0, 400)}`, details: res.out }
  }
  return parseVerifierVerdict(res.out)
}

// O veste către chatul lui Adrian (rostită + salvată în istoric). Fire-and-
// forget: chatul căzut nu oprește niciodată constructorul.
function tellAdmin(text) {
  return api('/api/bridge/say', 'POST', { text }).catch(() => {})
}

async function build(order) {
  // Curățăm eventualele schimbări locale rămase de la o rulare anterioară
  // eșuată, ca noul ordin să plece dintr-un repo curat.
  try { await gitEnsureCleanStart() } catch { /* ignore — încercăm oricum */ }

  // Claude editeaza + compileaza in repo. NU publica (interzis explicit).
  const prompt =
    `Esti constructorul Kelionai. Sarcina de la Adrian: "${order.text}". ` +
    `Editeaza codul in acest repo ca sa o rezolvi. Compileaza (npm run build in backend SI frontend) ` +
    `si ruleaza testele (npm test in backend) pana trec fara erori. ` +
    `NU face deploy, NU rula railway. La final scrie pe o singura linie, ` +
    `dupa "SUMAR:", ce ai schimbat.\n` +
    // Problema centrala (Adrian, 12 iul: „Kelion spune ca face dar nu executa
    // nimic" / „el nu-l face deloc"): constructorul iesea „fara fisiere
    // modificate" — rationa/explora dar NU edita. Fortam executia reala.
    `REGULA ZERO — TREBUIE SA EDITEZI: a rezolva o cerere inseamna sa MODIFICI ` +
    `fisiere reale (Edit/Write). A termina cu ZERO fisiere modificate = ESEC, ` +
    `NU „gata". Daca nu stii UNDE e codul, CAUTA intai (grep/glob) si editeaza ` +
    `fisierul cel mai probabil — niciodata doar sa descrii, sa „raportezi blocaj" ` +
    `sau sa inchizi fara editare. Un singur Edit real bate zece explicatii.\n` +
    // Harta ca sa nu porneasca orb (cauza #1 a „fara fisiere").
    `UNDE E CODUL (repere): comportamentul lui Kelion in chat (ton, reguli, ` +
    `gesturi [GEST]) → backend/src/routes/chat.ts (promptul creierului) + ` +
    `frontend/src/components/ChatPanel.tsx + frontend/src/components/AvatarModel.tsx; ` +
    `vocea/transcriere (STT) → backend/src/routes/asr.ts + asr-stream.ts + ` +
    `frontend/src/lib/audioIO.ts + micStream.ts; vocea rostita (TTS) → ` +
    `backend/src/services/tts.ts. Daca nu e in lista, foloseste grep pe cuvinte-cheie.\n` +
    // Problema 1 (Adrian, 12 iul): NU „documenta blocajul" in loc sa lucrezi.
    `REGULI DE FIER: (1) Daca sarcina cere OPERATIUNI de sistem (instalare pachete, ` +
    `pornire/repornire servicii, docker, config VPS) si NU le poti rula EXACT si dovedit, ` +
    `NU edita AI-HANDOFF/documente ca substitut de lucru — scrie clar "OPS_NECESITA_RUNBOOK: <ce comanda exacta trebuie>" ` +
    `si opreste-te, ca sa preia un workflow determinist (vps-*). ` +
    `(2) DOVADA INAINTE DE AFIRMATIE: nu spune ca ceva merge fara sa fi VERIFICAT (curl/status/loguri reale), ` +
    `niciodata din presupunere. (3) La orice esec, citeste faptele (loguri, status) inainte de concluzie. ` +
    // Problema noua (Adrian, 12 iul: „reparara o fantoma — consuma credite, bani;
    // creierul trebuie sa lucreze CONSTIENT INFIPT IN REALITATE, nu doar masina").
    `(4) POARTA DE REALITATE — REPRODU INAINTE SA REPARI: daca sarcina spune ca ceva e stricat ` +
    `(un endpoint da 500, o pagina crapa, o functie pica), PRIMUL lucru pe care-l faci e sa REPRODUCI defectul ACUM ` +
    `cu o comanda reala (ex: curl -s -o /dev/null -w '%{http_code}' <url>). Daca NU se mai reproduce ` +
    `(endpoint-ul da 200, functia merge), NU repara nimic — un esec tranzitoriu (ex: in timpul unui redeploy) ` +
    `NU e un bug. Scrie "NU SE MAI REPRODUCE: <dovada>" si INCHIDE sarcina. Repari DOAR ce ai vazut ca e ` +
    `chiar rupt acum. Un avertisment de browser (ceva „is deprecated") NU e o eroare — nu il repara niciodata. ` +
    // Clarificare (12 iul): regula (4) e DOAR pentru bug-uri raportate.
    `IMPORTANT: regula (4) se aplica DOAR cand sarcina spune ca ceva E STRICAT. ` +
    `Pentru cereri de COMPORTAMENT sau feature („fa X sa se poarte asa", „adauga Y", ` +
    `„schimba tonul/gesturile") NU cauti sa reproduci un bug — editezi direct codul ` +
    `care guverneaza acel comportament (vezi harta de mai sus) si REGULA ZERO se aplica: TREBUIE sa editezi.`
  const short = order.text.replace(/\s+/g, ' ').slice(0, 70)
  say(`🔨 Am preluat ordinul și încep execuția: ${short}`)
  pushProgress(10, 'Execuție')
  // Puls de prezenta cat lucreaza Claude: monitorul ramane LIVE chiar si in
  // pauzele lungi de gandire (fara pasi noi >60s, altfel feed-ul s-ar stinge).
  const hb = setInterval(() => { void api('/api/dev/heartbeat', 'POST', {}).catch(() => {}) }, 20_000)
  let steps = 0
  let lastFile = ''
  const res = await runClaudeLive(prompt, (ev) => {
    if (ev.type !== 'assistant') return
    const blocks = ev.message?.content
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue
      steps++
      const f = toolFile(b)
      if (f) lastFile = f
      say(toolLine(b))
      // CODUL SUB BARĂ (Adrian, 11 iul): conținutul fiecărei editări pleacă
      // la server — click pe bara de progres îl arată scriptic, live.
      if (b.name === 'Edit' || b.name === 'Write' || b.name === 'MultiEdit') {
        const inp = b.input || {}
        const text = String(inp.new_string ?? inp.content ?? '').slice(0, 2000)
        if (text) void api('/api/bridge/work-detail', 'POST', { file: baseName(inp.file_path), text }).catch(() => {})
      }
      // Executia umple 12→84%; verificarea si stagearea duc restul pana la 100.
      pushProgress(Math.min(84, 12 + steps * 2), 'Execuție', lastFile)
    }
  }, 86400000)
  clearInterval(hb)
  if (res.code !== 0) say('⚠️ Execuția s-a terminat cu erori — verific oricum ce s-a schimbat efectiv')
  else say('🧪 Execuția s-a încheiat — verific EU dovada (diff + build-uri), nu cred pe cuvânt')
  pushProgress(88, 'Verificare cu dovadă')
  const v = await verifyWork()
  const sumMatch = res.out.match(/SUMAR:\s*(.+)/)
  const title = (sumMatch ? sumMatch[1] : order.text).slice(0, 180)
  // Verdictul pleacă lui Adrian CU dovada atașată — niciodată „gata" gol.
  // GARDĂ ANTI-RECURSIVITATE (12 iul, Adrian: „ultimele 10 relesuri nu au
  // existat — e un bug"): un ordin de PUBLICARE (generat de decide-approve,
  // nu o cerere de cod nouă) nu se restagează NICIODATĂ ca release nou —
  // altfel un mic commit administrativ (fără linie SUMAR:) ducea la titlul
  // ordinului însuși devenind un release fantomă, aprobat la nesfârșit.
  const isPublishOrder = /^RELEASE APROBAT DE ADRIAN:/.test(order.text)
  if (v.ok && isPublishOrder) {
    say(`✅ Ordin de publicare executat: ${v.proof}`)
    await tellAdmin(`Am dus la capăt publicarea: ${title.slice(0, 120)}. Dovada: ${v.proof}.`)
    pushProgress(100, 'Publicare executată')
  } else if (v.ok) {
    say('🔍 Constructorul a trecut dovada — pornesc verificatorul independent GLM înainte de a declara gata')
    pushProgress(90, 'Verificare independentă GLM')
    const verdict = await runIndependentVerifier(order.text, title, v)
    if (verdict.pass) {
      let branch = ''
      try {
        branch = await prepareReleaseBranch(title)
      } catch (e) {
        say(`🔴 NU e gata — nu am putut pregăti branch-ul: ${e.message}`)
        await tellAdmin(`Ordinul „${order.text.slice(0, 100)}" NU e gata: nu am putut comite/push branch-ul (${e.message}).`)
        pushProgress(100, 'Eșec pregătire branch')
        return
      }
      const detail =
        `Ordin: ${order.text}\n\n` +
        `Verificator independent GLM: TRECE\n${verdict.reason}\n\n` +
        `${v.detail}\n\n` +
        `--- notele constructorului ---\n${res.out.slice(-2000)}`
      await api('/api/bridge/stage-release', 'POST', { title, detail, branch })
      say(`✅ Gata, verificat independent: ${v.proof} — aștept aprobarea (Admin → Release-uri)`)
      await tellAdmin(`Am terminat: ${title.slice(0, 120)}. Dovada: ${v.proof}. Verificator independent GLM: TRECE (${verdict.reason}). E pregătit — aprobă în Admin → Release-uri.`)
      pushProgress(100, 'Gata — dovadă + verificare independentă, aștept aprobarea')
    } else {
      // GARDĂ ANTI-BUCLĂ (12 iul, Adrian: coada s-a umplut cu „VERIFICATOR
      // INDEPENDENT PICĂ pentru „VERIFICATOR INDEPENDENT PICĂ pentru..."
      // cuibărit la infinit). Două cazuri distincte:
      const verifierCrashed = /s-a terminat cu exit|nu am putut porni/i.test(verdict.reason || '')
      const alreadyRequeued = /^VERIFICATOR INDEPENDENT PICĂ/.test(order.text)
      if (verifierCrashed) {
        // (a) Verificatorul ÎNSUȘI a crăpat (infra: cotă/cheie GLM, rețea) — NU
        // e vina lucrării. Constructorul a trecut deja build+test, deci stagem
        // release-ul cu o notă „neverificat-independent" (nimic nu intră live
        // fără aprobarea lui Adrian oricum) în loc să buclăm munca reală.
        let branch = ''
        try {
          branch = await prepareReleaseBranch(title)
        } catch (e) {
          say(`🔴 NU e gata — nu am putut pregăti branch-ul: ${e.message}`)
          await tellAdmin(`Ordinul „${order.text.slice(0, 100)}" NU e gata: nu am putut comite/push branch-ul (${e.message}).`)
          pushProgress(100, 'Eșec pregătire branch')
          return
        }
        const detail =
          `Ordin: ${order.text}\n\n` +
          `Verificator independent: INDISPONIBIL (${verdict.reason})\n` +
          `Constructorul a trecut build+test proprii; publicarea rămâne la aprobarea lui Adrian.\n\n` +
          `${v.detail}\n\n--- notele constructorului ---\n${res.out.slice(-2000)}`
        await api('/api/bridge/stage-release', 'POST', { title, detail, branch })
        say(`⚠️ Verificatorul independent n-a putut rula (${String(verdict.reason).slice(0, 60)}) — pus release cu build+test proprii, marcat neverificat-independent; aștept aprobarea`)
        await tellAdmin(`Am terminat: ${title.slice(0, 120)}. Dovada: ${v.proof}. NOTĂ: verificatorul independent GLM n-a putut rula (${String(verdict.reason).slice(0, 80)}) — de verificat cheia/cota GLM. Aprobă în Admin → Release-uri.`)
        pushProgress(100, 'Gata (verificator indisponibil) — aștept aprobarea')
      } else if (alreadyRequeued) {
        // (b) Ordinul e DEJA o re-emisie de eșec-verificator care a picat iar —
        // NU mai re-emitem, altfel se cuibărește la infinit.
        say('🔴 Verificarea a picat din nou pe o re-emisie — NU mai re-emit (evit bucla). Detalii în Release-uri.')
        await tellAdmin(`Ordinul „${order.text.slice(0, 80)}" a picat verificarea din nou — nu mai re-emit automat (evit bucla). Verifică manual.`)
        pushProgress(100, 'Verificare picată repetat — oprit re-emiterea')
      } else {
        say(`🔴 NU e gata — verificatorul independent GLM a PICĂ: ${verdict.reason}`)
        await tellAdmin(`Ordinul „${order.text.slice(0, 100)}" NU e gata: verificatorul independent GLM a PICĂ (${verdict.reason}). Nu public nimic stricat; repar și retrimite.`)
        pushProgress(100, 'Verificare independentă PICĂ — întors la reparat')
        // Întoarce la reparat cu motivele verificatorului (o SINGURĂ dată — o
        // re-emisie care pică iar cade pe ramura (b) și se oprește).
        await api('/api/bridge/workorders', 'POST', {
          text: `VERIFICATOR INDEPENDENT PICĂ pentru „${order.text.slice(0, 200)}": ${verdict.reason}. Repară problema și retrimite.`,
        }).catch(() => {})
      }
    }
  } else if (!v.changed) {
    say('⚠️ NU declar gata: niciun fișier modificat — nu am dovadă că s-a lucrat ceva (detaliile în Release-uri)')
    await tellAdmin(`Ordinul „${order.text.slice(0, 100)}" s-a terminat FĂRĂ fișiere modificate — nu am dovadă de lucru, nu declar gata. Detaliile sunt în Admin → Release-uri.`)
    pushProgress(100, 'Fără dovadă — niciun fișier modificat')
  } else {
    say(`🔴 NU e gata — dovada arată build picat: ${v.proof} (eroarea completă în Release-uri)`)
    await tellAdmin(`Ordinul „${order.text.slice(0, 100)}" NU e gata: ${v.proof}. Eroarea completă e în Admin → Release-uri; nu public nimic stricat.`)
    pushProgress(100, 'Build picat — dovada în Release-uri')
  }
}

async function generateAndUploadQRs() {
  say('🎨 Generez noile coduri QR pentru download...')
  try {
    // Folosim api-ul extern (ex: goqr.me sau similar) pentru a genera QR-urile
    // direct ca buffer, apoi le urcăm în baza de date. Fără dependințe noi pe VPS.
    const targets = [
      { name: 'qr-win.png', url: `${BASE}/dl/Kelionai-Setup.exe` },
      { name: 'qr-apk.png', url: `${BASE}/dl/Kelionai.apk` },
      { name: 'qr-linux.png', url: `${BASE}/dl/Kelionai-linux.zip` },
      { name: 'qr-ios.png', url: `${BASE}` },
    ]

    for (const t of targets) {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(t.url)}`
      const res = await fetch(qrUrl)
      if (!res.ok) throw new Error(`QR fail: ${t.name}`)
      const buf = await res.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      await api('/api/bridge/upload-app', 'POST', {
        name: t.name,
        type: 'image/png',
        data: b64
      })
      say(`  ✓ ${t.name} actualizat`)
    }
    say('✅ Toate codurile QR au fost regenerate și sunt LIVE')
  } catch (err) {
    console.error('QR regen failed:', err)
    say('⚠️ Eșec la regenerarea codurilor QR (detalii în log)')
  }
}

async function deployApproved(r) {
  const title = String(r.title || r.id).slice(0, 80)
  say(`🚀 Aprobat — public pe producție: ${title}`)
  pushProgress(92, 'PR → merge → deploy')

  const branch = String(r.branch || '').trim()
  if (!branch) {
    say('🔴 Deploy blocat: release-ul nu are branch atașat — nu pot publica.')
    return
  }

  // PUBLICARE COMPLETĂ CAP-COADĂ (Adrian, 12 iul: „Kelion trebuie să ducă o
  // reparație completă"): o SINGURĂ comandă atomică `publish` duce branch→master
  // →deploy, fără să se mai blocheze pe dreptul de a deschide PR (403-ul din 11
  // iul). Încearcă PR+merge (audit-trail); dacă tokenul nu poate, cade pe
  // `POST /merges` (contents:write), apoi rulează deploy-ul verificat anti-fantomă.
  say('📤 Public branch→master→deploy (o singură cale, fără blocaj de token)')
  const pubRes = await run(
    'bash',
    [REPO + '/bridge/kelion-github', 'publish', branch, `builder: ${title}`, String(r.detail || '').slice(0, 4000)],
    { timeoutMs: 900000 },
  )
  // `publish` face exec la `deploy`, care întoarce 0 DOAR după ce versiunea live
  // chiar s-a schimbat (verificarea anti-fantomă). Deci code!==0 = nimic publicat.
  if (pubRes.code !== 0) {
    console.error('Publicare eșuată:', pubRes.out.slice(-800))
    const tail = pubRes.out.split('\n').filter(Boolean).pop() || 'detalii în jurnalul serverului'
    say(`🔴 Publicare eșuată — nimic nu s-a publicat: ${tail.slice(0, 160)}`)
    await tellAdmin(`Publicarea „${title.slice(0, 100)}" a eșuat: ${tail.slice(0, 200)}. Nimic nu a ajuns live.`)
    pushProgress(100, 'Publicare eșuată')
    return
  }
  say('🔀 branch→master + deploy verificat anti-fantomă: OK')
  pushProgress(96, 'Publicat în master + deploy')

  // Release-ul se marchează publicat abia după ce pipeline-ul a confirmat
  // verificarea anti-fantomă (versiunea live s-a schimbat).
  await api('/api/bridge/release-deployed', 'POST', { id: r.id })
  say('🟢 PUBLICAT + VERIFICAT LIVE prin pipeline GitHub/Railway')
  pushProgress(98, 'Publicat — regenerez QR-uri')

  // După deploy, regenerăm codurile QR ca să reflecte ultimele căi.
  await generateAndUploadQRs()
  pushProgress(100, 'Publicat + QR-uri regenerate')
}

// REPARATOR EFEMER (pool elastic, Adrian 12 iul: „mai mulți reparatori
// sincronizați care se opresc când termină și repornesc când cresc sarcinile").
// Revendică UN ordin (atomic — /workorders/claim, FOR UPDATE SKIP LOCKED, sigur
// în paralel), îl repară, revine după altul; când coada e goală → IESE
// (scale-to-zero, nu mai consumă abonament). Rulează în worktree-ul propriu
// (KELION_REPO) → nu se bate pe git cu alți reparatori. Modul clasic (fără flag)
// rămâne NEATINS = plasa de siguranță; supervizorul îl comută deliberat.
async function repairerLoop() {
  const tag = process.env.REPAIRER_TAG || '1'
  console.log(`Reparator ${tag} pornit -> ${BASE}, repo ${REPO}`)
  for (;;) {
    let order = null
    try {
      const r = await api('/api/bridge/workorders/claim', 'POST', {})
      order = r?.order || null
    } catch (e) {
      console.error(`reparator ${tag} claim:`, e.message)
      await new Promise((res) => setTimeout(res, 5000))
      continue
    }
    if (!order) {
      console.log(`Reparator ${tag}: coadă goală — ies (scale-to-zero).`)
      process.exit(0)
    }
    try {
      await build(order)
    } catch (e) {
      console.error(`reparator ${tag} build:`, e.message)
    }
  }
}

async function main() {
  // Mod reparator efemer (pornit de supervizor) vs. constructorul clasic (default).
  if (process.env.REPAIRER_MODE === '1') return repairerLoop()
  // DOAR deploy: când pool-ul elastic e activ, reparatorii fac build-urile, iar
  // ACEST proces publică doar release-urile aprobate — nu mai trage ordine de
  // lucru (altfel s-ar bate cu reparatorii pe revendicare).
  const deployOnly = process.env.DEPLOY_ONLY === '1'
  console.log(`Constructorul Kelion (headless${deployOnly ? ' — DOAR deploy' : ''}) pornit ->`, BASE, 'repo', REPO)
  for (;;) {
    try {
      if (!deployOnly) {
        const { orders } = await api('/api/bridge/workorders')
        for (const o of orders || []) await build(o)
      }
      const { releases } = await api('/api/bridge/approved-releases')
      for (const r of releases || []) await deployApproved(r)
    } catch (e) {
      console.error('bucla:', e.message)
    }
    await new Promise((r) => setTimeout(r, 20000))
  }
}
void main()
