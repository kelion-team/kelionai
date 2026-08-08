#!/usr/bin/env node
// ── CE ÎNTORC RUTELE CU ADEVĂRAT (Adrian, 8 aug: „tu verifici și funcționarea și
// ce întorc butoanele real? că în admin e varză") ────────────────────────────
//
// Întrebare dreaptă. `verifica-butoane.mjs` verifică STATIC că fiecare adresă
// chemată din frontend are o rută în backend. Aia NU dovedește că ruta răspunde,
// nici CE răspunde. O rută înregistrată care crapă la primul apel arată identic
// cu una sănătoasă, la citit.
//
// Aici se pornește aplicația pe un port liber și se LOVEȘTE fiecare rută, fără
// sesiune. Ce se măsoară e statusul REAL:
//
//   2xx  răspunde public — normal pentru rutele publice; SUSPECT pe /api/admin/*
//        (ar însemna panou fără poartă)
//   401/403  rută vie și PĂZITĂ — răspunsul corect pentru admin fără sesiune
//   404  ruta nu există la rulare, deși e scrisă în cod (înregistrare ratată)
//   5xx  RUTA CRAPĂ — bug real: o eroare neprinsă înainte de verificarea de acces
//   fără răspuns  serverul a murit sau s-a blocat pe ruta asta
//
// Un 500 pe un apel neautentificat e un defect adevărat: codul a apucat să
// lucreze înainte să verifice cine întreabă. Alea sunt „varza" din admin.
//
// NU trimite nimic distructiv: doar GET-uri, și doar pe rutele GET.
//
// Rulare:  node scripts/proba-rute.mjs
import fs from 'node:fs'
import path from 'node:path'
import { RADACINA, porneste } from './lib/server-proba.mjs'

// ── PROBĂ AUTENTIFICATĂ (Adrian, 8 aug: „403 greșit, real trebuie 200") ──────
// Un 403 dovedește doar că poarta e acolo, NU că butonul face ceva. Ca să vedem
// ce întorc rutele CU ADEVĂRAT, serverul de probă pornește cu un secret de
// sesiune și un email de admin GENERATE AICI, iar proba își semnează singură un
// bilet cu ele. E instanța noastră locală, pornită și oprită de script — nicio
// atingere de producție, niciun secret real folosit.
//
// Pornirea (și CURĂȚAREA MEDIULUI) stau în `lib/server-proba.mjs`: prima
// variantă dădea serverului `...process.env`, adică inclusiv GITHUB_TOKEN-ul
// din mediul în care rulează probele. Vezi acolo de ce era o mină.

const PORT = Number(process.env.PROBA_PORT || 18100)

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

/** Rutele GET din cod. Doar GET: o probă nu are voie să scrie nimic.
 *  `\.get` simplu prindea și `getSessionUser(`, iar o fereastră largă sărea în
 *  ruta următoare și raporta adrese POST ca fiind GET. Acum se cere `.get(` sau
 *  `.get<…>(` — prins la prima rulare, pe rezultate care nu se legau. */
