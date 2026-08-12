import crypto from 'node:crypto'
import {
  recurringClientErrors, createBuildJob, loadKv, saveKv, requeueMoneyFailedBuildJobs,
  simptomeLiveRecente,
} from '../db.js'
import { isOpsPaused } from './runbooks.js'
import { geminiLive } from './geminiDirect.js'
import { ordinSimptomLive, pragPentru } from './simptomeLive.js'
import { plafonConstructor } from './autonomie.js'

// ── KELION'S SELF-HEALING (Adrian, 27 Jul: "Kelion must be able to gather
// errors appearing under each user automatically and remedy them, delivering
// the fixed version to all users afterwards") ──────────────────────────────
// The proactive loop, without being asked: at an interval, it takes the
// RECURRENT client errors (many occurrences, several users), and for each NEW
// signature it places an order in the constructor's queue. The constructor
// finds the cause in the source, fixes it, runs build+tests and opens a PR;
// on merge, auto-publishing brings the fixed version to ALL users. The merge
// stays with Adrian (the human gate) — that is why we file a PR, not push
// directly into master.
//
// Guards: (1) only real recurrent errors (the thresholds in
// recurringClientErrors); (2) dedup by signature in kv (`selfheal:<hash>`,
// 7 days) — we don't file the same error twice; (3) respects the autonomy
// pause; (4) max 3 orders per run, so a wave of errors doesn't flood the
// queue.

function signature(message: string): string {
  // A stable signature from the message, without variable numbers/addresses
  // — so the same error (with another line:col or another id) is recognized
  // as the same.
  const norm = message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9a-f]{8,}/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16)
}

// Simptome care se ÎNREGISTREAZĂ (owner-ul le vede) dar NU se trimit
// constructorului — nu-s bug de cod, ci stare externă (bani/cotă). Constructorul
// n-are ce repara acolo; le rezolvă owner-ul, informat de simptom.
const FARA_REPARATIE = new Set<string>(['creier-indisponibil'])

// Contractul de închidere pentru simptomele live (vezi bucla de mai jos).
const REVERIFICA_MS = 6 * 60 * 60 * 1000 // nu reverificăm mai des de 6h (lasă timp de merge+deploy)
const FEREASTRA_DEPLOY_MS = 30 * 60 * 1000 // o reapariție la ≤30 min după reparație nu contează (nu apucase să se publice)
const LIMITA_REPARARI = 4 // după atâtea reparații care n-au ținut, oprim relansarea (rămâne vizibil ca nerezolvat)

