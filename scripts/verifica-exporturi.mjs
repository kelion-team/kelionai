#!/usr/bin/env node
// ── POARTA „0 COD ABANDONAT", PARTEA CARE LIPSEA ────────────────────────────
//
// oxlint prinde variabile nefolosite ÎN INTERIORUL unui fișier. Nu prinde
// EXPORTURILE pe care nu le importă nimeni — iar acolo se ascunde codul mort
// care contează: funcții întregi, scrise cândva, care nu mai sunt legate de
// nimic. Auditul din 29 iul a găsit 16 (printre ele `identifyVoiceprint`,
// `crawlSite`, `geminiVision`), toate „verzi" la fiecare verificare de până
// atunci — pentru că nicio poartă nu se uita acolo.
//
// Un export folosit DOAR de teste e legitim (funcția e ținută sub test).
// Un export folosit de nimeni, nici măcar de teste, e cod abandonat.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const RADACINI = ['backend/src', 'frontend/src']
const EXT = new Set(['.ts', '.tsx'])

function fisiere(dir) {
  const out = []
  for (const nume of readdirSync(dir)) {
    const cale = join(dir, nume)
    if (statSync(cale).isDirectory()) out.push(...fisiere(cale))
    else if (EXT.has(extname(cale))) out.push(cale)
  }
  return out
}

const toate = RADACINI.flatMap((r) => {
  try {
    return fisiere(r)
  } catch {
    return []
  }
})
const eTest = (f) => f.includes('.test.') || f.includes('/testing/')
const prod = toate.filter((f) => !eTest(f))
const teste = toate.filter(eTest)

const citit = new Map(toate.map((f) => [f, readFileSync(f, 'utf8')]))
// Punctele de intrare NU sunt importate de nimeni — sunt pornite.
const INTRARI = new Set(['backend/src/index.ts', 'frontend/src/main.tsx'])

const DECL = /^export (?:async )?function (\w+)|^export (?:const|class|interface|type|enum) (\w+)/gm
const abandonate = []

for (const f of prod) {
  if (INTRARI.has(f.replaceAll('\\', '/'))) continue
  const src = citit.get(f)
  for (const m of src.matchAll(DECL)) {
    const nume = m[1] ?? m[2]
    const tipar = new RegExp(`\\b${nume.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    const inAltele = prod.some((g) => g !== f && tipar.test(citit.get(g)))
    const localAparitii = (src.match(new RegExp(tipar.source, 'g')) ?? []).length
    if (inAltele || localAparitii > 1) continue
    if (teste.some((g) => tipar.test(citit.get(g)))) continue // ținut sub test = legitim
    abandonate.push(`${f}: ${nume}`)
  }
}

if (abandonate.length) {
  console.error(`Cod abandonat: ${abandonate.length} exporturi pe care nu le folosește NIMENI:\n`)
  for (const a of abandonate) console.error(`  ${a}`)
  console.error('\nȚinta e 0: leagă-le unde trebuie, sau șterge-le.')
  process.exit(1)
}
console.log('Exporturi: toate au cel puțin un utilizator (0 cod abandonat).')
