#!/usr/bin/env node
// ── CONSTRUCTORUL LUI KELION — agentul de construcție de pe VPS ─────────────
// (Adrian, 27 iul: „Kelion trebuie să poată crea orice soft îi cere admin,
// orice modificare, orice îmbunătățire".)
//
// CE FACE: ia UN ordin din coadă (API-ul aplicației, auth x-bridge-secret),
// clonează repo-ul proaspăt în ATELIER (/root/kelion/atelier), lasă MOTORUL AIDER
// (pe creierul LOCAL Ollama de pe VPS — owner 16 aug: „la constructor nu e gemeni…
// Aider pe un model LOCAL pe VPS (Ollama)") să exploreze/scrie/repare, impune
// cele 7 porți verzi, apoi împinge ramura și deschide PR-ul. Constructorul își
// PUNE SINGUR creierul local pe VPS dacă lipsește (asiguraCreierulLocal — fără
// SSH). Merge-ul rămâne la Adrian.
// (La eșec de FURNIZOR ordinul se AMÂNĂ onest, rămâne în coadă și se reia
// automat — nu cade pe alt creier și nu inventează succes.)
//
// DE CE E JOB, NU DEMON: ecosistemul vechi (bridge/builder, procese claude
// permanente) ardea abonamentul și a produs phantom-deploy-uri — vezi
// AI-HANDOFF §6. Aici: pornit de cron, flock (unul singur), timeout dur din
// constructor-worker.sh, plafoane de pași și tokeni. Se termină și moare.
//
// PLAFOANE (env, cu valori implicite): CONSTRUCTOR_MAX_REPAIR și
// CONSTRUCTOR_BUDGET_MS. Watchdog-urile Aider au plafoane separate pentru
// execuția free, escaladarea paid și intervalul de după primul commit.
import { execSync, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ENVFILE = '/root/kelion/kelionai.env'
const ATELIER = '/root/kelion/atelier'
const APP = 'http://127.0.0.1:8080'
const REPO = 'kelion-team/kelionai'

export function caleAskpassConstructor(atelier = ATELIER) {
  return path.join(path.dirname(atelier), 'constructor-git-askpass.sh')
}

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
const GHTOKEN = env.GITHUB_TOKEN ?? ''
// PATH-ul CRON-ului e minimal (de regulă doar /usr/bin:/bin) și NU conține
// /usr/local/bin (unde setup-ollama.sh leagă `aider` și `ollama`) sau ~/.local/bin
// (unde ajung pip --user / pipx). MĂSURAT 16 aug, în constructor.log de pe gazdă:
// ordinele #367–#370 erau AMÂNATE la poarta creierului fiindcă `aider`/`ollama`
// păreau „lipsă" deși erau instalate — cron-ul pur și simplu nu le vedea pe PATH.
// Lărgim PATH-ul o SINGURĂ dată, aici, ca TOATE apelurile (probele ȘI lansarea
// reală a lui aider prin spawn, care moștenește process.env) să le găsească.
process.env.PATH = `${process.env.PATH || '/usr/bin:/bin'}:/usr/local/bin:${process.env.HOME || '/root'}/.local/bin`
// ── CREIERUL CONSTRUCTORULUI = MODEL LOCAL PE VPS (Ollama) ──────────────────────
// Owner, 16 aug: „la constructor nu e gemeni idiotule… e doar aider si cu openhands
// ca si completare… Aider pe un model LOCAL pe VPS (Ollama)… pe serverul linux si de
// acolo sa lucreze aider". Constructorul NU mai cere creier prin app (Gemini) și NU
// ține chei de furnizor (regula 13 aug): motorul Aider gândește pe creierul LOCAL
// Ollama de pe gazdă (localhost:11434), independent — fără cheie, fără cotă, fără
// bani. Constructorul își PUNE SINGUR creierul local pe VPS dacă lipsește
// (asiguraCreierulLocal → deploy/setup-ollama.sh), fără SSH — owner: „sa instaleze
// el, pe linux, aider automat cu tot ce trebuie".
// Numele creierului, pentru mesaje ONESTE pe monitor. Owner, 16 aug: „la constructor
// nu e gemeni… Aider pe un model LOCAL pe VPS (Ollama)" — creier local, independent.
const NUME_FURNIZOR = 'creierul LOCAL Ollama pe VPS (independent — fără cheie, fără cotă, fără bani)'
// Runde de reparație după o poartă roșie în atelier.
const MAX_REPAIR = Number(env.CONSTRUCTOR_MAX_REPAIR || 4)

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
// Încercarea ordinului curent (1 = primul drum; ≥2 = escaladare pe Fable 5).
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
        headers: { 'x-bridge-secret': BRIDGE, 'content-type': 'application/json', ...init.headers },
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

// Comenzi PERMISE explicit — nimic altceva nu se execută prin shell (atelierul
// nu e un shell liber; buildul și testele sunt verificările de care e nevoie).
const RUN_ALLOWED = new Set([
  'npm --prefix backend ci',
  'npm --prefix backend run build',
  'npm --prefix backend run typecheck',
  'npm --prefix backend run lint',
  'npm --prefix backend test',
  'npm --prefix frontend ci',
  'npm --prefix frontend run build',
  'npm --prefix frontend run typecheck',
  'npm --prefix frontend run lint',
  'git status --porcelain',
  'git diff --stat',
  // Porțile CASEI (măsurat pe ordinul #44, 3 aug 21:33: lucrătorul a vrut să
  // ruleze typecheck + verifica-exporturi — refuzat „comandă nepermisă" — și a
  // ars pașii pe reîncercări până la plafon, fără finish. Sunt exact porțile
  // pe care CI le rulează oricum pe PR; toate read-only, fără rețea, fără shell
  // metacaractere). Un lucrător care poate RULA porțile local nu mai împinge
  // PR-uri care pică pe ele.
  'node scripts/verifica-sintaxa.mjs',
  'node scripts/verifica-exporturi.mjs',
  'node scripts/verifica-gemini.mjs',
  // jscpd (cod duplicat) — poarta reală de pe VPS o rulează oricum; dându-i-o
  // modelului, poate să-și verifice singur duplicatele într-o rundă de reparație
  // în loc să afle abia din feedback că a picat.
  'npx --yes jscpd --threshold 0.0001',
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
  // Comenzi ÎNLĂNȚUITE cu `&&` — modelele le scriu firesc pentru verificări
  // (`npm --prefix backend run typecheck && npm --prefix backend test && …`).
  // MĂSURAT (ordin #187, DeepSeek): fiecare verigă era PERMISĂ, dar chain-ul întreg
  // era respins „comandă nepermisă", iar modelul ardea ture reîncercând. Le acceptăm
  // DOAR dacă FIECARE verigă e permisă individual; rulează în secvență, oprindu-se la
  // prima care pică (ca `&&`). Fără shell (execFileSync/sh per verigă) — `&&` nu ajunge
  // niciodată la un shell, deci gardul de injecție rămâne intact.
  if (c.includes('&&')) {
    const parti = c.split('&&').map((p) => p.trim()).filter(Boolean)
    if (parti.length > 1) {
      const pasi = []
      for (const p of parti) {
        const sub = classifyRunCommand(p)
        if (sub.mode === 'denied') return sub
        pasi.push(sub)
      }
      return { mode: 'chain', pasi }
    }
  }
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
function ruleazaUnPas(cls) {
  try {
    const out =
      cls.mode === 'install'
        ? execFileSync('npm', cls.argv, { cwd: ATELIER, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
        : sh(cls.cmd, { timeout: 10 * 60_000 })
    return { ok: true, text: out.slice(-8000) || '(ok, fără ieșire)' }
  } catch (e) {
    return { ok: false, text: `EȘEC (exit ${e.status ?? '?'})\n${String((e.stdout ?? '') + (e.stderr ?? '')).slice(-8000)}` }
  }
}
function toolRun(cmd) {
  const cls = classifyRunCommand(cmd)
  if (cls.mode === 'denied') return cls.reason
  if (cls.mode === 'chain') {
    // Verigile în ordine; ne oprim la prima care pică, exact ca `&&`.
    const bucati = []
    for (const pas of cls.pasi) {
      const eticheta = pas.mode === 'install' ? `npm ${pas.argv.join(' ')}` : pas.cmd
      const r = ruleazaUnPas(pas)
      bucati.push(`$ ${eticheta}\n${r.text}`)
      if (!r.ok) break
    }
    return bucati.join('\n---\n').slice(-8000)
  }
  return ruleazaUnPas(cls).text
}

// Ultimul creier care a SERVIT efectiv (pentru afișajul ONEST din raport/PR: dacă
// s-a căzut pe Fable 5, se vede Fable 5, nu Gemini). Setat în llm() la fiecare succes.
let ULTIMUL_CREIER = ''

// ── VITEZĂ: node_modules cald, sar peste instalarea inutilă (owner, 13 aug:
// „constructor mai rapid") ────────────────────────────────────────────────────
// `npm ci` ȘTERGE + reinstalează node_modules DE FIECARE DATĂ — minute pierdute
// când lock-ul n-a fost atins. Cu atelierul persistent (vezi main), node_modules
// rămâne cald; aici decidem: dacă package-lock.json e IDENTIC cu cel de la ultima
// instalare reușită (marca `.kelion-lock` scrisă în node_modules) ȘI node_modules
// există → SĂRIM instalarea. La ORICE dubiu → `npm ci` (sigur, reproductibil).
// Marca se scrie DOAR după o instalare+build+test reușite.
function hashLock(prefix) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(ATELIER, prefix, 'package-lock.json'))).digest('hex')
  } catch {
    return null
  }
}
/** Comanda de instalare pentru un prefix, SAU null când node_modules e cald și lock-ul neschimbat. */
function comandaInstalare(prefix, depsSchimbate) {
  if (depsSchimbate) return `npm --prefix ${prefix} install` // aduce pachetul nou + lock la zi
  try {
    const nm = path.join(ATELIER, prefix, 'node_modules')
    const marca = path.join(nm, '.kelion-lock')
    const h = hashLock(prefix)
    if (h && fs.existsSync(nm) && fs.existsSync(marca) && fs.readFileSync(marca, 'utf8') === h) return null
  } catch {
    /* dubiu → cădem pe ci */
  }
  return `npm --prefix ${prefix} ci`
}
function marcheazaInstalat(prefix) {
  try {
    const h = hashLock(prefix)
    if (h) fs.writeFileSync(path.join(ATELIER, prefix, 'node_modules', '.kelion-lock'), h)
  } catch {
    /* best-effort — la următorul job se reinstalează, nu strică nimic */
  }
}

// VERIFICAREA ATELIERULUI — ce s-a atins trebuie să compileze. Întoarce '' dacă
// e curat, altfel TEXTUL problemei: îl dăm înapoi modelului pentru o rundă de
// reparație, în loc să omorâm ordinul din prima (vezi bucla din main()).
function verificaAtelierul(baseSha) {
  // AIDER FACE --auto-commits: modificările lui sunt COMMITUITE, deci `git status
  // --porcelain` e GOL după el (vezi și comentariul buclei apelante: „arborele e de
  // obicei CURAT aici"). Verificarea VECHE citea DOAR `git status --porcelain`
  // (scrisă pentru bucla de dinaintea lui aider, care lăsa fișiere NECOMITUITE) →
  // după FIECARE ordin al lui aider credea fals „n-ai scris nimic" → intra în bucla
  // de reparație și pica „eșuat", IDENTIC pe free ȘI pe plătit (verificarea nu
  // depinde de model — de-aia și pe modelul cloud maxim rezultatul era același).
  // Bug REPRODUS: după un commit, porcelain e gol, dar `git diff baseSha HEAD` arată
  // fișierul. FIX: ne uităm la TOT ce s-a schimbat față de baseSha — commituri
  // (git diff baseSha..HEAD) + eventualul necomituit din arbore (porcelain).
  const dinCommit = baseSha ? sh(`git diff --name-only ${baseSha} HEAD`).trim() : ''
  const dinArbore = sh('git status --porcelain').trim()
  const fisiere = [
    ...dinCommit.split('\n'),
    ...dinArbore.split('\n').map((l) => l.slice(3)), // porcelain: „XY <cale>"
  ]
    .map((s) => s.trim())
    .filter(Boolean)
  if (!fisiere.length) return 'finish fără nicio modificare de fișier — nu ai scris nimic în atelier.'
  const touchedBackend = fisiere.some((f) => f.startsWith('backend/'))
  const touchedFrontend = fisiere.some((f) => f.startsWith('frontend/'))
  log(`modificări (${fisiere.length} fișiere):\n${fisiere.slice(0, 40).join('\n').slice(-1500)}`)
  // DEPENDENȚE NOI (Etapa 5): dacă ordinul a schimbat package.json (a adăugat o
  // bibliotecă), `npm ci` ar pica („package.json și package-lock.json out of
  // sync"). Atunci instalăm cu `npm install` — care aduce pachetul ȘI aduce
  // package-lock.json la zi; lock-ul actualizat intră în PR, deci publicarea în
  // producție (care rulează `npm ci`) merge. Fără schimbare de package.json,
  // rămânem pe `npm ci` (reproductibil din lock).
  const backendDeps = fisiere.some((f) => /^backend\/package(-lock)?\.json$/.test(f))
  const frontendDeps = fisiere.some((f) => /^frontend\/package(-lock)?\.json$/.test(f))
  const verify = []
  const instalBackend = touchedBackend ? comandaInstalare('backend', backendDeps) : null
  const instalFrontend = touchedFrontend ? comandaInstalare('frontend', frontendDeps) : null
  if (touchedBackend) {
    if (instalBackend) verify.push(instalBackend)
    else log('backend: node_modules cald (lock neschimbat) — sar peste instalare')
    verify.push('npm --prefix backend run build', 'npm --prefix backend test')
  }
  if (touchedFrontend) {
    if (instalFrontend) verify.push(instalFrontend)
    else log('frontend: node_modules cald (lock neschimbat) — sar peste instalare')
    verify.push('npm --prefix frontend run build')
  }
  for (const cmd of verify) {
    log(`verific: ${cmd}`)
    const out = toolRun(cmd)
    if (out.startsWith('EȘEC')) return `verificarea a picat la „${cmd}":\n${out.slice(-2000)}`
  }
  // Marcăm lock-ul ca instalat DOAR după ce instalarea + build + test au trecut
  // (dacă am instalat efectiv, nu am sărit). Așa jobul următor cu lock identic sare.
  if (instalBackend) marcheazaInstalat('backend')
  if (instalFrontend) marcheazaInstalat('frontend')
  // PORȚILE COMPLETE ALE CASEI (10 aug — #973 job-173): atelierul verifica DOAR
  // build+teste, dar POARTA reală de pe VPS (deploy/porti-pr.sh) rulează încă
  // PATRU pe care atelierul le sărea — cod duplicat (jscpd), exporturi fără
  // utilizator, sintaxă (markeri de conflict + CSS/JSON) și BOOTUL pe dist cu
  // Node curat. Așa a putut #973 să treacă buildul în atelier și să pice pe
  // poartă (tsc/teste/boot roșii), lăsând ownerul cu un PR roșu. Acum rulăm
  // EXACT aceleași porți AICI: dacă pică, ne întoarcem în runda de reparație și
  // modelul repară cauza — nu se mai deschide niciun PR care pică pe poartă.
  const porti = verificaPortileCasei(touchedBackend)
  if (porti) return porti
  return ''
}

// OGLINDA EXACTĂ a lui deploy/porti-pr.sh, rulată în atelier. `sh` = codul NOSTRU
// de verificare (nu shell-ul modelului), deci nu trece prin RUN_ALLOWED. Întoarce
// '' dacă toate trec, altfel textul primei porți picate (dat modelului la reparație).
function verificaPortileCasei(backendGataInstalat) {
  const coada = (e) => String((e.stdout ?? '') + (e.stderr ?? '')).slice(-2000)
  // 1) cod duplicat (jscpd) — pragul din poartă: 0 clone
  log('verific: npx --yes jscpd --threshold 0.0001')
  try { sh('npx --yes jscpd --threshold 0.0001', { timeout: 5 * 60_000 }) }
  catch (e) { return `poarta „cod duplicat (jscpd)" a picat — scoate duplicatul (extrage un helper comun):\n${coada(e)}` }
  // 2) exporturi fără utilizator
  log('verific: node scripts/verifica-exporturi.mjs')
  try { sh('node scripts/verifica-exporturi.mjs', { timeout: 2 * 60_000 }) }
  catch (e) { return `poarta „exporturi fără utilizator" a picat — șterge exportul nefolosit sau folosește-l:\n${coada(e)}` }
  // 3) sintaxă — markeri de conflict + CSS/JSON valide
  log('verific: node scripts/verifica-sintaxa.mjs')
  try { sh('node scripts/verifica-sintaxa.mjs', { timeout: 2 * 60_000 }) }
  catch (e) { return `poarta „sintaxă CSS + JSON" a picat:\n${coada(e)}` }
  // 4) BOOTUL pe dist cu Node curat — poarta care a prins căderea producției din
  //    2 aug (ciclu de importuri): tsc+teste+build erau verzi, dar aplicația NU
  //    pornea. Singura dovadă că pornește e s-o pornești. Backend-ul are nevoie
  //    de dependențe + build de emisie; dacă atelierul nu le-a instalat (ordinul
  //    n-a atins backend/), le instalăm acum, exact ca poarta (porti-pr.sh:49).
  if (!backendGataInstalat) {
    const inst = comandaInstalare('backend', false)
    if (inst) {
      log(`verific (boot): ${inst}`)
      try { sh(inst, { timeout: 10 * 60_000 }) }
      catch { try { sh('npm --prefix backend install', { timeout: 10 * 60_000 }) } catch (e) { return `bootul: instalarea dependențelor backend a picat:\n${coada(e)}` } }
      marcheazaInstalat('backend')
    } else {
      log('boot: node_modules backend cald (lock neschimbat) — sar peste instalare')
    }
  }
  log('verific (boot): npm --prefix backend run build')
  try { sh('npm --prefix backend run build', { timeout: 5 * 60_000 }) }
  catch (e) { return `bootul: buildul de emisie a picat:\n${coada(e)}` }
  log("verific (boot): PORT=18099 node dist/index.js → „Server listening”")
  // 45s, nu 20 (ordinul #331, 16 aug — a TREIA pică de boot-flake notată în
  // AI-HANDOFF: local trecea cu `timeout 45`, poarta PR-urilor dă tot 45
  // — porti-pr.sh:103 — doar aici rămăsese 20, prea strâns pe un VPS ocupat
  // de alt ordin). Și LEGEA MĂSURĂTORII: bootul se scrie în jurnal, iar la
  // pică raportul poartă COADA REALĂ a jurnalului (stack trace-ul), nu o
  // listă de „cauze uzuale" ghicite.
  const bootLog = '/tmp/kelion-boot-proba.log'
  try {
    sh(`PORT=18099 timeout 45 node dist/index.js 2>&1 | tee ${bootLog} | grep -qm1 'Server listening'`, { cwd: ATELIER + '/backend', timeout: 60_000 })
  } catch {
    let proba = ''
    try { proba = fs.readFileSync(bootLog, 'utf8').slice(-1500) } catch { /* jurnal absent — raportăm fără el */ }
    return `poarta „bootul pe dist (Node curat)" a picat: aplicația nu a scris „Server listening" în 45s.${proba ? ` Jurnalul REAL al bootului (coada):\n${proba}` : ' (jurnalul bootului nu s-a putut citi)'}\nRepară cauza din jurnal, nu simptomul.`
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
  // DEDUP la CREARE (Adrian, 5 aug: „real autonom"): nu deschide un AL DOILEA PR
  // pentru aceeași lucrare. Așa au apărut #796/799/800 — trei PR-uri, aceeași
  // idee, branch-uri diferite. Înainte de a crea, caută un PR deschis cu titlu
  // ECHIVALENT (normalizat) și refolosește-l. (Verificarea pe același branch de
  // mai jos, la 422, rămâne — asta e în plus, pe conținut, nu pe branch.)
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ăâîșț]+/g, ' ').trim()
  try {
    const deschise = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open&per_page=100`, { headers })
      .then((x) => x.json())
      .catch(() => null)
    if (Array.isArray(deschise)) {
      const tn = norm(titlu)
      const geaman = deschise.find((p) => p?.head?.ref !== branch && norm(p.title) === tn)
      if (geaman?.html_url) {
        log(`PR duplicat pentru „${titlu}" există deja (#${geaman.number}) — îl refolosesc, nu deschid altul`)
        return geaman.html_url
      }
    }
  } catch {
    /* dacă listarea pică, mergem mai departe și încercăm să creăm normal */
  }
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