function ruteGet() {
  const rute = new Set()
  for (const f of fisiere(path.join(RADACINA, 'backend/src'))) {
    let src
    try {
      src = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/\.get\s*(?:<[\s\S]{0,3000}?>)?\s*\(\s*['"`](\/api\/[^'"`]*)/g)) {
      rute.add(m[1].replace(/\/+$/, ''))
    }
  }
  return [...rute].sort()
}

/** Parametrii primesc o valoare inofensivă, ca ruta să fie chiar atinsă. */
const concret = (r) => r.replace(/:[A-Za-z_]+/g, 'proba')

const rute = ruteGet()
if (rute.length === 0) {
  console.error('\n❌ NU POT VERIFICA: n-am găsit nicio rută GET în cod.\n')
  process.exit(2)
}

console.log(`\nProbez ${rute.length} rute GET pe un server pornit local (port ${PORT})…\n`)

let server
try {
  server = await porneste({ port: PORT })
} catch (e) {
  console.error(`\n❌ NU POT VERIFICA: mediul de probă n-a trecut auto-verificarea — ${e.message}\n`)
  process.exit(2)
}

if (!server.ok) {
  server.opreste()
  console.error('\n❌ NU POT VERIFICA: serverul nu s-a ridicat în 40s. Ultimele rânduri:\n')
  console.error(server.iesire().slice(-1200))
  process.exit(2)
}

const rez = []
for (const r of rute) {
  const url = `http://127.0.0.1:${PORT}${concret(r)}`
  try {
    const raspuns = await fetch(url, { headers: { cookie: server.cookie }, signal: AbortSignal.timeout(12000) })
    const corp = (await raspuns.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ')
    rez.push({ ruta: r, status: raspuns.status, corp })
  } catch (e) {
    rez.push({ ruta: r, status: 0, corp: String(e).slice(0, 100) })
  }
}
server.opreste()

const clasa = (x) => {
  if (x.status === 0) return 'MUT'
  // FĂRĂ BAZĂ DE DATE AICI: proba rulează pe o instanță locală goală, deci
  // rutele care citesc din Postgres răspund cinstit „db_unreadable" /
  // „recovery_unreadable". ALEA NU SUNT DEFECTE — sunt chiar comportamentul
  // corect (ruta spune „nu pot citi", nu „0 rânduri"). Le-am raportat o dată ca
  // „crapă" și era alarmă falsă: nu pot verifica rutele de bază de date de aici.
  if (x.status >= 500 && /db_unreadable|recovery_unreadable|no_db|database/i.test(x.corp)) {
    return 'NU POT VERIFICA (fără bază de date aici)'
  }
  if (x.status >= 500) return 'CRAPĂ'
  if (x.status === 404) {
    // DISTINCȚIA care lipsea: un 404 cu mesajul cadrului („Route GET:/… not
    // found") înseamnă rută NEÎNREGISTRATĂ. Un 404 cu mesajul APLICAȚIEI
    // („agent necunoscut", „not_found") înseamnă că ruta A RULAT și a răspuns
    // corect pentru un id inexistent — i-am dat „proba" ca parametru, normal
    // că nu-l găsește. Prima rulare le-a amestecat și a raportat 9 „lipsă"
    // dintre care majoritatea erau rute perfect sănătoase.
    return /Route\s+GET:/i.test(x.corp) ? 'LIPSĂ' : 'RĂSPUNDE (404 de conținut)'
  }
  // CU bilet de admin, un 403 nu mai e „bine păzită": înseamnă că ruta nu ne-a
  // recunoscut — ori are o poartă în plus (amprentă vocală, deblocare), ori
  // biletul nu i-a ajuns. Se raportează separat, ca să se poată verifica.
  if (x.status === 401 || x.status === 403) return 'REFUZĂ BILETUL'
  if (x.status >= 200 && x.status < 400) return 'MERGE (2xx)'
  return 'ALTA'
}

const grupe = {}
for (const x of rez) (grupe[clasa(x)] ??= []).push(x)

console.log('REZULTAT MĂSURAT (server pornit, apeluri reale, fără sesiune):\n')
for (const [g, lista] of Object.entries(grupe).sort()) {
  console.log(`  ${g}: ${lista.length}`)
}
console.log('')

// Defectele reale: rute care crapă, care nu răspund, sau care nu există la
// rulare deși sunt scrise în cod.
const defecte = [...(grupe['CRAPĂ'] ?? []), ...(grupe['MUT'] ?? []), ...(grupe['LIPSĂ'] ?? [])]
// Admin fără poartă: o rută /api/admin/* care răspunde 2xx fără sesiune.
const nepazite = []

for (const g of ['REFUZĂ BILETUL', 'ALTA', 'NU POT VERIFICA (fără bază de date aici)']) {
  const lista = grupe[g] ?? []
  if (!lista.length) continue
  console.log(`${g} (${lista.length}):`)
  for (const x of lista) console.log(`  ${String(x.status).padEnd(4)} ${x.ruta}  ${x.corp.slice(0, 70)}`)
  console.log('')
}

if (defecte.length) {
  console.error(`❌ ${defecte.length} rute cu probleme reale:\n`)
  for (const x of defecte) console.error(`  ${String(x.status).padEnd(4)} ${x.ruta}\n       ${x.corp}`)
  console.error('')
}
if (nepazite.length) {
  console.error(`⚠️  ${nepazite.length} rute de ADMIN care răspund FĂRĂ sesiune (poartă lipsă?):\n`)
  for (const x of nepazite) console.error(`  ${x.status} ${x.ruta}`)
  console.error('')
}

if (!defecte.length && !nepazite.length) {
  console.log('✅ Nicio rută nu crapă, nu tace și nu lipsește; adminul e păzit peste tot.\n')
  process.exit(0)
}
process.exit(1)
