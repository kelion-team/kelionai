import crypto from 'node:crypto'
import {
  recurringClientErrors, createBuildJob, loadKv, saveKv, requeueMoneyFailedBuildJobs,
  simptomeLiveRecente, listFailedBuildJobsRecent, activeBuildJobsByScope, logCapabilityGap,
} from '../db.js'

/** UN DOCTOR PE PACIENT (owner, 14 aug: „setezi 1 singur ordin identic, că
 *  deschide ZECI"): cât timp o sursă de vindecare are deja un ordin ÎN COADĂ sau
 *  ÎN LUCRU, nu se mai depune altul de pe aceeași sursă — variațiile aceleiași
 *  cauze nășteau ordine în serie (#235/#236/#237/#248, ~1M tokeni fiecare), iar
 *  fixul primului le-ar fi stins oricum pe restul. Dedup-ul pe semnătură rămâne
 *  (el oprește REPETAREA aceleiași erori); zgarda asta oprește ROIUL de frați. */
export async function sursaOcupata(scope: string): Promise<boolean> {
  const active = await activeBuildJobsByScope(scope)
  if (active > 0) {
    console.log(`[self-heal] ${scope}: ${active} ordin(e) încă în lucru — nu depun altul până nu se termină (un doctor pe pacient)`)
    return true
  }
  return false
}
import { isOpsPaused } from './runbooks.js'
import { autonomActiv } from './autonomActiv.js'
import { geminiLive } from './geminiDirect.js'
import { ordinSimptomLive, pragPentru } from './simptomeLive.js'
import { plafonConstructor } from './autonomie.js'
import { runLogSelfHealPipeline } from './selfHealLogPipeline.js'

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

