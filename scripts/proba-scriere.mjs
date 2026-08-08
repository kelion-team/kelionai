#!/usr/bin/env node
// ── CE FAC BUTOANELE CARE SCRIU (Adrian, 8 aug: „tot ce e în admin trebuie
// probat și să facă, real" + „cu dovezi măsurate") ───────────────────────────
//
// `proba-rute.mjs` lovește doar GET-uri — scrie limpede în capul lui: „NU
// trimite nimic distructiv". Corect ca precauție, dar înseamnă că butoanele
// care CHIAR fac ceva (Reset VPS, Creează agenți, Blochează utilizator,
// Restaurează backup) n-au fost atinse niciodată. Adică fix cele din admin
// despre care ownerul zice „e varză" rămâneau nemăsurate.
//
// CE FACE PROBA ASTA, ALTFEL:
//
//   1. Pornește serverul cu MEDIU CURĂȚAT (scripts/lib/server-proba.mjs).
//      Fără GITHUB_TOKEN, fără token Google, fără chei de plată, fără poștă.
//      Asta e ce face sigură proba: `reset-vps` chiar intră în handler, chiar
//      cheamă `runRunbook`, dar `runRunbook` se oprește pe `if (!ghToken())`.
//      Codul e probat pe tot drumul lui; mâna lui nu ajunge nicăieri.
//
//   2. Fiecare rută e lovită de DOUĂ ori:
//      a) FĂRĂ bilet → o rută privilegiată TREBUIE să refuze. Un 2xx aici e
//         cel mai grav lucru pe care-l poate găsi proba: panou fără poartă.
//      b) CU bilet de admin → statusul REAL. Aici 403 e defect, nu succes
//         (Adrian, 8 aug: „403 greșit, real trebuie 200").
//
//   3. Ce nu se poate măsura de aici (bază de date, chei externe) se raportează
//      „NU POT VERIFICA", niciodată „ok".
//
// Rulare:  node scripts/proba-scriere.mjs
import fs from 'node:fs'
import path from 'node:path'
import { RADACINA, porneste } from './lib/server-proba.mjs'

const PORT = Number(process.env.PROBA_PORT || 18101)

function fisiere(dir) {
  const out = []
  const mers = (d) => {
    let intrari
    try {
      intrari = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of intrari) {
      if (it.name === 'node_modules' || it.name === 'dist' || it.name.startsWith('.')) continue
      const p = path.join(d, it.name)
      if (it.isDirectory()) mers(p)
      else if (it.name.endsWith('.ts') && !it.name.endsWith('.test.ts')) out.push(p)
    }
  }
  mers(dir)
  return out
}

/** Rutele care SCRIU, din cod. Aceeași lecție ca la GET: se cere `(` după verb
 *  (eventual cu generice TS între), altfel `.delete(` din `Set.delete(x)` intră
 *  în listă ca rută. */
