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

// 7 aug — SCHIMBAT PE MĂSURĂTOARE, cu acordul explicit al ownerului. Slotul greu
// a plecat de pe Pro pe `gemini-3.5-flash`: la calitate erau EGALE (20/20 amândouă,
// proba de 10 sarcini cu verificare automată), dar Pro avea cazuri de 72-75 SECUNDE
// față de 6,3 s. Lacătul NU s-a slăbit — și-a mutat ținta: acum păzește familia
// flash (fără `-lite`, care e slotul de conversație).
function regulaModelUnic() {
  return {
    nume: 'Sursa slotului greu (MODEL_UNIC_DEFAULT) = Gemini flash (nu lite)',
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = /MODEL_UNIC_DEFAULT = '([^']+)'/.exec(src)
      if (!m) return 'nu am găsit MODEL_UNIC_DEFAULT — sursa slotului greu a dispărut'
      const model = m[1]
      if (!/gemini/i.test(model)) return `MODEL_UNIC_DEFAULT NU mai e Gemini: „${model}"`
      if (!/^gemini-\d+(?:\.\d+)?-flash(?:-|$)/.test(model))
        return `MODEL_UNIC_DEFAULT NU mai e din familia flash: „${model}" (măsurat 7 aug: Pro = aceeași calitate, dar până la 75 s pe o tură)`
      if (/-lite(?:-|$)/.test(model))
        return `MODEL_UNIC_DEFAULT nu are voie să fie „lite": „${model}" — lite e slotul de CONVERSAȚIE; dacă intră și pe treapta grea, cele două sloturi se prăbușesc într-unul`
      return null
    },
  }
}

// POARTA AUTO-UPGRADE-ULUI (Adrian, 7 aug: „dacă nu se respectă tot să nu se facă
// upgrade; doar când apare modelul corespunzător să treacă tot"). Fără regula asta,
// cineva poate slăbi condiția înapoi la „a răspuns 200" — exact proba pe care
// gemini-3.6-flash o trecea, deși face 17/20 și pică lanțul de unelte.
function regulaPoartaUpgrade() {
  return {
    nume: 'Auto-upgrade: DOAR cu scor perfect pe bateria completă',
    fisier: 'backend/src/services/modelAutoUpgrade.ts',
    verifica(src) {
      if (!/probeazaModelComplet/.test(src))
        return 'auto-upgrade-ul nu mai rulează bateria completă (probeazaModelComplet a dispărut)'
      if (!/p\.scor !== p\.total/.test(src))
        return 'poarta „toate probele" a dispărut — un model care pică o probă ar putea intra pe treapta grea'
      // ATENȚIE la ce se verifică: nu că NUMELE apare (apărea și în mesajele de
      // log, deci o ștergere a scrierii trecea nevăzută — prins la proba cu
      // stricăciune intenționată), ci că se face SCRIEREA propriu-zisă.
      if (!/saveKv\(\s*KV_DOVADA/.test(src))
        return 'dovada nu se mai SCRIE (saveKv(KV_DOVADA…) a dispărut) — un upgrade fără dovadă e exact ce am interzis'
      if (!/probeazaModelComplet\(activ\)/.test(src))
        return 'modelul ACTIV nu mai e probat în aceeași trecere — dovada ar fi o cifră singură, fără termen de comparație'
      return null
    },
  }
}

// DOUĂ SLOTURI SIGILATE (7 aug): fiecare treaptă trebuie să rămână getter pe UNA
// din cele două surse din cod — `modelUnicDirect()` (Pro, gândirea grea) sau
// `modelRapidDirect()` (flash-lite, conversația). Lacătul NU s-a relaxat: în
// continuare nimeni nu poate pune un model liber, din env sau din UI — doar că
// acum sunt două sloturi în loc de unul, fiecare cu poarta lui de familie.
function regulaTreaptaGetter(camp, sursa) {
  return {
    nume: `Creierul (${camp}) = sursa sigilată (${sursa})`,
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = new RegExp(`get ${camp}\\(\\): string \\{\\s*return ${sursa}\\(\\)`).exec(src)
      if (!m) return `${camp} nu mai e getter pe ${sursa} — structura config.ts s-a schimbat`
      return null
    },
  }
}

