#!/usr/bin/env node
// ── PLASA DE SĂNĂTATE LA PUBLICARE (Adrian, 12 aug 2026) ──────────────────────
// „Să poată da automat merged, DAR cu backup înainte, în caz că crapă ceva; după
//  merged, verificare automată de sănătate; dacă nu trece, REVERT și schimbă
//  abordarea."
//
// Rulează DIN AFARA aplicației (Node standalone), chemat de `auto-publicare.sh`
// IMEDIAT DUPĂ `deploy.sh`. De-aia poate reveni chiar dacă aplicația NOUĂ nu mai
// pornește: nu depinde de ea, doar de git/GitHub API (token) + adresa publică.
//
// FLUX:
//   1. BACKUP al stării BUNE de dinainte (LKG = ce era live) — punct de
//      recuperare durabil (tag `backup-…`), ca ownerul să aibă la ce se întoarce.
//   2. VERIFICARE de sănătate pe `/api/health`, câteva minute (pragul ales de
//      owner: `/api/health` să pice SUSȚINUT → declanșează revert).
//   3. Dacă noua publicare NU ajunge sănătoasă → REVERT la LKG: un commit ÎNAINTE
//      pe master (arborele lui LKG, părinte = vârful curent — ca `restoreToPoint`,
//      FĂRĂ rescriere de istorie; „producție = master" rămâne intact), pe care
//      `auto-publicare.sh` îl republică singur la următorul ciclu.
//   4. SCHIMBĂ ABORDAREA: deschide un issue care spune clar că publicarea <NEW> a
//      picat sănătatea și a fost revenită — semnalul ca abordarea să fie schimbată
//      (ownerul + bucla autonomă a constructorului îl văd).
//
// ANTI-SPIRALĂ: nu revine de două ori la rând (marcaj în fișierul de stare) și nu
// tratează un sha deja verificat încă o dată — o plasă care se declanșează singură
// în buclă ar fi mai rea decât gaura pe care o acoperă.
//
// PROBĂ USCATĂ (fără GitHub, rulabilă oriunde):
//   PLASA_USCAT=1 node deploy/plasa-sanatate.mjs <lkg> <new>

import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const USCAT = !!process.env.PLASA_USCAT
const APP = process.env.PLASA_APP || 'https://kelionai.app'
const ENVFILE = process.env.PLASA_ENVFILE || '/root/kelion/kelionai.env'
const STARE = process.env.PLASA_STARE || '/root/kelion/plasa-sanatate.stare'
const GH = 'https://api.github.com/repos/kelion-team/kelionai'
// Fereastra de sănătate: la 12s × 20 = 4 min. Sănătos = 3 citiri 200 la rând
// (publicarea s-a ridicat și STĂ ridicată); altfel, la capătul ferestrei → revert.
const INTERVAL_MS = Number(process.env.PLASA_INTERVAL_MS || 12_000)
const MAX_POLL = Number(process.env.PLASA_MAX_POLL || 20)
const NEVOIE_CONSECUTIV = Number(process.env.PLASA_CONSEC || 3)
// Nu revenim de două ori într-o fereastră scurtă (anti-spirală).
const RACIRE_REVERT_MS = Number(process.env.PLASA_RACIRE_MS || 30 * 60_000)

const [lkgArg, newArg] = process.argv.slice(2)
const LKG = String(lkgArg || '').trim()
const NEW = String(newArg || '').trim()

const acum = () => Date.now()
const log = (m) => console.log(`[plasa] ${new Date().toISOString().slice(11, 19)} ${m}`)
const dormi = (ms) => new Promise((r) => setTimeout(r, ms))

function token() {
  const din = (process.env.GITHUB_TOKEN ?? '').trim()
  if (din) return din
  try {
    const linie = readFileSync(ENVFILE, 'utf8').split('\n').find((l) => l.startsWith('GITHUB_TOKEN='))
    return linie ? linie.slice('GITHUB_TOKEN='.length).trim() : ''
  } catch {
    return ''
  }
}
const TOKEN = token()

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

// ── VERDICTUL DE SĂNĂTATE — pur, ușor de raționat/probat ─────────────────────
// Primește șirul de citiri (true = 200+ok). Sănătos dacă a atins `nevoie` citiri
// bune LA RÂND oricând în fereastră; altfel (fereastra s-a terminat fără asta) →
// „revert". Toleranța de la început acoperă repornirea containerului (502 de la
// Caddy cât urcă) — nu declară boală pe blip-ul normal de repornire.
function verdict(citiri, nevoie = NEVOIE_CONSECUTIV) {
  let consec = 0
  for (const bun of citiri) {
    consec = bun ? consec + 1 : 0
    if (consec >= nevoie) return 'sanatos'
  }
  return 'revert'
}

