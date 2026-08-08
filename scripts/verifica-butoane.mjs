#!/usr/bin/env node
// ── FIECARE BUTON CHEAMĂ O RUTĂ CARE EXISTĂ? (Adrian, 8 aug: „fiecare linie și
// buton din aplicație") ──────────────────────────────────────────────────────
//
// DE CE: un buton legat la o rută inexistentă nu crapă zgomotos — dă 404, iar
// interfața arată o eroare vagă sau nimic. E fix familia de defecțiuni care l-a
// costat pe owner: ceva ce PARE că merge, fără să meargă. `tsc` nu prinde asta
// (adresa e un șir), testele nu o prind (nu cheamă rutele reale), iar la ochi nu
// se vede: sunt sute de apeluri.
//
// CE FACE: citește toate adresele `/api/...` chemate din frontend și toate
// rutele înregistrate în backend, apoi le pune față în față.
//   1. APELURI FĂRĂ RUTĂ — butoane care lovesc în gol (defect real, iese cu 1)
//   2. RUTE FĂRĂ APELANT — server pe care nu-l cheamă niciun buton (informativ:
//      pot fi chemate de Kelion prin unelte sau de scripturi)
//
// ONESTITATE (regula #1): dacă nu poate citi codul, spune „NU POT VERIFICA" și
// iese cu 2 — niciodată „0 probleme". Un zero dintr-o citire picată e minciuna
// pe care o vânăm.
import fs from 'node:fs'
import path from 'node:path'

const RADACINA = new URL('..', import.meta.url).pathname

function fisiere(dir, extensii) {
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
      else if (extensii.some((e) => it.name.endsWith(e))) out.push(p)
    }
  }
  mers(dir)
  return out
}

const citeste = (f) => {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

/** Normalizează o adresă: segmentele dinamice (`${id}`) devin `:p`, ca să se
 *  poată potrivi cu parametrii rutelor. */
const normal = (a) =>
  a
    // Un `${...}` care urmează după `/` e un SEGMENT (`/api/x/${id}`) → `:p`.
    .replace(/\/\$\{[^}]*\}/g, '/:p')
    // Unul lipit de text („gaps${all ? '?all=1' : ''}") e query/sufix, nu cale:
    // transformat în `:p` dădea „/api/admin/gaps:p", care nu se potrivea cu
    // nicio rută și părea buton rupt. Prins la a doua rulare.
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\/+$/, '')

/** Adresele `/api/...` chemate din frontend → unde apar. */
function apeluriFrontend() {
  const apeluri = new Map()
  for (const f of fisiere(path.join(RADACINA, 'frontend/src'), ['.ts', '.tsx'])) {
    const src = citeste(f)
    if (!src) continue
    // `[^'"`?]` ar tăia la primul spațiu, iar `${all ? '?all=1' : ''}` are spații:
    // captura ieșea trunchiată („/api/admin/gaps${all") și părea rută inexistentă.
    // Prinsă la prima rulare — o unealtă care strigă „hoții" degeaba e mai rea
    // decât niciuna. Acum se acceptă spații DOAR în interiorul unui `${...}`.
    for (const m of src.matchAll(/['"`](\/api\/(?:\$\{[^}]*\}|[^'"`\s?])*)/g)) {
      // `u.pathname.startsWith('/api/image')` e o VERIFICARE, nu un apel — o
      // număram ca buton și ieșea „rută inexistentă". Sărim comparațiile.
      const inainte = src.slice(Math.max(0, m.index - 30), m.index)
      if (/\.(startsWith|endsWith|includes|indexOf|match|test)\s*\($/.test(inainte)) continue
      const adresa = normal(m[1])
      if (!apeluri.has(adresa)) apeluri.set(adresa, new Set())
      apeluri.get(adresa).add(path.relative(RADACINA, f))
    }
  }
  return apeluri
}

/** Rutele `/api/...` înregistrate în backend (cu sau fără generice TS). */
function ruteBackend() {
  const rute = new Set()
  for (const f of fisiere(path.join(RADACINA, 'backend/src'), ['.ts'])) {
    if (f.endsWith('.test.ts')) continue
    const src = citeste(f)
    if (!src) continue
    // Genericele TS pot conține `>` („<{ Body: { x: string } }>") și pot sta pe
    // mai multe linii, iar adresa vine adesea pe rândul următor. `[^>]*` se
    // oprea la primul `>` și rata rute REALE — printre ele chiar `/api/chat`,
    // al cărui bloc de tipuri are peste 400 de caractere (de-aia fereastra e 4000).
    for (const m of src.matchAll(/\.(get|post|put|patch|delete|all)[\s\S]{0,4000}?\(\s*['"`](\/api\/[^'"`]*)/g)) {
      rute.add(normal(m[2]))
    }
  }
  return rute
}

/** Se potrivește adresa chemată cu ruta înregistrată? Parametrii (`:ceva`)
 *  acceptă orice segment, la fel și `:p` venit dintr-un `${...}`. */
function potrivesc(apel, ruta) {
  const a = apel.split('/')
  const r = ruta.split('/')
  return a.length === r.length && a.every((seg, i) => seg === r[i] || r[i].startsWith(':') || seg === ':p')
}

const apeluri = apeluriFrontend()
const rute = ruteBackend()

if (rute.size === 0 || apeluri.size === 0) {
  console.error(
    `\n❌ NU POT VERIFICA: ${apeluri.size} apeluri, ${rute.size} rute găsite.` +
      `\nNu înseamnă „curat" — înseamnă că n-am putut citi codul.\n`,
  )
  process.exit(2)
}

const listaRute = [...rute]
// Prefixele goale („/api", „/api/admin") sunt folosite la construirea altor
// adrese, nu sunt apeluri în sine — nu-s butoane rupte.
const rupte = [...apeluri.entries()]
  .filter(([adresa]) => adresa.split('/').length > 2)
  .filter(([adresa]) => !listaRute.some((r) => potrivesc(adresa, r)))
  .map(([adresa, unde]) => ({ adresa, unde: [...unde] }))
  .sort((x, y) => x.adresa.localeCompare(y.adresa))

const faraApelant = listaRute.filter((r) => ![...apeluri.keys()].some((a) => potrivesc(a, r))).sort()

console.log(`\nBUTOANE ↔ RUTE — ${apeluri.size} adrese chemate din frontend, ${rute.size} rute în backend\n`)

if (faraApelant.length) {
  console.log(`ℹ️  ${faraApelant.length} rute fără apelant în frontend (pot fi chemate de Kelion sau de scripturi):`)
  for (const r of faraApelant) console.log(`     ${r}`)
  console.log('')
}

if (rupte.length) {
  console.error(`❌ ${rupte.length} APELURI FĂRĂ RUTĂ — butoane care lovesc în gol:\n`)
  for (const x of rupte) console.error(`  ${x.adresa}\n       ${x.unde.join(', ')}`)
  console.error('\nUn buton care cheamă o rută inexistentă dă 404 în tăcere.')
  console.error('Reparat = ori se adaugă ruta, ori se scoate apelul.\n')
  process.exit(1)
}

console.log('✅ Fiecare adresă chemată din frontend are o rută în backend.\n')
process.exit(0)
