import type { FastifyInstance } from 'fastify'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { adminSiId, cerAdmin } from '../session.js'
import { pollVisitorChat } from './demo.js' // visitor chat polling from the common source
import {
  citesteAudit,
  citesteTranzactii,
  citesteUtilizatori,
  citesteIstoric,
  citesteRezumatCost,
  getCapabilityGaps,
  setGapResolved,
  deleteCapabilityGap,
  blockUser,
  unblockUser,
  grantCredit,
  listLeads,
  listContactMessages,
  markLeadContacted,
  listVisitorConvos,
  addVisitorMessage,
  getDemoStats,
  purgeVisits,
  getUserActivity,
  getDownloadStats,
  listInboundEmails,
  getDisabledGestures,
  setDisabledGestures,
  listKelionTools,
  decideKelionTool,
  listBuildJobs,
  listClientErrorGroups,
  resetCostCounters,
  rezumatPlati,
  listeazaPlatiNeatribuite,
  atribuiePlataNeatribuita,
  ignoraPlataNeatribuita,
  listeazaCoduriNeplatite,
  listeazaPlatiIncasate,
  totaluriPlati,
  getGeminiMonthUsd,
  loadKv,
  saveKv,
  noteazaAudit,
} from '../db.js'
import { videoPlatitPornit, KV_VIDEO_PLATIT, KV_VIDEO_ULTIMA } from '../services/video.js'
import { systemHealth } from '../services/health.js'
import { recentLogs } from '../services/logbuffer.js'
import { explicaEroare } from '../services/explicaEroare.js'
import { problemeGlobaleAcum } from '../services/autodiagnostic.js'
import { getAdminNotifications, markAdminNotificationRead } from '../services/adminNotification.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { stareCitirePlati, incepeLegaturaPlati, finalizeazaLegaturaPlati } from '../services/openBanking.js'
import { starePlatiEmail } from '../services/platiEmail.js'
import { stareAutonomie } from '../services/autonomie.js'
import { cheltuieliAplicatiei } from '../services/cardFurnizor.js'
import { isOpsPaused, setOpsPaused } from '../services/runbooks.js'
import { autonomActiv, seteazaAutonom } from '../services/autonomActiv.js'
import { dovezileAutonomiei } from '../services/dovezi.js'
import { isArmed as isLockArmed, hasUnlock, grantUnlock, verifyLockSecret, setLockSecret } from '../services/adminLock.js'
import { listRecoveryPoints, createRecoveryPoint, restoreToPoint } from '../services/recovery.js'
import { geminiLive } from '../services/geminiDirect.js'
import { getSerperBalance } from '../services/serperBalance.js'
import { VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { resurseGazda } from '../services/resurse.js'
import { triageGaps } from '../services/gapsTriage.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { envCheck, envOrphans, envSummary, processStartedAt } from '../services/envCheck.js'
import { sendMail } from '../services/mail.js'
import { fetchRecentInbox, deleteInboxMessages } from '../services/mailbox.js'
import { translateMany } from '../services/google.js'
import { uitaToateSesiunile } from '../services/stareSesiune.js'
import { dovadaUltimuluiUpgrade } from '../services/modelAutoUpgrade.js'

// ── Store presence (the admin's REAL market control) ───────────────────────
// Live checks against the four public install locations. Cached 5 minutes so
// the admin tab never hammers the stores. `listed` is the truth of the moment:
// a store page that 404s is NOT listed, no matter what the dashboard promises.
interface StoreCheck {
  key: string
  name: string
  store: string
  url: string
  listed: boolean
}
let storeCache: { at: number; checks: StoreCheck[] } | null = null

const STORE_TARGETS: { key: string; name: string; store: string; url: string }[] = [
  { key: 'windows', name: 'Windows', store: 'Microsoft Store', url: 'https://apps.microsoft.com/detail/9NBW313FHN44' },
  { key: 'android', name: 'Android', store: 'Google Play', url: 'https://play.google.com/store/apps/details?id=app.kelionai.twa' },
  { key: 'ios', name: 'iOS', store: 'App Store', url: 'https://apps.apple.com/app/id6786766714' },
  { key: 'linux', name: 'Linux', store: 'Web app (kelionai.app)', url: 'https://kelionai.app/health' },
]

async function checkStores(): Promise<StoreCheck[]> {
  if (storeCache && Date.now() - storeCache.at < 5 * 60_000) return storeCache.checks
  const checks = await Promise.all(
    STORE_TARGETS.map(async (t) => {
      let listed = false
      try {
        const res = await fetch(t.url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (KelionaiStatus)' },
        })
        listed = res.ok
      } catch {
        /* unreachable → not listed right now */
      }
      return { ...t, listed }
    }),
  )
  storeCache = { at: Date.now(), checks }
  return checks
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ── THE ADMIN LOCK (Adrian, 27 Jul) — the unlock routes. The global gate in
  // index.ts exempts /api/admin/unlock*; everything else here requires an
  // admin session. The secret is chosen by Adrian in Admin→Security and lives
  // only as a scrypt hash in kv; a matching voiceprint unlocks automatically
  // (see routes/realtime.ts). The state — the client decides what to show on
  // the button.
  app.get('/api/admin/unlock/status', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const armed = await isLockArmed()
    return reply.send({ armed, unlocked: !armed || hasUnlock(req, user.email) })
  })

  app.post<{ Body: { secret?: string } }>('/api/admin/unlock', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const secret = String(req.body?.secret ?? '')
    if (!secret || !(await verifyLockSecret(user.email, secret)))
      return reply.code(401).send({ error: 'cod_gresit' })
    grantUnlock(reply, user.email, 'secret')
    return reply.send({ ok: true })
  })

  // Setting/changing the secret. Unarmed → anytime (first arming); armed →
  // only from an ALREADY unlocked session (an open panel implies that).
  app.post<{ Body: { secret?: string } }>('/api/admin/unlock/secret', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const armed = await isLockArmed()
    if (armed && !hasUnlock(req, user.email)) return reply.code(423).send({ error: 'admin_locked' })
    const secret = String(req.body?.secret ?? '').trim()
    if (secret.length < 4) return reply.code(400).send({ error: 'secret_prea_scurt' })
    await setLockSecret(secret)
    grantUnlock(reply, user.email, 'secret') // the browser that arms stays unlocked
    return reply.send({ ok: true })
  })

  // RECOVERY POINTS (Adrian, 27 Jul): the "Recovery" menu in admin — the saved
  // versions (git tags, mirrored on the VPS as .bundle/.tar.gz) with clear
  // details, + a button to save the current version.
  app.get('/api/admin/backups', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): citirea picată (token lipsă / GitHub ne-ok) NU mai
    // e servită ca listă goală — 503, iar panoul scrie „nu pot citi
    // versiunile", distinct de „nicio versiune salvată încă".
    const points = await listRecoveryPoints()
    if (!points) return reply.code(503).send({ error: 'recovery_unreadable' })
    return reply.send({ points })
  })
  app.post<{ Body: { note?: string } }>('/api/admin/backups', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const r = await createRecoveryPoint(String(req.body?.note ?? ''))
    if (!r.ok) return reply.code(500).send(r)
    return reply.send(r)
  })
  // RESTORING from a saved point (Adrian, 27 Jul: selection buttons in admin).
  // Brings master to the tag's state with a new commit → publishing to the VPS
  // starts by itself. Heavy action → confirmation is in the UI, double.
  app.post<{ Body: { tag?: string } }>('/api/admin/backups/restore', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const r = await restoreToPoint(String(req.body?.tag ?? ''))
    if (!r.ok) return reply.code(500).send(r)
    return reply.send(r)
  })

  // ROW 19 — inbound contact@ emails + the Secretary's auto-replies (admin only).
  app.get('/api/admin/inbound', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ emails: await listInboundEmails(50) })
  })

  // LIVE INBOX (Adrian, 10 Jul) — reads the REAL contact@kelionai.app mailbox
  // over IMAP (latest messages, read or not), so the admin sees everything in
  // the mailbox, not just the new mail the poller caught. Read-only, admin
  // only.
  app.get('/api/admin/mailbox-live', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): răspunsul spune și DE CE e goală lista — `ok:false`
    // + `motiv` deosebește „cutia e goală" de „IMAP a picat" / „MAIL_PASS
    // lipsă"; UI-ul desenează trei texte diferite, nu unul ambiguu.
    return reply.send(await fetchRecentInbox(40))
  })

  // ȘTERGEREA DIN INBOX (Adrian, 3 aug: „să șterg de aici câte una sau prin
  // selecție toate"). UID-uri exacte din panou; serviciul mută în coșul REAL al
  // serverului când există (recuperabil), altfel șterge definitiv — și spune
  // care din ele s-a întâmplat. Întoarce câte s-au șters DE FAPT.
  app.post<{ Body: { uids?: number[] } }>('/api/admin/mailbox-delete', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const uids = Array.isArray(req.body?.uids) ? req.body.uids.map(Number) : []
    if (!uids.length) return reply.code(400).send({ error: 'uids_lipsa' })
    const r = await deleteInboxMessages(uids)
    return reply.send({ ok: r.sterse > 0, ...r })
  })

  // Market control: live store presence + direct-download counts + WHO
  // downloaded (email when signed in, else IP + country). Store installs are
  // aggregate-only by design — no store exposes user identities.
  app.get('/api/admin/stores', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const [checks, downloads] = await Promise.all([checkStores(), getDownloadStats()])
    return reply.send({ stores: checks, downloads })
  })

  // List users with message counts (admin only).
  app.get('/api/admin/users', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const u = await citesteUtilizatori()
    // 0 UTILIZATORI ≠ NU POT CITI (M7b, 8 aug). `listUsers()` întorcea `[]` și
    // când baza nu răspundea — panoul desena „niciun utilizator" peste o citire
    // imposibilă. Acum eșecul iese 503 cu motivul, nu ca listă goală.
    if (!u.citit) return reply.code(503).send({ error: 'utilizatori_necititi', motiv: u.motiv })
    return reply.send({ users: u.valoare })
  })

  // Full chat history for one user (admin only).
  app.get<{ Querystring: { email?: string } }>('/api/admin/history', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const email = req.query.email
    if (!email) return reply.code(400).send({ error: 'bad_request', message: 'email required' })
    const h = await citesteIstoric(email)
    if (!h.citit) return reply.code(503).send({ error: 'istoric_necitit', motiv: h.motiv })
    return reply.send({ history: h.valoare })
  })

  // Batch-translate a conversation's messages into Romanian (the "Translate
  // into Romanian" button in the chat viewer — testers write in any language).
  // Admin only. `failed` tells the admin how many messages came back as
  // UNTRANSLATED ORIGINAL (the translation service failed for them) — so a
  // half-translated conversation is never mistaken for a full one.
  app.post<{ Body: { texts?: unknown; target?: unknown } }>('/api/admin/translate', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const raw = req.body?.texts
    const texts = Array.isArray(raw) ? raw.slice(0, 300).map((t) => String(t ?? '')) : []
    if (texts.length === 0) return reply.send({ translations: [], failed: 0 })
    const target = typeof req.body?.target === 'string' && req.body.target ? req.body.target : 'Romanian'
    return reply.send(await translateMany(texts, target))
  })

  // Live real-cost / credit monitor (admin only) — total, today, per-AI breakdown.
  // M7b (8 aug): o citire picată NU mai iese ca „total: 0" — iese 503 cu motivul.
  app.get('/api/admin/costs', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const c = await citesteRezumatCost()
    if (!c.citit) return reply.code(503).send({ error: 'costuri_necitibile', motiv: c.motiv })
    return reply.send(c.valoare)
  })

  // Capability gaps — what users asked for that Kelion can't do yet (admin only).
  app.get<{ Querystring: { all?: string } }>('/api/admin/gaps', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ gaps: await getCapabilityGaps(req.query.all === '1') })
  })

  // THE COMPLETE AUDIT OF FAILURES (Adrian, 27 Jul: "here you must see all the
  // audits and all the failures"): the Uncovered requests tab shows, besides
  // gaps, EVERYTHING that failed — server errors (the server F12), client
  // errors (the browser F12), failed build orders and health problems (live vs
  // master, red runs, disk, DB, brain balance).
  app.get('/api/admin/audit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const [healthRaw, jobs, clientErrors] = await Promise.all([
      systemHealth().catch(() => '{}'),
      // listBuildJobs întoarce null la eșec (auditul admin, 3 aug); aici e
      // best-effort — auditul restului rămâne chiar dacă coada nu se citește.
      listBuildJobs(12).then((j) => j ?? []).catch(() => []),
      listClientErrorGroups(48, 30).catch(() => []),
    ])
    let health: unknown = {}
    try {
      health = JSON.parse(healthRaw)
    } catch {
      /* health unavailable — the rest of the audit stays */
    }
    return reply.send({
      health,
      serverErrors: recentLogs(40, 60),
      clientErrors,
      failedJobs: jobs
        .filter((j) => j.status === 'failed')
        .map((j) => ({ id: j.id, order: j.orderText.slice(0, 160), updated: j.updatedAt })),
    })
  })

  // ── LISTA DE ERORI, CE E FIECARE (Adrian, 12 aug: „adminul trebuie să aibă o
  // listă de erori care îi spune exact ce este") ─────────────────────────────
  // Erorile din browser (grupate pe mesaj) + defectele de sistem (server +
  // ordine picate), FIECARE cu explicația „ce este" din `explicaEroare`. Adminul
  // vede clar, nu coduri seci. E fața vizuală a autodiagnosticului pe care Kelion
  // îl are deja în creier (chat.ts) — aceeași sursă de adevăr.
  app.get('/api/admin/erori', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const [grupuriBrowser, sistem] = await Promise.all([
      listClientErrorGroups(48, 40).catch(() => []),
      problemeGlobaleAcum().catch(() => []),
    ])
    const browser = grupuriBrowser.map((g) => {
      const ex = explicaEroare(g.message)
      return {
        text: g.message,
        ceEste: ex.ceEste,
        severitate: ex.severitate,
        categorie: ex.categorie,
        cate: Number(g.n) || 1,
        cine: g.user_email ?? null,
        cand: g.created_at,
      }
    })
    return reply.send({ browser, sistem })
  })

  // ── NOTIFICĂRI PENTRU OWNER (K14: „sistem de rezolvări care anunță adminul că
  // sunt cereri") ────────────────────────────────────────────────────────────
  // Cereri noi care cer atenția ownerului: plată neatribuită (bani fără cod) și
  // cerere neacoperită (un user a cerut ceva ce Kelion nu acoperă). Sunt scrise
  // la momentul evenimentului (notifyAdmin); aici le citește + le marchează citite.
  app.get<{ Querystring: { necitite?: string } }>('/api/admin/notificari', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ notificari: await getAdminNotifications(50, req.query?.necitite === '1') })
  })
  app.post<{ Params: { id: string } }>('/api/admin/notificari/:id/citit', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    return reply.send({ ok: await markAdminNotificationRead(id) })
  })

  // ── PLAFONUL ZILNIC DE ARDERE (B8/K15: „contor real + limitare automată +
  // buton de oprit limita") ───────────────────────────────────────────────────
  // Contorul (cât s-a cheltuit azi, MĂSURAT), cifra plafonului și comutatorul.
  // Bucla de autonomie citește aceleași valori (plafonConstructor) și se oprește
  // la atingere. Import dinamic ca să nu legăm rutele de autonomie la boot.
  app.get('/api/admin/plafon-constructor', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { plafonConstructor } = await import('../services/autonomie.js')
    return reply.send(await plafonConstructor())
  })
  app.post<{ Body: { plafon?: number; activ?: boolean } }>('/api/admin/plafon-constructor', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    if (typeof req.body?.plafon === 'number' && Number.isFinite(req.body.plafon) && req.body.plafon > 0) {
      await saveKv('constructor:plafon_usd', String(Math.min(10000, Math.max(0.5, req.body.plafon))))
    }
    if (typeof req.body?.activ === 'boolean') {
      await saveKv('constructor:plafon_activ', req.body.activ ? '1' : '0')
    }
    const { plafonConstructor } = await import('../services/autonomie.js')
    return reply.send(await plafonConstructor())
  })

  // AUTONOMOUS TRIAGE (Adrian, 24 Jul): Kelion decides by itself on each gap —
  // valuable (stays, "TO IMPLEMENT") or automatically closed with a reason.
  // The admin button only triggers; the same function also runs daily,
  // autonomously.
  app.post('/api/admin/gaps/triage', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await triageGaps())
  })

  // Mark a gap resolved / reopen it (admin only). Used by the "Reject" button.
  app.post<{ Body: { id?: number; resolved?: boolean } }>('/api/admin/gaps/resolve', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const id = Number(req.body?.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad_request' })
    await setGapResolved(id, req.body?.resolved !== false)
    return reply.send({ ok: true })
  })

  // ȘTERGEREA DEFINITIVĂ a unei cereri neacoperite (Adrian, 3 aug: „trebuie să
  // aibă butoane de ștergere, sau rezolvate și arhivate"). Rezolvarea de mai
  // sus e arhivarea; asta e pentru zgomot/duplicate — rândul dispare de tot.
  app.delete<{ Params: { id: string } }>('/api/admin/gaps/:id', async (req, reply) => {
    const id = adminSiId(req, reply, req.params.id)
    if (id === null) return
    return reply.send({ ok: await deleteCapabilityGap(id) })
  })

  // (Ruta GET /api/admin/pool a fost ȘTEARSĂ DE-ADEVĂRATELEA — auditul admin,
  // 3 aug: trăia aici deși comentariul de mai jos, „was DELETED (Adrian, 30
  // Jul)", jura contrariul, n-o chema nimeni din frontend, iar getAdminAccount
  // — sursa ei — inventa {spent:0, profit:0} la orice eșec de DB. Funcția a
  // fost ștearsă din db.ts odată cu ruta.)

  // The brain is 100% Gemini direct (OpenRouter/OpenAI extirpate, 3 aug). The
  // bar polls this route: the Gemini live state + real month spend, the Serper
  // search credit and the VPS resources. STRICTLY admin (users don't see it).
  // ── CREDITUL RĂMAS, PE FIECARE AI (Adrian, 8 aug) ────────────────────────
  // `/api/admin/brain-credit` de mai jos e pastila din bară: Gemini + Serper,
  // în formă scurtă. Asta e RAPORTUL: un rând pe furnizor, cu ce s-a putut citi
  // de la el, ce s-a cheltuit la noi, și — acolo unde furnizorul nu dă sold —
  // motivul scris pe față, nu un zero care arată liniștitor.
  app.get('/api/admin/credit-ai', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // BECUL per furnizor, derivat pe server (o singură sursă, testabilă): verde =
    // are credit, roșu = fără (402/0), gri = nu pot verifica. Frontendul doar
    // desenează culoarea, nu re-judecă starea (două logici ar diverge).
    const { crediteAI, beculCredit } = await import('../services/creditAI.js')
    const furnizori = (await crediteAI()).map((c) => ({ ...c, bec: beculCredit(c) }))
    return reply.send({ furnizori })
  })

  app.get('/api/admin/brain-credit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const [vps, serperBalance, geminiCost, geminiState] = await Promise.all([
      resurseGazda(),
      // THE SERPER PILL: the REAL remaining search credit read from Serper's
      // /account endpoint. Cached 5 min in the service.
      getSerperBalance(),
      // THE GEMINI PILL (Adrian, 3 aug: „vreau să văd că am bani la gemini").
      // Creditul promoțional (£10.88) NU e expus de niciun API Google (nici
      // Cloud Billing nu are „credit balance") — deci nu-l pot CITI, nu-l pot
      // inventa (regula #1). Ce arăt sunt DOUĂ măsurători + o valoare pe care o
      // spui TU: (1) starea LIVE — un ping mic zice dacă cheia Tier 2 servește
      // (200 = ai credit + merge; „depleted" = epuizat); (2) cheltuiala REALĂ pe
      // luna curentă (cost_events kind='gemini'); (3) `creditGbp` — cifra pe care
      // o vezi în AI Studio și mi-o dai o dată (kv 'gemini:credit'), afișată ca
      // ATARE, cu data, fiindcă Google n-o dă automat. A ta, nu inventată de mine.
      getGeminiMonthUsd(),
      geminiLive(),
      // (Citirea kv `gemini:credit` a fost SCOASĂ, 15 aug — declarația manuală
      // a murit; soldul vine derivat din export, mai jos.)
    ])
    // ── SOLDUL REAL, DERIVAT DIN EXPORT (ordinul din 15 aug: „valoarea reală…
    // trebuie citit automat") ────────────────────────────────────────────────
    // Declarația de mână a MURIT: cifra spusă de om se învechea la fiecare
    // auto-reload și pastila ajungea să mintă (£0.00 lângă £25.80 real).
    // Acum: full_amount − aplicat, per credit, din exportul Cloud Billing →
    // BigQuery. Nicio verigă → `soldMotiv` cu pasul exact, NICIODATĂ o cifră.
    let geminiSold: number | undefined
    let geminiSoldMoneda: string | undefined
    let geminiSoldMotiv: string | undefined
    try {
      const { soldCrediteGoogle } = await import('../services/facturareGoogle.js')
      const s = await soldCrediteGoogle()
      if (s.ok && s.date.soldTotal != null) {
        geminiSold = s.date.soldTotal
        geminiSoldMoneda = s.date.moneda || undefined
      } else {
        geminiSoldMotiv = s.ok
          ? 'exportul are credite dar fără full_amount — soldul nu se poate deriva'
          : s.motiv
      }
    } catch {
      geminiSoldMotiv = 'citirea soldului din export a picat'
    }
    return reply.send({
      // (Câmpurile `openrouter` și `openai` au fost SCOASE din răspuns, 3 aug —
      // furnizorii au fost extirpați; pastilele lor au dispărut din bară.)
      active: 'gemini',
      // ── THE VPS, PERMANENTLY IN THE BAR (Adrian, 31 Jul: "permanently show
      // VPS on the interface in the top bar") ───────────────────────────────
      // It rides on this route, not a new one: the bar polls it every 30s
      // anyway (usePolledJson, intervalul implicit — cifra corectată la audit,
      // 3 aug: comentariul vechi jura „15s"), and reading /proc costs
      // microseconds. An extra poller would have been cost with no gain.
      // `null` when it can't be measured — the bar writes "⚠ VPS", NOT zeros.
      // A "0.0 GB / 0%" would look identical to a dead server and would be
      // exactly the error he keeps complaining about: a failed reading
      // presented as real state.
      vps,
      // The REAL Serper search credit (searches left). `live: false` means
      // UNREADABLE (key missing or read failed) — the bar writes "Serper ⚠",
      // NEVER "Serper 0" (regula de onestitate #1).
      serper: {
        live: serperBalance.ok,
        balance: serperBalance.ok ? serperBalance.balance : undefined,
        rateLimit: serperBalance.ok ? serperBalance.rateLimit : undefined,
        error: serperBalance.error,
      },
      // THE GEMINI PILL. `serving` = the live ping (Tier 2 key returned 200 →
      // green "Gemini ✓": credit present + working; false → red "Gemini ⚠" with
      // the reason: 'depleted' (prepay credit gone), 'quota', 'error'/network).
      // `checked: false` = the ping itself couldn't run (no key / network) — a
      // "⚠", never a fake "OK". `monthUsd` = REAL month-to-date Gemini spend from
      // our journal (tooltip detail). Nothing fabricated — the £11.58 prepay
      // credit is not exposed by any Google API (verified), so we show the honest
      // signal that reflects it: green while it serves, red the moment it can't.
      gemini: {
        checked: geminiState.ok,
        serving: geminiState.serving,
        reason: geminiState.reason,
        monthUsd: geminiCost.ok ? geminiCost.monthUsd : undefined,
        // SOLDUL REAL, derivat automat din exportul BigQuery (full_amount −
        // aplicat, per credit) — ordinul din 15 aug: „valoarea reală… citit
        // automat". Absent → `soldMotiv` spune exact ce lipsește (de obicei:
        // „aștept exportul" sau rolul rămas în consolă); pastila arată ✓/⚠,
        // NICIODATĂ un număr inventat. Declarația manuală a murit.
        sold: geminiSold,
        soldMoneda: geminiSoldMoneda,
        soldMotiv: geminiSoldMotiv,
      },
      // (Câmpul `runpod` a fost SCOS, 14 aug — owner: constructorul nu mai rulează
      // pe RunPod, ci pe Gemini (principal) → Fable 5 (rezervă), AMBELE prin app.
      // Creierul PRINCIPAL (Gemini) se vede pe pastila Gemini de mai sus; REZERVA
      // (Fable 5) e un rând în raportul pe furnizori — /api/admin/credit-ai. O
      // pastilă „RunPod" ar fi afișaj fals.)
      // (Câmpul `pool` a fost SCOS — auditul admin, 3 aug: nicio pastilă nu-l
      // desena, tipul din frontend mințea (loaded/remaining nu mai existau),
      // iar sursa lui, getAdminAccount, rula două SUM-uri la fiecare poll
      // pentru o valoare nefolosită și întorcea zerouri fabricate la eșec.)
    })
  })

  // ── CREDITUL GEMINI SPUS DE OWNER (Adrian, 3 aug: „gemini nu e afișată
  //    valoarea pe aplicație") — ÎNCHISĂ pe 15 aug ─────────────────────────
  // Ordinul: „re-declararea soldului Gemini trebuie citit automat — valoarea
  // reală". Declarația de mână a murit: soldul se DERIVEAZĂ din exportul
  // Cloud Billing → BigQuery (full_amount − aplicat, per credit, în
  // facturareGoogle.soldCrediteGoogle). Ruta rămâne ca apelanții vechi să
  // primească MOTIVUL, nu un 404 mut (tiparul de la /api/me/delete).
  app.post('/api/admin/gemini-credit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.code(410).send({
      error: 'declararea_manuala_inchisa',
      motiv:
        'Soldul Gemini se citește AUTOMAT din exportul Cloud Billing → BigQuery (totalul acordat minus creditele aplicate) — ordinul din 15 aug: „valoarea reală". Nu mai e nimic de declarat de mână; dacă pastila nu arată încă cifra, motivul de pe ea spune exact ce pas de consolă lipsește.',
    })
  })

  // (Ruta /api/admin/openai-costs a fost ȘTEARSĂ, 3 aug — OpenAI extirpat:
  // nu mai există nicio cheltuială OpenAI de citit.)

  // The REAL picture of the owner's money (admin only): the real cost consumed
  // at providers and the real profit. No hand-written figure. (Stripe is fully
  // out — 31 Jul; OpenRouter/OpenAI extirpate — 3 aug, împreună cu „punga"
  // care era soldul OpenRouter.)
  app.get('/api/admin/finance', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // M7b (8 aug): banii nu se desenează din zerouri inventate — dacă jurnalul
    // de cost nu se poate citi, pagina primește 503 cu motivul, nu „£0.00".
    const citire = await citesteRezumatCost()
    if (!citire.citit) return reply.code(503).send({ error: 'costuri_necitibile', motiv: citire.motiv })
    const costs = citire.valoare
    return reply.send({
      // (Câmpurile `spent` și `profit` au fost SCOASE — auditul admin, 3 aug:
      // tabul Bani nu le desena (citește spentUsd/masurat/estimat/today), iar
      // sursa lor, getAdminAccount, dubla SELECT-ul din getCostSummary și
      // inventa zerouri la eșec. Funcția a fost ștearsă din db.ts.)
      // The cost journal is kept in USD end to end (cost_events.cost_usd) —
      // the Money tab never mixes "total £" with "azi $".
      spentUsd: costs.total,
      currency: config.billing.currency,
      byKind: costs.byKind,
      // Consumed TODAY (USD, real) — for the "Consumed today" card in the
      // Money tab.
      today: costs.today,
      // ── REAL vs ESTIMATE, WRITTEN ON EVERY ROW ────────────────────────────
      // Only brain calls carry the provider's own figure. Everything else —
      // the voice minutes especially — is a fixed rate × a quantity, OUR
      // estimate. The tab labels each row from `felul`; an unlabeled estimate
      // presented as cost is exactly the "voice_minutes $204.52" fabrication
      // this change removes.
      masurat: costs.masurat,
      estimat: costs.estimat,
      felul: costs.felul,
      // (Câmpurile `punga`, `openrouter` și `openai` au fost SCOASE, 3 aug —
      // furnizorii au fost extirpați; nu mai există sold OpenRouter de citit.)
    })
  })

  // ORDIN #6G: admin view of all credit transactions (status, amount, credits, user).
  app.get('/api/admin/transactions', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const t = await citesteTranzactii(200)
    if (!t.citit) return reply.code(503).send({ error: 'tranzactii_necitite', motiv: t.motiv })
    return reply.send({ transactions: t.valoare })
  })

  // Per-USER activity (admin only): who signed in, last IP/place/device, how
  // long they stayed (sum of presence-ping time), plus their latest sessions.
  app.get('/api/admin/activity', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): DB picat NU mai răspunde 200 cu liste goale („nu
    // s-a strâns activitate" nemăsurat) — 500, iar panoul scrie „nu pot citi".
    const activity = await getUserActivity()
    if (!activity) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send(activity)
  })

  // P26 — REGISTRUL DE AUDIT + dovada backupului (owner, 15 aug: „istoric
  // INCIDENTUL 15 aug seara: prima versiune a rutei se chema /api/admin/audit —
  // adresă care EXISTA deja (auditul eșecurilor, 27 iul, mai sus) — iar Fastify
  // a crăpat bootul pe „duplicated route" → 502 pe live până a ținut plasa
  // publicării. Lecția: orice rută nouă se caută întâi cu grep + BOOTUL se
  // probează local înainte de push (poarta VPS fiind mută, bootul nu-l mai
  // proba nimeni). Adresa nouă: registru-audit.
  // salvat cu dovezi cine a modificat, trasabilitate 24 din 24 de ore" +
  // „baza de date nu se pierde"). Registrul vine din audit_log (el însuși sub
  // scutul datelor); backupul e MĂSURAT de pe disc — cel mai nou fișier din
  // BACKUP_DIR (implicit /root/kelion/backups, scris de deploy/backup.sh) —
  // nu presupus. Fără director pe mașina asta → null cinstit, nu o dată
  // inventată (regula #1).
  app.get('/api/admin/registru-audit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const randuri = await citesteAudit(200)
    let backup: { fisier: string; la: string; octeti: number } | null = null
    try {
      const dir = process.env.BACKUP_DIR || '/root/kelion/backups'
      let cel: { f: string; t: number; s: number } | null = null
      for (const f of await readdir(dir)) {
        const st = await stat(join(dir, f)).catch(() => null)
        if (st?.isFile() && (!cel || st.mtimeMs > cel.t)) cel = { f, t: st.mtimeMs, s: st.size }
      }
      if (cel) backup = { fisier: cel.f, la: new Date(cel.t).toISOString(), octeti: cel.s }
    } catch {
      /* mașina asta n-are director de backup — rămâne null, spus pe față */
    }
    if (!randuri) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ randuri, backup })
  })

  // Free-trial visitor analytics (admin only): where trials come from — country,
  // city, IP, total, today.
  app.get('/api/admin/demos', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): zerourile fabricate de vechiul `empty` nu mai ies
    // pe ușă — o citire picată e 500, nu „Vizite 0/0".
    const demos = await getDemoStats()
    if (!demos) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send(demos)
  })

  // GOLEȘTE BAZA DE VIZITATORI (owner, 13 aug: „golești baza de date de
  // vizitatori, cine va fi acolo va avea o poză cu acceptul lor"). Distructiv,
  // dar mărginit la analiza de vizitatori — declanșat DOAR de owner, prin
  // butonul din tabul „Vizitatori" (confirmarea lui = clicul). Întoarce câte
  // rânduri s-au șters (măsurat), nu un „gata" inventat.
  app.post('/api/admin/visitors/purge', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    try {
      const deleted = await purgeVisits()
      if (deleted < 0) return reply.code(500).send({ error: 'db_unreadable' })
      return reply.send({ ok: true, deleted })
    } catch {
      return reply.code(500).send({ error: 'purge_failed' })
    }
  })

  // Which brain models actually serve right now (admin only): a real 1-token
  // ping of the default chat + work models through Gemini direct (services/brain.ts).
  app.get('/api/admin/models', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // DOVADA ULTIMULUI AUTO-UPGRADE (Adrian, 7 aug: „clar cu dovadă"). Scorul
    // candidatului ȘI al modelului activ, probate în aceeași trecere, plus ce
    // sarcini a picat. `null` când nu s-a verificat încă — „nu pot verifica",
    // nu o cifră liniștitoare inventată.
    return reply.send({ ...(await verifyModels()), dovadaUpgrade: await dovadaUltimuluiUpgrade() })
  })

  // Verify the brain key live (admin only): pings the Gemini chat default
  // with a 1-token call; reports ok/fail without ever exposing the key value.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await verifyKeys())
  })

  // VERIFY ALL PRIVILEGED TOKENS (Adrian, 14 Jul): verifies LIVE all the
  // keys/tokens with access to external services and reports status without
  // exposing secret values. Includes the Gemini brain, Google
  // (service account/TTS/OAuth), Mail (SMTP+IMAP), PostgreSQL
  // and SESSION_SECRET.
  app.get('/api/admin/token-checks', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const checks = await runAllTokenChecks()
    const ok = checks.filter((c) => c.status === 'ok').length
    const notConfigured = checks.filter((c) => c.status === 'not_configured').length
    const failed = checks.length - ok - notConfigured
    return reply.send({ ok, notConfigured, failed, total: checks.length, checks })
  })

  // ── WHICH KEYS THE SERVER SEES RIGHT NOW (Adrian, 30 Jul: "all the keys
  // have been written dozens of times") ─────────────────────────────────────
  // The panel said "(not configured)" while the man said "I wrote them". Both
  // can be true: a WRITTEN key doesn't automatically reach the running process
  // — it may be in a different file than the one given to docker, written
  // AFTER the container started (so unloaded until a restart), or set as a
  // GitHub secret without running `vps-set-env`. This route asks the PROCESS,
  // not the man. It returns NO values — only the name, whether present, and
  // the length.
  app.get('/api/admin/env-check', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({
      vars: envCheck(),
      summary: envSummary(),
      // Keys you HAVE in the process, but under a name the code didn't read.
      // That's the answer to "I wrote it dozens of times": you wrote it, I was
      // looking elsewhere. Only NAMES, never values.
      orphans: envOrphans(),
      // The process start time: answers the question that actually matters —
      // "did I write the key BEFORE or AFTER the app started?"
      startedAt: processStartedAt(),
    })
  })

  // GESTURES (Adrian, 13 Jul): the admin panel reads/writes which gestures
  // Kelion is allowed to use contextually. Admin only (403 otherwise). We
  // store the DISABLED list (default: all active).
  app.get('/api/admin/gestures', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ disabled: await getDisabledGestures() })
  })
  app.post<{ Body: { disabled?: string[] } }>('/api/admin/gestures', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const list = Array.isArray(req.body?.disabled) ? req.body.disabled : []
    await setDisabledGestures(list)
    // Gesturile sunt o setare GLOBALĂ, dar de la 7 aug fiecare sesiune își ține
    // lista în memorie (stareSesiune, TTL 10 min) ca să nu recitească DB-ul la
    // fiecare tură. Fără linia asta, un gest debifat din panou ar fi rămas activ
    // până la 10 minute pentru oricine e deja logat — exact tiparul „valoare
    // veche servită după ce s-a schimbat". Uităm TOT: următoarea tură recitește.
    uitaToateSesiunile()
    return reply.send({ ok: true, disabled: await getDisabledGestures() })
  })

  // KELION'S SELF-EXPANSION (Adrian, 25 Jul): the tools Kelion PROPOSED by
  // itself. The owner sees them and approves/rejects with ONE CLICK — an
  // approved tool becomes active instantly, no redeploy. "Independent up to
  // deploy, with my approval" — exactly the requested gate.
  app.get('/api/admin/kelion-tools', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ tools: await listKelionTools() })
  })
  app.post<{ Body: { id?: number; approve?: boolean } }>('/api/admin/kelion-tools', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const id = Number(req.body?.id ?? 0)
    if (!id) return reply.code(400).send({ error: 'bad_request' })
    const ok = await decideKelionTool(id, req.body?.approve === true)
    return reply.send({ ok, tools: await listKelionTools() })
  })

  // RESETTING THE CONSUMPTION COUNTERS (Adrian, 30 Jul). Deletes ONLY the
  // journal of our costs at providers. The users' wallets, the payments ledger
  // and the purchase history stay UNTOUCHED — consumed credits are not given
  // back, and accounting is not rewritten. Requires an admin session, like
  // everything here.
  // ── „TRIMISĂ CU SUCCES" ERA O MINCIUNĂ (măsurat, 8 aug 2026) ──────────────
  // Ruta chema cele două runbook-uri și le ARUNCA răspunsul, apoi întorcea
  // `{ok:true}` orice s-ar fi întâmplat. Probat pe o instanță fără GITHUB_TOKEN:
  //
  //     POST /api/admin/reset-vps  →  200 {"ok":true}
  //
  // în timp ce `runRunbook` întorsese `{"error":"github_token_missing"}`. Adică
  // butonul „Reset VPS" scria „Comanda a fost trimisă cu succes" fără să fi
  // trimis nimic — și s-ar fi purtat identic cu autonomia pusă pe pauză
  // („paused_by_owner"), cu workflow-ul șters sau cu un dispatch refuzat de
  // GitHub. A patra oară aceeași familie, după „£0.00", „Cardul: necreat" și
  // „0 creați, 0 eșuați": o operație REFUZATĂ, raportată ca fapt împlinit.
  // Acum răspunsul POARTĂ rezultatul fiecărui pas, iar un refuz e 502.
  app.post('/api/admin/reset-vps', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { runRunbook, citesteRaspunsRunbook } = await import('../services/runbooks.js')
    const pasi = []
    for (const nume of ['restart-app', 'restart-caddy']) {
      const pas = citesteRaspunsRunbook(nume, await runRunbook(nume))
      pasi.push(pas)
      // Primul pas refuzat înseamnă că al doilea primește exact același „nu":
      // nu mai punem încă o cerere pe drum ca să adunăm aceeași eroare.
      if (!pas.ok) break
    }
    const ok = pasi.length === 2 && pasi.every((p) => p.ok)
    if (!ok) return reply.code(502).send({ ok: false, error: 'repornire_nepornita', pasi })
    return reply.send({ ok: true, pasi })
  })

  app.post('/api/admin/reset-counters', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const r = await resetCostCounters()
    // ȘTERGEREA PICATĂ răspundea 200 cu `{ok:false, sterse:0}`, iar panoul se
    // uita DOAR la statusul HTTP (`r?.ok`) — deci scria „Resetat ✓" peste niște
    // contoare neatinse. Măsurat 8 aug pe o instanță fără bază de date.
    if (!r.ok) return reply.code(502).send({ ...r, error: 'resetare_esuata' })
    return reply.send(r)
  })

  // The /api/admin/pool route was DELETED (Adrian, 30 Jul): it hand-wrote how
  // much the man thought he had in his pocket, and the panel displayed that
  // figure as fact. How much money you have is read from the bank account
  // (Enable Banking).

  // THE MONEY CIRCUIT from the Kelionai admin (Adrian, 24 Jul): the live state
  // of each payment→AI link. STRICTLY admin.
  app.get('/api/admin/money-circuit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // M7b (8 aug): costul e o CITIRE — picată, se spune cu motiv (costRealMotiv),
    // nu se maschează în zerouri și nu doboară restul panoului.
    const cost = await citesteRezumatCost()
    // `citirePlati` = the state of the Revolut transaction reader. Without it,
    // the panel couldn't tell "nobody paid" apart from "I can't read the
    // account" — exactly the confusion that cost a whole day on 30 Jul.
    return reply.send({
      // `expenses` DIED SILENTLY with Stripe (#624) — it was built in
      // stripe.ts — and the panel's whole status block was gated on it, so
      // "Citirea plăților", the autonomy row, the proofs and the pause were
      // ALL invisible since Aug 1 ("mai jos nu mai e nimic", Adrian, Aug 2).
      // Rebuilt in cardFurnizor.ts, from config keys + what card_gata measured.
      expenses: await cheltuieliAplicatiei().catch(() => []),
      citirePlati: stareCitirePlati(),
      // `citirePlatiEmail` = the Revolut-email reader (Pro path, Aug 3): reads
      // "Ai primit …" mails from the owner's Gmail and credits. Shown next to
      // `citirePlati` so the panel says whether THIS path is working — a read,
      // not a claim.
      citirePlatiEmail: starePlatiEmail(),
      // `autonomie` = the last pass of the loop that gives Kelion work WITHOUT
      // anyone asking (Adrian, 30 Jul: "make it autonomous"). Shown for the
      // same reason as the rest: so that "the loop is working" is a reading,
      // not a claim of mine.
      autonomie: stareAutonomie(),
      // THE COST IN SIGHT (Adrian, 30 Jul: "I need to see, not brakes"). It
      // existed as a tool — you had to ASK to find out. Now it's in the panel,
      // next to the money: total, today, and what it went on. It cuts nothing;
      // it shows.
      costReal: cost.citit ? cost.valoare : null,
      costRealMotiv: cost.citit ? undefined : cost.motiv,
      // The voice rate the estimate is computed with — read by the panel so
      // the figure next to the explanation is ALWAYS the live one (it can be
      // changed from env, and a hand-written copy in the frontend would lie).
      voiceUsdPerMin: VOICE_USD_PER_MINUTE,
      // THE BRAKE IS YOURS, AND IT SHOWS. "pauza-autonomie" existed for a long
      // time, but only as a command you had to know by heart. A limit you
      // choose is not a barrier; one I impose on you is.
      autonomiaOprita: await isOpsPaused().catch(() => false),
      // MOTOARELE AUTONOME (9 aug): OFF by default — iscoade/pietar/embeddings/
      // self-heal/triaj/autonomia orară nu mai ard credit fără user decât dacă
      // e pornit explicit de aici.
      autonomActiv: await autonomActiv().catch(() => false),
      // P29 (15 aug): comutatorul „video plătit" — citit, nu presupus; null =
      // citirea a picat (se spune „necitit", nu se inventează un OPRIT).
      videoPlatit: await videoPlatitPornit().catch(() => null),
      // 21:26 („nu vrea sa genereze"): ULTIMA încercare de generare, cu
      // verdictul ei pe nume — diagnoza e o citire din panou, nu un
      // interogatoriu al omului. null = nicio încercare notată încă.
      videoUltimaIncercare: await loadKv(KV_VIDEO_ULTIMA)
        .then((v) => (v ? (JSON.parse(v) as { la: string; ok: boolean; verdict: string }) : null))
        .catch(() => null),
    })
  })

  // P29 — BUTONUL „VIDEO PLĂTIT" (owner, 15 aug: „eu vreau sa platesc, sau
  // clientul, de ce nu ma duce spre plata"): pornirea/oprirea generării video
  // plătite era un env pe VPS în care ownerul nu umblă; acum e kv + buton.
  // Fiecare apăsare lasă urmă în registrul de audit (P26 — trasabilitate 24/7).
  app.post<{ Body: { pornit?: boolean } }>('/api/admin/video-platit', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const pornit = req.body?.pornit === true
    const vechi = await videoPlatitPornit().catch(() => null)
    await saveKv(KV_VIDEO_PLATIT, pornit ? '1' : '0')
    noteazaAudit('admin', 'video-platit (buton)', 'kv_state', KV_VIDEO_PLATIT,
      vechi ? `${vechi.pornit ? 'pornit' : 'oprit'} (${vechi.sursa})` : 'necitit',
      pornit ? 'pornit' : 'oprit')
    return reply.send(await videoPlatitPornit().catch(() => ({ pornit, sursa: 'buton' as const })))
  })

  // P22 — TIMERUL DE PROMOVARE: setările sunt ALE ownerului (ore + plafon
  // zilnic + ideea + butonul), în kv; fiecare schimbare lasă urmă în audit.
  app.get('/api/admin/studio-promo', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { setariPromoDinKv, KV_STUDIO_PROMO } = await import('../services/studioClipuri.js')
    return reply.send(setariPromoDinKv(await loadKv(KV_STUDIO_PROMO).catch(() => null)))
  })
  app.post<{ Body: { pornit?: boolean; ore?: number[]; plafonUsdZi?: number; idee?: string } }>(
    '/api/admin/studio-promo',
    async (req, reply) => {
      const user = cerAdmin(req, reply)
      if (!user) return
      const { setariPromoDinKv, KV_STUDIO_PROMO } = await import('../services/studioClipuri.js')
      const vechi = setariPromoDinKv(await loadKv(KV_STUDIO_PROMO).catch(() => null))
      // Se trece prin ACEEAȘI validare ca la citire — ce nu e valid nu intră.
      const nou = setariPromoDinKv(JSON.stringify({ ...vechi, ...req.body }))
      await saveKv(KV_STUDIO_PROMO, JSON.stringify(nou))
      noteazaAudit('admin', 'studio-promo (setări timer)', 'kv_state', KV_STUDIO_PROMO,
        JSON.stringify(vechi).slice(0, 380), JSON.stringify(nou).slice(0, 380))
      return reply.send(nou)
    },
  )
  // YOUR BRAKE, ONE CLICK AWAY (Adrian, 30 Jul: "the 6 are needed, but no
  // brakes" — this is not a brake I put over him, it's the lever YOU hold).
  // "pauza-autonomie" existed since 27 Jul, but only as a command you had to
  // know by heart and say to Kelion. Now it's a button, in plain sight.
  // THE EIGHT PROOFS (Adrian, 31 Jul: "we need 8 out of 8 proofs"). The
  // autonomy level is no longer a claim of mine in a chat that gets lost: it's
  // a READING from the database. Each level looks for its concrete trace — an
  // order, a PR, a measurement — and says "proven" only if it found it.
  // Otherwise it says what exactly the proof would be. Rule #1, applied to our
  // own evidence.
  app.get('/api/admin/autonomie/dovezi', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await dovezileAutonomiei())
  })

  app.post<{ Body: { oprit?: boolean } }>('/api/admin/autonomie/pauza', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const oprit = req.body?.oprit === true
    await setOpsPaused(oprit)
    return reply.send({ oprit })
  })

  // MOTOARELE AUTONOME — PORNIT/OPRIT (9 aug, ownerul: „off default, dacă nu
  // trebuie nu se autoactivează; la sfârșit de cerință se revine în OFF").
  // Comutatorul-master pentru iscoade/pietar/embeddings/self-heal/triaj/
  // autonomia orară. Implicit OPRIT; se pornește DOAR de aici, la nevoie.
  app.post<{ Body: { activ?: boolean } }>('/api/admin/autonom', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const activ = req.body?.activ === true
    await seteazaAutonom(activ)
    return reply.send({ activ })
  })

  // ── LINKING THE REVOLUT ACCOUNT (PSD2 consent, Enable Banking) ────────────
  // Two routes that take the owner through consent without SSH:
  //   1. start  → the URL to open in the browser (approval is given in the
  //      Revolut app)
  //   2. finalizeaza → with the code from the return URL, we save the linked
  //      account
  // Consent expires in max. 90 days (PSD2) — the same routes renew it.
  // `redirect_url` must be declared in the Enable Banking Control Panel.
  app.post('/api/admin/plati/legatura/start', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const redirectUrl = `https://${req.headers.host ?? 'kelionai.app'}/admin`
    const r = await incepeLegaturaPlati(redirectUrl)
    if ('error' in r) return reply.code(502).send(r)
    return reply.send(r)
  })

  app.post<{ Body: { code?: string } }>('/api/admin/plati/legatura/finalizeaza', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const r = await finalizeazaLegaturaPlati(String(req.body?.code ?? ''))
    if ('error' in r) return reply.code(502).send(r)
    return reply.send(r)
  })

  // ── THE PAYMENTS PANEL (M3, Aug 2) ────────────────────────────────────────
  // Codes issued / paid / pending + the NET (unattributed inflows). Until
  // today none of this had a window: `payment_codes` was written and matched,
  // but the admin could not see a single row of it, and the net's table did
  // not even exist. Every figure is a database read; a failed read arrives as
  // null, never as zeros (rule no. 1).
  app.get('/api/admin/plati', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({
      rezumat: await rezumatPlati(),
      neatribuite: await listeazaPlatiNeatribuite(),
      coduriNeplatite: await listeazaCoduriNeplatite(),
      platiIncasate: await listeazaPlatiIncasate(),
      totaluri: await totaluriPlati(),
    })
  })

  app.get('/api/admin/plati/coduri-neplatite', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ ok: true, coduri: await listeazaCoduriNeplatite() })
  })

  app.get('/api/admin/plati/incasate', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ ok: true, plati: await listeazaPlatiIncasate() })
  })

  app.get('/api/admin/plati/totaluri', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ ok: true, totaluri: await totaluriPlati() })
  })

  // The admin ties a netted inflow to a person (credits through the same
  // idempotent path as automatic matching — the bank id is the reference, so
  // a double credit is refused by the unique index, not by anyone's care).
  app.post<{ Body: { id?: number; email?: string } }>('/api/admin/plati/neatribuite/atribuie', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const id = Number(req.body?.id ?? 0)
    const email = String(req.body?.email ?? '').trim()
    if (!(id > 0) || !email.includes('@')) return reply.code(400).send({ error: 'bad_request' })
    const rezultat = await atribuiePlataNeatribuita(id, email)
    if (rezultat === 'creditat') return reply.send({ ok: true, rezultat })
    const cod = rezultat === 'negasit' ? 404 : rezultat === 'deja' ? 409 : 502
    return reply.code(cod).send({ ok: false, rezultat })
  })

  app.post<{ Body: { id?: number } }>('/api/admin/plati/neatribuite/ignora', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const id = Number(req.body?.id ?? 0)
    if (!(id > 0)) return reply.code(400).send({ error: 'bad_request' })
    const ok = await ignoraPlataNeatribuita(id)
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ ok: false })
  })

  // Here used to live the Stripe virtual card routes, the Stripe
  // deposit/payout and the credit selling with a Stripe payment link. Deleted
  // together with Stripe (31 Jul): credit selling now happens through a unique
  // code + Revolut transfer, and manual crediting stays on /api/admin/user
  // (action: 'credit').

  // ── User management (admin only) ──────────────────────────────────────────
  // Block/unblock, grant credit, or delete a user. The ADMIN is hard-protected:
  // he can never block or delete himself, so the owner can't be locked out.
  app.post<{ Body: { email?: string; action?: string; amount?: number } }>(
    '/api/admin/user',
    async (req, reply) => {
      const user = cerAdmin(req, reply)
      if (!user) return
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const action = String(req.body?.action ?? '')
      if (!email) return reply.code(400).send({ error: 'bad_request' })
      const isOwner = email === config.adminEmail
      switch (action) {
        case 'block':
          if (isOwner) return reply.code(400).send({ error: 'cannot_block_admin' })
          await blockUser(email)
          break
        case 'unblock':
          await unblockUser(email)
          break
        case 'credit': {
          const amount = Number(req.body?.amount)
          if (!Number.isFinite(amount) || amount === 0)
            return reply.code(400).send({ error: 'bad_amount' })
          await grantCredit(email, amount, config.billing.currency)
          break
        }
        case 'delete':
          // ÎNCHIS (ordinul ownerului, 14 aug: „baza de date de utilizatori
          // trebuie să nu se poată șterge niciodată, prin nicio comandă" +
          // „amprentele vocale trebuie să se păstreze"). Scutul din Postgres
          // (scutulDatelor) oricum ar fi avortat tranzacția pe primul tabel
          // protejat — refuzăm CINSTIT la ușă, cu motivul, nu cu un 500 criptic.
          // NOTĂ pentru owner (scrisă și în RAMAS-DE-FACUT): dreptul GDPR la
          // ștergere al unui user real rămâne o decizie a lui — când o va cere,
          // se face cu procedura lui explicită, nu cu un buton generic.
          return reply.code(403).send({
            error: 'utilizatorii_se_pastreaza',
            motiv:
              'Ordinul ownerului (14 aug): datele utilizatorilor nu se șterg prin nicio comandă — identitatea, banii și biometria sunt sub scut.',
          })
        default:
          return reply.code(400).send({ error: 'bad_action' })
      }
      return reply.send(await getUserActivity())
    },
  )

  // Leads captured from visitors who left an email (admin only).
  app.get('/api/admin/leads', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): eșec de DB → 500, nu „Niciun contact încă".
    const leads = await listLeads()
    if (!leads) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ leads })
  })

  // The messages from the "Contact" form — ALWAYS saved in the DB, so the
  // owner sees them here even if email is not configured (the "contact doesn't
  // send" bug).
  app.get('/api/admin/contact-messages', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ messages: await listContactMessages() })
  })

  // Email a captured lead through the site's mail service (admin only).
  app.post<{ Body: { id?: number; to?: string; subject?: string; body?: string } }>(
    '/api/admin/lead/email',
    async (req, reply) => {
      const user = cerAdmin(req, reply)
      if (!user) return
      const to = String(req.body?.to ?? '').trim()
      const subject = String(req.body?.subject ?? '').trim()
      const body = String(req.body?.body ?? '')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !subject || !body.trim()) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">${body
        .split('\n')
        .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('<br>')}</div>`
      const sent = await sendMail({ to, subject, html, text: body, replyTo: config.mail.forwardTo })
      if (!sent) return reply.code(502).send({ error: 'send_failed' })
      if (req.body?.id) await markLeadContacted(Number(req.body.id))
      return reply.send({ ok: true })
    },
  )

  // ── Live visitor chat, owner side (admin only) ────────────────────────────
  // List conversations, read one, and reply — the owner's inbox for the widget.
  app.get('/api/admin/visitor-chats', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // AUDIT ADMIN (3 aug): DB picat → 500, nu „Nicio conversație încă" — pot
    // exista vizitatori care scriu chiar atunci.
    const convos = await listVisitorConvos()
    if (!convos) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ convos })
  })

  app.get<{ Querystring: { conv?: string; after?: string } }>(
    '/api/admin/visitor-chat',
    async (req, reply) => {
      const user = cerAdmin(req, reply)
      if (!user) return
      // The body is shared with the public route (single source in demo.ts);
      // only the admin gate above is added here.
      return pollVisitorChat(req, reply)
    },
  )

  app.post<{ Body: { conv?: string; text?: string } }>(
    '/api/admin/visitor-chat/reply',
    async (req, reply) => {
      const user = cerAdmin(req, reply)
      if (!user) return
      const conv = String(req.body?.conv ?? '')
      const text = String(req.body?.text ?? '')
      if (!conv || !text.trim()) return reply.code(400).send({ error: 'bad_request' })
      const id = await addVisitorMessage(conv, 'owner', text)
      // AUDIT ADMIN (3 aug): INSERT picat = 502, nu 200 cu {ok:false} —
      // un răspuns „salvat" pe care vizitatorul nu-l va vedea niciodată.
      if (!(id > 0)) return reply.code(502).send({ ok: false, error: 'save_failed', id: 0 })
      return reply.send({ ok: true, id })
    },
  )

  // ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug: „ceva inteligent bazat pe AI"
  // + „verifică și DE CE nu merge") ─────────────────────────────────────────
  // Kelion se testează pe el însuși pe TOATE funcțiile din registrul unic:
  // citirile se probează REAL (execuție prin `uneltele`), funcțiile cu EFECT NU
  // se execută (dry-run — nu ardem bani/nu facem acțiuni), verdictul e MĂSURAT,
  // iar pe cele picate creierul (AI) dă diagnostic + recomandare fermă.
  app.post('/api/admin/autoverificare', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    const { ruleazaAutoverificare } = await import('../services/autoverificare.js')
    const { uneltele } = await import('../services/autonomie.js')
    const { rationeazaMesajeSigur } = await import('../services/creierRationament.js')
    const raport = await ruleazaAutoverificare({
      // CITIRE: execută unealta real, cu argumente goale (sigur — doar citește).
      probaCitire: async (c) => {
        try {
          const out = await uneltele(c.name, {})
          return { ok: true, rezultat: String(out ?? '') }
        } catch (e) {
          return { ok: false, eroare: String((e as Error)?.message ?? e).slice(0, 200) }
        }
      },
      // EFECT: NU se execută la test (ar produce efect/cost). Cablajul e garantat
      // de paritatea registru↔unelte (lacătul brainCapabilities); marcăm „cablată".
      esteCablat: () => true,
      // DIAGNOSTIC AI pe cele picate: cauză + recomandare fermă, JSON. Null/eroare
      // → rămâne diagnosticul determinist (regula #1: nu inventăm).
      creierDiag: async (picate) => {
        const lista = picate.map((p) => `- ${p.functie}: face „${p.face}"; simptom măsurat: ${p.deCe}`).join('\n')
        const prompt =
          `Ești diagnosticianul lui Kelion. Pentru FIECARE funcție picată de mai jos, spune DE CE nu merge ` +
          `(cauza cea mai probabilă, scurt) și o RECOMANDARE fermă (ce să facă concret). ` +
          `Răspunde DOAR cu JSON valid: [{"functie":"<nume>","deCe":"<scurt>","recomandare":"<ferm>"}].\n\nFuncții:\n${lista}`
        const txt = await rationeazaMesajeSigur([{ role: 'user', content: prompt }], { ruta: 'autoverificare', treapta: 'lucru', maxTokens: 1200 })
        const m: Record<string, { deCe?: string; recomandare?: string }> = {}
        if (!txt) return m
        try {
          const j = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) as { functie?: string; deCe?: string; recomandare?: string }[]
          for (const x of j) if (x?.functie) m[x.functie] = { deCe: x.deCe, recomandare: x.recomandare }
        } catch {
          /* JSON invalid → rămâne diagnosticul determinist */
        }
        return m
      },
    })
    // Ținem ultimul raport, ca panoul să-l poată reafișa fără re-rulare.
    await saveKv('autoverificare:ultima', JSON.stringify({ la: new Date().toISOString(), raport }).slice(0, 100_000)).catch(() => {})
    return reply.send(raport)
  })
}
