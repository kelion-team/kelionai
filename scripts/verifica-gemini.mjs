#!/usr/bin/env node
// ── LACĂTUL GEMINI (Adrian, 3 aug: „blochezi schimbarea Gemini de aici încolo") ──
//
// ZID TURNAT, nu desenat. Verifică în cod că lucrurile pe care Adrian le-a
// probat și le-a bătut în cuie pe Gemini RĂMÂN Gemini. Iese cu 1 (ROȘU) dacă
// cineva — inclusiv Claude — le schimbă.
//
// Diferența față de lacat.test.ts (care rulează în pr-verify, INFORMATIV, nu
// oprea nimic — de-aia s-a putut strica): ăsta e rulat de workflow-ul
// `gemini-lock.yml` și devine BLOCANT când Adrian îl pune „required status
// check" în branch protection. Atunci merge-ul în master e RESPINS dacă se
// atinge Gemini — nu doar avertizat.
//
// Cum se EXTINDE lacătul (pe măsură ce mutăm și restul pe Gemini — voce, etc.):
// adaugă o regulă nouă în lista REGULI de mai jos. Nimic altundeva de schimbat.
import fs from 'node:fs'

function citeste(p) {
  try {
    return fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  } catch {
    return null
  }
}

// Fiecare regulă: unde caută, ce trebuie să fie Gemini, și mesajul dacă nu e.
const REGULI = [
  {
    nume: 'Creierul de lucru (workDefault) = Gemini',
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = /workDefault:\s*\(process\.env\.\w+\s*\?\?\s*'([^']+)'/.exec(src)
      if (!m) return 'nu am găsit linia workDefault — structura config.ts s-a schimbat'
      const model = m[1]
      const eGemini = model.startsWith('google-direct/') || /gemini/i.test(model)
      if (!eGemini) return `workDefault NU mai e Gemini: „${model}"`
      return null // OK
    },
  },
]

const erori = []
for (const r of REGULI) {
  const src = citeste(r.fisier)
  if (src === null) {
    erori.push(`${r.nume}: nu pot citi ${r.fisier}`)
    continue
  }
  const e = r.verifica(src)
  if (e) erori.push(`${r.nume}: ${e}`)
}

if (erori.length) {
  console.error('\n❌ LACĂTUL GEMINI a prins o schimbare INTERZISĂ:\n')
  for (const e of erori) console.error('  • ' + e)
  console.error(
    '\nGemini e bătut în cuie (ordinul lui Adrian, 3 aug: „blochezi schimbarea Gemini").' +
      '\nCa să-l schimbi trebuie întâi acordul lui Adrian ȘI modificarea lacătului — nu se trece pe lângă el.\n',
  )
  process.exit(1)
}

console.log('✅ Lacătul Gemini: tot ce e bătut în cuie pe Gemini e neatins.')
process.exit(0)
