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
// CONSTRUCTOR_MAX_STEPS (24 — pași CU UNELTE, nu ture), CONSTRUCTOR_MAX_TOKENS
// (900000), CONSTRUCTOR_MAX_STERILE (8 — ture în care modelul doar povestește),
// CONSTRUCTOR_MAX_REPAIR (2 — runde de reparație după un build picat),
// CONSTRUCTOR_MODEL_CAPABIL (pe ce urcă atunci când gratuitul dovedește că nu
// poate) + CONSTRUCTOR_ESCALADARE=0 ca s-o stingi,
// CONSTRUCTOR_BUDGET_MS (1560000 = 26 min, sub timeout-ul dur de 30 min din
// constructor-worker.sh, ca să apucăm SĂ RAPORTĂM înainte să fim omorâți).
import { execSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENVFILE = '/root/kelion/kelionai.env'
const ATELIER = '/root/kelion/atelier'
const APP = 'http://127.0.0.1:8080'
const REPO = 'kelion-team/kelionai'

// env-ul aplicației, citit direct din fișier (cronul nu are mediul shell-ului).
// Tolerant la lipsa fișierului: pe VPS există mereu, dar dacă cumva nu (sau la
// importul modulului dintr-un test al gărzii de comenzi), pornim cu env gol —
// main() se oprește oricum curat pe „lipsesc BRIDGE_SECRET/...", nu crapă.
const env = {}
try {
  for (const line of fs.readFileSync(ENVFILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
} catch {
  /* fișier absent/necitibil — env gol, main() raportează lipsurile */
}
const BRIDGE = env.BRIDGE_SECRET ?? ''
const ORKEY = env.OPENROUTER_API_KEY ?? ''
const GHTOKEN = env.GITHUB_TOKEN ?? ''
// DOAR GRATUIT, STRUCTURAL (Adrian, 27 iul: „doar gratuit... să nu mai poată
// reveni vreodată" arderea de bani). Implicitul e un model :free; iar dacă
// cineva pune totuși un model PLĂTIT în env, constructorul REFUZĂ să pornească
// (decât cu CONSTRUCTOR_ALLOW_PAID=1, ales conștient). Așa, incidentul din 27
// iul (constructor pe model plătit care ardea bani la fiecare rulare) NU se
// mai poate întâmpla din greșeală — e imposibil, nu doar nerecomandat.
const MODEL = env.CONSTRUCTOR_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'
const ALLOW_PAID = env.CONSTRUCTOR_ALLOW_PAID === '1'
if (!MODEL.endsWith(':free') && !ALLOW_PAID) {
  console.log(
    `[constructor] REFUZ: modelul „${MODEL}" NU e gratuit (:free) și CONSTRUCTOR_ALLOW_PAID nu e 1. ` +
      `Arderea de bani e blocată structural. Pune un model :free sau, conștient, CONSTRUCTOR_ALLOW_PAID=1.`,
  )
  process.exit(0)
}
// GARDA DE MAI SUS PRIVEȘTE DOAR MODELUL DE PORNIRE. Escaladarea pe neputință
// (mai jos, `escaladeazaPeNeputinta`) urcă pe un model plătit DUPĂ ce gratuitul
// a dovedit că nu poate — și e intenționat neatinsă de garda asta. Regula din
// 27 iul apăra împotriva „plătit LA FIECARE rulare"; aici se plătește doar
// acolo unde gratuitul a picat deja, o dată pe ordin. Se stinge cu
// CONSTRUCTOR_ESCALADARE=0.
const MAX_STEPS = Number(env.CONSTRUCTOR_MAX_STEPS || 24)
// Plafon SEPARAT pentru turele sterile (vorbărie, unelte refuzate) — vezi
// contabilitatea pașilor din main(): ele nu mai au voie să mănânce bugetul de
// construcție, dar nici să ne țină la nesfârșit.
const MAX_STERILE = Number(env.CONSTRUCTOR_MAX_STERILE || 8)
// Runde de reparație după un build/test roșu (promise în system prompt, dar
// niciodată acordate de codul vechi — vezi bucla din main()).
const MAX_REPAIR = Number(env.CONSTRUCTOR_MAX_REPAIR || 2)
const MAX_TOKENS = Number(env.CONSTRUCTOR_MAX_TOKENS || 900_000)
// FEREASTRA DE CONTEXT (audit 27 iul — cauza EȘECULUI pe ORICE model): bucla
// re-trimitea TOT istoricul la fiecare pas, cu citiri de până la 120k caractere
// păstrate pe veci → un job trivial ajungea la ~794k tokeni, unul greu spărgea
// plafonul. Acum: rezultatele uneltelor vechi se comprimă la un ciot; doar
// ultimele KEEP_VERBATIM schimburi rămân întregi. Liniar, nu pătratic.
const KEEP_VERBATIM = Number(env.CONSTRUCTOR_KEEP_VERBATIM || 6)
const READ_CAP = 6_000 // caractere pe o citire (era 120k — sursa exploziei)

// BUGETUL DE TIMP AL RULĂRII. constructor-worker.sh ne dă `timeout 1800`; dacă
// ne prinde acolo, procesul moare SIGKILL/SIGTERM fără să raporteze, ordinul
// rămâne „running" 40 de minute în DB și consumă o încercare degeaba (la a 3-a
// e abandonat automat). Deci ne oprim SINGURI mai devreme și raportăm.
const START = Date.now()
const BUDGET_MS = Number(env.CONSTRUCTOR_BUDGET_MS || 26 * 60_000)
const ramase = () => BUDGET_MS - (Date.now() - START)
const dormi = (ms) => new Promise((r) => setTimeout(r, ms))

const logLines = []
// PROGRES LIVE (Etapa 4 autonomie, 29 iul): fiecare pas al constructorului
// (clonat → editez X → build → deschid PR...) e împins spre aplicație ca să
// apară pe monitor și ca Kelion să-l poată NARA. Fire-and-forget, throttlat la
// ~4s și cu timeout scurt: NU are voie să mănânce din bugetul de timp al rulării
// (lecția „un job nu poate deveni demon") — un beat pierdut nu strică nimic.
let beatJobId = 0
let lastBeatAt = 0
function beat(text, acum = false) {
  if (!beatJobId || !BRIDGE) return
  const now = Date.now()
  // `acum` sare peste throttle: ultimul pas dinaintea unei pauze lungi TREBUIE
  // să ajungă pe monitor, altfel omul rămâne cu un pas vechi pe ecran 40 de
  // minute și crede că s-a blocat ceva (D6).
  if (!acum && now - lastBeatAt < 4000) return
  lastBeatAt = now
  fetch(`${APP}/api/constructor/progress`, {
    method: 'POST',
    headers: { 'x-bridge-secret': BRIDGE, 'content-type': 'application/json' },
    body: JSON.stringify({ id: beatJobId, progress: String(text).slice(0, 300) }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

function log(s) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`
  console.log(line)
  logLines.push(line)
  beat(s) // pasul curent → monitorul lui Kelion (throttlat în beat)
}

// REÎNCERCARE PE API-UL APLICAȚIEI (dovadă live 28 iul, ordinul #9: stiva de
// eroare arăta „connect ECONNREFUSED 127.0.0.1:8080" chiar aici, în api()).
// Cauza: publicările se fac non-stop, iar containerul aplicației e jos câteva
// secunde la fiecare repornire — exact atunci cronul nostru cere ordinul sau
// trimite raportul. Un deploy NU are voie să omoare un ordin în lucru. Deci:
// erorile de rețea și 5xx-urile (Caddy răspunde 502/503 cât timp aplicația
// urcă) se reîncearcă cu pauze crescătoare; un răspuns real (200, 401, 404) se
// întoarce ca atare, fără reîncercare. La capătul răbdării întoarcem null în
// loc să aruncăm: coada goală = tăcere, iar cronul revine în 2 minute.
async function api(pathname, init = {}, tries = 8) {
  let lastErr = ''
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(`${APP}${pathname}`, {
        ...init,
        headers: { 'x-bridge-secret': BRIDGE, 'content-type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      })
      if (r.status >= 500) throw new Error(`aplicația întoarce ${r.status} (repornire în curs?)`)
      return await r.json().catch(() => null)
    } catch (e) {
      lastErr = String(e?.message ?? e)
      if (attempt === tries) break
      const wait = Math.min(attempt * 3_000, 15_000)
      log(`API ${pathname}: ${lastErr.slice(0, 90)} — reîncerc în ${wait / 1000}s (${attempt}/${tries})`)
      await dormi(wait)
    }
  }
  log(`API ${pathname} indisponibil după ${tries} încercări: ${lastErr.slice(0, 140)}`)
  return null
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
// Citirea cu numere de linie ȘI interval opțional (from/to) — ca modelul să
// tragă DOAR bucata de care are nevoie, nu tot fișierul (audit: citirile
// întregi umpleau contextul). Fără interval: primele READ_CAP caractere.
function toolRead(p, from, to) {
  const lines = fs.readFileSync(safePath(p), 'utf8').split('\n')
  const a = Number.isFinite(from) && from > 0 ? Math.floor(from) : 1
  const b = Number.isFinite(to) && to >= a ? Math.floor(to) : lines.length
  const slice = lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join('\n')
  if (slice.length > READ_CAP)
    return `${slice.slice(0, READ_CAP)}\n...[trunchiat la ${READ_CAP} caractere — cere un interval de linii (from/to) pentru restul; fișierul are ${lines.length} linii]`
  return slice
}
// GREP peste atelier (audit: fără căutare, modelul „spelunca" prin ls/read pas
// cu pas ca să găsească fișierul). O singură căutare = fișierul + linia țintă.
function toolGrep(pattern) {
  const pat = String(pattern ?? '').trim()
  if (!pat) return 'pattern gol'
  try {
    const out = sh(
      `grep -rnI --exclude-dir={node_modules,.git,dist,build,coverage} -e ${JSON.stringify(pat)} . | head -60`,
    )
    return out.trim() || '(niciun rezultat)'
  } catch (e) {
    // grep întoarce exit 1 când nu găsește nimic — nu e eroare.
    return e.status === 1 ? '(niciun rezultat)' : `EROARE grep: ${String(e.message).slice(0, 200)}`
  }
}
// GARDĂ ANTI-TRUNCHIERE. 'write' cere CONȚINUTUL COMPLET al fișierului, dar
// ieșirea modelului e plafonată la 16k tokeni: pe un fișier mare răspunsul se
// taie la jumătate, „reparația" scrie un fișier ciuntit, buildul pică și
// ordinul iese EȘUAT fără ca nimeni să vadă adevărata cauză. Dacă rescrierea
// unui fișier existent îi taie peste jumătate din corp, REFUZĂM și trimitem
// modelul la 'edit' (înlocuire punctuală, fără să retrimită tot fișierul).
function toolWrite(p, content) {
  const full = safePath(p)
  const vechi = fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : null
  if (vechi !== null && vechi.length > 2_000 && content.length < vechi.length * 0.5)
    return (
      `REFUZAT: ai trimis ${content.length} caractere peste un fișier de ${vechi.length} — ` +
      `pare tăiat de plafonul de ieșire. Folosește 'edit' (înlocuiești DOAR bucata care se schimbă) ` +
      `sau retrimite fișierul ÎNTREG.`
    )
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return `scris: ${p} (${content.length} caractere)`
}
// EDIT PUNCTUAL — plasa reală împotriva truncherii de mai sus: modelul dă doar
// textul vechi (exact) și textul nou. Cerem potrivire UNICĂ, ca să nu schimbe
// din greșeală altă apariție (fără diff-uri fuzzy, fără petice oarbe).
function toolEdit(p, vechi, nou) {
  const full = safePath(p)
  if (!vechi) return 'REFUZAT: „old" gol — dă textul EXACT care trebuie înlocuit.'
  const src = fs.readFileSync(full, 'utf8')
  const prima = src.indexOf(vechi)
  if (prima < 0) return `REFUZAT: textul „old" nu apare în ${p} — copiază-l EXACT din 'read' (cu tot cu spații/indentare).`
  if (src.indexOf(vechi, prima + vechi.length) >= 0)
    return `REFUZAT: textul „old" apare de mai multe ori în ${p} — dă un fragment mai lung, unic.`
  fs.writeFileSync(full, src.slice(0, prima) + nou + src.slice(prima + vechi.length))
  return `editat: ${p} (${vechi.length} → ${nou.length} caractere)`
}
// Comenzi PERMISE explicit — nimic altceva nu se execută prin shell (atelierul
// nu e un shell liber; buildul și testele sunt verificările de care e nevoie).
const RUN_ALLOWED = new Set([
  'npm --prefix backend ci',
  'npm --prefix backend run build',
  'npm --prefix backend test',
  'npm --prefix frontend ci',
  'npm --prefix frontend run build',
  'git status --porcelain',
  'git diff --stat',
])
// INSTALAREA DE DEPENDENȚE (Etapa 5 autonomie): un ordin poate cere o bibliotecă
// NOUĂ, iar până acum `npm install` era „comandă nepermisă" — deci constructorul
// nu putea adăuga un pachet, iar dacă edita doar package.json, `npm ci` din
// verificare pica („out of sync"). Acum permitem EXACT `npm --prefix
// (backend|frontend) install [pachete]`, dar cu două garduri: (1) argumentele
// trec printr-un filtru strict (doar nume-npm / nume@versiune și câteva flag-uri
// cunoscute) — un „; rm -rf" sau „--registry=http://rău" e respins; (2) execuția
// e FĂRĂ shell (execFileSync), deci chiar dacă ceva ar scăpa de filtru, un
// metacaracter nu poate fi interpretat. Restul (curl, apt, rm, chmod...) rămân
// interzise; instalarea de unelte de SISTEM e treaba unui runbook, nu a atelierului.
const NPM_PKG_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[a-zA-Z0-9._^~*-]+)?$/
const NPM_INSTALL_FLAGS = new Set(['--save', '--save-dev', '-D', '--save-exact', '-E', '--save-optional', '-O', '--save-peer', '--no-audit', '--no-fund', '--omit=dev'])
const INSTALL_RE = /^npm --prefix (backend|frontend) install\b(.*)$/
// PUR (fără shell, fără disc): decide ce e o comandă din 'run'. Ținut separat +
// exportat ca să poată fi PROBAT (garda de injecție e prea importantă ca s-o
// verific „pe încredere"). Întoarce {mode:'shell'|'install'|'denied'}.
export function classifyRunCommand(cmd) {
  const c = String(cmd ?? '').trim()
  if (RUN_ALLOWED.has(c)) return { mode: 'shell', cmd: c }
  const mi = INSTALL_RE.exec(c)
  if (mi) {
    const prefix = mi[1]
    const toks = (mi[2] || '').trim() ? mi[2].trim().split(/\s+/) : []
    for (const t of toks) {
      if (t.startsWith('-')) {
        if (!NPM_INSTALL_FLAGS.has(t)) return { mode: 'denied', reason: `flag npm nepermis: „${t}". Permise: ${[...NPM_INSTALL_FLAGS].join(' ')}` }
      } else if (!NPM_PKG_RE.test(t)) {
        return { mode: 'denied', reason: `nume de pachet nepermis: „${t}" — doar nume-npm sau nume@versiune (fără spații/metacaractere).` }
      }
    }
    return { mode: 'install', argv: ['--prefix', prefix, 'install', ...toks, '--no-audit', '--no-fund'] }
  }
  return { mode: 'denied', reason: `comandă nepermisă. Permise: ${[...RUN_ALLOWED].join(' | ')} | npm --prefix (backend|frontend) install [pachete]` }
}
function toolRun(cmd) {
  const cls = classifyRunCommand(cmd)
  if (cls.mode === 'denied') return cls.reason
  try {
    const out =
      cls.mode === 'install'
        ? execFileSync('npm', cls.argv, { cwd: ATELIER, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
        : sh(cls.cmd, { timeout: 10 * 60_000 })
    return out.slice(-8000) || '(ok, fără ieșire)'
  } catch (e) {
    return `EȘEC (exit ${e.status ?? '?'})\n${String((e.stdout ?? '') + (e.stderr ?? '')).slice(-8000)}`
  }
}

const TOOLS = [
  { type: 'function', function: { name: 'ls', description: 'Listează un director din repo (fără node_modules/.git/dist).', parameters: { type: 'object', properties: { dir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'grep', description: 'Caută un text/regex în tot repo-ul și întoarce fișier:linie:conținut (max 60). FOLOSEȘTE ASTA ca să găsești fișierul de modificat — nu explora cu ls/read pas cu pas.', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'read', description: 'Citește un fișier (numerotat). Dă from/to ca să iei DOAR intervalul de linii care te interesează — nu tot fișierul.', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'Scrie CONȚINUTUL COMPLET al unui fișier (rescriere integrală, nu diff). Pentru un fișier EXISTENT mare folosește mai bine „edit" — răspunsul tău are plafon și se taie.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'Înlocuiește o bucată de text într-un fișier existent: „old" (textul EXACT de acum, unic în fișier) → „new". Preferă asta la fișiere mari — nu retrimiți tot fișierul.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } } },
  { type: 'function', function: { name: 'run', description: 'Rulează o comandă permisă: verificări (npm ci/build/test pe backend/frontend, git status/diff) SAU instalare de dependențe — `npm --prefix backend install <pachet>` / `npm --prefix frontend install <pachet>` — când ordinul cere o bibliotecă nouă (adaugă pachetul în package.json + lock).', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'finish', description: 'Termină lucrarea: dai titlul + corpul PR-ului (română). Cheam-o DOAR după build verde (și teste verzi pe backend dacă l-ai atins).', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } } },
  // ── UNELTELE GRELE (Adrian, 30 iul: „am cerut agenți full echipați și tu i-ai
  // dat doar ciurucuri" · „toate, trebuie echipat la full") ───────────────────
  // Avea dreptate: cu ls/grep/read/write/edit/run/finish poți scrie cod, dar nu
  // poți deschide un site și nu poți pune o cheie. Un ordin care cerea un portal
  // era IMPOSIBIL pentru el — și ar fi picat de trei ori, pe banii ownerului.
  // Acum le are, prin aplicație (`/api/constructor/tool`, aceeași poartă
  // x-bridge-secret): browserul e Playwright în procesul aplicației, iar
  // secretele se scriu criptat în repo.
  { type: 'function', function: { name: 'browser_open', description: 'Deschide un site REAL în browserul de pe server și îți întoarce textul paginii + elementele numerotate pe care poți da click.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browser_read', description: 'Recitește pagina deschisă (text + elemente numerotate).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'browser_click', description: 'Click pe elementul cu numărul dat, din pagina deschisă.', parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] } } },
  { type: 'function', function: { name: 'browser_type', description: 'Scrie text în câmpul cu numărul dat. submit=true apasă Enter după. NU scrie niciodată parole sau date de card.', parameters: { type: 'object', properties: { index: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['index', 'text'] } } },
  { type: 'function', function: { name: 'browser_scroll', description: 'Derulează pagina („down" sau „up").', parameters: { type: 'object', properties: { direction: { type: 'string' } }, required: ['direction'] } } },
  { type: 'function', function: { name: 'browser_key', description: 'Apasă o tastă/combinație în pagină (Enter, Tab, Escape, ArrowDown, Control+A).', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'browser_click_at', description: 'Click pe coordonatele x,y din pagină (1280×800), pentru ce nu apare în lista numerotată.', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'browser_back', description: 'Înapoi la pagina anterioară.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'browser_close', description: 'Închide browserul când ai terminat de navigat.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'secret_lista', description: 'Ce chei există în secretele repo-ului (DOAR numele — valorile nu le dă nimeni, prin construcție).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'secret_pune', description: 'Pune o cheie în secretele repo-ului, criptată. NU repeta niciodată valoarea în răspunsul tău, în PR sau într-un fișier — doar numele și lungimea.', parameters: { type: 'object', properties: { nume: { type: 'string' }, valoare: { type: 'string' } }, required: ['nume', 'valoare'] } } },
  { type: 'function', function: { name: 'secret_publica', description: 'Duce cheile pe serverul de producție și repornește aplicația ca să le încarce.', parameters: { type: 'object', properties: {} } } },
  // ȘI RESTUL — „toate, trebuie echipat la full" (Adrian, 30 iul). Baza de date
  // reală, sănătatea proprie și operațiile de pe server. Fără ele, un ordin care
  // cere „vezi ce e în tabelă" sau „repornește și verifică" era imposibil.
  { type: 'function', function: { name: 'db_tables', description: 'Vezi tabelele bazei de date de producție și forma lor.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'db_query', description: 'Interoghează baza de date de producție (SQL). Folosește-o ca să VERIFICI ce ai construit, pe date reale.', parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } } },
  { type: 'function', function: { name: 'system_health', description: 'Sănătatea aplicației: sincronizarea publicării (live vs master), rulări roșii, ordine picate, disc, bază de date, punga creierului.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_runbook', description: 'Operație pe server, dintr-o listă fixă: diagnostic, restart-app, restart-caddy, loguri-app, backup-db, publish-master, curata-zombi, sentinel-now.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'runbook_status', description: 'Starea rulărilor de operații pornite de tine.', parameters: { type: 'object', properties: { name: { type: 'string' } } } } },
  { type: 'function', function: { name: 'runbook_log', description: 'Jurnalul unei rulări de operație, după id.', parameters: { type: 'object', properties: { run_id: { type: 'number' } }, required: ['run_id'] } } },
  { type: 'function', function: { name: 'request_repair', description: 'Notează durabil un ordin de reparație pentru ce ai găsit și nu intră în lucrarea asta (nu se pierde, ajunge la owner).', parameters: { type: 'object', properties: { title: { type: 'string' }, details: { type: 'string' } }, required: ['title', 'details'] } } },
]

// Care unelte NU se execută aici, ci în aplicație (browser Playwright în proces,
// secrete criptate, baza de date, operațiile de pe server). Lista se DERIVĂ din
// TOOLS, ca să nu poată rămâne în urmă: uneltele locale sunt cele 7 de fișiere,
// tot restul trece prin `/api/constructor/tool`.
const UNELTE_LOCALE = new Set(['ls', 'grep', 'read', 'write', 'edit', 'run', 'finish'])
const UNELTE_PRIN_APLICATIE = new Set(
  TOOLS.map((t) => t.function.name).filter((n) => !UNELTE_LOCALE.has(n)),
)

const SYSTEM = `Ești CONSTRUCTORUL lui Kelionai — lucrătorul de cod autonom, pe serverul proiectului.
Repo: backend/ (Node+Fastify+TS), frontend/ (React+Vite+TS), deploy/ (scripturi VPS).

PROCEDURA (ține-o STRICT — bugetul de pași cu unelte e mic, ~24):
1. Primul tău mesaj: UN PLAN de o linie — ce fișier(e) modifici. Fără unealtă încă.
2. Găsește fișierul cu 'grep' (un pattern din ordin). NU explora cu ls/read pas cu pas.
3. Citește DOAR fișierul pe care-l modifici, și DOAR intervalul relevant (read cu from/to). Nu citi de două ori același fișier. NU citi AI-HANDOFF.md (e uriaș) decât dacă ordinul cere explicit arhitectura.
4. Modifică: 'edit' pe fișiere existente (dai textul vechi EXACT → textul nou) — e calea sigură, fiindcă răspunsul tău are plafon și un 'write' pe un fișier mare se taie la mijloc și strică fișierul. 'write' îl folosești la fișiere NOI sau mici.
5. Cheamă 'finish' IMEDIAT după ce ai scris. NU rula tu 'npm ci/build/test' — sistemul verifică singur după finish. Ținta: finish în ≤3 unelte după ce ai găsit fișierul.
   EXCEPȚIE — bibliotecă NOUĂ: dacă ordinul are nevoie de un pachet care nu există încă, rulează 'run' cu „npm --prefix backend install <pachet>" (sau frontend) ÎNAINTE de finish — așa package.json + lock rămân sincronizate și verificarea trece.

REGULILE CASEI:
- Rescrii curat modulul responsabil — fără petice band-aid; potrivește stilul din jur (comentarii în română).
- Schimbări STRICT în perimetrul ordinului — nimic „din zbor"; nu atingi contoare financiare, nu ștergi date.
- finish: titlu + corp de PR în română (ce, de ce). Dacă sistemul îți spune că buildul a picat, repari și re-finish (ai un număr mic de runde).`

// REZISTENT LA MODELELE GRATUITE (jobul #2, 27 iul, cauza reală din log:
// „Unexpected end of JSON input" — endpointul :free a întors corp gol/trunchiat
// la rate-limit și agentul crăpa pe r.json() fără nicio reîncercare). Acum:
// corp gol, JSON rupt, 429 sau 5xx → reîncearcă cu pauze crescătoare; abia
// după 4 încercări ratate jobul pică de-adevăratelea.
// FEREASTRA GLISANTĂ pe istoric (audit 27 iul — fixul care taie explozia
// pătratică de tokeni): rezultatele uneltelor mai vechi decât ultimele
// KEEP_VERBATIM se înlocuiesc cu un ciot de o linie. Contextul rămâne mic și
// aproape constant, indiferent câți pași durează jobul → merge și pe modelele
// gratuite (care se sufocau la request-uri uriașe). Mesajele system+ordin și
// apelurile de unealtă (assistant) rămân neatinse — doar CORPUL rezultatelor
// vechi (role:'tool') se comprimă, ca modelul să nu-și piardă firul.
function compactHistory(messages) {
  const toolIdx = []
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'tool') toolIdx.push(i)
  const cutoff = toolIdx.length - KEEP_VERBATIM
  for (let k = 0; k < cutoff; k++) {
    const i = toolIdx[k]
    const c = messages[i].content
    if (typeof c === 'string' && c.length > 120 && !c.startsWith('[rezultat vechi'))
      messages[i] = { ...messages[i], content: `[rezultat vechi elidat — ${c.length} caractere; cere din nou dacă îți trebuie]` }
  }
}

// SCARA DE MODELE GRATUITE (dovadă live 28 iul, ordinul #9: modelul configurat
// a primit 429 la FIECARE pas — „poolside/laguna-m.1:free is rate-limited" — și
// agentul a reîncercat același model până la plafonul de pași, fără să scrie o
// linie de cod; jobul a picat cu „plafon de pași atins fără finish"). Reîncercarea
// pe ACELAȘI model nu ajută când modelul e saturat: la a doua încercare eșuată
// TRECEM LA URMĂTORUL model gratuit. Toate au tools confirmat în catalog.
// SCARA, REFĂCUTĂ PE MĂSURĂTORI (28 iul, catalogul live OpenRouter + uptime pe
// 24h raportat de /models/{id}/endpoints). Trei lucruri au reieșit:
//   • `poolside/laguna-m.1:free` (modelul din env) are cel mai PROST uptime din
//     familia lui: 95,43% pe 24h, față de 99,9% la frații lui. De-aia primea
//     429 la fiecare pas. NU-l mai punem primul.
//   • Cele două trepte NVIDIA de dinainte NU erau două plase, ci UNA: ambele
//     rulează pe platforma NVIDIA (NVCF), deci `400 DEGRADED` le doboară
//     împreună. Ținem UNA singură pe scară, restul la alți furnizori.
//   • Modelele Poolside gratuite spun explicit că POT FOLOSI ce le trimiți ca
//     să se antreneze — iar constructorul le-ar trimite codul sursă al lui
//     Adrian. Fără acordul lui explicit, NU le folosim, oricât ar fi de bune la
//     cod. Decizia îi aparține; până atunci scara ocolește Poolside.
// Rezultat: patru furnizori DIFERIȚI (NVIDIA, Cohere, Novita, Google), ca o
// pană la unul să nu însemne pană la toți.
const MODEL_LADDER = [
  'nvidia/nemotron-3-super-120b-a12b:free', // 262k ctx, 262k out, uptime 99,70%
  'cohere/north-mini-code:free', // agent de cod dedicat, alt furnizor, 96,79%
  'inclusionai/ling-3.0-flash:free', // Novita, cel mai bun uptime măsurat: 99,97%
  'google/gemma-4-31b-it:free', // Google AI Studio, 99,77% — plasă de final
].filter((m, i, a) => m && a.indexOf(m) === i)
// Modelul din env intră pe scară DOAR dacă nu e unul dovedit prost. Așa, o
// setare veche în kelionai.env nu mai poate readuce boala pe treapta întâi.
const MODELE_DOVEDIT_PROASTE = new Set([
  'poolside/laguna-m.1:free', // 95,43% uptime, 429 la fiecare pas (dovadă live)
  'nvidia/nemotron-nano-12b-v2-vl:free', // status -2 în catalog: degradat ACUM
])
if (MODEL && !MODEL_LADDER.includes(MODEL) && !MODELE_DOVEDIT_PROASTE.has(MODEL)) MODEL_LADDER.unshift(MODEL)
// ── ESCALADAREA ÎN SUS, PE NEPUTINȚĂ (Adrian, 30 iul: „de ce nu se escaladează
// pe model potențial? automat") ──────────────────────────────────────────────
// Scara de mai sus e LATERALĂ: patru modele GRATUITE, între care ne rotim când
// unul dă 429 sau moare. Escalada pe PANĂ DE FURNIZOR exista. Escalada pe
// NEPUTINȚĂ — nu. Dacă toate patru povestesc în loc să lucreze, se roteau între
// ele la nesfârșit și ordinul murea cu „modelul nu folosește uneltele", iar
// cerința ownerului rămânea nefăcută.
//
// Acum: gratuit ÎNTÂI, mereu. Dar când gratuitul a DOVEDIT că nu poate — ture
// sterile epuizate, sau rundele de reparație terminate — urcăm O SINGURĂ DATĂ
// pe un model capabil, plătit, pentru ordinul ăsta.
//
// De ce e apărat și de regula din 27 iul („doar gratuit, să nu mai ardă bani"):
// atunci constructorul rula PLĂTIT LA FIECARE RULARE. Aici se plătește doar
// acolo unde gratuitul a picat deja, o dată per ordin, cu motivul scris în
// jurnal și în PR. Se stinge cu CONSTRUCTOR_ESCALADARE=0.
const MODEL_CAPABIL = env.CONSTRUCTOR_MODEL_CAPABIL || 'anthropic/claude-sonnet-5'
const ESCALADARE_ON = env.CONSTRUCTOR_ESCALADARE !== '0'
let escaladat = false
let modelIdx = 0

// ── NIVELUL DE DIFICULTATE ALEGE MÂNA, DE LA ÎNCEPUT ─────────────────────────
// Adrian, 30 iul: „nu, în sus, pe 200" · „pe nivel de dificultate setabil
// automat pe cerință".
//
// Escaladarea DUPĂ eșec (mai jos) rămâne ca plasă, dar e prea târziu ca regulă:
// o sarcină grea pornită pe un model mic arde 8 ture povestind, apoi urcă — cu
// jumătate din buget deja pierdut. Corect e să pornească direct pe mâna
// potrivită.
//
// Ordinul poartă cu el o linie „NIVEL DE DIFICULTATE: N/5", pusă de cine îl
// scrie (bucla autonomă o cere creierului odată cu evaluarea variantelor). De
// aici alegem scara:
//   1-2  banal / simplu   → doar gratuite (o redenumire nu merită bani)
//   3    mediu            → model mediu în cap, gratuitele ca plasă
//   4-5  greu / foarte greu → modelul mare în cap, apoi mediu, apoi gratuitele
//
// Dacă un model plătit nu există în catalog, logica de „model mort" îl scoate
// și rămânem pe gratuite — deci o setare greșită degradează, nu blochează.
const MODEL_GREU = env.CONSTRUCTOR_MODEL_GREU || 'anthropic/claude-opus-5'
const MODEL_MEDIU = env.CONSTRUCTOR_MODEL_MEDIU || 'anthropic/claude-sonnet-5'

/** Citește nivelul din textul ordinului. Fără marcaj → 3 (mediu): mai bine
 *  pornim cu o mână bună decât să ardem bugetul descoperind că era greu. */
function nivelDinOrdin(text) {
  const m = /NIVEL DE DIFICULTATE:\s*(\d)/i.exec(String(text ?? ''))
  const n = m ? Number(m[1]) : 3
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3))
}

/** Pune în capul scării mâna potrivită nivelului. Gratuitele rămân dedesubt,
 *  ca plasă — deci nici la nivel 5 nu rămânem fără opțiuni dacă plătitul pică. */
function pregatesteScaraPentruNivel(nivel) {
  const sus = nivel >= 4 ? [MODEL_GREU, MODEL_MEDIU] : nivel === 3 ? [MODEL_MEDIU] : []
  for (const m of [...sus].reverse()) {
    if (m && !MODEL_LADDER.includes(m)) MODEL_LADDER.unshift(m)
  }
  modelIdx = 0
  log(
    `nivel de dificultate ${nivel}/5 → pornesc pe „${modelCurent()}"` +
      (sus.length ? ` (plătit, ales de dificultate; gratuitele rămân ca plasă)` : ` (gratuit — sarcina nu cere mai mult)`),
  )
}
// Modele scoase din joc pentru rularea asta (nu există, n-au unelte, au context
// prea mic) — nu le mai atingem, ca rotația să nu ne întoarcă la ele.
const modeleMoarte = new Set()
const modelCurent = () => MODEL_LADDER[modelIdx % MODEL_LADDER.length]
// ROTAȚIE, nu coborâre într-un sens. Vechiul cod făcea „if (modelIdx < len-1)
// modelIdx++": ajuns pe ULTIMA treaptă rămânea acolo pentru tot restul rulării
// și reîncerca la infinit exact modelul care tocmai picase — adică fix boala pe
// care scara trebuia s-o vindece. Acum ne rotim circular și sărim peste cele
// moarte; primul model are timp să-și revină din rate-limit până revenim la el.
function treciLaUrmatorulModel() {
  for (let i = 1; i <= MODEL_LADDER.length; i++) {
    const idx = (modelIdx + i) % MODEL_LADDER.length
    if (!modeleMoarte.has(MODEL_LADDER[idx])) {
      modelIdx = idx
      return true
    }
  }
  return false // toată scara e moartă
}

/** URCĂ pe modelul capabil, o singură dată per ordin, când gratuitul a DOVEDIT
 *  că nu poate duce sarcina. Întoarce `true` dacă am urcat — atunci apelantul
 *  NU aruncă eroarea, ci mai încearcă o dată, cu mâna bună. */
function escaladeazaPeNeputinta(motiv) {
  if (!ESCALADARE_ON || escaladat) return false
  escaladat = true
  // Îl punem în capul scării și mergem pe el ACUM. Dacă modelul nu există în
  // catalog, logica de „model mort" existentă îl scoate și ne întoarce pe
  // gratuite — deci o setare greșită degradează, nu blochează.
  MODEL_LADDER.unshift(MODEL_CAPABIL)
  modelIdx = 0
  // NU atingem `pasiSterili` de aici: e declarat în main(), iar un modul ES e în
  // mod strict — o atribuire din afară ar arunca ReferenceError exact în clipa
  // escaladării, adică fix când aveam nevoie de ea. Îl resetează apelantul.
  log(
    `ESCALADEZ pe model capabil (${MODEL_CAPABIL}): ${motiv}. ` +
      `Gratuitul a dovedit că nu poate — de-acum se plătește, o singură dată pe ordinul ăsta. ` +
      `Se stinge cu CONSTRUCTOR_ESCALADARE=0.`,
  )
  return true
}

// CLASIFICAREA ERORILOR OPENROUTER (dovadă live 28 iul, ordinul #13: a murit
// INSTANT cu „OpenRouter 400: Provider returned error … DEGRADED function
// cannot be invoked", provider_name „Nvidia"). Regula veche — „429/5xx =
// tranzitoriu, ORICE 4xx = fatal" — a omorât ordinul deși aveam încă 3 modele
// neîncercate pe scară: ăla NU era un request greșit de-al nostru, era
// FURNIZORUL lor picat. Dar nici invers nu e bine (a reîncerca orb orice 400
// ne-ar arde scara pe o cerere stricată). Deci despărțim clar trei familii:
//   'furnizor' — e stricat la ei ACUM (Provider returned error, DEGRADED,
//                supraîncărcat, 429, 5xx) → alt model de pe scară, ordinul trăiește;
//   'model'    — cererea noastră e bună, dar MODELUL ăsta n-o poate duce (nu
//                există, n-are endpoint, n-are unelte, context prea mic) → alt
//                model ȘI îl marcăm mort pentru rularea asta;
//   'fatal'    — e vina NOASTRĂ sau a contului (401/403 cheie, 402 fără credit,
//                corp malformat) → niciun model nu ajută, ne oprim pe loc.
const RE_FURNIZOR =
  /provider returned error|degraded|upstream|overload|capacity|temporarily|unavailable|rate.?limit|try again|timed? ?out|bad gateway|service unavailable|internal server error/i
const RE_MODEL =
  /not a valid model|invalid model|model not found|no endpoints|no allowed providers|no providers|does not support|not supported|tool.?call|maximum context|context.?length|max_tokens|too many tokens|prompt is too long/i
function clasificaEroare(status, text) {
  const t = String(text ?? '')
  if (status === 401 || status === 402 || status === 403) return 'fatal' // cheie/credit — scara nu ajută
  if (status === 429 || status === 408 || status === 409) return 'furnizor'
  if (status >= 500) return 'furnizor'
  if (status === 404) return 'model' // ruta/modelul nu există la ei
  if (status === 400 || status === 422) {
    if (RE_FURNIZOR.test(t)) return 'furnizor'
    if (RE_MODEL.test(t)) return 'model'
    return 'fatal' // 400 neclasificat = presupunem că e cererea noastră; nu ardem scara
  }
  return 'furnizor'
}

const LLM_ATTEMPTS = Math.max(6, MODEL_LADDER.length * 2)

async function llm(messages) {
  let lastErr = ''
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    const model = modelCurent()
    if (ramase() <= 0) throw Object.assign(new Error('bugetul de timp al rulării s-a terminat'), { fatal: true })
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ORKEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 16_000 }),
        // Fără plafon, un endpoint :free care atârnă ținea agentul blocat până
        // la `timeout 1800` din worker — adică moarte fără raport.
        signal: AbortSignal.timeout(Math.max(30_000, Math.min(180_000, ramase()))),
      })
      const text = await r.text()
      if (!r.ok) {
        lastErr = `OpenRouter ${r.status}: ${text.slice(0, 300)}`
        const clasa = clasificaEroare(r.status, text)
        // Familia intră ÎN JURNAL (deci în emailul de eșec): la următoarea
        // cădere se vede din prima dacă a fost vina lor, a treptei sau a
        // noastră — fără să mai reconstituim cauza din text brut.
        if (clasa === 'fatal') {
          log(`llm [fatal, ${model}] — e cererea/contul nostru, scara nu ajută: ${lastErr.slice(0, 200)}`)
          throw Object.assign(new Error(lastErr), { fatal: true })
        }
        throw Object.assign(new Error(lastErr), { clasa })
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
      const clasa = e?.clasa ?? 'furnizor'
      // 'model' = treapta asta nu poate duce cererea noastră niciodată în
      // rularea asta (nu există / n-are unelte / context prea mic) → o scoatem
      // definitiv din rotație, ca să nu ne întoarcem la ea peste două ture.
      if (clasa === 'model') modeleMoarte.add(model)
      if (attempt === LLM_ATTEMPTS) break
      const maiAvem = treciLaUrmatorulModel()
      if (!maiAvem)
        throw Object.assign(new Error(`toate modelele gratuite de pe scară sunt inutilizabile — ultima eroare: ${lastErr}`), {
          fatal: true,
          // Nu e vina ordinului: furnizorii gratuiți sunt sugrumați ACUM.
          // main() amână ordinul (rămâne în coadă) în loc să-l declare mort.
          amanabil: true,
        })
      // Când chiar SCHIMBĂM modelul, pauza n-are rost (nu el e saturat) — 2s.
      // Când scara are o singură treaptă bună, revenim la pauze crescătoare.
      const schimbat = modelCurent() !== model
      const wait = schimbat ? 2_000 : Math.min(attempt * 8_000, 30_000)
      log(
        `llm încercarea ${attempt}/${LLM_ATTEMPTS} a picat pe ${model} [${clasa}] (${lastErr.slice(0, 100)}) — ` +
          `trec pe ${modelCurent()} în ${wait / 1000}s`,
      )
      await dormi(wait)
    }
  }
  // La capătul tuturor încercărilor: dacă ultima eroare e sugrumare de furnizor
  // (429/rate-limit/DEGRADED), marcăm amânabil — ordinul nu moare, se reia.
  throw Object.assign(new Error(lastErr || `OpenRouter indisponibil după ${LLM_ATTEMPTS} încercări`), {
    amanabil: /429|rate.?limit|ResourceExhausted|DEGRADED function|Provider returned error/i.test(lastErr),
  })
}

// VERIFICAREA ATELIERULUI — ce s-a atins trebuie să compileze. Întoarce '' dacă
// e curat, altfel TEXTUL problemei: îl dăm înapoi modelului pentru o rundă de
// reparație, în loc să omorâm ordinul din prima (vezi bucla din main()).
function verificaAtelierul() {
  const changed = sh('git status --porcelain').trim()
  if (!changed) return 'finish fără nicio modificare de fișier — nu ai scris nimic în atelier.'
  const touchedBackend = /(^|\n).{3}backend\//.test(changed)
  const touchedFrontend = /(^|\n).{3}frontend\//.test(changed)
  // `git diff --stat` NU vede fișierele noi (netrăcite) — logăm și starea brută,
  // altfel un ordin care doar adaugă fișiere apare în jurnal ca „fără modificări".
  log(`modificări:\n${(sh('git diff --stat').trim() || changed).slice(-1500)}`)
  // DEPENDENȚE NOI (Etapa 5): dacă ordinul a schimbat package.json (a adăugat o
  // bibliotecă), `npm ci` ar pica („package.json și package-lock.json out of
  // sync"). Atunci instalăm cu `npm install` — care aduce pachetul ȘI aduce
  // package-lock.json la zi; lock-ul actualizat intră în PR, deci publicarea în
  // producție (care rulează `npm ci`) merge. Fără schimbare de package.json,
  // rămânem pe `npm ci` (reproductibil din lock).
  const backendDeps = /(^|\n).{3}backend\/package(-lock)?\.json/.test(changed)
  const frontendDeps = /(^|\n).{3}frontend\/package(-lock)?\.json/.test(changed)
  const verify = []
  if (touchedBackend) verify.push(backendDeps ? 'npm --prefix backend install' : 'npm --prefix backend ci', 'npm --prefix backend run build', 'npm --prefix backend test')
  if (touchedFrontend) verify.push(frontendDeps ? 'npm --prefix frontend install' : 'npm --prefix frontend ci', 'npm --prefix frontend run build')
  for (const cmd of verify) {
    log(`verific: ${cmd}`)
    const out = toolRun(cmd)
    if (/^EȘEC/.test(out)) return `verificarea a picat la „${cmd}":\n${out.slice(-2000)}`
  }
  return ''
}

// DESCHIDEREA PR-ULUI, rezistentă. Două capcane reale pe drumul ăsta:
// (1) ordinele se REIAU (claimNextBuildJob repune joburile înțepenite, până la
//     3 încercări) — dar ramura e mereu `kelion/job-N`, deci a doua oară GitHub
//     întoarce 422 „A pull request already exists". Codul vechi arunca „PR-ul
//     nu s-a deschis" și marca ordinul EȘUAT, deși codul era împins și PR-ul
//     exista deja. Acum îl regăsim după ramură și-l refolosim.
// (2) un 5xx/o pică de rețea la GitHub arunca la fel de definitiv — acum se
//     reîncearcă de câteva ori.
async function deschidePR(titlu, corp, branch) {
  const owner = REPO.split('/')[0]
  const headers = { Authorization: `Bearer ${GHTOKEN}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json' }
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    let status = 0
    let body = null
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: titlu, head: branch, base: 'master', body: corp }),
        signal: AbortSignal.timeout(60_000),
      })
      status = r.status
      body = await r.json().catch(() => null)
    } catch (e) {
      lastErr = String(e?.message ?? e)
      await dormi(attempt * 5_000)
      continue
    }
    if (body?.html_url) return body.html_url
    lastErr = `GitHub ${status}: ${JSON.stringify(body).slice(0, 300)}`
    if (status === 422) {
      const existent = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open&head=${owner}:${branch}`, { headers })
        .then((x) => x.json())
        .catch(() => null)
      const url = Array.isArray(existent) ? existent[0]?.html_url : null
      if (url) {
        log(`PR-ul pentru ${branch} exista deja — îl refolosesc`)
        return url
      }
      throw new Error(`PR-ul nu s-a deschis: ${lastErr}`) // 422 real (ex. „No commits between…")
    }
    if (status < 500) throw new Error(`PR-ul nu s-a deschis: ${lastErr}`)
    await dormi(attempt * 5_000)
  }
  throw new Error(`PR-ul nu s-a deschis după 4 încercări: ${lastErr}`)
}

// DOVADA INDEPENDENTĂ (Etapa 6): „Gata" nu mai e pe cuvântul lucrătorului —
// după PR, CI-ul (workflow-ul pr-verify) re-rulează build+teste pe o MAȘINĂ
// CURATĂ. PUR (fără rețea): din răspunsul GitHub /check-runs alege checkul
// „verify" și dă verdictul. Ținut separat + exportat ca să poată fi PROBAT.
export function verdictDinCheckRuns(json, nume = 'verify') {
  const runs = Array.isArray(json?.check_runs) ? json.check_runs : []
  const r = runs.find((x) => x?.name === nume)
  if (!r) return 'absent'
  if (r.status !== 'completed') return 'pending'
  return r.conclusion === 'success' ? 'success' : 'failure'
}

// Așteaptă checkul „verify" pe commit-ul PR-ului, mărginit de un termen (nu poate
// depăși bugetul de timp al rulării — un job NU devine demon). Întoarce
// 'success' | 'failure' | 'timeout'.
async function asteaptaVerificareCI(sha, deadlineMs) {
  const headers = { Authorization: `Bearer ${GHTOKEN}`, Accept: 'application/vnd.github+json' }
  let ultim = 'absent'
  while (Date.now() < deadlineMs) {
    let json = null
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs`, { headers, signal: AbortSignal.timeout(15_000) })
      json = await r.json().catch(() => null)
    } catch {
      /* rețea — reîncerc la următoarea tură */
    }
    const v = verdictDinCheckRuns(json, 'verify')
    ultim = v
    if (v === 'success' || v === 'failure') return v
    await dormi(15_000)
  }
  return ultim === 'failure' ? 'failure' : ultim === 'success' ? 'success' : 'timeout'
}

// RAPORTUL DE AVARIE LA OMORÂRE. `timeout 1800` din constructor-worker.sh ne
// trimite SIGTERM; fără handler mureau mut, iar ordinul rămânea „running" 40 de
// minute în DB și mai ardea o încercare din trei. Acum apucăm să raportăm.
let raportCurent = null
let seInchide = false
for (const semnal of ['SIGTERM', 'SIGINT']) {
  process.on(semnal, () => {
    if (seInchide) return
    seInchide = true
    log(`primit ${semnal} (timeout dur?) — raportez eșecul înainte să ies`)
    const plasa = setTimeout(() => process.exit(1), 20_000)
    Promise.resolve(raportCurent ? raportCurent('failed', {}, 3) : null)
      .catch(() => {})
      .finally(() => {
        clearTimeout(plasa)
        process.exit(1)
      })
  })
}

async function main() {
  if (!BRIDGE || !ORKEY || !GHTOKEN) {
    log('lipsesc BRIDGE_SECRET/OPENROUTER_API_KEY/GITHUB_TOKEN din kelionai.env — ies')
    return
  }
  const claim = await api('/api/constructor/next')
  if (!claim?.job) return // coada goală sau pauza-autonomie — tăcere totală
  beatJobId = Number(claim.job.id) || 0 // de-acum log() trimite pasul pe monitor
  const job = claim.job
  log(`ordin #${job.id} (încercarea ${job.attempts}): ${job.orderText.slice(0, 160)}`)
  // MÂNA POTRIVITĂ, DE LA ÎNCEPUT — după cât de grea e sarcina, nu după ce a
  // eșuat deja o dată (Adrian: „pe nivel de dificultate setabil automat pe
  // cerință"). Se face AICI, nu la încărcarea modulului, fiindcă nivelul vine
  // din ordinul pe care tocmai l-am luat.
  pregatesteScaraPentruNivel(nivelDinOrdin(job.orderText))

  // `tries` mai mic la închiderea forțată: handlerul de SIGTERM are doar ~20s
  // până ne omorâm singuri, deci acolo nu ne permitem cele 8 reîncercări.
  const report = (status, extra = {}, tries = 8) =>
    api(
      '/api/constructor/report',
      { method: 'POST', body: JSON.stringify({ id: job.id, status, log: logLines.join('\n'), ...extra }) },
      tries,
    )
  raportCurent = report // ca handlerul de SIGTERM să poată raporta eșecul

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
    // CONTABILITATEA PAȘILOR (dovadă live 28 iul, ordinul #9: „EȘEC: plafon de
    // pași atins fără finish" după ~30 de ture în care nu s-a produs nicio
    // reparație). Bucla veche socotea O TURĂ = UN PAS, indiferent dacă modelul
    // a atins vreo unealtă: vorbăria, unealta inexistentă, comanda nepermisă,
    // calea greșită — toate mâncau din bugetul de CONSTRUCȚIE exact ca o
    // modificare reală de fișier. Așa se termina bugetul fără o linie de cod
    // scrisă. Acum plătim doar munca: pașii utili (cel puțin o unealtă care a
    // lucrat) au plafonul MAX_STEPS, iar turele sterile au plafonul lor, mic —
    // ca să ieșim repede ȘI CU DIAGNOSTIC dacă modelul nu știe uneltele.
    let pasiUtili = 0
    let pasiSterili = 0
    let reparatii = 0
    // Rezultate care înseamnă „unealta a REFUZAT", nu „unealta a lucrat".
    const RE_REFUZ = /^(EROARE|REFUZAT|unealtă necunoscută|comandă nepermisă|pattern gol)/
    // BUCLA MARE = ordinul întreg, cu rundele lui de reparație. Bucla mică
    // (while) = dialogul cu modelul până la 'finish'; după fiecare finish
    // verificăm în atelier și, dacă e roșu, ne întoarcem aici cu eroarea în mână.
    for (;;) {
      while (!finish) {
        if (pasiUtili >= MAX_STEPS)
          throw new Error(`plafon de pași atins fără finish (${pasiUtili} pași cu unelte, ${pasiSterili} sterili)`)
        // NEPUTINȚĂ DOVEDITĂ: modelul povestește în loc să lucreze. Înainte
        // muream aici, cu cerința ownerului nefăcută. Acum urcăm o dată pe
        // modelul capabil — și abia dacă și ăla nu poate, ne oprim.
        if (pasiSterili >= MAX_STERILE) {
          if (escaladeazaPeNeputinta(`${pasiSterili} ture fără nicio unealtă validă pe ${modelCurent()}`)) {
            pasiSterili = 0 // mâna nouă pornește cu contorul curat
          } else {
            throw new Error(
              `modelul nu folosește uneltele: ${pasiSterili} ture fără nicio unealtă validă (ultimul model: ${modelCurent()})`,
            )
          }
        }
        // Ne oprim ÎNAINTE de `timeout 1800` din constructor-worker.sh, ca să mai
        // rămână timp de verificare + push + PR + RAPORT. Omorâți de timeout am
        // muri muți, iar ordinul ar rămâne „running" 40 de minute și ar arde o
        // încercare din trei degeaba.
        if (ramase() < 6 * 60_000)
          throw new Error(`timpul rulării s-a terminat înainte de finish (${pasiUtili} pași utili, ${pasiSterili} sterili)`)
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
          // modelul a vorbit fără unealtă — îl împingem înapoi la lucru. Tură
          // STERILĂ: nu scade din bugetul de construcție, are contorul ei.
          pasiSterili++
          messages.push({
            role: 'user',
            content: `Continuă cu uneltele (grep/read/edit/write/run) sau cheamă finish. Nu povesti — lucrează. (${pasiSterili}/${MAX_STERILE} ture irosite)`,
          })
          compactHistory(messages)
          continue
        }
        let aLucrat = false
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
            else if (c.function.name === 'grep') result = toolGrep(String(args.pattern ?? ''))
            else if (c.function.name === 'read') result = toolRead(String(args.path ?? ''), Number(args.from), Number(args.to))
            else if (c.function.name === 'write') result = toolWrite(String(args.path ?? ''), String(args.content ?? ''))
            else if (c.function.name === 'edit') result = toolEdit(String(args.path ?? ''), String(args.old ?? ''), String(args.new ?? ''))
            else if (c.function.name === 'run') result = toolRun(String(args.cmd ?? ''))
            else if (c.function.name === 'finish') {
              finish = { title: String(args.title ?? '').slice(0, 120), body: String(args.body ?? '') }
              result = 'lucrarea se închide — verific și public'
            } else if (UNELTE_PRIN_APLICATIE.has(c.function.name)) {
              // UNELTELE GRELE: trăiesc în aplicație (browser Playwright în
              // proces + scrierea criptată a secretelor). Le chemăm prin aceeași
              // poartă x-bridge-secret ca restul capătului de lucrător, cu
              // aceleași reîncercări la 5xx — deci o repornire a aplicației nu
              // omoară un ordin în lucru.
              const r = await api('/api/constructor/tool', {
                method: 'POST',
                body: JSON.stringify({ name: c.function.name, args }),
              })
              result = r?.rezultat ?? 'aplicația nu a răspuns la unealtă'
            } else result = 'unealtă necunoscută'
          } catch (e) {
            result = `EROARE: ${e.message}`
          }
          // Unealta care a REFUZAT (cale greșită, comandă nepermisă, write tăiat)
          // nu e progres — tura rămâne sterilă și nu costă buget de construcție.
          if (!RE_REFUZ.test(result)) aLucrat = true
          if (c.function.name !== 'read')
            log(
              `pas ${pasiUtili + 1}/${MAX_STEPS}: ${c.function.name} ${String(args.path ?? args.cmd ?? args.dir ?? args.pattern ?? '').slice(0, 80)}` +
                (RE_REFUZ.test(result) ? ` → ${result.slice(0, 90)}` : ''),
            )
          // Plafon per-rezultat mic (era 100k — sursa exploziei de context).
          messages.push({ role: 'tool', tool_call_id: c.id, content: result.slice(0, READ_CAP) })
        }
        if (aLucrat) pasiUtili++
        else pasiSterili++
        // FEREASTRA GLISANTĂ (fixul structural, audit 27 iul): comprimă
        // rezultatele uneltelor VECHI la un ciot de o linie — modelul păstrează
        // firul (ce a făcut) fără să care conținutul integral al fiecărei citiri
        // pe veci. Doar ultimele KEEP_VERBATIM rezultate rămân întregi.
        compactHistory(messages)
      }

      // VERIFICAREA NOASTRĂ, nu pe încredere: ce s-a atins trebuie să compileze.
      const problema = verificaAtelierul()
      if (!problema) break
      // RUNDA DE REPARAȚIE. System promptul îi promite modelului: „dacă sistemul
      // îți spune că buildul a picat, repari și re-finish" — dar codul vechi NU
      // dădea niciodată runda aia: la primul build roșu arunca direct și ordinul
      // ieșea EȘUAT. Un model gratuit greșește un import sau un tip la prima
      // scriere; asta singură explică o parte din ordinele picate „end-to-end".
      // Mărginită: MAX_REPAIR runde ȘI doar dacă mai avem timp de încă un ciclu
      // complet de npm ci/build/test (altfel murim la timeout, fără raport).
      // A DOUA NEPUTINȚĂ DOVEDITĂ: a scris cod, dar nu poate să-l facă să treacă
      // verificarea, nici după rundele de reparație. Mai dăm o șansă, cu mâna
      // bună — dar numai dacă mai avem timp de un ciclu complet de verificare.
      if (reparatii >= MAX_REPAIR && ramase() >= 10 * 60_000 && escaladeazaPeNeputinta('rundele de reparație s-au terminat, verificarea tot roșie')) {
        reparatii = 0
      } else if (reparatii >= MAX_REPAIR || ramase() < 10 * 60_000) {
        throw new Error(problema)
      }
      reparatii++
      finish = null
      log(`verificarea a picat — runda de reparație ${reparatii}/${MAX_REPAIR}`)
      messages.push({
        role: 'user',
        content: `VERIFICAREA A PICAT în atelier. Repară CAUZA (nu peticește) și cheamă din nou 'finish'.\n\n${problema.slice(-3000)}`,
      })
      compactHistory(messages)
    }

    const branch = `kelion/job-${job.id}`
    // Titlu gol = `git commit -m ""` refuză commit-ul („Aborting commit due to
    // empty commit message") și ordinul pica după ce toată munca era făcută.
    const titlu = (finish.title || '').trim() || `Ordin #${job.id} — modificare automată`
    sh(`git checkout -B ${branch}`)
    sh('git add -A')
    execFileSync('git', ['-c', 'user.name=Kelion Constructor', '-c', 'user.email=contact@kelionai.app', 'commit', '-m', titlu], { cwd: ATELIER, stdio: 'pipe' })
    execFileSync('git', ['push', '-u', 'origin', branch, '--force'], { cwd: ATELIER, stdio: 'pipe', timeout: 60_000 })
    const headSha = sh('git rev-parse HEAD').trim()
    log(`ramura ${branch} împinsă`)

    const prUrl = await deschidePR(
      titlu,
      `${finish.body}\n\n---\nOrdin #${job.id} · construit automat de Constructorul lui Kelion (bază ${baseSha}, verificare build/teste în atelier). Merge-ul îl dă ownerul.`,
      branch,
    )
    log(`PR deschis: ${prUrl} (tokeni: ${tokens})`)

    // VERIFICARE INDEPENDENTĂ (Etapa 6): aștept CI-ul pe PR, mărginit de bugetul
    // rămas (las 60s tampon ca să apuc să raportez înainte de timeout-ul dur).
    // Doar dacă mai am timp real — altfel „Gata" cu ci:'în curs' (atelierul
    // trecuse deja build+teste), fără să blochez sau să mint.
    let ci = 'în curs'
    const timpCI = Math.min(ramase() - 60_000, 9 * 60_000)
    if (timpCI > 45_000) {
      log('aștept verificarea independentă (CI) pe PR…')
      const v = await asteaptaVerificareCI(headSha, Date.now() + timpCI)
      ci = v === 'success' ? 'verde' : v === 'failure' ? 'roșu' : 'în curs'
      log(`CI: ${ci}`)
    }
    if (ci === 'roșu') {
      // CI a picat pe o mașină curată deși atelierul trecuse — NU declar „Gata"
      // fals. Raportez eșec cu dovada, ca ownerul să nu dea merge pe roșu.
      await report('failed', { branch, prUrl, tokens, ci, log: `${logLines.join('\n')}\n\nVerificarea independentă (CI) a picat pe PR (commit ${headSha.slice(0, 7)}).` })
    } else {
      await report('done', { branch, prUrl, tokens, ci })
    }
  } catch (e) {
    // AMÂNARE, NU MOARTE (dovadă live 28 iul, ordinele #9-#13: toate au picat pe
    // sugrumarea furnizorilor gratuiți — 429 „free-models-per-min", Nvidia
    // „DEGRADED" — iar #14, IDENTIC ca natură, a reușit o oră mai târziu când
    // cotele s-au eliberat). Când vina e a furnizorilor, NU raportăm eșec:
    // ordinul rămâne „running" iar coada îl reia singură după 40 min (până la 3
    // încercări — mecanismul existent din claimNextBuildJob). Fără email de
    // eșec fals, fără ordin îngropat degeaba.
    const amanabil =
      e?.amanabil || /429|rate.?limit|ResourceExhausted|DEGRADED function|Provider returned error/i.test(String(e?.message ?? ''))
    if (amanabil && Number(job.attempts) < 3) {
      log(
        `AMÂNAT (nu eșuat): furnizorii gratuiți sunt sugrumați (${String(e.message).slice(0, 120)}) — ` +
          'ordinul rămâne în coadă și se reia automat în ~40 min',
      )
      // PAUZA SE VEDE (D6). Fără rândul ăsta, panoul rămânea pe „Lucrează" cu
      // ultimul pas înghețat pe ecran 40 de minute — imposibil de deosebit de
      // un ordin blocat. Marcajul „⏳" îl citește interfața și schimbă insigna.
      beat('⏳ Furnizorii gratuiți sunt sugrumați acum. Ordinul NU e pierdut — se reia automat în ~40 min.', true)
      return
    }
    log(`EȘEC: ${e.message}`)
    await report('failed', {})
  }
}

// Rulează bucla DOAR când fișierul e pornit ca script (node constructor-agent.mjs
// pe VPS). La import (proba gărzii de comenzi din classifyRunCommand) nu pornim
// agentul — doar folosim funcțiile pure.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('constructor-agent fatal:', e)
    process.exit(1)
  })
}