export function signature(message: string): string {
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

// ── MÂNA RAPIDĂ A AUTOVINDECĂRII: AIDER (owner, 16 aug: „pentru autovindecare
// ... daca e gratuit ... il lasi pe el, face asta corect?") ──────────────────
// Aider e deja lucrătorul #1 din panou (lucratori.ts) și deja instalat în
// imagine (Dockerfile: pip3 install aider-chat). AICI primește PRIMUL ordinul
// de vindecare: clonă separată, editează în bucla lui, TESTELE le rulăm NOI
// (ruleazaLucrator), ramura se împinge și PR-ul se deschide — deci drumul legal
// (PR → porți → master → publicare) rămâne neatins, iar constructorul NU e
// scos: el ține coada, porțile și legile, și rămâne drumul de REZERVĂ (Aider
// fără produs sau cu teste roșii → ordinul se depune la constructor ca până
// azi). Verdictul e MĂSURAT (diff din git + vitest rulat de noi), nu povestit.
async function vindecaCuAider(ordin: string): Promise<string> {
  try {
    const { LUCRATORI, ruleazaLucrator, lucratoriInstalati } = await import('./lucratori.js')
    if (!(await lucratoriInstalati()).includes('aider')) return ''
    const aider = LUCRATORI.find((l) => l.nume === 'aider')
    if (!aider) return ''
    const { config } = await import('../config.js')
    const p = await ruleazaLucrator(aider, `gemini/${config.constructorGeminiModel}`, ordin)
    if (!p.aSchimbat || p.testeTrec !== true || !p.branch) return ''
    const { repoOpenPR } = await import('./github.js')
    const pr = await repoOpenPR(
      p.branch,
      `Auto-vindecare (aider): ${ordin.replace(/\s+/g, ' ').slice(0, 70)}`,
      `Vindecare propusă de lucrătorul Aider pe ordinul de auto-vindecare de mai jos. ` +
        `Diff măsurat: ${p.fisiere} fișiere, +${p.adaugate}/−${p.sterse}; testele backend TREC (rulate de noi, nu de unealtă).\n\n` +
        '```\n' + ordin.slice(0, 1500) + '\n```',
    )
    return /^https?:\/\//.test(pr) ? pr : ''
  } catch (e) {
    console.error(`[self-heal] aider a picat, cad pe constructor: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}`)
    return ''
  }
}

export async function runSelfHeal(): Promise<{ filed: number }> {
  // AMBELE COMUTATOARE opresc self-heal-ul (owner, 13 aug, incident VPS 1000%):
  // altfel, cu „motoare autonome" OFF, self-heal-ul tot reumplea coada (repunea
  // ordine eșuate cu attempts=0 + depunea ordine noi), iar lucrătorul le construia
  // → VPS sufocat. Acum ORICARE comutator oprit ⇒ self-heal-ul nu reumple nimic.
  if ((await isOpsPaused()) || !(await autonomActiv().catch(() => true))) return { filed: 0 }

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

  // ── ERORILE RAPORTATE DIN BROWSER (F12/consolă) ─────────────────────────────
  // PRAG COBORÂT (owner, 13 aug: „obligatoriu trebuie să le verifice, eu nu am
  // timp de așa ceva, face parte din autonomia lui"). Înainte: 5 apariții la 2
  // utilizatori distincți — deci erorile pe care le lovea ownerul SINGUR, testând,
  // NU declanșau auto-reparația. Acum: 3 apariții la 1 utilizator — eșecul lui,
  // singur, contează (ca la simptomele „mute" de mai jos). Rămâne mărginit de
  // plafonul zilnic de bani + dedup pe semnătură + max 3 ordine/rulare, ca o rafală
  // să nu inunde coada. Un singur fluke (1 apariție) tot nu naște ordin — regula #1.
  const errors = await recurringClientErrors(24, 3, 1)
  for (const e of errors) {
    if (filed >= 3) break
    if (await sursaOcupata('kelion-autovindecare')) break // un doctor pe pacient
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

    // Întâi mâna rapidă (Aider, PR direct cu teste verzi); constructorul rămâne rezerva.
    const prAider = await vindecaCuAider(order)
    if (prAider) {
      await saveKv(key, JSON.stringify({ at: Date.now(), aiderPr: prAider, count: e.count }))
      console.log(`[self-heal] aider a vindecat direct (PR: ${prAider}) — fără ordin la constructor`)
      filed += 1
      continue
    }
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
    if (await sursaOcupata('kelion-autovindecare-live')) break // un doctor pe pacient
    if (s.count < pragPentru(s.fel)) continue // nu e (încă) un tipar — nu-l reparăm orbește
    const sig = signature(`${s.fel} ${s.message}`)
    const key = `selfheal-live:${sig}`
    if (await loadKv(key)) continue // deja trimis — nu duplicăm

    const ordinLive = ordinSimptomLive(s.fel, s.message, s.count, s.sampleUrl)
    // Aceeași ordine ca la erorile de browser: întâi Aider, apoi constructorul.
    const prAiderLive = await vindecaCuAider(ordinLive)
    if (prAiderLive) {
      await saveKv(key, JSON.stringify({ at: Date.now(), aiderPr: prAiderLive, fel: s.fel, count: s.count }))
      console.log(`[self-heal] aider a vindecat simptomul live (PR: ${prAiderLive}) — fără ordin la constructor`)
      filed += 1
      filedLive += 1
      continue
    }
    const id = await createBuildJob('kelion-autovindecare-live', ordinLive)
    if (id) {
      await saveKv(key, JSON.stringify({ at: Date.now(), job: id, fel: s.fel, count: s.count }))
      filed += 1
      filedLive += 1
    }
  }

  // ── ORDINELE MOARTE DE TOT (owner, 14 aug: „trebuie rezolvată definitiv
  // partea cu eșuatul ordinelor") ────────────────────────────────────────────
  // Un ordin care și-a ars toate încercările nu mai e reluat de nimeni — și
  // până azi murea ÎN TĂCERE (ownerul îl descoperea singur, pe panou). De-acum:
  // alarmă în panou cu motivul din log, O SINGURĂ dată per ordin (semn în kv).
  // Banii/creierul au căile lor (requeue-ul de mai sus + alarma din ruta
  // creierului) — aici doar se STRIGĂ, nu se re-depune orbește același ordin
  // (l-ar arde din nou pe aceiași bani).
  const moarte = await listFailedBuildJobsRecent(24).catch(() => [])
  for (const m of moarte) {
    const key = `selfheal-ordin-mort:${m.id}`
    if (await loadKv(key)) continue
    await saveKv(key, JSON.stringify({ at: Date.now(), attempts: m.attempts }))
    const peBani = /(402|credit|creier_esec|indisponibil)/i.test(m.log)
    // P27 (LEGEA ordinului: „se rezolva, se arhiveaza, sau se escaladeaza sau
    // se raporteaza la kelion"): ordinul mort intră în TRIAJUL lui Kelion cu
    // motivul — ÎNAINTE de panou și în try separat, ca un panou picat să nu
    // lase triajul nescris (și invers). Zombie nu rămâne nimeni.
    try {
      await logCapabilityGap('constructor', `Ordinul #${m.id} a murit după ${m.attempts} încercări: „${m.orderText.slice(0, 120)}"`, m.log.slice(-300))
    } catch {
      /* raportarea picată nu oprește vindecarea; alarma de panou urmează oricum */
    }
    try {
      const { notifyAdmin } = await import('./adminNotification.js')
      await notifyAdmin(
        'scris',
        `Ordinul #${m.id} a MURIT după ${m.attempts} încercări`,
        `Ordin: „${m.orderText.slice(0, 160)}". Coada NU îl mai reia singură. ` +
          `Motiv (coada logului): „${m.log.slice(-300)}"` +
          (peBani ? ' — pare BANI/CREIER: la revenirea creierului se repune singur (vindecătorul de credit).' : ''),
        { jobId: m.id, attempts: m.attempts },
      )
    } catch {
      /* alarma nu are voie să oprească vindecarea */
    }
  }

  // ── SCANARE LOGURI (SERVER & CONSTRUCTOR/GAZDĂ) CU PIPELINE ȘI MOTOR DE DECIZIE ──
  // Scanare adaptoare decuplate (ServerLogAdapter, ConstructorLogAdapter),
  // grupare pe amprente și verificare praguri de declanșare automată de reparații.
  let filedLogs = 0
  try {
    const logRes = await runLogSelfHealPipeline()
    filedLogs = logRes.filed
    filed += filedLogs
  } catch (err) {
    console.warn('[self-heal] eroare pipeline loguri:', err)
  }

  if (filed) {
    console.log(
      `[self-heal] ${filed} reparare(i) trimisă(e) constructorului` +
        (filedLive ? ` (din care ${filedLive} din eșecuri MUTE de pe viu)` : '') +
        (filedLogs ? ` (din care ${filedLogs} din logurile scanate server/constructor)` : ''),
    )
  }
  return { filed }
}