export async function runSelfHeal(): Promise<{ filed: number }> {
  if (await isOpsPaused()) return { filed: 0 }

  // HEALING THE ORDERS THAT FELL ON MONEY (Adrian, 27 Jul: "why doesn't the
  // healing system see, repair? — automatically?"): if the brain (Gemini)
  // SERVES again — the honest live signal, since Google exposes no readable
  // balance — the constructor orders failed on 402/credit are put BACK in the
  // queue BY THEMSELVES (only once per order — a mark in the log).
  try {
    const g = await geminiLive()
    if (g.ok && g.serving) {
      const requeued = await requeueMoneyFailedBuildJobs()
      if (requeued) console.log(`[self-heal] ${requeued} ordin(e) eșuat(e) pe lipsă de credit, repus(e) în coadă — Gemini servește din nou`)
    }
  } catch {
    /* live signal unavailable — we try again on the next run */
  }

  // PLAFONUL DE BANI, ȘI AICI (B5, 12 aug): self-heal cheamă createBuildJob
  // direct — deci trebuie să respecte ACELAȘI plafon zilnic de $10 ca bucla de
  // noapte, altfel o rafală de simptome ar putea porni ordine peste limita pe
  // care owner-ul a cerut-o. Dacă plafonul e atins, nu mai file-uim azi (requeue-ul
  // de mai sus, care doar reia ce a picat pe lipsă de credit, a rulat deja).
  const pl = await plafonConstructor().catch(() => ({ activ: false, plafon: 0, cheltuit: 0 }))
  if (pl.activ && pl.cheltuit >= pl.plafon) {
    console.log(`[self-heal] plafon zilnic atins ($${pl.cheltuit.toFixed(2)}/$${pl.plafon.toFixed(2)}) — nu mai trimit reparații azi`)
    return { filed: 0 }
  }

  let filed = 0

  // ── ERORILE RAPORTATE DIN BROWSER (calea veche) ─────────────────────────────
  const errors = await recurringClientErrors(24, 5, 2)
  for (const e of errors) {
    if (filed >= 3) break
    const sig = signature(e.message)
    const key = `selfheal:${sig}`
    if (await loadKv(key)) continue // already filed — we don't duplicate

    const order =
      `AUTO-VINDECARE: repară o eroare de client RECURENTĂ (apărută de ${e.count} ori, ` +
      `la ${e.users} utilizatori distincți în ultimele 24h). Găsește CAUZA REALĂ în sursă ` +
      `(caută mesajul/stack-ul cu search_source/read_source) și rescrie curat modulul ` +
      `responsabil — fără petice. NU schimba nimic în afara cauzei acestei erori.\n\n` +
      `Mesaj: ${e.message}\n` +
      `URL unde apare: ${e.sampleUrl}\n` +
      `Stack (exemplu):\n${(e.sampleStack ?? '(fără stack)').slice(0, 2000)}\n\n` +
      `Verifică: npm --prefix backend run build (+ test dacă atingi backend), ` +
      `npm --prefix frontend run build dacă atingi frontend.`

    const id = await createBuildJob('kelion-autovindecare', order)
    if (id) {
      await saveKv(key, JSON.stringify({ at: Date.now(), job: id, count: e.count }))
      filed += 1
    }
  }

  // ── EȘECURILE MUTE DE PE VIU (calea nouă — „kelion sa vada tot ce pica") ─────
  // Ce a picat TĂCUT — camera fără cadru, o rută 5xx, creierul mut — a fost
  // înregistrat structurat (recordSimptomLive) și AICI devine ordin de reparație
  // cu cauza REALĂ atașată. Fără pragul „2 useri" al erorilor de browser: eșecul
  // ownerului, singur, contează. Pragul pe fel (`pragPentru`) ține un simplu
  // „camera oprită" să nu nască un ordin degeaba (regula #1). Dedup 7 zile pe
  // semnătură, plafon mic pe rulare — nu inundăm coada.
  let filedLive = 0
  const simptome = await simptomeLiveRecente(6, 1).catch(() => [])
  for (const s of simptome) {
    if (filedLive >= 3) break
    // Simptome VIZIBILE dar pe care constructorul NU le poate repara (nu-s bug de
    // cod): creierul fără credit / cu cota atinsă. Le vede owner-ul, dar nu se
    // trimite un ordin degeaba (regula #1 + #4). Rămân în admin ca semnal.
    if (FARA_REPARATIE.has(s.fel)) continue
    if (s.count < pragPentru(s.fel)) continue // nu e (încă) un tipar — nu-l reparăm orbește
    const sig = signature(`${s.fel} ${s.message}`)
    const key = `selfheal-live:${sig}`

    // ── CONTRACT DE ÎNCHIDERE (Adrian, 12 aug: „nu au nimic clar că trebuie să
    // ajungă la o soluție măsurabilă real. de ce?") ─────────────────────────────
    // Un simptom NU e rezolvat fiindcă s-a trimis un ordin — e rezolvat când
    // ÎNCETEAZĂ. Dacă a mai fost o reparație dar simptomul REAPARE după fereastra
    // de merge+deploy, reparația n-a ținut: se redeschide cu escaladare (schimbă
    // metoda), plafonat ca să nu curgă la infinit. Dacă N-a mai reapărut de la
    // reparație, nici nu ajunge aici (simptomeLiveRecente nu-l mai întoarce) —
    // închis prin absență, măsurat.
    let incercari = 0
    const prevRaw = await loadKv(key)
    if (prevRaw) {
      let prev: { at?: number; incercari?: number } = {}
      try { prev = JSON.parse(prevRaw) } catch { prev = { at: 0, incercari: 1 } }
      const at = Number(prev.at ?? 0)
      incercari = Number(prev.incercari ?? 1)
      const reaparutDupaReparatie = new Date(s.lastSeen).getTime() > at + FEREASTRA_DEPLOY_MS
      const treceFereastraDeReverificare = Date.now() - at > REVERIFICA_MS
      if (!(reaparutDupaReparatie && treceFereastraDeReverificare)) continue // încă ține SAU prea devreme
      if (incercari >= LIMITA_REPARARI) continue // stop-flood: rămâne VIZIBIL ca nerezolvat, nu-l mai reiau orbește
    }

    const ordinBaza = ordinSimptomLive(s.fel, s.message, s.count, s.sampleUrl)
    const ordin =
      incercari > 0
        ? `⚠ REPARAȚIA PRECEDENTĂ (încercarea ${incercari}) NU A OPRIT eroarea — reapare pe viu. ` +
          `SCRIE ÎN PRIMUL RÂND CE FACI ALTFEL; nu relua același drum, ai dovada că nu duce nicăieri.\n\n` +
          ordinBaza
        : ordinBaza

    const id = await createBuildJob('kelion-autovindecare-live', ordin)
    if (id) {
      await saveKv(key, JSON.stringify({ at: Date.now(), job: id, fel: s.fel, count: s.count, incercari: incercari + 1 }))
      filed += 1
      filedLive += 1
    }
  }

  if (filed) {
    console.log(
      `[self-heal] ${filed} reparare(i) trimisă(e) constructorului` +
        (filedLive ? ` (din care ${filedLive} din eșecuri MUTE de pe viu)` : ''),
    )
  }
  return { filed }
}
