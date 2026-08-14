#!/usr/bin/env node
// ── CONSTRUCTORUL LUI KELION — agentul de construcție de pe VPS ─────────────
// (Adrian, 27 iul: „Kelion trebuie să poată crea orice soft îi cere admin,
// orice modificare, orice îmbunătățire".)
//
// CE FACE: ia UN ordin din coadă (API-ul aplicației, auth x-bridge-secret),
// clonează repo-ul proaspăt în ATELIER (/root/kelion/atelier), lasă creierul
// (prin app: Gemini principal → Fable 5 rezervă) să
// exploreze/scrie/verifice prin unelte, impune BUILD + TESTE verzi, apoi
// împinge ramura și deschide PR-ul. Merge-ul rămâne la Adrian.
// (La eșec de FURNIZOR ordinul se AMÂNĂ onest, rămâne în coadă și se reia
// automat — nu cade pe alt creier și nu inventează succes.)
//
// DE CE E JOB, NU DEMON: ecosistemul vechi (bridge/builder, procese claude
// permanente) ardea abonamentul și a produs phantom-deploy-uri — vezi
// AI-HANDOFF §6. Aici: pornit de cron, flock (unul singur), timeout dur din
// constructor-worker.sh, plafoane de pași și tokeni. Se termină și moare.
//
// PLAFOANE (env, cu valori implicite): CONSTRUCTOR_GEMINI_MODEL,
// CONSTRUCTOR_MAX_STEPS (24 — pași CU UNELTE, nu ture), CONSTRUCTOR_MAX_TOKENS
// (900000), CONSTRUCTOR_MAX_STERILE (8 — ture în care modelul doar povestește),
// CONSTRUCTOR_MAX_REPAIR (2 — runde de reparație după un build picat),
// CONSTRUCTOR_BUDGET_MS (1560000 = 26 min, sub timeout-ul dur de 30 min din
// constructor-worker.sh, ca să apucăm SĂ RAPORTĂM înainte să fim omorâți).
import { execSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
const GHTOKEN = env.GITHUB_TOKEN ?? ''
// ── CREIERUL CONSTRUCTORULUI = GEMINI (principal) → FABLE 5 (rezervă), PRIN APP ─
// Owner, 14 aug: „schimbă-mi constructorul cu gemeni ultra… când nu merge repara
// să cadă pe fable 5, înlocuiește peste tot asta". Constructorul NU mai are creier
// propriu pe RunPod/DeepInfra (SCOS) — cere creierul DOAR prin app, pe ruta gardată
// `/api/constructor/creier` (x-bridge-secret). ACOLO app-ul rulează Gemini „ultra"
// (Pro) ca PRINCIPAL și cade pe Fable 5 ca REZERVĂ când Gemini nu poate; tot acolo
// se face REVENIREA pe Gemini (fiecare pas reîncepe cu principalul). Cheile
// (Gemini + Anthropic) + creditul stau în APP, NICIODATĂ în constructor (regula 13
// aug: constructorul nu ține chei de furnizor și nu cheamă direct API-uri externe).
// Mesajele + TOOLS-urile sunt deja în format OpenAI → trec DIRECT, fără conversie.
const LLM_TIMEOUT_MS = Number(env.CONSTRUCTOR_LLM_TIMEOUT_MS || 120_000)
// Numele lanțului, pentru mesaje ONESTE pe monitor (nu mai există „RunPod/DeepInfra").
const NUME_FURNIZOR = 'creierul prin app (Gemini → Fable 5)'
// PE MAXIM (Adrian, 5 aug: „setează-l pe maxim posibil"). Plafonul REAL al unei
// rulări NU e numărul de pași — e BUGETUL DE TIMP (26 min, sub timeout-ul dur de
// 30) și cel de TOKENI. Punem pașii atât de sus (120) încât să NU mai fie ei
// limita: un ordin mare (tabelă + detectare + panou + teste — ex. plasa banilor
// M2) merge până la capătul bugetului, nu iese neterminat fiindcă „s-au gătat
// pașii". Suprascriibil din env fără deploy (CONSTRUCTOR_MAX_STEPS).
const MAX_STEPS = Number(env.CONSTRUCTOR_MAX_STEPS || 120)
// Plafon SEPARAT pentru turele sterile (vorbărie, unelte refuzate) — vezi
// contabilitatea pașilor din main(): ele nu mai au voie să mănânce bugetul de
// construcție, dar nici să ne țină la nesfârșit.
const MAX_STERILE = Number(env.CONSTRUCTOR_MAX_STERILE || 8)
// Runde de reparație după o poartă roșie în atelier (promise în system prompt).
// Ridicat 2→4 (10 aug): atelierul verifică acum TOATE cele 7 porți (jscpd,
// exporturi, sintaxă, boot — adăugate în #978), nu doar build+teste. Cu doar 2
// runde, un ordin care pică o poartă nouă (ex. un duplicat de scos, un boot de
// reparat) rămânea „eșuat" deși era reparabil. Mai multe runde = chiar le termină.
const MAX_REPAIR = Number(env.CONSTRUCTOR_MAX_REPAIR || 4)
// Ridicat la 2M odată cu pașii (5 aug): cu 120 de pași, bugetul de tokeni nu mai
// trebuie să fie el frâna înainte de cel de TIMP. Fereastra glisantă
// (KEEP_VERBATIM) ține contextul per-tură mărginit, deci ăsta e doar cumulul.
const MAX_TOKENS = Number(env.CONSTRUCTOR_MAX_TOKENS || 2_000_000)
// FEREASTRA DE CONTEXT (audit 27 iul — cauza EȘECULUI pe ORICE model): bucla
// re-trimitea TOT istoricul la fiecare pas, cu citiri de până la 120k caractere
// păstrate pe veci → un job trivial ajungea la ~794k tokeni, unul greu spărgea
// plafonul. Acum: rezultatele uneltelor vechi se comprimă la un ciot; doar
// ultimele KEEP_VERBATIM schimburi rămân întregi. Liniar, nu pătratic.
const KEEP_VERBATIM = Number(env.CONSTRUCTOR_KEEP_VERBATIM || 6)
const READ_CAP = 6_000 // plafon pe REZULTATUL oricărei unelte în istoric (era 120k — sursa exploziei)
// Plafon SEPARAT, mai mare, DOAR pentru citirea unui fișier (Adrian, 5 aug: „să
// nu mai pice"): 6k tăia fișiere mari (config.ts, db.ts) la jumătate →
// constructorul edita pe orb și cădea. 20k acoperă majoritatea fișierelor
// întregi; ce e mai mare se cere pe interval de linii. Fereastra glisantă
// (KEEP_VERBATIM) comprimă oricum citirile vechi, deci nu sparge contextul.
const READ_CAP_FISIER = Number(env.CONSTRUCTOR_READ_CAP || 40_000)

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
  if (slice.length > READ_CAP_FISIER)
    return `${slice.slice(0, READ_CAP_FISIER)}\n...[trunchiat la ${READ_CAP_FISIER} caractere — cere un interval de linii (from/to) pentru restul; fișierul are ${lines.length} linii]`
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
      `pare tăiat de plafonul de ieșire. Pe fișiere MARI folosește 'edit_lines' (dai numerele ` +
      `de linie din 'read' + textul nou — imun la plafon) sau 'edit'; NU retrimite tot fișierul.`
    )
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return `scris: ${p} (${content.length} caractere)`
}
// EDIT PUNCTUAL — plasa reală împotriva truncherii de mai sus: modelul dă doar
// textul vechi și textul nou. Cerem potrivire UNICĂ, ca să nu schimbe din
// greșeală altă apariție (fără petice oarbe). DAR cauza #1 a ordinelor picate
// (ex. #53, 4 aug: 4 refuzuri „old nu apare" pe api-types.ts → plafon de pași)
// era că modelul dă „old" cu spații/indentare puțin diferite, iar potrivirea
// STRICT exactă refuza — și el ardea pașii reîncercând. Acum: exact → tolerant
// la spații (unic) → iar dacă tot nu, îi dăm CONTEXTUL real ca să se descurce
// singur dintr-o singură mișcare. Astfel Kelion rezolvă ordinul, nu se blochează.
function toolEdit(p, vechi, nou) {
  const full = safePath(p)
  if (!vechi) return 'REFUZAT: „old" gol — dă textul EXACT care trebuie înlocuit.'
  const src = fs.readFileSync(full, 'utf8')
  const r = potrivesteEdit(src, vechi)
  if (r === 'exacta_multipla' || r === 'toleranta_multipla')
    return `REFUZAT: textul „old" apare în mai multe locuri în ${p} — dă un fragment mai lung, unic.`
  if (r && typeof r === 'object') {
    fs.writeFileSync(full, src.slice(0, r.start) + nou + src.slice(r.end))
    const et = r.mod === 'toleranta' ? ' (potrivit tolerant la spații)' : ''
    return `editat${et}: ${p} (${r.end - r.start} → ${nou.length} caractere)`
  }
  // Nici tolerant — RE-ANCORARE (măsurat pe #43/#53): dăm liniile REALE din fișier
  // din jurul primei linii recognoscibile din „old", ca modelul să copieze exact
  // dintr-o dată, fără să ardă pașii ghicind sau pe un 'read' în plus.
  return `REFUZAT: textul „old" nu apare în ${p}. ${contextReancorare(src, vechi)}`
}
// EDIT PE LINII — plasa DEFINITIVĂ pentru fișiere MARI (măsurat pe #65, 4 aug:
// pe admin.ts de 45KB, 'write' refuza corect (răspuns tăiat de plafon) iar 'edit'
// nu potrivea „old" → 8 ture sterile → EȘEC). Aici modelul dă doar NUMERELE de
// linie (le vede din 'read' numerotat) + textul nou. Zero potrivire de text,
// zero rescriere a fișierului întreg — deci imună la plafonul de ieșire și la
// nepotrivirea lui „old". Așa Kelion editează orice fișier, oricât de mare.
function toolEditLines(p, from, to, nou) {
  const full = safePath(p)
  const r = inlocuiesteLinii(fs.readFileSync(full, 'utf8'), from, to, nou)
  if (r.err) return `REFUZAT: ${r.err} (vezi numerele din 'read').`
  fs.writeFileSync(full, r.text)
  const inlocuite = Math.max(0, r.bb - r.a + 1)
  return inlocuite === 0
    ? `adăugat la sfârșit: ${p} (+${r.n} linii)`
    : `editat pe linii: ${p} (liniile ${r.a}–${r.bb}, ${inlocuite} → ${r.n} linii)`
}
// ȘTERGERE de fișier — plasă pentru un fișier creat din GREȘEALĂ (măsurat pe #45,
// 3 aug: modelul a vrut `run rm <migrație greșită>` → „comandă nepermisă" și a
// ars pași fără să poată curăța). `run` nu execută `rm` (shell liber interzis),
// dar aici e o unealtă sandbox: `safePath` o ține STRICT în atelier (clona de
// unică folosință) și ștergerea apare în diff-ul PR-ului, pe care owner-ul îl vede.
function toolDelete(p) {
  const full = safePath(p)
  if (!fs.existsSync(full)) return `REFUZAT: ${p} nu există.`
  if (!fs.statSync(full).isFile()) return `REFUZAT: ${p} nu e fișier (directoarele nu se șterg de aici).`
  fs.unlinkSync(full)
  return `șters: ${p}`
}
// Nucleul PUR (fără disc) al lui edit_lines, exportat ca să fie probat: taie
// liniile from..to și pune „nou" în loc. Întoarce {text,a,bb,n} sau {err}.
export function inlocuiesteLinii(src, from, to, nou) {
  const lines = String(src).split('\n')
  const a = Math.floor(Number(from))
  const b = Math.floor(Number(to))
  // `from === lines.length + 1` = ADĂUGARE la sfârșit (append pur). Măsurat pe
  // #67 (4 aug): modelul cerea exact asta — `from=317` pe un fișier de 316 linii
  // — și pica „interval invalid", ardea pași sterili → EȘEC. Permitem un singur
  // rând peste ultima linie, ca adăugarea la coadă să funcționeze.
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || a > lines.length + 1)
    return { err: `interval invalid (from=${from}, to=${to}); fișierul are ${lines.length} linii, dă 1 ≤ from ≤ to ≤ ${lines.length} (sau from=to=${lines.length + 1} ca să adaugi la sfârșit)` }
  const bb = Math.min(b, lines.length)
  const nouLinii = String(nou ?? '').split('\n')
  return { text: [...lines.slice(0, a - 1), ...nouLinii, ...lines.slice(bb)].join('\n'), a, bb, n: nouLinii.length }
}
// POTRIVIRE ROBUSTĂ pentru 'edit'. Întoarce {start,end,mod} pentru o singură
// potrivire (exactă SAU tolerantă la spații), 'exacta_multipla'/'toleranta_multipla'
// când e ambiguu, sau null când nu se găsește. Pură (fără disc), EXPORTATĂ ca să
// fie probată — garda de unicitate e prea importantă ca s-o verific „pe încredere".
export function potrivesteEdit(src, vechi) {
  if (typeof src !== 'string' || typeof vechi !== 'string' || vechi === '') return null
  // 1) EXACT, unic.
  const i = src.indexOf(vechi)
  if (i >= 0) {
    if (src.indexOf(vechi, i + vechi.length) >= 0) return 'exacta_multipla'
    return { start: i, end: i + vechi.length, mod: 'exacta' }
  }
  // 2) TOLERANT LA SPAȚII: fiecare run de whitespace din „old" ↔ orice alt run
  //    (\s+), restul literal. Prinde diferențe de indentare / spații la capăt /
  //    CRLF — cauza reală a refuzurilor. Tot UNIC (mapat înapoi prin index-ul
  //    potrivirii), ca să nu atingem din greșeală altă bucată.
  if (vechi.length > 8000) return null // gardă anti-backtracking pe „old" uriaș
  const pat = vechi
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape metacaractere (spațiile rămân literale)
    .replace(/\s+/g, '\\s+') // orice run de spații/linii noi ↔ orice alt run
  let re
  try {
    re = new RegExp(pat, 'g')
  } catch {
    return null
  }
  const gasite = [...src.matchAll(re)]
  if (gasite.length === 0) return null
  if (gasite.length > 1) return 'toleranta_multipla'
  const m = gasite[0]
  return { start: m.index, end: m.index + m[0].length, mod: 'toleranta' }
}
// Când „old" nu se potrivește nici tolerant, arătăm liniile REALE din fișier în
// jurul primei linii recognoscibile din „old", ca modelul să copieze exact și să
// se descurce SINGUR. Cade pe începutul fișierului dacă nicio linie nu se prinde.
function contextReancorare(src, vechi) {
  const linii = src.split('\n')
  const candidate = String(vechi).split('\n').map((l) => l.trim()).filter((l) => l.length > 4)
  for (const cheie of candidate) {
    const idx = linii.findIndex((l) => l.includes(cheie))
    if (idx >= 0) {
      const de = Math.max(0, idx - 2)
      const pana = Math.min(linii.length, idx + 4)
      const bloc = linii.slice(de, pana).map((l, k) => `${de + k + 1}: ${l}`).join('\n')
      return `Textul REAL din fișier (copiază-l EXACT ca „old"):\n${bloc}`
    }
  }
  return `Copiază „old" EXACT din fișier. Începutul lui (primele 400 caractere):\n${src.slice(0, 400)}`
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

let TOOLS = [
  // NB: `let`, nu `const` — la pornire se reîncarcă din sursa unică a aplicației
  // (incarcaUneltele), ca să aibă mereu aceleași unelte de dev/ops ca creierul.
  { type: 'function', function: { name: 'ls', description: 'Listează un director din repo (fără node_modules/.git/dist).', parameters: { type: 'object', properties: { dir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'grep', description: 'Caută un text/regex în tot repo-ul și întoarce fișier:linie:conținut (max 60). FOLOSEȘTE ASTA ca să găsești fișierul de modificat — nu explora cu ls/read pas cu pas.', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'read', description: 'Citește un fișier (numerotat). Dă from/to ca să iei DOAR intervalul de linii care te interesează — nu tot fișierul.', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'Scrie CONȚINUTUL COMPLET al unui fișier (rescriere integrală, nu diff). Pentru un fișier EXISTENT mare folosește mai bine „edit" — răspunsul tău are plafon și se taie.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'Înlocuiește o bucată de text într-un fișier existent: „old" (textul EXACT de acum, unic în fișier) → „new". Preferă asta la fișiere mari — nu retrimiți tot fișierul.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } } },
  { type: 'function', function: { name: 'edit_lines', description: 'CEA MAI SIGURĂ pe fișiere MARI: înlocuiește liniile from..to (numerele din „read") cu textul „new". Fără potrivire de text, fără să retrimiți tot fișierul — imună la plafonul de ieșire. Ca să ȘTERGI, dă „new" gol. Ca să INSEREZI după linia N, dă from=to=N+1 doar dacă acele linii nu-ți trebuie — altfel include-le în „new".', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' }, new: { type: 'string' } }, required: ['path', 'from', 'to', 'new'] } } },
  { type: 'function', function: { name: 'delete_file', description: 'Șterge un fișier din atelier — de folosit când ai creat unul din greșeală (ex. o migrație inutilă). Doar în atelier; ștergerea apare în diff-ul PR-ului pe care owner-ul îl vede.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'run', description: 'Rulează o comandă permisă: verificări (npm ci/build/test pe backend/frontend, git status/diff) SAU instalare de dependențe — `npm --prefix backend install <pachet>` / `npm --prefix frontend install <pachet>` — când ordinul cere o bibliotecă nouă (adaugă pachetul în package.json + lock).', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'finish', description: 'Close the work: PR title + body (body in Romanian, for the owner: what was done, how it was verified, what remains unverified). Call it ONLY after the self-check against the order — the change must actually fulfil what was asked. The system runs build+tests itself right after.', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } } },
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
  // ── AGENȚII SPECIALIȘTI (Adrian, 10 aug: „folosește la nevoie automat toți
  // agenții"; „când îți lipsește un TIP de agent, creează-l automat") ──────────
  { type: 'function', function: { name: 'cheama_agent', description: 'Deleagă o sub-sarcină unui agent specialist din roster (ex. un expert pe un domeniu). Folosește-l cât e cazul, automat, când sub-sarcina cade mai bine pe un specialist decât pe tine.', parameters: { type: 'object', properties: { agent: { type: 'string', description: 'id-ul agentului din roster' }, sarcina: { type: 'string', description: 'ce are de făcut, complet' } }, required: ['agent', 'sarcina'] } } },
  { type: 'function', function: { name: 'agent_nou', description: 'Creează un agent specialist NOU când îți lipsește TIPUL de care ai nevoie (instant, fără publicare — e o persona folosită imediat de cheama_agent). Dă un nume și rolul (meseria) lui. După ce-l creezi, cheamă-l cu cheama_agent.', parameters: { type: 'object', properties: { nume: { type: 'string' }, rol: { type: 'string', description: 'meseria/rolul agentului, min 10 caractere' } }, required: ['nume', 'rol'] } } },
]

// Care unelte NU se execută aici, ci în aplicație (browser Playwright în proces,
// secrete criptate, baza de date, operațiile de pe server). Lista se DERIVĂ din
// TOOLS, ca să nu poată rămâne în urmă: uneltele locale sunt cele 7 de fișiere,
// tot restul trece prin `/api/constructor/tool`.
const UNELTE_LOCALE = new Set(['ls', 'grep', 'read', 'write', 'edit', 'edit_lines', 'delete_file', 'run', 'finish'])
let UNELTE_PRIN_APLICATIE = new Set(
  TOOLS.map((t) => t.function.name).filter((n) => !UNELTE_LOCALE.has(n)),
)

// ── SURSA UNICĂ DE UNELTE (Adrian, 10 aug: „dă-i TOT, deblochează TOT") ────────
// Defs-urile LOCALE (fișiere) rămân aici — se execută în proces. Restul le cerem
// la pornire de la aplicație (GET /api/constructor/tool-defs, derivate din
// SHARED_ADMIN_TOOLS + agenți + browser), ca lista să nu mai poată rămâne în
// urmă față de creierul de chat. Dacă cererea pică din ORICE motiv, rămâne lista
// de rezervă de mai sus (TOOLS neatins) — constructorul nu poate ajunge fără unelte.
const UNELTE_LOCALE_DEFS = TOOLS.filter((t) => UNELTE_LOCALE.has(t.function.name))
async function incarcaUneltele() {
  try {
    const r = await api('/api/constructor/tool-defs')
    const primite = Array.isArray(r?.tools) ? r.tools.filter((t) => t?.function?.name) : []
    if (!primite.length) { log('unelte: lista de rezervă (aplicația n-a întors unelte)'); return }
    const numeLocale = new Set(UNELTE_LOCALE_DEFS.map((t) => t.function.name))
    const prinApp = primite.filter((t) => !numeLocale.has(t.function.name))
    TOOLS = [...UNELTE_LOCALE_DEFS, ...prinApp]
    UNELTE_PRIN_APLICATIE = new Set(TOOLS.map((t) => t.function.name).filter((n) => !UNELTE_LOCALE.has(n)))
    log(`unelte: ${TOOLS.length} din sursa unică (${prinApp.length} prin aplicație)`)
  } catch (e) {
    log(`unelte: lista de rezervă (cererea a picat: ${e?.message ?? e})`)
  }
}

// ── ANTI-RĂTĂCIRE (5 aug 2026 — cauza MĂSURATĂ a joburilor picate) ────────────
// Din jurnalul buclei: joburi cu 40 de grep-uri LA RÂND, zero editări, care au
// ars tot bugetul MAX_STEPS fără să producă (job 96: „40 pași cu unelte, 0
// sterili"). Cauza: un grep care „lucrează" numără ca pas UTIL exact ca un edit
// (aLucrat=true), deci explorarea pură golește bugetul de construcție. Owner-ul,
// 5 aug: „constructorul se pierde". Fixul: numărăm explorările CONSECUTIVE fără
// nicio producție; la prag, un ghiont TARE spre editare. Pur, exportat, probat.
export const UNELTE_EXPLORARE = new Set(['grep', 'ls', 'read'])
export const UNELTE_PRODUCTIE = new Set(['write', 'edit', 'edit_lines', 'delete_file'])
export const PRAG_EXPLORARE = 8

/** Actualizează contorul de explorare-fără-producție pentru o tură.
 *  `numeUnelte` = numele uneltelor folosite în tură; `aProdus` = a lucrat vreo
 *  unealtă de PRODUCȚIE (edit/write/edit_lines/delete_file). Întoarce
 *  {contor, ghiont}: contorul nou și dacă se cuvine ghiontul anti-rătăcire
 *  (prea multă explorare fără nicio editare). PURĂ — nicio atingere de disc. */
export function pasExplorare(numeUnelte, aProdus, contorVechi) {
  if (aProdus) return { contor: 0, ghiont: false }
  const aExplorat = numeUnelte.some((n) => UNELTE_EXPLORARE.has(n))
  const contor = aExplorat ? contorVechi + 1 : contorVechi
  if (contor >= PRAG_EXPLORARE) return { contor: 0, ghiont: true }
  return { contor, ghiont: false }
}

const SYSTEM = `You are KELIONAI'S BUILDER — the autonomous coding worker on the project's server.
Repo: backend/ (Node+Fastify+TS), frontend/ (React+Vite+TS), deploy/ (VPS scripts).

THE WORK METHOD — follow it 100%, in this order, on EVERY order (the tool-step budget is small, ~24; spend it on work, never on wandering):
1. UNDERSTAND. First message: restate the order in ONE line and name what proves it done. No tool call yet.
2. CHECK REALITY. Find the file with 'grep' (a pattern from the order) — do NOT explore with ls/read step by step. NEVER assume what the code says: read the actual lines ('read' with from/to, only the relevant range). Never read the same file twice. Do NOT read AI-HANDOFF.md (it is huge) unless the order explicitly asks about architecture.
3. PLAN. One line: which file(s) change and how the change will be verified.
4. EXECUTE. On existing files use 'edit' (EXACT old text → new text) or, on LARGE files, 'edit_lines' (give the from/to line numbers from 'read' + the new text — no text matching, immune to the output cap). NEVER 'write' a large existing file — your output has a cap and gets cut in half, corrupting it. Use 'write' only for NEW or small files. Fix the CAUSE, not the symptom; cleanly rewrite the responsible module — no band-aid patches; match the surrounding style. All code comments in ENGLISH. Changes STRICTLY inside the order's perimeter — nothing "on the fly"; never touch financial counters, never delete data.
   NEVER FAKE A FEATURE (owner's iron rule, 10 Aug, after order #166 shipped a "job search" with a HARDCODED job list and invented "AI adaptation" text): no simulated/hardcoded data presented as real, no mock lists, no invented outputs pretending to be a service. If the order needs search/AI/external data, wire the REAL services this app already has (webSearch via the brain, cheama_agent, db_query, browser_* — all through /api/constructor/tool). If the real integration is genuinely impossible from here, BUILD NOTHING FAKE — say so honestly in the PR body and via request_repair. A visibly missing feature is acceptable; a fake one is not.
5. PROVE. "Done" is never a claim — it is evidence. Before calling 'finish', re-read the order and check that your change actually FULFILS it (not merely that it compiles). Then call 'finish' IMMEDIATELY — do NOT run 'npm ci/build/test' yourself; the system verifies on its own after finish. The verification runs the SAME seven house gates as the PR gate: backend tsc, backend tests, frontend build, jscpd (ZERO duplicated code — extract a shared helper, never copy-paste), unused-exports (no export without a caller), syntax (no conflict markers, valid CSS/JSON), and BOOT on dist (the app must actually start and print "Server listening" — so never write a route/handler at module scope; register it inside the Fastify plugin where the fastify instance and the pool are in scope). If any gate fails you get a repair round with the exact error. Target: finish within ≤3 tool calls after finding the file.
   EXCEPTION — NEW dependency: if the order needs a package that does not exist yet, run 'run' with "npm --prefix backend install <package>" (or frontend) BEFORE finish — so package.json + lock stay in sync and verification passes.
6. REPORT HONESTLY. The PR body (in Romanian, for the owner) states three things: what was done, how it was verified, and what remains unverified. An honest "this could not be verified" is worth more than a confident guess. If the system tells you the build failed, repair the CAUSE and re-finish (you have a small number of repair rounds). Never hide a failure.

USE THE SPECIALIST AGENTS — automatically, whenever a sub-task fits a specialist better than you (owner's order, 10 Aug: "the builder must use, automatically when needed, all the agents"):
- If a sub-part of the order falls squarely in a specialty (design, SEO, security, database, tests, i18n, etc.), DELEGATE it with 'cheama_agent' (agent id + the full sub-task) instead of doing it half-well yourself. Fold the agent's answer back into your work — you still own the edit and the 'finish'.
- If you need a TYPE of specialist the roster does NOT have, create one on the spot with 'agent_nou' (a name + the role), briefly say which agent you created, then call it with 'cheama_agent'. Creating an agent is instant and needs no publish. Do this only when a real gap blocks the order — not as busywork.

PROJECT CONVENTIONS — know them; each one saves whole wasted steps (measured on real failed orders):
- DATABASE: the ENTIRE schema lives in backend/src/db.ts as "CREATE TABLE IF NOT EXISTS ..." inside the init SQL. This repo has NO knex, NO knexfile.ts, NO migrations/ folder — do NOT create migration files (they are dead weight here). To add a table or column, EDIT that SQL block in db.ts.
- LARGE existing files (backend/src/db.ts, backend/src/routes/admin.ts, frontend/src/components/AdminPanel.tsx): change them with 'edit' or 'edit_lines', NEVER 'write' — your output is capped and a whole-file rewrite gets cut, which corrupts the file and the order fails. After any edit that inserts or deletes lines the numbers SHIFT — 'read' the file again before the next 'edit_lines', or its from/to will point at the wrong place.
- To remove a file you created by mistake, use 'delete_file' (there is no shell 'rm').`

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

// ── SCARA DE MODELE OPENROUTER — EXTIRPATĂ (3 aug) ──────────────────────────
// Aici stăteau: MODEL_LADDER (pool-ul :free), MODELE_DOVEDIT_PROASTE, creierul
// plătit „Fable 5" (FABLE_MODEL / cereCreierFable / modelePentruOrdin), rotația
// circulară pe trepte și clasificarea erorilor OpenRouter. Toate au murit odată
// cu furnizorul — ordinul repetat al ownerului: „openrouter și open ai scos din
// toată aplicația". Creierul constructorului merge prin app (/api/constructor/creier:
// Gemini principal → Fable 5 rezervă); la eșec de furnizor, ordinul se AMÂNĂ onest (rămâne în coadă, se reia automat).
const LLM_ATTEMPTS = 6

// (Owner, 14 aug: creierul constructorului e PRIN APP — Gemini (principal) →
// Fable 5 (rezervă) —, rulat în app pe /api/constructor/creier. Aici, în
// constructor, NU mai există creier propriu pe RunPod/DeepInfra: `llmGemini` cere
// ruta din app, iar `llm()` doar reîncearcă pe eșec. Trezirea de placă RunPod a
// fost SCOASĂ — nu mai există placă proprie de trezit.)

// ── CREIERUL PRIN APP: GEMINI (principal) → FABLE 5 (rezervă) — owner, 14 aug ──
// Cerem creierul APLICAȚIEI pe ruta gardată cu bridge-secret. App-ul rulează
// Gemini „ultra" (Pro) ca principal și cade pe Fable 5 ca rezervă când Gemini nu
// poate; cheile (Gemini + Anthropic) + creditul stau în app, nu în constructor.
// Răspunsul vine în format OpenAI (ca de la orice creier), deci restul buclei nu
// știe pe ce creier a mers. `modelServit` din răspuns spune care a servit efectiv.
async function llmGemini(messages) {
  let r
  try {
    r = await fetch(`${APP}/api/constructor/creier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': BRIDGE },
      body: JSON.stringify({ messages, tools: TOOLS }),
      signal: AbortSignal.timeout(Math.max(30_000, Math.min(LLM_TIMEOUT_MS, ramase()))),
    })
  } catch (e) {
    throw new Error(`creier 2 rețea: ${String(e?.message ?? e).slice(0, 200)}`)
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) {
    const err = new Error(`creier 2 ${r.status}: ${text.slice(0, 200)}`)
    err.status = r.status
    throw err
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`creier 2 JSON rupt (${text.length} caractere)`)
  }
  const message = parsed?.choices?.[0]?.message
  if (!message) throw new Error('creier 2: răspuns fără candidați')
  const content = typeof message.content === 'string' ? message.content : ''
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  if (!content.trim() && !toolCalls.length) throw new Error('creier 2: răspuns gol')
  const out = { role: 'assistant', content }
  if (toolCalls.length) out.tool_calls = toolCalls
  const total = Number(parsed?.usage?.total_tokens)
  return {
    choices: [{ message: out }],
    usage: { total_tokens: Number.isFinite(total) ? total : 0 },
    modelServit: parsed?.modelServit || 'gemini/creier-2',
  }
}

// Ultimul creier care a SERVIT efectiv (pentru afișajul ONEST din raport/PR: dacă
// s-a căzut pe Fable 5, se vede Fable 5, nu Gemini). Setat în llm() la fiecare succes.
let ULTIMUL_CREIER = ''
async function llm(messages) {
  // CREIERUL E PRIN APP (owner, 14 aug): Gemini (principal) → Fable 5 (rezervă),
  // rulate în APP pe /api/constructor/creier (gardat cu bridge-secret). Aici, în
  // constructor, cerem DOAR ruta aia (llmGemini) și reîncercăm cu pauze crescătoare
  // pe eșec; ESCALADAREA Gemini→Fable5 și REVENIREA pe Gemini se fac în app (fiecare
  // pas nou reîncepe cu principalul). 401 = bridge-secret greșit → FATAL; orice alt
  // eșec (Gemini ȘI Fable 5 jos, sau app jos) → AMÂNABIL: ordinul se reia, nu moare.
  if (!BRIDGE)
    throw Object.assign(
      new Error(
        'creierul constructorului merge PRIN APP (/api/constructor/creier) — lipsește BRIDGE_SECRET, nu pot cere creierul aplicației',
      ),
      { fatal: true },
    )
  let lastErr = ''
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    if (ramase() <= 0) throw Object.assign(new Error('bugetul de timp al rulării s-a terminat'), { fatal: true })
    try {
      const rez = await llmGemini(messages)
      ULTIMUL_CREIER = rez.modelServit || NUME_FURNIZOR
      return rez
    } catch (e) {
      lastErr = String(e?.message ?? e)
      // 401 direct de la app = bridge-secret greșit; nicio reîncercare n-o repară → fatal.
      // Verificăm strict statusul HTTP 401 direct de la ruta /api/constructor/creier
      // (nu "401" apărut într-un corp de răspuns 502 al unui furnizor secundar).
      if (e?.status === 401 || /^creier 2 401\b/.test(lastErr)) {
        log(`llm [fatal] — app a refuzat creierul (bridge-secret incorect): ${lastErr.slice(0, 160)}`)
        throw Object.assign(new Error(lastErr), { fatal: true })
      }
      if (attempt === LLM_ATTEMPTS) break
      const wait = Math.min(attempt * 8_000, 30_000)
      log(`llm încercarea ${attempt}/${LLM_ATTEMPTS} a picat pe ${NUME_FURNIZOR} (${lastErr.slice(0, 90)}) — reîncerc în ${wait / 1000}s`)
      await dormi(wait)
    }
  }
  // Toate încercările au picat (Gemini ȘI Fable 5 în app, sau app jos) → AMÂNABIL:
  // ordinul rămâne în coadă și se reia automat (nu moare).
  throw Object.assign(new Error(lastErr || `${NUME_FURNIZOR} indisponibil după ${LLM_ATTEMPTS} încercări`), {
    amanabil: true,
  })
}

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
    if (/^EȘEC/.test(out)) return `verificarea a picat la „${cmd}":\n${out.slice(-2000)}`
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
  try {
    sh("PORT=18099 timeout 20 node dist/index.js 2>&1 | grep -qm1 'Server listening'", { cwd: ATELIER + '/backend', timeout: 30_000 })
  } catch {
    return 'poarta „bootul pe dist (Node curat)" a picat: aplicația nu a scris „Server listening" în 20s. Cauze uzuale: ciclu de importuri, cod la nivel de modul care aruncă la încărcare, sau o rută/`fastify.post` scrisă în afara plugin-ului (fără `fastify`/`getPool` în scope). Repară cauza, nu simptomul.'
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

async function main() {
  if (!BRIDGE || !GHTOKEN) {
    log('lipsesc BRIDGE_SECRET (creierul merge PRIN APP) / GITHUB_TOKEN din kelionai.env — ies')
    return
  }
  const claim = await api('/api/constructor/next')
  if (!claim?.job) return // coada goală sau pauza-autonomie — tăcere totală
  // Avem un ordin — abia acum aducem setul COMPLET de unelte din sursa unică
  // (dacă pică, rămâne lista de rezervă și tot poate lucra).
  await incarcaUneltele()
  beatJobId = Number(claim.job.id) || 0 // de-acum log() trimite pasul pe monitor
  const job = claim.job
  log(`ordin #${job.id} (încercarea ${job.attempts}): ${job.orderText.slice(0, 160)}`)
  // DOVADA CREIERULUI ACTIV (9 aug): scris în jurnal la fiecare ordin, ca să se
  // vadă negru pe alb pe ce rulează constructorul — creierul PRIN APP (Gemini → Fable 5).
  // modelServit din răspuns cară creierul care a SERVIT efectiv, în raport.
  log(`creier constructor: ${NUME_FURNIZOR} — Gemini principal, Fable 5 rezervă (rulate în app pe /api/constructor/creier)`)

  // `tries` mai mic la închiderea forțată: handlerul de SIGTERM are doar ~20s
  // până ne omorâm singuri, deci acolo nu ne permitem cele 8 reîncercări.
  // (CONTABILITATEA DE COST a fost EXTIRPATĂ cu totul, 3 aug — Gemini nu
  // itemizează cost per apel. Invariantul din bug-ul ordinelor #32/#34 —
  // „report() nu moare pe variabile din alt scope" („ReferenceError:
  // tokensPaid is not defined" DUPĂ ce PR-ul fusese deschis) — e ținut prin
  // ELIMINARE: report() nu mai citește nicio variabilă de cost.)
  const report = (status, extra = {}, tries = 8) =>
    api(
      '/api/constructor/report',
      {
        method: 'POST',
        // Creierul merge în FIECARE raport (succes sau eșec). 'free' = „nu e
        // ordinul plătit expres Fable 5" (marcaj istoric ținut de API); Gemini
        // nu itemizează un cost per apel, deci costUsd nu se trimite — o cifră
        // neraportată de furnizor NU se inventează (regula #1).
        body: JSON.stringify({
          id: job.id,
          status,
          log: logLines.join('\n'),
          brain: 'free',
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
    const url = `https://x-access-token:${GHTOKEN}@github.com/${REPO}.git`
    let rapid = false
    if (fs.existsSync(path.join(ATELIER, '.git'))) {
      try {
        execFileSync('git', ['-C', ATELIER, 'remote', 'set-url', 'origin', url], { stdio: 'pipe', timeout: 30_000 })
        execFileSync('git', ['-C', ATELIER, 'fetch', '--depth', '50', 'origin', 'master'], { stdio: 'pipe', timeout: 120_000 })
        execFileSync('git', ['-C', ATELIER, 'reset', '--hard', 'FETCH_HEAD'], { stdio: 'pipe', timeout: 60_000 })
        execFileSync('git', ['-C', ATELIER, 'clean', '-fd'], { stdio: 'pipe', timeout: 60_000 }) // FĂRĂ -x → node_modules (ignorat) rămâne
        rapid = true
      } catch {
        rapid = false
      }
    }
    if (!rapid) {
      fs.rmSync(ATELIER, { recursive: true, force: true })
      execFileSync('git', ['clone', '--depth', '50', url, ATELIER], { stdio: 'pipe', timeout: 120_000 })
    }
    const baseSha = sh('git rev-parse --short=7 HEAD').trim()
    log(`atelier pe ${baseSha}${rapid ? ' (persistent, node_modules cald)' : ' (clonă curată)'}`)

    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `ORDINUL DE CONSTRUCȚIE (de la owner):\n\n${job.orderText}` },
    ]
    // ── ÎNVĂȚAREA DIN ÎNCERCAREA ANTERIOARĂ (10 aug, ownerul: „ajută-l să
    // treacă de blocaje ÎNVĂȚÂNDU-L") ──────────────────────────────────────────
    // Un ordin repus — manual („reia", care păstrează jurnalul) sau reclamat
    // după un worker mort — pornea până acum ORB: doar system+ordin, fără nicio
    // urmă a ce a picat data trecută. Deci repeta EXACT greșeala care l-a blocat,
    // până la abandonul de la 3 încercări. Acum, dacă ordinul are jurnal de la o
    // încercare anterioară, i-l dăm și îi cerem O ALTĂ strategie — să învețe, nu
    // să reia orbește.
    const jurnalVechi = String(job.log ?? '').trim()
    if (jurnalVechi) {
      messages.push({
        role: 'user',
        content:
          'ATENȚIE — ordinul ăsta A MAI FOST ÎNCERCAT și NU s-a terminat. Mai jos e coada ' +
          'jurnalului încercării anterioare. CITEȘTE-L întâi și află DE CE a picat (build/test ' +
          'roșu, fișier greșit, plafon de pași, verificare picată, unealtă/agent lipsă). Apoi ia ' +
          'o ABORDARE DIFERITĂ — nu relua aceiași pași care au dus la blocaj. Dacă îți lipsește un ' +
          'specialist, creează-l cu agent_nou și cheamă-l cu cheama_agent. Dacă ordinul e prea mare ' +
          'pentru bugetul de pași, fă partea esențială și notează restul cu request_repair.\n\n' +
          `--- JURNALUL ÎNCERCĂRII ANTERIOARE (coadă) ---\n${jurnalVechi.slice(-3500)}`,
      })
      log(`ordin reîncercat — dau agentului jurnalul vechi (${jurnalVechi.length} car.) ca să învețe din el, nu să repete`)
    }
    let tokens = 0
    // (Contabilitatea „tokensPaid/costUsd/costMasurat" pe scara plătită
    // OpenRouter a fost EXTIRPATĂ, 3 aug: Gemini nu itemizează cost per apel;
    // tokenii se numără din usageMetadata și se raportează ca atare.
    // Invariantul din bug-ul ordinelor #32/#34 — `report()` nu are voie să
    // moară pe variabile din alt scope — e ținut prin ELIMINARE: report() nu
    // mai citește nicio variabilă de cost.)
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
    let explorareFaraProductie = 0 // explorări CONSECUTIVE fără nicio editare (anti-rătăcire)
    const greppuriVazute = new Set() // pattern-uri deja căutate — nu le repetăm în gol
    // Rezultate care înseamnă „unealta a REFUZAT", nu „unealta a lucrat".
    const RE_REFUZ = /^(EROARE|REFUZAT|unealtă necunoscută|comandă nepermisă|pattern gol)/
    // BUCLA MARE = ordinul întreg, cu rundele lui de reparație. Bucla mică
    // (while) = dialogul cu modelul până la 'finish'; după fiecare finish
    // verificăm în atelier și, dacă e roșu, ne întoarcem aici cu eroarea în mână.
    for (;;) {
      while (!finish) {
        if (pasiUtili >= MAX_STEPS)
          throw new Error(`plafon de pași atins fără finish (${pasiUtili} pași cu unelte, ${pasiSterili} sterili)`)
        // NEPUTINȚĂ: modelul povestește în loc să lucreze. Până la 2 aug se
        // urca aici pe un model capabil PLĂTIT — desființat („nimic altceva
        // plătit, niciodată"): ordinul eșuează onest, cu diagnostic.
        if (pasiSterili >= MAX_STERILE) {
          throw new Error(
            `modelul nu folosește uneltele: ${pasiSterili} ture fără nicio unealtă validă (creier: ${ULTIMUL_CREIER || NUME_FURNIZOR})`,
          )
        }
        // Ne oprim ÎNAINTE de `timeout 1800` din constructor-worker.sh, ca să mai
        // rămână timp de verificare + push + PR + RAPORT. Omorâți de timeout am
        // muri muți, iar ordinul ar rămâne „running" 40 de minute și ar arde o
        // încercare din trei degeaba.
        if (ramase() < 6 * 60_000)
          throw new Error(`timpul rulării s-a terminat înainte de finish (${pasiUtili} pași utili, ${pasiSterili} sterili)`)
        const resp = await llm(messages)
        const tokPas = Number(resp.usage?.total_tokens ?? 0)
        tokens += tokPas
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
          // CE SPUNE MODELUL CÂND SE BLOCHEAZĂ (owner, 12 aug: „dă-i acces să
          // citească logurile dacă eșuează" — dar logul avea doar pașii, NU
          // cauza). Scoatem în jurnal exact ce a scris modelul în loc să cheme o
          // unealtă → cauza reală intră în log, ca (1) owner-ul s-o vadă, (2)
          // reîncercarea s-o citească și să ia altă abordare, nu să repete orb.
          const spus = String(msg.content ?? '').replace(/\s+/g, ' ').trim()
          log(`tură sterilă ${pasiSterili}/${MAX_STERILE} — modelul a scris în loc să lucreze: ${spus.slice(0, 400) || '(răspuns gol)'}`)
          messages.push({
            role: 'user',
            content: `Continue with the tools (grep/read/edit/write/run) or call finish. Don't narrate — work. (${pasiSterili}/${MAX_STERILE} wasted turns)`,
          })
          compactHistory(messages)
          continue
        }
        let aLucrat = false
        let aProductie = false // a lucrat vreo unealtă de PRODUCȚIE în tura asta? (edit/write/...)
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
            else if (c.function.name === 'grep') {
              const pat = String(args.pattern ?? '')
              if (greppuriVazute.has(pat))
                result = `(deja ai căutat „${pat}" — rezultatul e mai sus. NU repeta căutări; folosește ce ai și EDITEAZĂ acum, sau finish.)`
              else {
                greppuriVazute.add(pat)
                result = toolGrep(pat)
              }
            }
            else if (c.function.name === 'read') result = toolRead(String(args.path ?? ''), Number(args.from), Number(args.to))
            else if (c.function.name === 'write') result = toolWrite(String(args.path ?? ''), String(args.content ?? ''))
            else if (c.function.name === 'edit') result = toolEdit(String(args.path ?? ''), String(args.old ?? ''), String(args.new ?? ''))
            else if (c.function.name === 'edit_lines') result = toolEditLines(String(args.path ?? ''), Number(args.from), Number(args.to), String(args.new ?? ''))
            else if (c.function.name === 'delete_file') result = toolDelete(String(args.path ?? ''))
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
          if (!RE_REFUZ.test(result)) {
            aLucrat = true
            if (UNELTE_PRODUCTIE.has(c.function.name)) aProductie = true // editare reală
          }
          if (c.function.name !== 'read')
            log(
              `pas ${pasiUtili + 1}/${MAX_STEPS}: ${c.function.name} ${String(args.path ?? args.cmd ?? args.dir ?? args.pattern ?? '').slice(0, 80)}` +
                (RE_REFUZ.test(result) ? ` → ${result.slice(0, 90)}` : ''),
            )
          // Plafon per-rezultat: o CITIRE de fișier are voie mai mult (ca să
          // vadă fișierul întreg, nu jumătate — altfel edita pe orb și cădea);
          // restul uneltelor rămân la plafonul mic (era 100k — sursa exploziei).
          // Fereastra glisantă de mai jos comprimă oricum rezultatele vechi.
          const capRezultat = c.function.name === 'read' ? READ_CAP_FISIER : READ_CAP
          messages.push({ role: 'tool', tool_call_id: c.id, content: result.slice(0, capRezultat) })
        }
        // Contor de sterile CONSECUTIVE, nu cumulative (MĂSURAT, ordin #187: modele
        // care făceau 13-18 pași REALI mureau fiindcă adunau 8 ture de „gândit cu voce
        // tare" RĂSPÂNDITE printre pași — deși LUCRAU). Un pas productiv resetează
        // contorul; mor doar buclele de pură povestire (8 la RÂND fără unealtă utilă).
        if (aLucrat) {
          pasiUtili++
          pasiSterili = 0
        } else pasiSterili++
        // ANTI-RĂTĂCIRE: dacă modelul explorează întruna (grep/ls/read) fără nicio
        // editare, la PRAG_EXPLORARE îl ghiontim TARE spre producție — altfel
        // arde tot bugetul pe explorare (job 96: 40 grep-uri, 0 editări).
        const ghiontExpl = pasExplorare(calls.map((c) => c.function.name), aProductie, explorareFaraProductie)
        explorareFaraProductie = ghiontExpl.contor
        if (ghiontExpl.ghiont) {
          messages.push({
            role: 'user',
            content: `You have explored ${PRAG_EXPLORARE}+ times (grep/ls/read) WITHOUT a single edit. You have enough context — STOP exploring. Make an edit NOW (edit/edit_lines/write) or call finish. Do NOT grep/read again.`,
          })
        }
        // FEREASTRA GLISANTĂ (fixul structural, audit 27 iul): comprimă
        // rezultatele uneltelor VECHI la un ciot de o linie — modelul păstrează
        // firul (ce a făcut) fără să care conținutul integral al fiecărei citiri
        // pe veci. Doar ultimele KEEP_VERBATIM rezultate rămân întregi.
        compactHistory(messages)
      }

      // VERIFICAREA NOASTRĂ, nu pe încredere: ce s-a atins trebuie să compileze.
      const tVerif = Date.now()
      const problema = verificaAtelierul()
      const durataVerif = Date.now() - tVerif
      if (!problema) break
      // RUNDA DE REPARAȚIE. System promptul îi promite modelului: „dacă sistemul
      // îți spune că buildul a picat, repari și re-finish" — dar codul vechi NU
      // dădea niciodată runda aia: la primul build roșu arunca direct și ordinul
      // ieșea EȘUAT. Un model gratuit greșește un import sau un tip la prima
      // scriere; asta singură explică o parte din ordinele picate „end-to-end".
      // GARDA DE TIMP, ADAPTIVĂ (10 aug): garda fixă de 10 min renunța DES cu timp
      // pe ceas — mai ales de când verificarea rulează toate cele 7 porți și ține
      // mai mult. O rundă reală mai încape dacă a rămas cât o verificare completă
      // (durataVerif) + un tur de reparație + tamponul de push/PR/raport. Bucla
      // internă are oricum garda ei (ramase() < 6 min) care protejează coada.
      const nevoieRunda = Math.max(7 * 60_000, durataVerif + 2 * 60_000)
      if (reparatii >= MAX_REPAIR || ramase() < nevoieRunda) {
        throw new Error(problema)
      }
      reparatii++
      finish = null
      log(`verificarea a picat — runda de reparație ${reparatii}/${MAX_REPAIR}`)
      messages.push({
        role: 'user',
        content: `THE VERIFICATION FAILED in the workshop. Repair the CAUSE (do not patch over it) and call 'finish' again.\n\n${problema.slice(-3000)}`,
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

    // CREIERUL, SCRIS ÎN PR (regula din 2 aug: alegerea modelului e VIZIBILĂ).
    // Furnizorul nu itemizează cost per apel — se raportează DOAR tokenii măsurați.
    const linieCreier = `Creier folosit: ${ULTIMUL_CREIER || NUME_FURNIZOR} · tokeni: ${tokens}`
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