function ruteScriere() {
  const rute = new Map()
  for (const f of fisiere(path.join(RADACINA, 'backend/src'))) {
    let src
    try {
      src = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(
      /\.(post|put|patch|delete)\s*(?:<[\s\S]{0,3000}?>)?\s*\(\s*['"`](\/api\/[^'"`]*)/g,
    )) {
      const cale = m[2].replace(/\/+$/, '')
      rute.set(`${m[1].toUpperCase()} ${cale}`, { metoda: m[1].toUpperCase(), cale })
    }
  }
  return [...rute.values()].sort((a, b) => `${a.cale}${a.metoda}`.localeCompare(`${b.cale}${b.metoda}`))
}

/** Parametrii primesc o valoare inofensivă, ca ruta să fie chiar atinsă. */
const concret = (r) => r.replace(/:[A-Za-z_]+/g, 'proba')

// ── CE E PRIVILEGIAT ─────────────────────────────────────────────────────────
// Rutele astea NU au voie să răspundă 2xx fără bilet. Lista e pe prefixe, ca o
// rută nouă de admin să intre automat sub gard — nu prin ținere de minte.
const PRIVILEGIAT = [
  '/api/admin/',
  '/api/enterprise/',
  '/api/me/',
  '/api/prefs',
  '/api/notes',
  '/api/voiceprint/',
  '/api/billing/',
  '/api/models/',
  '/api/tranzactii/',
]
const ePrivilegiat = (cale) => PRIVILEGIAT.some((p) => cale.startsWith(p))

// ── CORPURI ──────────────────────────────────────────────────────────────────
// Implicit `{}`: o rută care validează și răspunde 400 e SĂNĂTOASĂ — a rulat,
// a citit corpul, a spus ce lipsește. Unde am putut construi un corp cinstit și
// inofensiv, îl trimit, ca să se vadă drumul complet, nu doar validarea.
const CORP = {
  'POST /api/client-errors': { errors: ['proba: eroare inventată de probă'] },
  'POST /api/visit': { fp: 'proba', ref: 'proba' },
  'POST /api/visit/ping': { fp: 'proba' },
  'POST /api/notes': { title: 'proba', content: 'proba' },
  'PUT /api/models/selection': { chat: 'model-inexistent-de-proba' },
  'POST /api/admin/user': { email: 'proba-nimeni@local.test', action: 'necunoscut' },
  'POST /api/admin/translate': { texts: ['proba'] },
  'POST /api/ops/alert': { key: 'proba', subject: 'proba' },
  'POST /api/ops/pulse': { event: 'proba' },
  'POST /api/lead': { email: 'proba-nimeni@local.test', note: 'proba' },
  'POST /api/contact': { email: 'proba-nimeni@local.test', message: 'proba' },
  'POST /api/visitor-chat/send': { conv: 'proba', text: 'proba' },
}

async function loveste(ruta, cookie) {
  const url = `http://127.0.0.1:${PORT}${concret(ruta.cale)}`
  const cheie = `${ruta.metoda} ${ruta.cale}`
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  try {
    const r = await fetch(url, {
      method: ruta.metoda,
      headers,
      body: JSON.stringify(CORP[cheie] ?? {}),
      signal: AbortSignal.timeout(15000),
    })
    const corp = (await r.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
    return { status: r.status, corp }
  } catch (e) {
    return { status: 0, corp: String(e).slice(0, 120) }
  }
}

// „Nu pot verifica" = lipsește ceva din MEDIU (bază de date, cheie externă),
// nu e un defect al codului. Distincția e tot ce separă un raport onest de
// alarmă falsă — am raportat o dată `db_unreadable` ca „crapă" și greșeam.
//
// A DOUA GREȘEALĂ A MEA, la a doua rulare: am lărgit tiparul cu `_lipsa`, ca să
// prind `revolut_link_lipsa` — și a înghițit `uids_lipsa`, care e o eroare de
// VALIDARE (n-am trimis uid-uri), nu o lipsă de mediu. Adică exact ce vânez:
// roșu făcut verde prin lărgirea gardului. Corectat: două liste precise, și se
// aplică DOAR pe 5xx. Un 4xx rămâne „a răspuns argumentat", orice ar scrie.
const LIPSA_CHEI =
  /github_token|missing [A-Z]|missing Enable Banking|revolut_link_lipsa|ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|no_api_key|missing_key|not configured|neconfigurat/i
const LIPSA_DB = /db_unreadable|db_indisponibil|recovery_unreadable|no_db|save_failed|_esuat/i

// ── REGULA CARE PRINDE TOATĂ FAMILIA ────────────────────────────────────────
// Patru bug-uri din aceeași zi (reset-vps, reset-counters, voiceprint, analiza
// de piață) aveau exact aceeași formă: HTTP 2xx peste un corp care spune că
// operația a EȘUAT. Un apelant care se uită la `res.ok` — panoul, uneltele lui
// Kelion, orice script — citește „a mers". Nu le mai vânez unul câte unul: orice
// 2xx cu `"ok":false` sau cu un câmp `error` în corp e defect, măsurat la
// fiecare rulare, pe toate rutele deodată.
const MINTE = (x) =>
  x.status >= 200 && x.status < 300 && /"ok"\s*:\s*false|"error"\s*:/.test(x.corp)

/** `bazaVie` se MĂSOARĂ înainte (vezi mai jos), nu se presupune: o scriere
 *  picată e „nu pot verifica" doar dacă baza chiar lipsește de aici. Cu baza
 *  vie, exact același răspuns ar fi un defect adevărat — și trebuie să iasă roșu. */
function clasa(x, bazaVie) {
  if (x.status === 0) return 'MUT'
  if (x.status === 404 && /Route\s+(POST|PUT|PATCH|DELETE):/i.test(x.corp)) return 'LIPSĂ'
  if (x.status >= 500) {
    if (LIPSA_CHEI.test(x.corp)) return 'NU POT VERIFICA (lipsă cheie externă)'
    if (!bazaVie && LIPSA_DB.test(x.corp)) return 'NU POT VERIFICA (fără bază de date aici)'
    return 'CRAPĂ'
  }
  if (x.status === 401 || x.status === 403) return 'REFUZĂ BILETUL'
  if (MINTE(x)) return 'MINTE (2xx peste un eșec)'
  if (x.status >= 200 && x.status < 300) return 'MERGE (2xx)'
  // 400/404-de-conținut/409/422/423: ruta A RULAT și a răspuns argumentat.
  return 'RĂSPUNDE ARGUMENTAT (4xx)'
}

const rute = ruteScriere()
if (rute.length === 0) {
  console.error('\n❌ NU POT VERIFICA: n-am găsit nicio rută de scriere în cod.\n')
  process.exit(2)
}

console.log(`\nProbez ${rute.length} rute care SCRIU, pe un server local cu mediu curățat (port ${PORT})…`)

let server
try {
  server = await porneste({ port: PORT })
} catch (e) {
  console.error(`\n❌ NU POT VERIFICA: mediul de probă n-a trecut auto-verificarea — ${e.message}\n`)
  process.exit(2)
}
console.log(`Mediu dat serverului: ${Object.keys(server.env).sort().join(', ')}\n`)

if (!server.ok) {
  server.opreste()
  console.error('\n❌ NU POT VERIFICA: serverul nu s-a ridicat în 40s. Ultimele rânduri:\n')
  console.error(server.iesire().slice(-1500))
  process.exit(2)
}

// ── STAREA BAZEI DE DATE: UN FAPT, NU O DEDUCȚIE ─────────────────────────────
// Fără pasul ăsta, „scrierea a picat" și „nu e nicio bază aici" arată identic —
// și aș fi ales interpretarea care-mi convine.
//
// Prima variantă întreba `/api/admin/users` și se uita la răspuns. A ieșit
// „baza e citibilă" — pe un server căruia NU-i dădusem `DATABASE_URL`. Cauza,
// în `db.ts`: `listUsers()` face `if (!dbEnabled()) return []` și `catch {
// return [] }`, deci o citire IMPOSIBILĂ iese pe sârmă ca „0 utilizatori".
// Adică fix familia „£0.00" — un citit picat prezentat ca fapt stabilit. Nu se
// poate deduce starea bazei dintr-un răspuns care minte despre ea.
//
// Deci nu deduc: MĂSOR faptul pe care-l controlez — ce i-am dat serverului la
// pornire. `dbEnabled()` e `Boolean(config.databaseUrl)`, iar mediul e construit
// de mine, aici, cu listă albă.
const bazaVie = Boolean(server.env.DATABASE_URL)
console.log(
  bazaVie
    ? 'BAZA DE DATE: pornită cu DATABASE_URL — o scriere picată e defect, nu scuză.\n'
    : 'BAZA DE DATE: serverul de probă a pornit FĂRĂ DATABASE_URL — scrierile în ea se raportează „nu pot verifica", niciodată „ok".\n',
)

const rez = []
for (const ruta of rute) {
  const faraBilet = await loveste(ruta, null)
  const cuBilet = await loveste(ruta, server.cookie)
  rez.push({ ...ruta, cheie: `${ruta.metoda} ${ruta.cale}`, faraBilet, cuBilet })
}
server.opreste()

// ── DEFECTE ──────────────────────────────────────────────────────────────────
// 1. Poartă lipsă: rută privilegiată care răspunde 2xx FĂRĂ bilet.
const faraPoarta = rez.filter((x) => ePrivilegiat(x.cale) && x.faraBilet.status >= 200 && x.faraBilet.status < 300)
// 2. Ruta crapă, tace, nu există la rulare — sau MINTE (2xx peste un eșec).
const stricate = rez.filter((x) => ['CRAPĂ', 'MUT', 'LIPSĂ', 'MINTE (2xx peste un eșec)'].includes(clasa(x.cuBilet, bazaVie)))
// 3. Refuză biletul de admin: ori are o poartă în plus (secret separat,
//    amprentă vocală), ori nu ne recunoaște. Nu e automat defect — dar trebuie
//    numit, nu ascuns într-un total.
const refuza = rez.filter((x) => clasa(x.cuBilet, bazaVie) === 'REFUZĂ BILETUL')

const grupe = {}
for (const x of rez) (grupe[clasa(x.cuBilet, bazaVie)] ??= []).push(x)

console.log('REZULTAT MĂSURAT — cu bilet de admin, apeluri reale:\n')
for (const [g, lista] of Object.entries(grupe).sort()) console.log(`  ${g}: ${lista.length}`)

const pazite = rez.filter((x) => ePrivilegiat(x.cale))
console.log(
  `\nPOARTA: ${pazite.length - faraPoarta.length}/${pazite.length} rute privilegiate refuză cererea fără bilet.\n`,
)

for (const g of ['MERGE (2xx)', 'RĂSPUNDE ARGUMENTAT (4xx)', 'NU POT VERIFICA (lipsă cheie externă)', 'NU POT VERIFICA (fără bază de date aici)']) {
  const lista = grupe[g] ?? []
  if (!lista.length) continue
  console.log(`${g} (${lista.length}):`)
  for (const x of lista) console.log(`  ${String(x.cuBilet.status).padEnd(4)} ${x.cheie}  ${x.cuBilet.corp.slice(0, 60)}`)
  console.log('')
}

if (refuza.length) {
  console.log(`REFUZĂ BILETUL DE ADMIN (${refuza.length}) — au altă poartă sau nu ne recunosc:`)
  for (const x of refuza) console.log(`  ${x.cuBilet.status}  ${x.cheie}  ${x.cuBilet.corp.slice(0, 60)}`)
  console.log('')
}

if (faraPoarta.length) {
  console.error(`❌ ${faraPoarta.length} rute PRIVILEGIATE răspund 2xx FĂRĂ bilet — poartă lipsă:\n`)
  for (const x of faraPoarta) console.error(`  ${x.faraBilet.status} ${x.cheie}\n       ${x.faraBilet.corp}`)
  console.error('')
}
if (stricate.length) {
  console.error(`❌ ${stricate.length} rute care crapă, tac sau nu există la rulare:\n`)
  for (const x of stricate) console.error(`  ${String(x.cuBilet.status).padEnd(4)} ${x.cheie}\n       ${x.cuBilet.corp}`)
  console.error('')
}

if (!faraPoarta.length && !stricate.length) {
  console.log('✅ Nicio rută de scriere nu crapă, nu tace, nu lipsește; fiecare rută privilegiată are poartă.\n')
  process.exit(0)
}
process.exit(1)
