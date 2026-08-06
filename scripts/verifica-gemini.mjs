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

// MODELUL UNIC — SIGILAT (Adrian, 6 aug, regulă ultra-decisă: „modelul decis de
// mine să nu se poată modifica accidental sau de altcineva fără decizia mea").
// Sursa unică e MODEL_UNIC_DEFAULT (în cod), iar treptele (chat/work/top) sunt
// GETTERI pe ea (modelUnicDirect) — deci un singur model, peste tot. Lacătul
// verifică: (1) sursa unică e Gemini Pro; (2) treptele sunt getteri pe sursa
// unică; (3) NU se citește niciun env de model (nimic nu-l poate schimba din env).

function regulaModelUnic() {
  return {
    nume: 'Sursa unică (MODEL_UNIC_DEFAULT) = Gemini Pro',
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = /MODEL_UNIC_DEFAULT = '([^']+)'/.exec(src)
      if (!m) return 'nu am găsit MODEL_UNIC_DEFAULT — sursa unică a modelului a dispărut'
      const model = m[1]
      if (!/gemini/i.test(model)) return `MODEL_UNIC_DEFAULT NU mai e Gemini: „${model}"`
      if (!/pro/i.test(model)) return `MODEL_UNIC_DEFAULT NU mai e Pro (cel mai performant): „${model}"`
      return null
    },
  }
}

function regulaTreaptaGetter(camp) {
  return {
    nume: `Creierul (${camp}) = sursa unică (Gemini)`,
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = new RegExp(`get ${camp}\\(\\): string \\{\\s*return modelUnicDirect\\(\\)`).exec(src)
      if (!m) return `${camp} nu mai e getter pe sursa unică (modelUnicDirect) — structura config.ts s-a schimbat`
      return null
    },
  }
}

function regulaFaraEnvModel() {
  return {
    nume: 'Modelul NU se poate schimba din env',
    fisier: 'backend/src/config.ts',
    verifica(src) {
      if (/process\.env\.(GEMINI_MODEL_GREU|BRAIN_CHAT_MODEL|BRAIN_WORK_MODEL|BRAIN_TOP_MODEL)/.test(src))
        return 'a reapărut un env de model (GEMINI_MODEL_GREU/BRAIN_*_MODEL) — modelul trebuie să fie DOAR din sursa unică, fără env'
      return null
    },
  }
}

// Fiecare regulă: unde caută, ce trebuie să rămână, și mesajul dacă s-a schimbat.
const REGULI = [
  regulaModelUnic(),
  regulaTreaptaGetter('chatDefault'),
  regulaTreaptaGetter('workDefault'),
  regulaTreaptaGetter('topDefault'),
  regulaFaraEnvModel(),
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