async function esteSanatos() {
  try {
    const r = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return false
    const j = await r.json().catch(() => null)
    return j?.status === 'ok'
  } catch {
    return false
  }
}

async function versiuneLive() {
  try {
    const r = await fetch(`${APP}/api/version`, { signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => null)
    return String(j?.v ?? '').trim()
  } catch {
    return ''
  }
}

function citesteStare() {
  try {
    if (!existsSync(STARE)) return {}
    return JSON.parse(readFileSync(STARE, 'utf8')) || {}
  } catch {
    return {}
  }
}
function scrieStare(o) {
  try {
    writeFileSync(STARE, JSON.stringify(o))
  } catch {
    /* best-effort */
  }
}

// ── BACKUP al stării BUNE (LKG) — tag durabil, ca `createRecoveryPoint` ──────
async function faBackup(sha) {
  if (USCAT) return log(`[uscat] aș face backup (tag) pentru starea bună ${sha}`)
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12) // YYYYMMDDHHMM
    const tag = `backup-${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}-${stamp.slice(8, 12)}-${sha}`
    // sha scurt → commit complet
    const cr = await fetch(`${GH}/commits/${sha}`, { headers: ghHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!cr.ok) return log(`backup: nu pot rezolva ${sha} (${cr.status}) — sar`)
    const full = String(((await cr.json())?.sha) ?? '')
    if (!full) return
    const to = await fetch(`${GH}/git/tags`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        tag,
        message: `Backup automat înainte de publicarea ${NEW} (plasa de sănătate)`,
        object: full,
        type: 'commit',
        tagger: { name: 'Kelion Recovery', email: 'contact@kelionai.app', date: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!to.ok) return log(`backup: tag_obj ${to.status} — sar (nefatal)`)
    const tagSha = String((await to.json())?.sha ?? '')
    const rr = await fetch(`${GH}/git/refs`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: tagSha }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!rr.ok) return log(`backup: ref ${rr.status} — sar (nefatal)`)
    log(`backup creat: ${tag}`)
  } catch (e) {
    log(`backup: eroare nefatală (${String(e?.message ?? e).slice(0, 120)})`)
  }
}

