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
// acolo unde gratuitul a picat deja, o dată pe ordin. Se st