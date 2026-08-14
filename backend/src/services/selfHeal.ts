import crypto from 'node:crypto'
import {
  recurringClientErrors, createBuildJob, loadKv, saveKv, requeueMoneyFailedBuildJobs,
  simptomeLiveRecente, listFailedBuildJobsRecent,
} from '../db.js'
import { FISIERE_GAZDA, coadaLogGazda, semnaturiEroare } from './logGazda.js'
import { isOpsPaused } from './runbooks.js'
import { autonomActiv } from './autonomActiv.js'
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
    if (s.count < pragPentru(s.fel)) continue // nu e (încă) un tipar — nu-l reparăm orbește
    const sig = signature(`${s.fel} ${s.message}`)
    const key = `selfheal-live:${sig}`
    if (await loadKv(key)) continue // deja trimis — nu duplicăm

    const id = await createBuildJob('kelion-autovindecare-live', ordinSimptomLive(s.fel, s.message, s.count, s.sampleUrl))
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

  // ── LOGURILE GAZDEI (owner, 14 aug: „cine monitorizează toate logurile?" —
  // răspuns cinstit de azi-dimineață: nimeni; de-acum: ochiul ăsta) ──────────
  // constructor.log + auto-publicare.log, montate read-only la /host/kelion.
  // O semnătură de eroare trebuie văzută în DOUĂ rulări distincte (kv contor)
  // ca să devină ordin — un fulger nu e un tipar (regula #1). Fișier nemontat
  // încă → se sare tăcut (coadaLogGazda spune motivul, nu inventează).
  let filedGazda = 0
  for (const fisier of FISIERE_GAZDA) {
    const coada = await coadaLogGazda(fisier)
    if (!coada.ok) continue
    for (const linie of semnaturiEroare(coada.text)) {
      if (filedGazda >= 2 || filed >= 5) break
      const sig = signature(`${fisier} ${linie}`)
      const cheieFiled = `selfheal-gazda:${sig}`
      if (await loadKv(cheieFiled)) continue
      const cheieContor = `selfheal-gazda-n:${sig}`
      const vazutDe = Number((await loadKv(cheieContor)) ?? '0') + 1
      await saveKv(cheieContor, String(vazutDe))
      if (vazutDe < 2) continue
      const order =
        `AUTO-VINDECARE (loguri gazdă): în ${fisier} de pe VPS apare RECURENT eroarea:\n` +
        `${linie}\n\n` +
        `Găsește CAUZA REALĂ în cod (search_source pe mesaj; sursa probabilă: ` +
        `${fisier === 'constructor.log' ? 'deploy/constructor-agent.mjs sau ruta /api/constructor/*' : 'deploy/deploy.sh, deploy/auto-publicare.sh sau bootul aplicației'}) ` +
        `și rescrie curat modulul responsabil — fără petice. NU schimba nimic în afara cauzei.\n` +
        `Verifică: build + teste (backend și, dacă atingi, frontend).`
      const id = await createBuildJob('kelion-autovindecare-gazda', order)
      if (id) {
        await saveKv(cheieFiled, JSON.stringify({ at: Date.now(), job: id }))
        filed += 1
        filedGazda += 1
      }
    }
  }

  if (filed) {
    console.log(
      `[self-heal] ${filed} reparare(i) trimisă(e) constructorului` +
        (filedLive ? ` (din care ${filedLive} din eșecuri MUTE de pe viu)` : '') +
        (filedGazda ? ` (din care ${filedGazda} din logurile GAZDEI)` : ''),
    )
  }
  return { filed }
}
