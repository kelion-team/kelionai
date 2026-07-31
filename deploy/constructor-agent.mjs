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
// eroare arăta „connect ECONNREFUSED 1