// ── REVERT la LKG — commit ÎNAINTE pe master (arborele bun, părinte = vârf) ───
async function revertLaLKG(sha) {
  if (USCAT) {
    log(`[uscat] aș reveni master la starea bună ${sha} (commit înainte) + aș deschide issue`)
    return true
  }
  try {
    const cr = await fetch(`${GH}/commits/${sha}`, { headers: ghHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!cr.ok) return (log(`revert: nu pot rezolva LKG ${sha} (${cr.status})`), false)
    const cj = await cr.json()
    const lkgFull = String(cj?.sha ?? '')
    const treeSha = String(cj?.commit?.tree?.sha ?? '')
    if (!lkgFull || !treeSha) return (log('revert: LKG fără sha/arbore'), false)
    const mr = await fetch(`${GH}/git/refs/heads/master`, { headers: ghHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!mr.ok) return (log(`revert: master ref ${mr.status}`), false)
    const headSha = String(((await mr.json())?.object?.sha) ?? '')
    if (!headSha) return (log('revert: fără vârf de master'), false)
    if (headSha === lkgFull) return (log('revert: master e deja pe LKG — nimic de făcut'), true)
    const nc = await fetch(`${GH}/git/commits`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({
        message: `REVERT AUTOMAT: publicarea ${NEW} a picat la sănătate — revenire la starea bună ${sha} (plasa de sănătate)`,
        tree: treeSha,
        parents: [headSha],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!nc.ok) return (log(`revert: commit nou ${nc.status}`), false)
    const newSha = String((await nc.json())?.sha ?? '')
    const up = await fetch(`${GH}/git/refs/heads/master`, {
      method: 'PATCH',
      headers: ghHeaders(),
      body: JSON.stringify({ sha: newSha, force: false }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!up.ok) return (log(`revert: PATCH master ${up.status} — NU am putut reveni`), false)
    log(`REVERT făcut: master → arborele lui ${sha} (commit ${newSha.slice(0, 7)}). auto-publicare îl republică.`)
    return true
  } catch (e) {
    log(`revert: eroare (${String(e?.message ?? e).slice(0, 160)})`)
    return false
  }
}

async function deschideIssue(reusit) {
  if (USCAT) return log('[uscat] aș deschide issue „publicare picată la sănătate → revert"')
  const titlu = `Publicarea ${NEW} a picat la sănătate → revert automat la ${LKG}`
  const corp =
    `Plasa de sănătate a măsurat: după publicarea \`${NEW}\`, \`${APP}/api/health\` nu a ajuns sănătos în fereastra de ${Math.round((INTERVAL_MS * MAX_POLL) / 60000)} min.\n\n` +
    `| | |\n|---|---|\n| publicare picată | \`${NEW}\` |\n| revenit la (LKG) | \`${LKG}\` |\n| revert | ${reusit ? '✅ făcut (master readus la starea bună; auto-publicare republică)' : '❌ NU a reușit — intervenție manuală'} |\n\n` +
    `**Abordarea trebuie schimbată**: codul din \`${NEW}\` a trecut porțile de atelier dar a picat sănătatea LIVE — deci defectul e la runtime, nu la compilare. Ordinul care a produs-o trebuie reluat cu altă abordare.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`
  try {
    const r = await fetch(`${GH}/issues`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ title: titlu, body: corp }),
      signal: AbortSignal.timeout(15_000),
    })
    if (r.ok) log(`issue deschis: #${(await r.json())?.number ?? '?'}`)
    else log(`issue: ${r.status} — nu am putut deschide`)
  } catch (e) {
    log(`issue: eroare (${String(e?.message ?? e).slice(0, 120)})`)
  }
}

async function main() {
  // Validări: fără sha bun de revenit, plasa nu se activează (nu inventăm o țintă).
  const hex7 = /^[0-9a-f]{7,40}$/i
  if (!hex7.test(NEW)) return (log(`sha nou invalid („${NEW}") — nu fac nimic`), process.exit(0))
  if (!hex7.test(LKG) || LKG === NEW) {
    log(`fără stare bună distinctă (LKG=„${LKG}") — verific sănătatea, dar nu pot reveni; ies`)
  }
  if (!USCAT && !TOKEN) return (log('fără GITHUB_TOKEN — nu pot face backup/revert; ies'), process.exit(0))

  const st = citesteStare()
  // Idempotent: același NEW deja verificat → nu repet.
  if (st.ultimNou === NEW && st.verdict) return (log(`${NEW} deja verificat (${st.verdict}) — sar`), process.exit(0))
  // Anti-spirală: dacă tocmai am revenit, publicarea curentă E revenirea — n-o
  // mai „reparăm" încă o dată (LKG republicat trebuie să fie sănătos oricum).
  if (st.ultimRevertLa && acum() - (st.candRevert || 0) < RACIRE_REVERT_MS) {
    log(`am revenit recent la ${st.ultimRevertLa} — sar plasa pe publicarea de revenire (anti-spirală)`)
    scrieStare({ ...st, ultimNou: NEW, verdict: 'sarit-anti-spirala' })
    return process.exit(0)
  }

  await faBackup(LKG)

  log(`verific sănătatea publicării ${NEW} (max ${Math.round((INTERVAL_MS * MAX_POLL) / 60000)} min)…`)
  const citiri = []
  for (let i = 0; i < MAX_POLL; i++) {
    const bun = await esteSanatos()
    citiri.push(bun)
    if (verdict(citiri) === 'sanatos') {
      const v = await versiuneLive()
      log(`SĂNĂTOS după ${i + 1} citiri (live=${v || '?'}) — publicare confirmată`)
      scrieStare({ ...st, ultimNou: NEW, verdict: 'sanatos', cand: acum() })
      return process.exit(0)
    }
    if (i < MAX_POLL - 1) await dormi(INTERVAL_MS)
  }

  // Fereastra s-a terminat fără sănătate susținută → revert (dacă avem LKG).
  const v = await versiuneLive()
  log(`NESĂNĂTOS: ${NEW} nu a ajuns sănătos în fereastră (live=${v || 'necitibil'}) → declanșez plasa`)
  if (!hex7.test(LKG) || LKG === NEW) {
    log('nu am o stare bună distinctă la care să revin — deschid doar issue de alarmă')
    await deschideIssue(false)
    scrieStare({ ...st, ultimNou: NEW, verdict: 'nesanatos-fara-lkg', cand: acum() })
    return process.exit(1)
  }
  const reusit = await revertLaLKG(LKG)
  await deschideIssue(reusit)
  scrieStare({
    ...st,
    ultimNou: NEW,
    verdict: reusit ? 'revert' : 'revert-esuat',
    ultimRevertLa: LKG,
    candRevert: acum(),
    cand: acum(),
  })
  process.exit(reusit ? 0 : 1)
}

// Doar când e rulat direct (nu la import în test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log(`eroare fatală: ${String(e?.message ?? e).slice(0, 200)}`)
    process.exit(1)
  })
}
