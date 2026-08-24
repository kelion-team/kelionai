import type { FastifyInstance } from 'fastify'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { adminSiId, cerAdmin } from '../session.js'
import {
  citesteAudit,
  citesteUtilizatori,
  citesteIstoric,
  citesteRezumatCost,
  blockUser,
  unblockUser,
  grantCreditMinor,
  listLeads,
  listContactMessages,
  getDemoStats,
  getUserActivity,
  listInboundEmails,
  getDisabledGestures,
  setDisabledGestures,
  listBuildJobs,
  listClientErrorGroups,
  resetCostCounters,
  loadKv,
} from '../db.js'
import { videoPlatitPornit, KV_VIDEO_ULTIMA } from '../services/video.js'
import { systemHealth } from '../services/health.js'
import { recentLogs } from '../services/logbuffer.js'
import { explicaEroare } from '../services/explicaEroare.js'
import { problemeGlobaleAcum } from '../services/autodiagnostic.js'
import { getAdminNotifications, markAdminNotificationRead } from '../services/adminNotification.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { cheltuieliAplicatiei } from '../services/cheltuieli.js'
import { listRecoveryPoints, createRecoveryPoint, restoreToPoint } from '../services/recovery.js'
import { openaiAvailable } from '../services/openaiChat.js'
import { motivCatalogOpenAI, reimprospateazaCatalogOpenAI } from '../services/openaiModele.js'
import { getSerperBalance } from '../services/serperBalance.js'
import { resurseGazda } from '../services/resurse.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { envCheck, envOrphans, envSummary, processStartedAt } from '../services/envCheck.js'
import { fetchRecentInbox, deleteInboxMessages } from '../services/mailbox.js'
import { translateMany } from '../services/google.js'
import { uitaToateSesiunile } from '../services/stareSesiune.js'

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
  { key: 'linux', name: 'Linux', store: `Web app (${new URL(config.publicOrigin).hostname})`, url: `${config.publicOrigin}/health` },
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
          headers: { 'User-Agent': config.httpUserAgent },
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