// ÎMBINAREA e a PORȚII REALE de pe VPS (deploy/porti-pr.sh), nu a lucrătorului:
// ea rulează porțile reale la 10 min și, DOAR pe verde, îmbină singură PR-urile
// constructorului (kelion/job-*); pe roșu le lasă deschise. Aici nu mai îmbinăm
// (Actions e mort → n-am avea niciodată un verde de la el; un PR rupt ca #973 nu
// se mai poate strecura). Lucrătorul doar deschide PR-ul și raportează.

// DOVADA INDEPENDENTĂ (Etapa 6): „Gata" nu mai e pe cuvântul lucrătorului —
// după PR, CI-ul (workflow-ul pr-verify) re-rulează build+teste pe o MAȘINĂ
// CURATĂ. PUR (fără rețea): din răspunsul GitHub /check-runs alege checkul
// „verify" și dă verdictul. Ținut separat + exportat ca să poată fi PROBAT.
export function verdictDinCheckRuns(json, nume = 'verify') {
  const runs = Array.isArray(json?.check_runs) ? json.check_runs : []
  const r = runs.find((x) => x?.name === nume)
  if (!r) return 'absent'
  if (r.status !== 'completed') return 'pending'
  // 'skipped'/'neutral' = CI-ul NU a rulat de fapt (pe repo-ul ăsta Actions e
  // oprit — `vars.ACTIONS_PORNIT` fals — deci checkul „verify" iese 'skipped').
  // NU e un EȘEC: verificarea reală au fost cele 7 porți din atelier, rulate deja
  // înainte de PR, plus poarta de pe VPS care îmbină pe verde. Îl tratăm ca
  // 'absent' ca ordinul să NU fie marcat „picat" pe un check care n-a rulat.
  if (r.conclusion === 'skipped' || r.conclusion === 'neutral') return 'absent'
  return r.conclusion === 'success' ? 'success' : 'failure'
}