function regulaModelRapid() {
  return {
    nume: 'Slotul rapid (MODEL_RAPID_DEFAULT) = Gemini flash/flash-lite',
    fisier: 'backend/src/config.ts',
    verifica(src) {
      const m = /MODEL_RAPID_DEFAULT = '([^']+)'/.exec(src)
      if (!m) return 'nu am găsit MODEL_RAPID_DEFAULT — slotul rapid al conversației a dispărut'
      const model = m[1]
      if (!/gemini/i.test(model)) return `MODEL_RAPID_DEFAULT NU mai e Gemini: „${model}"`
      if (!/flash/i.test(model))
        return `MODEL_RAPID_DEFAULT NU mai e din familia flash: „${model}" (chatul trebuie să rămână rapid — măsurat 7 aug: Pro pe chat = 3,6s…45s)`
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

// CONSTRUCTORUL (autonomia) A FOST MUTAT DE PE GEMINI de owner (12 aug: „nu are ce
// căuta Gemini acolo"; înainte „doar RunPod" → DeepInfra). Regula veche cerea ca
// modelul constructorului să fie Gemini — acum contrazice ordinul ownerului. O
// INVERSĂM: lacătul păzește ca acest creier să RĂMÂNĂ un endpoint OpenAI-compatibil
// (RunPod/DeepInfra din env) și să NU recadă pe Gemini. Celelalte reguli (creierul
// APLICAȚIEI — chat/voce/work) rămân neatinse: acolo Gemini e în continuare bătut
// în cuie. Măsurat 12 aug: Qwen3-Coder-480B-Turbo pe DeepInfra e supraîncărcat
// (engine_overloaded, 0 tool_calls); DeepSeek-V3/Qwen2.5-72B/Llama merg pe aceeași
// cheie → constructorul rulează pe DeepSeek-V3 cu rotire pe rezerve.
function regulaConstructorFaraGemini() {
  return {
    nume: 'Constructorul (autonomia) = endpoint OpenAI-compatibil (DeepInfra), NU Gemini',
    fisier: 'deploy/constructor-agent.mjs',
    verifica(src) {
      // Trebuie să-și ia creierul din env-ul OpenAI-compatibil (ambele nume: nou
      // RUNPOD_*, vechi DEEPSEEK_* — cheia stă pe VPS sub numele vechi).
      if (!/env\.CONSTRUCTOR_RUNPOD_KEY\s*\|\|\s*env\.CONSTRUCTOR_DEEPSEEK_KEY/.test(src))
        return 'constructorul nu mai citește cheia endpointului OpenAI-compatibil (CONSTRUCTOR_RUNPOD_KEY/CONSTRUCTOR_DEEPSEEK_KEY) — structura s-a schimbat'
      // ȘI nu trebuie să mai cheme Gemini (niciun apel către API-ul Google).
      if (/generativelanguage\.googleapis\.com/.test(src))
        return 'a reapărut un apel Gemini (generativelanguage.googleapis.com) în constructor — owner: „nu are ce căuta Gemini acolo"'
      return null
    },
  }
}

// SEMNĂTURA DE GÂNDIRE (Adrian, 7 aug — dovedit A/B pe cheia lui, de pe VPS).
// Gemini 3.x CERE `thoughtSignature` înapoi la replay; fără ea, pasul 2 al
// oricărei ture cu unelte pică cu HTTP 400 „Function call is missing a
// thought_signature". Bug-ul a existat cu adevărat: semnătura era captată din
// răspuns și aruncată la reconstrucția cererii. Sub lacăt ca să nu reapară.
function regulaSemnaturaGandirii() {
  return {
    nume: 'Semnătura de gândire se RETRIMITE la replay (altfel turele cu unelte se rup pe 3.x)',
    fisier: 'backend/src/services/geminiDirect.ts',
    verifica(src) {
      if (!/partApel\.thoughtSignature = c\.thoughtSignature/.test(src))
        return 'nu se mai retrimite `thoughtSignature` pe apelul de unealtă — pasul 2 al oricărei ture cu unelte va pica cu 400 pe TOATE modelele 3.x'
      return null
    },
  }
}

// VOCEA LIVE (Adrian, 7 aug, ales pe măsurătoare: 491 ms primul răspuns, unelte
// DA, 66 KB de audio real). Modelul rămâne pe env, ca să poată fi schimbat cu o
// valoare și o repornire dacă vocea nu-i place — dar defaultul din cod trebuie
// să rămână un model Gemini de sesiune LIVE, nu unul de chat (alea n-au bidi și
// vocea ar muri tăcut).
function regulaVoceLive() {
  return {
    nume: 'Vocea live = model Gemini de sesiune LIVE, pe env',
    fisier: 'backend/src/services/vocalLive.ts',
    verifica(src) {
      const m = /VOCAL_LIVE_MODEL = process\.env\.VOCAL_LIVE_MODEL \|\| '([^']+)'/.exec(src)
      if (!m) return 'VOCAL_LIVE_MODEL nu mai e pe env cu default în cod — ownerul nu mai poate schimba vocea fără cod'
      const model = m[1]
      if (!/^gemini-/.test(model)) return `vocea live NU mai e Gemini: „${model}"`
      if (!/(live|native-audio)/.test(model))
        return `„${model}" nu e model de sesiune LIVE (are nevoie de bidiGenerateContent) — vocea ar muri tăcut`
      return null
    },
  }
}

// Fiecare regulă: unde caută, ce trebuie să rămână, și mesajul dacă s-a schimbat.
const REGULI = [
  regulaModelUnic(),
  regulaModelRapid(),
  regulaTreaptaGetter('chatDefault', 'modelRapidDirect'),
  regulaTreaptaGetter('workDefault', 'modelUnicDirect'),
  regulaTreaptaGetter('topDefault', 'modelUnicDirect'),
  regulaFaraEnvModel(),
  regulaConstructorFaraGemini(),
  regulaPoartaUpgrade(),
  regulaSemnaturaGandirii(),
  regulaVoceLive(),
]

// DOVADA, NU DECLARAȚIA (Adrian, 7 aug: „vreau dovadă că ce discutăm și facem
// aici să fie sub lacăt, clar"). Lacătul nu mai spune doar „e bine" — SPUNE ce a
// verificat, unde, rând cu rând. Un „✅" fără listă e exact tiparul interzis:
// un verdict pe care nu-l poți controla.
const erori = []
const trecute = []
for (const r of REGULI) {
  const src = citeste(r.fisier)
  if (src === null) {
    erori.push(`${r.nume}: nu pot citi ${r.fisier}`)
    continue
  }
  const e = r.verifica(src)
  if (e) erori.push(`${r.nume}: ${e}`)
  else trecute.push(r)
}

console.log(`\nLACĂTUL — ${REGULI.length} reguli verificate în cod:\n`)
for (const r of trecute) console.log(`  ✅ ${r.nume}\n       ${r.fisier}`)
for (const r of REGULI.filter((x) => !trecute.includes(x))) console.log(`  ❌ ${r.nume}\n       ${r.fisier}`)
console.log('')

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