async function configuratieCreier(): Promise<Record<string, unknown>> {
  const m = config.openai
  const catalog = await reimprospateazaCatalogOpenAI()
  const configurate = [m.luna, m.medium, m.heavy].filter(Boolean)
  const lipsa = configurate.filter((id) => !catalog.includes(id))
  const eroareCitire = motivCatalogOpenAI()
  const catalogEroare = eroareCitire
    || (lipsa.length ? `Modele configurate absente din catalog: ${lipsa.join(', ')}` : '')
  return {
    activ: 'openai',
    provideri: [
      { prefix: 'openai', nume: 'OpenAI', disponibil: openaiAvailable(), info: 'Responses API + Realtime; cheia runtime vine numai din OPENAI_API_KEY' },
    ],
    modele: [
      { id: 'auto', nume: 'Auto (Luna → Terra → Sol)', isAuto: true },
      { id: m.luna, nume: m.luna, tag: 'rapid', validat: catalog.includes(m.luna) },
      { id: m.medium, nume: m.medium, tag: 'echilibrat', validat: catalog.includes(m.medium) },
      { id: m.heavy, nume: m.heavy, tag: 'profund', validat: catalog.includes(m.heavy) },
    ],
    ...(catalogEroare ? { catalogEroare } : {}),
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
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

  // Market control: live store presence. Store installs remain aggregate-only
  // in the external store dashboards and are not claimed as local telemetry.
  app.get('/api/admin/stores', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send({ stores: await checkStores() })
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
        cine: g.account_ref ?? null,
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

  // (Ruta GET /api/admin/pool a fost ȘTEARSĂ DE-ADEVĂRATELEA — auditul admin,
  // 3 aug: trăia aici deși comentariul de mai jos, „was DELETED (Adrian, 30
  // Jul)", jura contrariul, n-o chema nimeni din frontend, iar getAdminAccount
  // — sursa ei — inventa {spent:0, profit:0} la orice eșec de DB. Funcția a
  // fost ștearsă din db.ts odată cu ruta.)

  // Admin-only provider and integration status. Unknown or unreadable values
  // remain explicit and are never rendered as a reassuring zero.
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
    const [vps, serperBalance] = await Promise.all([
      resurseGazda(),
      // THE SERPER PILL: the REAL remaining search credit read from Serper's
      // /account endpoint. Cached 5 min in the service.
      getSerperBalance(),
    ])
    return reply.send({
      active: 'openai',
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
      openai: {
        checked: true,
        serving: openaiAvailable(),
        // Costul real vine dintr-un import separat al OpenAI Costs API; runtime
        // nu transformă tokeni în dolari cu tarife scrise în cod.
        monthUsd: undefined,
      },
      // (Câmpul `pool` a fost SCOS — auditul admin, 3 aug: nicio pastilă nu-l
      // desena, tipul din frontend mințea (loaded/remaining nu mai existau),
      // iar sursa lui, getAdminAccount, rula două SUM-uri la fiecare poll
      // pentru o valoare nefolosită și întorcea zerouri fabricate la eșec.)
    })
  })

  // Admin-only accounting projection. No hand-written provider balance is
  // represented as measured cost.
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
      // The cost journal is kept in USD micros end to end —
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
    })
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

  // Which OpenAI brain models actually serve right now (admin only).
  app.get('/api/admin/models', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // DOVADA ULTIMULUI AUTO-UPGRADE (Adrian, 7 aug: „clar cu dovadă"). Scorul
    // candidatului ȘI al modelului activ, probate în aceeași trecere, plus ce
    // sarcini a picat. `null` când nu s-a verificat încă — „nu pot verifica",
    // nu o cifră liniștitoare inventată.
    return reply.send(await verifyModels())
  })

  // OpenAI este providerul unic; selectorul păstrează doar modelul configurat.
  app.get('/api/admin/creier', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await configuratieCreier())
  })

  // Verify configured integrations without ever exposing secret values.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    return reply.send(await verifyKeys())
  })

  // VERIFY ALL PRIVILEGED TOKENS (Adrian, 14 Jul): verifies LIVE all the
  // keys/tokens with access to external services and reports status without
  // exposing secret values. Includes OpenAI, Google Workspace/OAuth, mail, PostgreSQL
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

  // Resetarea contoarelor afectează numai jurnalul intern de cost; wallet-ul și
  // registrul plăților rămân nemodificate. Operațiile VPS/deploy aparțin
  // publisherului izolat și nu sunt expuse procesului web.
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
      // Inventar de furnizori; aplicația nu primește și nu gestionează carduri.
      expenses: await cheltuieliAplicatiei().catch(() => []),
      paymentCollection: {
        status: 'setup_required',
        automaticCredit: false,
        detail: 'No verified merchant order and signed settlement webhook are configured.',
      },
      // THE COST IN SIGHT (Adrian, 30 Jul: "I need to see, not brakes"). It
      // existed as a tool — you had to ASK to find out. Now it's in the panel,
      // next to the money: total, today, and what it went on. It cuts nothing;
      // it shows.
      costReal: cost.citit ? cost.valoare : null,
      costRealMotiv: cost.citit ? undefined : cost.motiv,
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

  // ── User management (admin only) ──────────────────────────────────────────
  // Block/unblock, grant credit, or delete a user. The ADMIN is hard-protected:
  // he can never block or delete himself, so the owner can't be locked out.
  app.post<{ Body: { email?: string; action?: string; amountMinor?: number } }>(
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
          const amountMinor = Number(req.body?.amountMinor)
          if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
            return reply.code(400).send({ error: 'bad_amount' })
          if (!await grantCreditMinor(email, amountMinor, `admin-grant:${randomUUID()}`)) {
            return reply.code(503).send({ error: 'credit_unavailable' })
          }
          break
        }
        case 'delete':
          // ÎNCHIS (ordinul ownerului, 14 aug: „baza de date de utilizatori
          // trebuie să nu se poată șterge niciodată, prin nicio comandă" +
          // „amprentele vocale trebuie să se păstreze"). Scutul din Postgres
          // (scutulDatelor) oricum ar fi avortat tranzacția pe primul tabel
          // protejat — refuzăm CINSTIT la ușă, cu motivul, nu cu un 500 criptic.
          // Dreptul la ștergere este implementat prin fluxul self-service.
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

  // ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug: „ceva inteligent bazat pe AI"
  // + „verifică și DE CE nu merge") ─────────────────────────────────────────
  // Kelion se testează pe el însuși pe TOATE funcțiile din registrul unic:
  // citirile se probează REAL (execuție prin `uneltele`), funcțiile cu EFECT NU
  // se execută (dry-run — nu ardem bani/nu facem acțiuni), verdictul e MĂSURAT,
  // iar pe cele picate creierul (AI) dă diagnostic + recomandare fermă.
  app.post('/api/admin/autoverificare', async (req, reply) => {
    const user = cerAdmin(req, reply)
    if (!user) return
    // Rularea live și salvarea stau în implementarea unică a serviciului;
    // procesul web nu expune unelte de repository, shell sau deploy modelului.
    const { autoverificareLive } = await import('../services/autoverificare.js')
    return reply.send(await autoverificareLive())
  })
}