// Așteaptă checkul „verify" pe commit-ul PR-ului, mărginit de un termen (nu poate
// depăși bugetul de timp al rulării — un job NU devine demon). Întoarce
// 'success' | 'failure' | 'timeout'.
async function asteaptaVerificareCI(sha, deadlineMs, gratieAbsentMs = 90_000) {
  const headers = { Authorization: `Bearer ${GHTOKEN}`, Accept: 'application/vnd.github+json' }
  const start = Date.now()
  let ultim = 'absent'
  let aRulatVreodata = false // checkul „verify" a apărut măcar o dată ca 'pending'?
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
    if (v === 'pending') aRulatVreodata = true
    // NU așteptăm tot bugetul pe un check care NU vine: pe repo-ul ăsta Actions e
    // oprit, deci „verify" rămâne 'absent' (sau iese 'skipped' → tot 'absent') la
    // nesfârșit. Dacă după perioada de grație tot n-a pornit niciodată, ieșim —
    // porțile din atelier (deja verzi) + poarta de pe VPS confirmă și îmbină. Dacă
    // A pornit ('pending'), rămânem până la termen ca să prindem verdictul real.
    if (!aRulatVreodata && Date.now() - start > gratieAbsentMs) return 'absent'
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

// ── MOTORUL AIDER (owner, 16 aug: „constructor unic aider… aider va avea absolut
// toate instrumentele necesare pentru a repara si construi, real" + „aider
// trebuie sa fie permanet de creiere si kelion real, colaboreaza 100% intre ei
// informational"). CREIERUL LUI AIDER = MODEL LOCAL PE VPS (Ollama), owner 16 aug:
// „la constructor nu e gemeni… Aider pe un model LOCAL pe VPS (Ollama)… pe serverul
// linux si de acolo sa lucreze aider". Independent — fără cheie, fără cotă, fără
// bani. Colaborarea informațională cu Kelion rămâne (context viu injectat în prompt):
// Kelion dă ordinul + memoria + roster-ul + jurnalul; Aider dă pașii (pe monitor) +
// rezultatul (în raport). Constructorul își PUNE SINGUR creierul local pe VPS
// (asiguraCreierulLocal) — nimeni nu mai intră pe SSH.
function aiderInstalat() {
  // PROBĂ DE EXISTENȚĂ, NU DE VERSIUNE (măsurat 16 aug, constructor.log de pe gazdă,
  // #370): `aider --version` pornește TOT Python-ul greu al lui aider (litellm etc.)
  // și pe VPS-ul „sugrumat" (CPU-only, încărcat) depășea cele 20s → arunca → FALS
  // „aider lipsă" → poarta asiguraCreierulLocal amâna ordinul ÎNAINTE ca aider să
  // pornească. `command -v` e instant (nu pornește Python) și răspunde exact la
  // întrebarea reală: e aider pe PATH? (PATH-ul e deja lărgit la pornire cu
  // /usr/local/bin + ~/.local/bin, deci găsește symlink-ul pus de setup-ollama.)
  try { execFileSync('bash', ['-c', 'command -v aider'], { timeout: 8_000, stdio: 'ignore' }); return true } catch { return false }
}

// ── CREIERUL LOCAL, PUS AUTOMAT DE CONSTRUCTOR (owner, 16 aug: „sa instaleze el…
// pe linux… aider automat cu tot ce trebuie"). Constructorul își asigură SINGUR
// pe VPS creierul local de care are nevoie Aider (Ollama + un model de cod) —
// fără SSH, fără mâna omului. IDEMPOTENT: dacă Aider + modelul sunt deja acolo,
// iese instant; altfel rulează procedura din repo (deploy/setup-ollama.sh, sursa
// UNICĂ), cu fallback inline dacă scriptul lipsește din clonă. Prima punere e
// scumpă (trage câțiva GB, o singură dată); rulările următoare o sar.
//
// PUR (fără disc/shell), EXPORTAT ca să fie PROBAT: din ieșirea lui `ollama list`
// + numele modelului cerut, spune dacă modelul mai trebuie tras. Cu tag explicit
// (`nume:tag`) cere potrivire exactă; fără tag, acceptă orice tag pe aceeași bază
// (Ollama trage ':latest').
export function creierLocalLipseste(ollamaListOutput, modelCerut) {
  const model = String(modelCerut || '').replace(/^ollama_chat\//, '').trim()
  if (!model) return true
  const modele = String(ollamaListOutput || '')
    .trim()
    .split('\n')
    .slice(1) // prima linie = antetul „NAME …"
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((m) => m && m !== 'NAME')
  if (model.includes(':')) return !modele.includes(model)
  return !modele.some((m) => m.split(':')[0] === model)
}

// Numele modelului FĂRĂ prefixul LiteLLM (pentru `ollama pull` / scriptul de setup).
function numeModelOllama() {
  return (env.CONSTRUCTOR_AIDER_MODEL || 'ollama_chat/qwen2.5-coder:32b').replace(/^ollama_chat\//, '')
}

function commandExista(bin) {
  try { execFileSync('bash', ['-lc', `command -v ${bin}`], { timeout: 8_000, stdio: 'ignore' }); return true } catch { return false }
}

// Fallback inline dacă scriptul din repo lipsește (clonă parțială). Aceleași
// comenzi ca deploy/setup-ollama.sh, minimul necesar: Ollama + serviciu + model +
// Aider pe host. Fiecare pas e best-effort (prins în try) — proba finală din
// asiguraCreierulLocal decide dacă a reușit.
function instaleazaCreierulInline(model, timeout, instalEnv) {
  const rula = (cmd) => {
    try { execSync(cmd, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: instalEnv }) }
    catch (e) { log(`  (inline) „${cmd.slice(0, 60)}": ${String(e.message).slice(0, 120)}`) }
  }
  if (!commandExista('ollama')) rula('curl -fsSL https://ollama.com/install.sh | sh')
  rula('systemctl enable --now ollama 2>/dev/null || (pgrep -x ollama >/dev/null 2>&1 || nohup ollama serve >/var/log/ollama.log 2>&1 &)')
  rula('for i in $(seq 1 30); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done')
  rula(`ollama pull ${model}`)
  if (!commandExista('aider')) rula('pip3 install --break-system-packages aider-chat 2>/dev/null || pipx install aider-chat')
}

// Pune (dacă lipsește) creierul local pe VPS. Întoarce true dacă la final Aider +
// modelul sunt gata. NU aruncă — decizia de amânare o ia apelantul.
function asiguraCreierulLocal() {
  const model = numeModelOllama()
  const listaAcum = () => { try { return execFileSync('ollama', ['list'], { timeout: 15_000, encoding: 'utf8' }) } catch { return '' } }
  if (aiderInstalat() && !creierLocalLipseste(listaAcum(), model)) {
    log(`creier local: Aider + Ollama („${model}") DEJA gata pe VPS — sar peste instalare`)
    return true
  }
  log(`creier local LIPSĂ pe VPS — îl instalez AUTOMAT (Ollama + „${model}" + Aider), fără SSH…`)
  beat('⚙️ pun creierul local (Ollama) pe VPS — o singură dată, poate dura câteva minute…', true)
  const timeout = Math.max(60_000, Math.min(ramase() - 60_000, 40 * 60_000))
  const instalEnv = { ...process.env, CONSTRUCTOR_OLLAMA_MODEL: model, KELION_ENVFILE: ENVFILE }
  const script = path.join(ATELIER, 'deploy', 'setup-ollama.sh')
  try {
    if (fs.existsSync(script)) {
      const out = execFileSync('bash', [script], { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: instalEnv })
      for (const l of String(out).split('\n').slice(-6)) { const t = l.trim(); if (t) log(`setup-ollama: ${t.slice(0, 140)}`) }
    } else {
      log('deploy/setup-ollama.sh lipsește din clonă — instalez inline (curl ollama.com | sh + pull + aider)')
      instaleazaCreierulInline(model, timeout, instalEnv)
    }
  } catch (e) {
    log(`instalarea creierului local a picat: ${String((e.stdout ?? '') + (e.stderr ?? '') + (e.message ?? '')).slice(-500)}`)
  }
  const gata = aiderInstalat() && !creierLocalLipseste(listaAcum(), model)
  log(gata ? `creier local: instalat și VIU pe VPS („${model}")` : 'creier local: încă indisponibil după instalarea automată (rețea/disc/root?) — ordinul se reia')
  return gata
}


// ?? LEC?II DURABILE din e?ecuri (owner 17 aug: auto-dezvoltare + ?nv??are) ??
// Fi?ier pe host, citit la fiecare ordin FREE/PAID. Nu arde bani: e text local.

// ?? LEGE: ORICE CREIER folose?te pa?i mici (owner 17 aug) ???????????????????
// Free local, cloud pl?tit, ajutor Gemini ? ACELA?I contract:
// plan FILES/STEPS/CHECK ? Aider doar pe fi?ierele din plan ? por?i.
const LECTII_PATH = '/root/kelion/memory/lectii-constructor.jsonl'
function salveazaLectie(row) {
  try {
    fs.mkdirSync(path.dirname(LECTII_PATH), { recursive: true })
    fs.appendFileSync(LECTII_PATH, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n')
  } catch { /* ignore */ }
}
export function extrageFisiereDinText(text, limit = 6) {
  const out = []
  const re = /(?:^|[\s`"'(])([A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|yml|yaml))/g
  let m
  const s = String(text || '')
  while ((m = re.exec(s)) && out.length < limit) {
    const f = m[1].replace(/^\.\//, '')
    if (f.includes('..')) continue
    if (!out.includes(f)) out.push(f)
  }
  return out
}
const ALIASE_DIRECTOARE = new Map([
  ['servicii', 'services'],
  ['rute', 'routes'],
])

export function rezolvaFisiereCerute(files, trackedFiles, limit = 6) {
  const tracked = [...new Set((trackedFiles || []).map((f) => String(f).replace(/\\/g, '/')))]
  const trackedSet = new Set(tracked)
  const out = []
  for (const raw of files || []) {
    const normal = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normal || normal.startsWith('/') || /^[A-Za-z]:\//.test(normal)) continue
    const parti = normal.split('/')
    if (parti.includes('..')) continue
    const aliased = parti.map((part) => ALIASE_DIRECTOARE.get(part.toLowerCase()) || part).join('/')
    let ales = trackedSet.has(normal) ? normal : (trackedSet.has(aliased) ? aliased : '')
    if (!ales) {
      const baza = path.posix.basename(aliased)
      const potriviri = tracked.filter((f) => path.posix.basename(f) === baza)
      if (potriviri.length === 1) ales = potriviri[0]
    }
    if (ales && !out.includes(ales)) out.push(ales)
    if (out.length >= limit) break
  }
  return out
}

function fisiereUrmariteInAtelier() {
  try {
    return execFileSync(
      'git',
      ['-C', ATELIER, 'ls-files', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', timeout: 30_000 },
    ).split('\n').map((f) => f.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function fisiereExistenteInAtelier(files) {
  return rezolvaFisiereCerute(files, fisiereUrmariteInAtelier(), 6).filter((f) => {
    try {
      const fp = path.join(ATELIER, f)
      return fs.existsSync(fp) && fs.statSync(fp).isFile()
    } catch {
      return false
    }
  })
}
const CONSTRUCTOR_PROTOCOL_ID = 'kelion.constructor/v1'
const COMENZI_PROTOCOL = new Set([
  'npm --prefix backend run build',
  'npm --prefix backend run typecheck',
  'npm --prefix backend run lint',
  'npm --prefix backend test',
  'npm --prefix frontend run build',
  'npm --prefix frontend run lint',
  'node scripts/verifica-sintaxa.mjs',
  'node scripts/verifica-exporturi.mjs',
])
const ACTIUNI_PROTOCOL = new Set(['inspect', 'create', 'modify', 'delete'])
const cheiExacte = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}
const caleProtocolSigura = (value) => {
  if (typeof value !== 'string' || !value || value.length > 240) return false
  if (value.startsWith('/') || /^[A-Za-z]:[\/]/.test(value) || value.includes('\\')) return false
  return /^[A-Za-z0-9_.@/+\-]+$/.test(value) && value.split('/').every((part) => part && part !== '.' && part !== '..')
}

export function valideazaProtocolConstructorPrimit(value, trackedFiles = []) {
  const errors = []
  if (!cheiExacte(value, ['protocol', 'naturalLanguage', 'technical']))
    return { ok: false, protocol: null, errors: ['invalid root shape'] }
  if (value.protocol !== CONSTRUCTOR_PROTOCOL_ID) errors.push('unsupported protocol version')

  const natural = value.naturalLanguage
  if (!cheiExacte(natural, ['task', 'rationale', 'instructions'])) errors.push('invalid naturalLanguage shape')
  const instructions = Array.isArray(natural?.instructions) ? natural.instructions : []
  if (typeof natural?.task !== 'string' || natural.task.length < 8 || natural.task.length > 2500) errors.push('invalid naturalLanguage.task')
  if (typeof natural?.rationale !== 'string' || !natural.rationale || natural.rationale.length > 1200) errors.push('invalid naturalLanguage.rationale')
  if (instructions.length < 1 || instructions.length > 10) errors.push('invalid naturalLanguage.instructions count')

  const technical = value.technical
  if (!cheiExacte(technical, ['files', 'operations', 'checks'])) errors.push('invalid technical shape')
  const files = Array.isArray(technical?.files) ? technical.files : []
  const operations = Array.isArray(technical?.operations) ? technical.operations : []
  const checks = Array.isArray(technical?.checks) ? technical.checks : []
  if (files.length < 1 || files.length > 6) errors.push('invalid technical.files count')
  if (operations.length < 1 || operations.length > 10) errors.push('invalid technical.operations count')
  if (checks.length < 1 || checks.length > 10) errors.push('invalid technical.checks count')

  const accessByPath = new Map()
  for (const file of files) {
    if (!cheiExacte(file, ['path', 'access']) || !caleProtocolSigura(file.path) || !ACTIUNI_PROTOCOL.has(file.access)) {
      errors.push('invalid technical file entry')
      continue
    }
    if (accessByPath.has(file.path)) errors.push(`duplicate file path: ${file.path}`)
    accessByPath.set(file.path, file.access)
  }

  const tracked = new Set((trackedFiles || []).map(String))
  if (tracked.size) {
    const trackedDirs = new Set([...tracked].flatMap((file) => {
      const parts = file.split('/'); const dirs = []
      for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'))
      return dirs
    }))
    for (const [file, access] of accessByPath) {
      if (access === 'create') {
        const parent = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
        if (parent && !trackedDirs.has(parent)) errors.push(`create parent directory is not tracked: ${parent}`)
      } else if (!tracked.has(file)) {
        errors.push(`protocol file is not tracked exactly: ${file}`)
      }
    }
  }

  const operationIds = new Set()
  for (const operation of operations) {
    const allowedKeys = operation && Object.hasOwn(operation, 'symbol')
      ? ['id', 'action', 'file', 'symbol']
      : ['id', 'action', 'file']
    if (!cheiExacte(operation, allowedKeys) || !/^S[1-9][0-9]?$/.test(String(operation?.id || '')) ||
        !ACTIUNI_PROTOCOL.has(operation?.action) || !caleProtocolSigura(operation?.file)) {
      errors.push('invalid technical operation entry')
      continue
    }
    if (Object.hasOwn(operation, 'symbol') &&
        (typeof operation.symbol !== 'string' || operation.symbol.length < 1 || operation.symbol.length > 160))
      errors.push('invalid technical operation symbol')
    if (operationIds.has(operation.id)) errors.push(`duplicate operation id: ${operation.id}`)
    operationIds.add(operation.id)
    const access = accessByPath.get(operation.file)
    if (!access) errors.push(`operation ${operation.id} references undeclared file: ${operation.file}`)
    if (operation.action !== 'inspect' && access && access !== operation.action)
      errors.push(`operation ${operation.id} conflicts with declared file access`)
  }

  const instructionIds = new Set()
  for (const instruction of instructions) {
    if (!cheiExacte(instruction, ['operationId', 'text']) || !/^S[1-9][0-9]?$/.test(String(instruction?.operationId || '')) ||
        typeof instruction?.text !== 'string' || instruction.text.length < 3 || instruction.text.length > 500) {
      errors.push('invalid natural-language instruction entry')
      continue
    }
    if (instructionIds.has(instruction.operationId)) errors.push(`duplicate instruction id: ${instruction.operationId}`)
    instructionIds.add(instruction.operationId)
    if (!operationIds.has(instruction.operationId)) errors.push(`instruction references unknown operation: ${instruction.operationId}`)
  }
  for (const id of operationIds) if (!instructionIds.has(id)) errors.push(`operation has no instruction: ${id}`)

  for (const check of checks) {
    if (check?.type === 'command') {
      if (!cheiExacte(check, ['type', 'command']) || !COMENZI_PROTOCOL.has(check.command)) errors.push('invalid command check')
    } else if (check?.type === 'condition') {
      if (!cheiExacte(check, ['type', 'assertion']) || typeof check.assertion !== 'string' || check.assertion.length < 3 || check.assertion.length > 500)
        errors.push('invalid condition check')
    } else errors.push('invalid check type')
  }

  return errors.length ? { ok: false, protocol: null, errors } : { ok: true, protocol: value, errors: [] }
}

/** Protocol structurat de la creierul Kelion pentru ORICE sursa Aider. */
async function cereAjutorCreier(ordin, esuat) {
  try {
    const r = await api(
      '/api/constructor/ajutor',
      {
        method: 'POST',
        body: JSON.stringify({
          ordin: String(ordin || '').slice(0, 2500),
          esuat: String(esuat || '').slice(0, 1500),
          repositoryFiles: fisiereUrmariteInAtelier().filter(caleProtocolSigura).slice(0, 2500),
        }),
      },
      1,
    )
    const structured = Object.hasOwn(r || {}, 'protocol') || r?.schema === CONSTRUCTOR_PROTOCOL_ID
    if (structured) {
      const verdict = valideazaProtocolConstructorPrimit(r?.protocol, fisiereUrmariteInAtelier())
      if (!verdict.ok || !verdict.protocol) {
        log(`protocol constructor respins: ${verdict.errors.slice(0, 4).join('; ')}`)
        return { protocol: null, plan: '', files: [], legacy: false, strictFailure: true, errors: verdict.errors }
      }
      const files = verdict.protocol.technical.files.map((file) => file.path)
      log(`protocol constructor ${verdict.protocol.protocol}: ${files.length} files, ${verdict.protocol.technical.operations.length} operations`)
      return { protocol: verdict.protocol, plan: '', files, legacy: false, strictFailure: false, errors: [] }
    }

    // Compatibilitate temporara: aplicatia veche poate raspunde inca FILES/STEPS.
    const plan = String(r?.plan || '').trim()
    const declarate = Array.isArray(r?.files) ? r.files.map(String) : []
    const files = [...new Set([...declarate, ...extrageFisiereDinText(plan, 12)])]
    if (plan) log(`protocol legacy rolling-deploy: ${files.length} files`)
    return { protocol: null, plan, files, legacy: true, strictFailure: false, errors: [] }
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200)
    log(`protocol constructor indisponibil: ${error}`)
    return { protocol: null, plan: '', files: [], legacy: false, strictFailure: true, errors: [error] }
  }
}
export function construiestePromptPasiMici(job, extra = '', plan = '', protocol = null) {
  if (protocol) {
    let prompt =
      'Apply the validated machine protocol below. The SAME JSON is used for local and cloud brains.\n' +
      'Technical paths/actions/checks are authoritative and MUST NOT be translated or inferred from prose.\n' +
      `CONSTRUCTOR_PROTOCOL_JSON:\n${JSON.stringify(protocol)}\n`
    if (extra) prompt += `RUNTIME_FAILURE_EVIDENCE (diagnostic only):\n${String(extra).slice(0, 1000)}\n`
    return prompt
  }
  const ordin = String(job.orderText || '').slice(0, 1800)
  let prompt = `LEGACY_ROLLING_DEPLOY_ORDER:\n${ordin}\n`
  if (plan) prompt += `LEGACY_VALIDATED_BY_OLD_APP:\n${String(plan).slice(0, 2000)}\n`
  if (extra) prompt += `RUNTIME_FAILURE_EVIDENCE:\n${String(extra).slice(0, 1000)}\n`
  return prompt.slice(0, 4000)
}

export function pregatesteMesajAider(prompt, platit = false) {
  const msg = String(prompt || '')
  const protocolat = msg.includes('CONSTRUCTOR_PROTOCOL_JSON:\n')
  const cap = protocolat ? 16_000 : (platit ? 8000 : 3500)
  if (msg.length <= cap) return { msg, cap, capped: false }
  if (protocolat) throw new Error(`validated protocol prompt exceeds safe cap: ${msg.length}`)
  return { msg: msg.slice(0, cap) + '\n[prompt capped - small steps law]', cap, capped: true }
}

function ruleazaAider(prompt, creierCfg = { sursa: 'free', model: '', base: '', cheie: '' }, files = []) {
  // ORICE creier: free local SAU cloud pl?tit ? acela?i motor Aider, pa?i mici, fi?iere ?intite.
  // OpenRouter interzis pe free. Pl?tit = doar Ollama cloud cu cheie owner.
  const platit = !!(creierCfg && creierCfg.sursa === 'platit' && creierCfg.model && creierCfg.cheie)
  const model = platit
    ? `openai/${creierCfg.model}`
    : (env.CONSTRUCTOR_AIDER_MODEL || 'ollama_chat/qwen2.5-coder:32b')

  // Igien? context: pe free mereu; pe pl?tit tot wipe history ca s? nu umfle cost/timp.
  try {
    for (const f of ['.aider.chat.history.md', '.aider.input.history']) {
      try { fs.writeFileSync(path.join(ATELIER, f), '') } catch { /* ignore */ }
    }
    if (!platit) {
      const freeCfgBody =
        `model: ${model}\neditor-model: ${model}\nweak-model: ${model}\n` +
        'architect: false\nedit-format: whole\nmap-tokens: 0\nauto-commits: true\n' +
        'auto-test: false\nstream: false\nanalytics-disable: true\ngit: true\n'
      fs.writeFileSync('/root/kelion/aider-free.conf.yml', freeCfgBody)
      try { fs.mkdirSync(ATELIER, { recursive: true }) } catch { /* ignore */ }
      fs.writeFileSync(path.join(ATELIER, '.aider.conf.yml'), freeCfgBody)
    }
  } catch (e) {
    log(`aider hygiene: ${String(e?.message || e).slice(0, 140)}`)
  }

  const pregatit = pregatesteMesajAider(prompt, platit)
  const msg = pregatit.msg
  if (pregatit.capped) log(`prompt capped to ${pregatit.cap} chars (${platit ? 'platit' : 'free'})`)

  // Fara fisiere explicite, map-tokens=0 il lasa pe Aider complet orb si modelul
  // poate doar sa ceara continutul. O harta mica ii permite sa aleaga tinta;
  // cand avem fisiere, pastram contextul strict si ieftin.
  const scoped = fisiereExistenteInAtelier(files)
  const mapTokens = scoped.length
    ? (platit ? String(env.CONSTRUCTOR_AIDER_MAP_TOKENS || '0') : '0')
    : String(env.CONSTRUCTOR_AIDER_FALLBACK_MAP_TOKENS || '2048')
  const args = [
    '--message', msg,
    '--model', model,
    '--editor-model', model,
    '--weak-model', model,
    '--yes-always', '--no-analytics', '--no-check-update', '--no-gitignore',
    '--auto-commits', '--no-stream', '--no-show-model-warnings',
    '--map-tokens', mapTokens,
    '--edit-format', 'whole',
  ]
  if (!platit && fs.existsSync('/root/kelion/aider-free.conf.yml')) {
    args.push('--config', '/root/kelion/aider-free.conf.yml')
  }
  for (const f of scoped) args.push(f)
  if (scoped.length) log(`aider (${platit ? 'platit' : 'free'}) scoped: ${scoped.join(', ')}`)
  else log(`aider (${platit ? 'platit' : 'free'}) fara fisiere scoped - repo-map=${mapTokens}`)

  const aiderEnv = {
    ...process.env,
    OLLAMA_API_BASE: env.OLLAMA_API_BASE || 'http://127.0.0.1:11434',
    GIT_TERMINAL_PROMPT: '0',
  }
  if (!platit) {
    delete aiderEnv.OPENROUTER_API_KEY
    delete aiderEnv.OPENAI_API_KEY
    delete aiderEnv.OPENAI_API_BASE
    aiderEnv.OPENROUTER_API_KEY = ''
  } else {
    aiderEnv.OPENAI_API_BASE = `${String(creierCfg.base).replace(/\/+$/, '')}/v1`
    aiderEnv.OPENAI_API_KEY = creierCfg.cheie
  }

  // Free: max 8 min; pl?tit: max 18 min ? ambele pot fi omor?te la t?cere.
  const timeout = Math.max(
    45_000,
    Math.min(ramase() - 60_000, platit ? Number(env.CONSTRUCTOR_PAID_TIMEOUT_MS || 18 * 60_000) : Number(env.CONSTRUCTOR_FREE_TIMEOUT_MS || 8 * 60_000)),
  )
  // Cold-start measured on this VPS: qwen2.5-coder:32b needs ~81s only to load.
  // Killing free at 45s guaranteed a false timeout/HTTP 499 before its first token.
  // Paid also proved a false kill at 90s AFTER Aider had already committed, while
  // its summarizer was still closing. Once HEAD changed, allow a larger close grace.
  const TACERE_KILL_MS = Number(env.CONSTRUCTOR_SILENCE_MS || (platit ? 180_000 : 150_000))
  const TACERE_DUPA_COMMIT_MS = Number(env.CONSTRUCTOR_POST_COMMIT_SILENCE_MS || 300_000)

  return new Promise((resolve) => {
    let out = ''
    let ultimaLa = Date.now()
    let anuntatAgatat = false
    let anuntatCommit = false
    const headLaStart = sh('git rev-parse --short=7 HEAD').trim()
    const inghite = (buf) => {
      const s = String(buf)
      out += s
      if (out.length > 32 * 1024 * 1024) out = out.slice(-16 * 1024 * 1024)
      for (const linie of s.split('\n')) {
        const t = linie.trim()
        if (t) { log(`aider: ${t.slice(0, 140)}`); ultimaLa = Date.now(); anuntatAgatat = false }
      }
    }
    let child
    try {
      child = spawn('aider', args, { cwd: ATELIER, env: aiderEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ log: String(e?.message ?? e).slice(-4000), throttled: /econnrefused|enoent|econnreset/i.test(String(e)) })
      return
    }
    child.stdout?.on('data', inghite)
    child.stderr?.on('data', inghite)
    const paznic = setInterval(() => {
      const tacut = Date.now() - ultimaLa
      const headAcum = sh('git rev-parse --short=7 HEAD').trim()
      const aComis = !!headLaStart && !!headAcum && headAcum !== headLaStart
      const pragTacere = aComis ? Math.max(TACERE_KILL_MS, TACERE_DUPA_COMMIT_MS) : TACERE_KILL_MS
      if (aComis && !anuntatCommit) {
        anuntatCommit = true
        log(`aider: commit detectat (${headAcum}) — acord ${Math.round(pragTacere / 1000)}s pentru închidere/sumarizare`)
      }
      if (pragTacere > 0 && tacut > pragTacere) {
        log(`aider: T?CUT de ${Math.round(tacut / 1000)}s (${platit ? 'platit' : 'free'}, commit=${aComis ? 'da' : 'nu'}) ? kill; urmeaz? replan pa?i mici`)
        try { child.kill('SIGKILL') } catch { /* dead */ }
        return
      }
      if (!anuntatAgatat && tacut > 60_000) {
        anuntatAgatat = true
        log(`aider: T?CUT de ${Math.round(tacut / 1000)}s ? posibil ag??at`)
      }
    }, 10_000)
    const omoara = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* dead */ } }, timeout)
    const inchide = (throttleSemnal) => {
      clearInterval(paznic)
      clearTimeout(omoara)
      const throttled = throttleSemnal || /429|rate.?limit|RESOURCE_?EXHAUSTED|quota|overload|unavailable|\b5\d\d\b|creier_esec|epuizat|depleted|api.?error|connection|econnrefused|econnreset/i.test(out)
      resolve({ log: out.slice(-4000), throttled })
    }
    child.on('close', () => inchide(false))
    child.on('error', (e) => { out += `\n${e?.message ?? e}`; inchide(/econnrefused|enoent|econnreset/i.test(String(e))) })
  })
}


// FREE-FIRST + paid rezervă (owner 17 aug): oglinda deciziei din
// backend/src/services/escaladareConstructor.ts — ținută inline ca agentul
// pe host să nu depindă de build-ul TS. Paid NU pornește degeaba.
function decideEscaladareFreeFirst({ peFree, paidDisponibil, motivFree }) {
  if (!peFree) return { escaladeaza: false, motiv: 'deja_platit' }
  if (!paidDisponibil) return { escaladeaza: false, motiv: 'paid_indisponibil' }
  const t = String(motivFree || '')
  let motiv = ''
  if (/free_indisponibil|creier local|ollama.*indispon|aider.*lips|enoent|econnrefused.*11434/i.test(t)) motiv = 'free_indisponibil'
  else if (/timeout_throttle|429|rate.?limit|timeout|throttl|sugrumat|RESOURCE_?EXHAUSTED|overload|econnreset/i.test(t)) motiv = 'timeout_throttle'
  else if (/no_change|no_edit|n-a modificat|context_overflow|token limit/i.test(t)) motiv = 'no_change'
  else if (/calitate|failed|eșuat|esuat|build.*picat|teste.*roș|poart/i.test(t)) motiv = 'calitate'
  else if (/openrouter_auth|openrouter|AuthenticationError/i.test(t)) motiv = 'openrouter_auth'
  if (!motiv) return { escaladeaza: false, motiv: 'motiv_insuficient' }
  return { escaladeaza: true, motiv }
}

async function construiesteCuAider(job, baseSha, jurnalVechi) {
  // preferred free; fallback paid doar dacă API-ul raportează rezervă gata
  let creierCfg = { sursa: 'free', model: '', base: '', cheie: '' }
  let fallbackPaid = null // { sursa, model, base, cheie } | null
  try {
    const c = await api('/api/constructor/creier-config', {}, 2)
    if (c && (c.sursa === 'platit' || c.sursa === 'free')) {
      creierCfg = { sursa: c.sursa, model: c.model || '', base: c.base || '', cheie: c.cheie || '' }
    }
    if (c?.fallback && c.fallback.sursa === 'platit' && c.fallback.model && c.fallback.cheie) {
      fallbackPaid = {
        sursa: 'platit',
        model: String(c.fallback.model),
        base: String(c.fallback.base || ''),
        cheie: String(c.fallback.cheie),
      }
    } else if (c?.paidDisponibil && c.model && c.cheie) {
      // compat răspuns vechi forțat platit
      fallbackPaid = { sursa: 'platit', model: String(c.model), base: String(c.base || ''), cheie: String(c.cheie) }
    }
  } catch (e) {
    // Nu logăm corpul config (poate conține cheie paid) — doar motivul scurt.
    log(`creier-config: ${e instanceof Error ? e.message.slice(0, 80) : e} — free local`)
  }
  // Nu loga NICIODATĂ creierCfg.cheie / fallback.cheie (secret).
  let platit = !!(creierCfg.sursa === 'platit' && creierCfg.model && creierCfg.cheie)
  let brainRaport = platit ? 'paid_cloud' : 'free_local'
  let motivEscaladare = ''
  ULTIMUL_CREIER = platit
    ? `aider (CLOUD rezervă: ${creierCfg.model})`
    : `aider (LOCAL Ollama FREE: ${numeModelOllama()})`
  if (!platit && !asiguraCreierulLocal()) {
    // Free jos: încearcă rezervă paid în ACELAȘI run dacă există; altfel amână pe free
    const dec = decideEscaladareFreeFirst({
      peFree: true,
      paidDisponibil: !!fallbackPaid,
      motivFree: 'free_indisponibil',
    })
    if (dec.escaladeaza && fallbackPaid) {
      creierCfg = fallbackPaid
      platit = true
      brainRaport = 'paid_cloud'
      motivEscaladare = dec.motiv
      ULTIMUL_CREIER = `aider (CLOUD rezervă după free_indisponibil: ${creierCfg.model})`
      log(`ESCALADARE same-run free→paid rezervă: motiv=${dec.motiv} model=${creierCfg.model}`)
      salveazaLectie({ sig: 'escaladare_paid', cauza: 'free_indisponibil', fix: `paid:${creierCfg.model}`, ok: false })
    } else {
      throw Object.assign(new Error('creier local Ollama indisponibil — ordinul se reia pe FREE'), { amanabil: true, freeIssue: 'free_indisponibil' })
    }
  }

  // Context Kelion scurt ? ambele creiere; free mai str?ns.
  let contextKelion = ''
  try {
    const ctx = await api('/api/constructor/context', { method: 'POST', body: JSON.stringify({ ordin: job.orderText }) }, 2)
    const mem = (ctx?.memorie ?? []).filter((x) => !String(x).includes('[iscoada')).slice(0, platit ? 8 : 4)
    const rel = (ctx?.relevante ?? []).slice(0, platit ? 6 : 3)
    const parti = []
    if (mem.length) parti.push(`MEMORIE:\n- ${mem.join('\n- ')}`)
    if (rel.length) parti.push(`ISTORIC:\n- ${rel.join('\n- ')}`)
    if (parti.length) {
      contextKelion = `\n=== context Kelion ===\n${parti.join('\n')}\n=== /context ===\n`
      const cap = platit ? 4000 : 1500
      if (contextKelion.length > cap) contextKelion = contextKelion.slice(0, cap) + '\n?\n'
    }
  } catch { /* optional */ }

  // LEGE: plan pa?i mici ?NAINTE de Aider ? pentru free ?I pl?tit.
  let plan0 = ''
  let protocol0 = null
  let legacyProtocol = false
  let files0 = []
  let ajutorFolosit = false
  {
    const h = await cereAjutorCreier(job.orderText, String(jurnalVechi || '').slice(-800))
    if (h.strictFailure) {
      throw Object.assign(new Error(`protocol constructor invalid: ${(h.errors || []).join('; ').slice(0, 500)}`), {
        amanabil: true,
        freeIssue: 'invalid_protocol',
      })
    }
    protocol0 = h.protocol
    plan0 = h.plan
    legacyProtocol = h.legacy === true
    files0 = h.files || []
    ajutorFolosit = !!(protocol0 || plan0)
    beat(platit ? 'protocol JSON validat -> Aider CLOUD' : 'protocol JSON validat -> Aider FREE', true)
  }

  let reparatii = 0
  let ultimaProblema = ''
  for (;;) {
    const prompt = construiestePromptPasiMici(
      job,
      reparatii ? ultimaProblema : (jurnalVechi ? String(jurnalVechi).slice(-1000) : ''),
      plan0,
      protocol0,
    ) + (platit ? contextKelion : '')
    const fallbackLegacy = legacyProtocol ? extrageFisiereDinText(plan0 + '\n' + job.orderText) : []
    const files = fisiereExistenteInAtelier(files0.length ? files0 : fallbackLegacy)
    log(`aider run ${reparatii ? 'repair ' + reparatii : 'build'} -> ${ULTIMUL_CREIER} -> files=${files.join(',') || '-'} -> protocol=${protocol0 ? protocol0.protocol : 'legacy'}`)
    let a = await ruleazaAider(prompt, creierCfg, files)
    for (const linie of String(a.log).split('\n').slice(-6)) {
      const tl = linie.trim()
      if (tl) log(`aider: ${tl.slice(0, 140)}`)
    }
    if (a.throttled) {
      const decT = decideEscaladareFreeFirst({
        peFree: !platit,
        paidDisponibil: !!fallbackPaid,
        motivFree: `timeout_throttle ${a.log.slice(-200)}`,
      })
      if (decT.escaladeaza && fallbackPaid && !platit) {
        creierCfg = fallbackPaid
        platit = true
        brainRaport = 'paid_cloud'
        motivEscaladare = decT.motiv
        ULTIMUL_CREIER = `aider (CLOUD rezervă după throttle: ${creierCfg.model})`
        log(`ESCALADARE same-run free→paid: motiv=${decT.motiv}`)
        salveazaLectie({ sig: 'escaladare_paid', cauza: 'timeout_throttle', fix: `paid:${creierCfg.model}`, ok: false })
        continue // reîncearcă pe paid în același run
      }
      throw Object.assign(new Error(`aider sugrumat: ${a.log.slice(-160)}`), { amanabil: true, freeIssue: 'timeout_throttle' })
    }
    let headAcum = sh('git rev-parse --short=7 HEAD').trim()

    // No-edit: replan pe același creier; dacă tot free+no-edit → rezervă paid same-run.
    if (headAcum === baseSha && ramase() > 2 * 60_000) {
      log('no-edit — replan pași mici (același creier)')
      const h2 = await cereAjutorCreier(job.orderText, a.log.slice(-1200))
      const ceruteLegacy = h2.legacy ? extrageFisiereDinText(a.log, 12) : []
      if (!h2.strictFailure && (h2.protocol || h2.plan || ceruteLegacy.length)) {
        if (h2.protocol) {
          protocol0 = h2.protocol
          plan0 = ''
          legacyProtocol = false
          files0 = h2.files || []
        } else {
          plan0 = h2.plan || plan0
          legacyProtocol = true
          files0 = [...new Set([...files0, ...ceruteLegacy, ...(h2.files || [])])]
        }
        ajutorFolosit = true
        const files2 = fisiereExistenteInAtelier(files0)
        beat('replan protocolat -> Aider din nou pe fisiere tintite', true)
        a = await ruleazaAider(construiestePromptPasiMici(job, a.log.slice(-800), plan0, protocol0), creierCfg, files2)
        for (const linie of String(a.log).split('\n').slice(-6)) {
          const tl = linie.trim()
          if (tl) log(`aider: ${tl.slice(0, 140)}`)
        }
        headAcum = sh('git rev-parse --short=7 HEAD').trim()
      }
    }

    if (headAcum === baseSha) {
      const sig = /token limit|context of \d+/i.test(a.log)
        ? 'context_overflow'
        : (/openrouter|AuthenticationError/i.test(a.log) ? 'openrouter_auth' : 'no_edit')
      const decN = decideEscaladareFreeFirst({
        peFree: !platit,
        paidDisponibil: !!fallbackPaid,
        motivFree: sig,
      })
      if (decN.escaladeaza && fallbackPaid && !platit && ramase() > 3 * 60_000) {
        creierCfg = fallbackPaid
        platit = true
        brainRaport = 'paid_cloud'
        motivEscaladare = decN.motiv
        ULTIMUL_CREIER = `aider (CLOUD rezervă după ${sig}: ${creierCfg.model})`
        log(`ESCALADARE same-run free→paid: motiv=${decN.motiv} (${sig})`)
        salveazaLectie({ sig: 'escaladare_paid', cauza: sig, fix: `paid:${creierCfg.model}`, ok: false })
        continue
      }
      salveazaLectie({ sig, cauza: a.log.slice(-300), fix: platit ? 'paid-no-edit' : 'free-no-edit; paid rezervă indisponibilă sau epuizată', ok: false })
      throw Object.assign(
        new Error(`aider n-a modificat nimic [${sig}] creier=${platit ? 'platit' : 'free'} brain=${brainRaport} plan=${ajutorFolosit ? 'da' : 'nu'}\n${a.log.slice(-600)}`),
        { amanabil: true, freeIssue: sig },
      )
    }

    const problema = verificaAtelierul(baseSha)
    if (!problema) {
      salveazaLectie({
        sig: platit ? 'paid_ok' : 'free_ok',
        cauza: motivEscaladare ? `done_after_${motivEscaladare}` : 'done',
        fix: ajutorFolosit ? 'brain-plan+aider' : 'aider',
        ok: true,
      })
      return {
        title: (job.orderText.split('\n')[0] || `Ordin #${job.id}`).slice(0, 120),
        body: `Aider — ${ULTIMUL_CREIER}${ajutorFolosit ? ' — plan pași mici creier Kelion' : ''}${motivEscaladare ? ` — escaladat (${motivEscaladare})` : ''}. brain=${brainRaport}. Ordin #${job.id}.`,
        brainRaport,
        motivEscaladare,
      }
    }
    ultimaProblema = problema
    // Rezultatul free a scris cod, dar porțile reale (build/tests) l-au respins.
    // Acesta este exact cazul „răspuns incorect”: următoarea reparație folosește
    // fallbackul paid în ACELAȘI run, fără să mai repete aceeași mână free.
    const decQ = decideEscaladareFreeFirst({
      peFree: !platit,
      paidDisponibil: !!fallbackPaid,
      motivFree: `calitate ${problema.slice(0, 300)}`,
    })
    if (decQ.escaladeaza && fallbackPaid && !platit) {
      creierCfg = fallbackPaid
      platit = true
      brainRaport = 'paid_cloud'
      motivEscaladare = decQ.motiv
      ULTIMUL_CREIER = `aider (CLOUD rezervă după poarta de calitate: ${creierCfg.model})`
      log(`ESCALADARE same-run free→paid: motiv=${decQ.motiv} (porți roșii)`)
      salveazaLectie({ sig: 'escaladare_paid', cauza: 'calitate', fix: `paid:${creierCfg.model}`, ok: false })
    }
    if (reparatii + 1 < MAX_REPAIR && ramase() > 3 * 60_000) {
      const h3 = await cereAjutorCreier(job.orderText, problema.slice(-1200))
      if (h3.plan) {
        plan0 = h3.plan
        if (h3.files?.length) files0 = h3.files
        ultimaProblema = problema.slice(0, 1000) + '\n\nPLAN:\n' + h3.plan.slice(0, 1200)
        ajutorFolosit = true
      }
    }
    if (reparatii >= MAX_REPAIR || ramase() < 4 * 60_000) throw new Error(problema)
    reparatii++
  }
}


async function main() {
  if (!BRIDGE || !GHTOKEN) {
    log('lipsesc BRIDGE_SECRET (creierul merge PRIN APP) / GITHUB_TOKEN din kelionai.env — ies')
    return
  }
  const claim = await api('/api/constructor/next')
  if (!claim?.job) return // coada goală sau pauza-autonomie — tăcere totală
  beatJobId = Number(claim.job.id) || 0 // de-acum log() trimite pasul pe monitor
  const job = claim.job
  log(`ordin #${job.id} (încercarea ${job.attempts}): ${job.orderText.slice(0, 160)}`)
  // MOTORUL = AIDER, UNIC (owner, 16 aug, verbatim: „constructor unic aider… scoti
  // tot din constructor si instalezi doar aider… aider va avea absolut toate
  // instrumentele necesare pentru a repara si construi, real"). CREIERUL LUI AIDER
  // = MODEL LOCAL PE VPS (Ollama), owner 16 aug: „la constructor nu e gemeni… Aider
  // pe un model LOCAL pe VPS (Ollama)… pe serverul linux si de acolo sa lucreze
  // aider". Independent, fără chei/cotă/bani. Colaborarea informațională cu Kelion
  // rămâne: contextul ordinului + memoria + roster-ul + jurnalul curg de la Kelion
  // spre Aider (în prompt), iar pașii + rezultatul lui Aider curg înapoi la Kelion
  // (monitor prin beat/log + raportul final + triajul).
  log(`creier constructor: MOTORUL AIDER (unic) pe creierul LOCAL Ollama de pe VPS (${numeModelOllama()}) — independent, fără chei în constructor`)

  // `tries` mai mic la închiderea forțată: handlerul de SIGTERM are doar ~20s
  // până ne omorâm singuri, deci acolo nu ne permitem cele 8 reîncercări.
  // (CONTABILITATEA DE COST a fost EXTIRPATĂ cu totul, 3 aug — Gemini nu
  // itemizează cost per apel. Invariantul din bug-ul ordinelor #32/#34 —
  // „report() nu moare pe variabile din alt scope" („ReferenceError:
  // tokensPaid is not defined" DUPĂ ce PR-ul fusese deschis) — e ținut prin
  // ELIMINARE: report() nu mai citește nicio variabilă de cost.)
  // brainRaport din run: free_local (default) sau paid_cloud (doar rezervă folosită).
  let brainRaportRun = 'free_local'
  const report = (status, extra = {}, tries = 8) =>
    api(
      '/api/constructor/report',
      {
        method: 'POST',
        // brain = free_local | paid_cloud (owner 17 aug: paid doar rezervă, raportat).
        // costUsd nu se inventează (regula #1).
        body: JSON.stringify({
          id: job.id,
          status,
          log: logLines.join('\n'),
          brain: brainRaportRun === 'paid_cloud' ? 'paid_cloud' : 'free_local',
          ...extra,
        }),
      },
      tries,
    )
  raportCurent = report // ca handlerul de SIGTERM să poată raporta eșecul

  try {
    // ATELIER PERSISTENT (owner, 13 aug: „constructor mai rapid"). Înainte ștergeam
    // TOT (inclusiv node_modules) + re-clonam ~mii de fișiere la FIECARE job — minute
    // pierdute. Acum refolosim atelierul: aducem master-ul de ACUM prin fetch + reset
    // DUR + clean, PĂSTRÂND node_modules (gitignored → nici `reset --hard`, nici
    // `clean -fd` fără `-x` nu-l ating). Dacă atelierul lipsește / e corupt / fetch-ul
    // pică → cădem pe CLONA CURATĂ de dinainte (fallback SIGUR: cel mai rău caz =
    // comportamentul vechi). Așa jobul următor pornește pe master proaspăt, dar cu
    // node_modules cald (vezi comandaInstalare — sare peste `npm ci` inutil).
    const url = `https://github.com/${REPO}.git`
    const askpass = caleAskpassConstructor()
    fs.writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$GITHUB_TOKEN" ;;\nesac\n',
      { mode: 0o700 },
    )
    const gitEnv = {
      ...process.env,
      GITHUB_TOKEN: GHTOKEN,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: '0',
    }
    let rapid = false
    if (fs.existsSync(path.join(ATELIER, '.git'))) {
      try {
        execFileSync('git', ['-C', ATELIER, 'remote', 'set-url', 'origin', url], { stdio: 'pipe', timeout: 30_000 , env: gitEnv })
        execFileSync('git', ['-C', ATELIER, 'fetch', '--depth', '50', 'origin', 'master'], { stdio: 'pipe', timeout: 120_000 , env: gitEnv })
        execFileSync('git', ['-C', ATELIER, 'reset', '--hard', 'FETCH_HEAD'], { stdio: 'pipe', timeout: 60_000 })
        execFileSync('git', ['-C', ATELIER, 'clean', '-fd'], { stdio: 'pipe', timeout: 60_000 }) // FĂRĂ -x → node_modules (ignorat) rămâne
        rapid = true
      } catch {
        rapid = false
      }
    }
    if (!rapid) {
      fs.rmSync(ATELIER, { recursive: true, force: true })
      execFileSync('git', ['clone', '--depth', '50', url, ATELIER], { stdio: 'pipe', timeout: 120_000 , env: gitEnv })
    }
    const baseSha = sh('git rev-parse --short=7 HEAD').trim()
    log(`atelier pe ${baseSha}${rapid ? ' (persistent, node_modules cald)' : ' (clonă curată)'}`)

    // ── CONSTRUIT DE AIDER (motorul UNIC al constructorului) — owner, 16 aug:
    // „constructor unic aider… aider va avea absolut toate instrumentele necesare
    // pentru a repara si construi, real". Kelion → Aider: ordinul + jurnalul
    // încercării anterioare (învățare). Aider ↔ creiere: PRIN APP. Aider → Kelion:
    // pașii pe monitor + rezultatul în raport. Bucla veche de model a fost SCOASĂ.
    const jurnalVechi = String(job.log ?? "").trim()
    const tokens = 0 // Aider nu itemizează tokeni — nicio cifră inventată (regula #1)
    const finish = await construiesteCuAider(job, baseSha, jurnalVechi)
    if (finish?.brainRaport === 'paid_cloud' || finish?.brainRaport === 'free_local') {
      brainRaportRun = finish.brainRaport
    }
    const branch = `kelion/job-${job.id}`
    // Titlu gol = `git commit -m ""` refuză commit-ul („Aborting commit due to
    // empty commit message") și ordinul pica după ce toată munca era făcută.
    const titlu = (finish.title || '').trim() || `Ordin #${job.id} — modificare automată`
    sh(`git checkout -B ${branch}`)
    // Aider face --auto-commits, deci arborele e de obicei CURAT aici; comitem noi
    // DOAR dacă mai există modificări nescrise (altfel `git commit` pică pe „empty").
    if (sh('git status --porcelain').trim()) {
      sh('git add -A')
      execFileSync('git', ['-c', 'user.name=Kelion Constructor', '-c', 'user.email=contact@kelionai.app', 'commit', '-m', titlu], { cwd: ATELIER, stdio: 'pipe' })
    }
    execFileSync('git', ['push', '-u', 'origin', branch, '--force'], { cwd: ATELIER, stdio: 'pipe', timeout: 60_000, env: gitEnv })
    const headSha = sh('git rev-parse HEAD').trim()
    log(`ramura ${branch} împinsă`)

    // CREIERUL, SCRIS ÎN PR (regula din 2 aug: alegerea modelului e VIZIBILĂ).
    // Furnizorul nu itemizează cost per apel — se raportează DOAR tokenii măsurați.
    const linieCreier = `Motor: Aider (unic) · ${ULTIMUL_CREIER || NUME_FURNIZOR} · brain=${brainRaportRun} · tokeni neitemizați (regula #1: nicio cifră inventată)`
    const prUrl = await deschidePR(
      titlu,
      `${finish.body}\n\n---\n${linieCreier}\nOrdin #${job.id} · construit automat de Constructorul lui Kelion (bază ${baseSha}, toate cele 7 porți rulate în atelier: tsc, teste, build, jscpd, exporturi, sintaxă, boot pe dist). Se îmbină singur DOAR pe poartă verde; pe roșu rămâne deschis cu problemele raportate.`,
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
    // ÎMBINAREA e a PORȚII REALE, nu a lucrătorului (10 aug): GitHub Actions e
    // mort (facturare blocată), deci checkul „verify" nu vine niciodată — de-aia
    // un PR rupt ca #973 a putut fi îmbinat manual. Acum poarta de pe VPS
    // (deploy/porti-pr.sh, cron 10 min) rulează porțile REALE și, DOAR pe verde,
    // îmbină singură PR-urile constructorului (kelion/job-*); pe roșu le lasă
    // deschise cu problema anunțată. Aici doar RAPORTĂM starea; nu îmbinăm de
    // două ori.
    if (ci === 'roșu') {
      await report('failed', { branch, prUrl, tokens, ci, log: `${logLines.join('\n')}\n\nVerificarea independentă (CI) a picat pe PR (commit ${headSha.slice(0, 7)}).` })
    } else {
      // verde SAU 'în curs' — poarta de pe VPS confirmă și îmbină pe verde.
      await report('done', { branch, prUrl, tokens, ci: ci === 'verde' ? 'verde' : `${ci} (poarta VPS confirmă + îmbină pe verde)` })
    }
  } catch (e) {
    // AMÂNARE, NU MOARTE (regula din 28 iul): când
    // vina e a FURNIZORULUI (429/cotă/5xx/„busy" la endpoint), NU raportăm eșec:
    // ordinul rămâne „running" iar coada îl reia singură după 40 min (până la 3
    // încercări — mecanismul existent din claimNextBuildJob). Fără email de
    // eșec fals, fără ordin îngropat degeaba. Nu există alt creier pe care să
    // cadă — extirparea OpenRouter, 3 aug.
    const amanabil =
      e?.amanabil ||
      /429|rate.?limit|RESOURCE_?EXHAUSTED|quota|overloaded|Model busy|\b5\d\d\b/i.test(String(e?.message ?? ''))
    if (amanabil && Number(job.attempts) < 3) {
      log(
        `AMÂNAT (nu eșuat): ${NUME_FURNIZOR} e sugrumat acum (${String(e.message).slice(0, 120)}) — ` +
          'ordinul rămâne în coadă și se reia automat în ~40 min',
      )
      // PAUZA SE VEDE (D6). Fără rândul ăsta, panoul rămânea pe „Lucrează" cu
      // ultimul pas înghețat pe ecran 40 de minute — imposibil de deosebit de
      // un ordin blocat. Marcajul „⏳" îl citește interfața și schimbă insigna.
      beat(`⏳ ${NUME_FURNIZOR} e sugrumat acum. Ordinul NU e pierdut — se reia automat în ~40 min.`, true)
      return
    }
    const detaliu = e instanceof Error ? (e.stack || e.message) : String(e)
    log(`EȘEC: ${detaliu}`)
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
