import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser, adminSiId } from '../session.js'
import { pollVisitorChat } from './demo.js' // visitor chat polling from the common source
import {
  listAllTransactions,
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  deleteCapabilityGap,
  blockUser,
  unblockUser,
  grantCredit,
  deleteUserData,
  listLeads,
  listContactMessages,
  markLeadContacted,
  listVisitorConvos,
  addVisitorMessage,
  getDemoStats,
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
} from '../db.js'
import { systemHealth } from '../services/health.js'
import { recentLogs } from '../services/logbuffer.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { stareCitirePlati, incepeLegaturaPlati, finalizeazaLegaturaPlati } from '../services/openBanking.js'
import { starePlatiEmail } from '../services/platiEmail.js'
import { stareAutonomie } from '../services/autonomie.js'
import { cheltuieliAplicatiei } from '../services/cardFurnizor.js'
import { isOpsPaused, setOpsPaused } from '../services/runbooks.js'
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const armed = await isLockArmed()
    return reply.send({ armed, unlocked: !armed || hasUnlock(req, user.email) })
  })

  app.post<{ Body: { secret?: string } }>('/api/admin/unlock', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const secret = String(req.body?.secret ?? '')
    if (!secret || !(await verifyLockSecret(user.email, secret)))
      return reply.code(401).send({ error: 'cod_gresit' })
    grantUnlock(reply, user.email, 'secret')
    return reply.send({ ok: true })
  })

  // Setting/changing the secret. Unarmed → anytime (first arming); armed →
  // only from an ALREADY unlocked session (an open panel implies that).
  app.post<{ Body: { secret?: string } }>('/api/admin/unlock/secret', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): citirea picată (token lipsă / GitHub ne-ok) NU mai
    // e servită ca listă goală — 503, iar panoul scrie „nu pot citi
    // versiunile", distinct de „nicio versiune salvată încă".
    const points = await listRecoveryPoints()
    if (!points) return reply.code(503).send({ error: 'recovery_unreadable' })
    return reply.send({ points })
  })
  app.post<{ Body: { note?: string } }>('/api/admin/backups', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const r = await createRecoveryPoint(String(req.body?.note ?? ''))
    if (!r.ok) return reply.code(500).send(r)
    return reply.send(r)
  })
  // RESTORING from a saved point (Adrian, 27 Jul: selection buttons in admin).
  // Brings master to the tag's state with a new commit → publishing to the VPS
  // starts by itself. Heavy action → confirmation is in the UI, double.
  app.post<{ Body: { tag?: string } }>('/api/admin/backups/restore', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const r = await restoreToPoint(String(req.body?.tag ?? ''))
    if (!r.ok) return reply.code(500).send(r)
    return reply.send(r)
  })

  // ROW 19 — inbound contact@ emails + the Secretary's auto-replies (admin only).
  app.get('/api/admin/inbound', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ emails: await listInboundEmails(50) })
  })

  // LIVE INBOX (Adrian, 10 Jul) — reads the REAL contact@kelionai.app mailbox
  // over IMAP (latest messages, read or not), so the admin sees everything in
  // the mailbox, not just the new mail the poller caught. Read-only, admin
  // only.
  app.get('/api/admin/mailbox-live', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const uids = Array.isArray(req.body?.uids) ? req.body.uids.map(Number) : []
    if (!uids.length) return reply.code(400).send({ error: 'uids_lipsa' })
    const r = await deleteInboxMessages(uids)
    return reply.send({ ok: r.sterse > 0, ...r })
  })

  // Market control: live store presence + direct-download counts + WHO
  // downloaded (email when signed in, else IP + country). Store installs are
  // aggregate-only by design — no store exposes user identities.
  app.get('/api/admin/stores', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [checks, downloads] = await Promise.all([checkStores(), getDownloadStats()])
    return reply.send({ stores: checks, downloads })
  })

  // List users with message counts (admin only).
  app.get('/api/admin/users', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ users: await listUsers() })
  })

  // Full chat history for one user (admin only).
  app.get<{ Querystring: { email?: string } }>('/api/admin/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = req.query.email
    if (!email) return reply.code(400).send({ error: 'bad_request', message: 'email required' })
    return reply.send({ history: await getHistory(email) })
  })

  // Batch-translate a conversation's messages into Romanian (the "Translate
  // into Romanian" button in the chat viewer — testers write in any language).
  // Admin only. `failed` tells the admin how many messages came back as
  // UNTRANSLATED ORIGINAL (the translation service failed for them) — so a
  // half-translated conversation is never mistaken for a full one.
  app.post<{ Body: { texts?: unknown; target?: unknown } }>('/api/admin/translate', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const raw = req.body?.texts
    const texts = Array.isArray(raw) ? raw.slice(0, 300).map((t) => String(t ?? '')) : []
    if (texts.length === 0) return reply.send({ translations: [], failed: 0 })
    const target = typeof req.body?.target === 'string' && req.body.target ? req.body.target : 'Romanian'
    return reply.send(await translateMany(texts, target))
  })

  // Live real-cost / credit monitor (admin only) — total, today, per-AI breakdown.
  app.get('/api/admin/costs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getCostSummary())
  })

  // Capability gaps — what users asked for that Kelion can't do yet (admin only).
  app.get<{ Querystring: { all?: string } }>('/api/admin/gaps', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ gaps: await getCapabilityGaps(req.query.all === '1') })
  })

  // THE COMPLETE AUDIT OF FAILURES (Adrian, 27 Jul: "here you must see all the
  // audits and all the failures"): the Uncovered requests tab shows, besides
  // gaps, EVERYTHING that failed — server errors (the server F12), client
  // errors (the browser F12), failed build orders and health problems (live vs
  // master, red runs, disk, DB, brain balance).
  app.get('/api/admin/audit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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

  // AUTONOMOUS TRIAGE (Adrian, 24 Jul): Kelion decides by itself on each gap —
  // valuable (stays, "TO IMPLEMENT") or automatically closed with a reason.
  // The admin button only triggers; the same function also runs daily,
  // autonomously.
  app.post('/api/admin/gaps/triage', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await triageGaps())
  })

  // Mark a gap resolved / reopen it (admin only). Used by the "Reject" button.
  app.post<{ Body: { id?: number; resolved?: boolean } }>('/api/admin/gaps/resolve', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
  app.get('/api/admin/brain-credit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [vps, serperBalance, geminiCost, geminiState, geminiCreditRaw] = await Promise.all([
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
      // GARDAT (auditul admin, 3 aug): loadKv era singura citire NEgardată din
      // acest Promise.all — un sughiț de DB pe KV respingea tot lanțul, ruta
      // dădea 500 și TOATE pastilele se stingeau, deși Serper/VPS/Gemini se
      // măsuraseră cu succes. Eșecul se declară per câmp, nu omoară răspunsul.
      loadKv('gemini:credit').catch(() => null),
    ])
    // Creditul „spus de owner" — citit onest din kv. Dacă lipsește sau e stricat,
    // rămâne undefined (pastila arată ✓/⚠, nu o cifră falsă).
    let geminiCreditGbp: number | undefined
    let geminiCreditAt: string | undefined
    try {
      const c = geminiCreditRaw ? (JSON.parse(geminiCreditRaw) as { gbp?: number; at?: string }) : null
      if (c && Number.isFinite(c.gbp) && (c.gbp as number) >= 0) {
        geminiCreditGbp = c.gbp
        geminiCreditAt = typeof c.at === 'string' ? c.at : undefined
      }
    } catch {
      /* kv stricat → „nu știu", niciodată un zero fals */
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
        // Creditul spus de owner (GBP) + când. Afișat ca ATARE pe pastilă.
        creditGbp: geminiCreditGbp,
        creditAt: geminiCreditAt,
      },
      // (Câmpul `pool` a fost SCOS — auditul admin, 3 aug: nicio pastilă nu-l
      // desena, tipul din frontend mințea (loaded/remaining nu mai existau),
      // iar sursa lui, getAdminAccount, rula două SUM-uri la fiecare poll
      // pentru o valoare nefolosită și întorcea zerouri fabricate la eșec.)
    })
  })

  // ── CREDITUL GEMINI SPUS DE OWNER (Adrian, 3 aug: „gemini nu e afișată
  //    valoarea pe aplicație", cu poza £10.88 din AI Studio) ─────────────────
  // Google NU expune creditul promoțional prin niciun API — deci nu-l pot citi
  // și n-am voie să-l inventez (regula #1). Soluția onestă: îl spui O DATĂ (aici
  // sau prin Kelion în chat), se salvează cu data, și pastila îl arată ca ATARE
  // — cifra TA, nu o măsurătoare. `gbp` gol/negativ/absent → șterge ancora
  // (pastila revine la ✓/⚠), niciodată un zero fals.
  app.post<{ Body: { gbp?: number | string | null } }>('/api/admin/gemini-credit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const raw = req.body?.gbp
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.').trim()) : raw
    if (raw == null || raw === '' || !Number.isFinite(n) || (n as number) < 0) {
      await saveKv('gemini:credit', '').catch(() => {})
      return reply.send({ ok: true, cleared: true })
    }
    const at = new Date().toISOString()
    await saveKv('gemini:credit', JSON.stringify({ gbp: n, at, by: user.email }))
    return reply.send({ ok: true, gbp: n, at })
  })

  // (Ruta /api/admin/openai-costs a fost ȘTEARSĂ, 3 aug — OpenAI extirpat:
  // nu mai există nicio cheltuială OpenAI de citit.)

  // The REAL picture of the owner's money (admin only): the real cost consumed
  // at providers and the real profit. No hand-written figure. (Stripe is fully
  // out — 31 Jul; OpenRouter/OpenAI extirpate — 3 aug, împreună cu „punga"
  // care era soldul OpenRouter.)
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const costs = await getCostSummary()
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ transactions: await listAllTransactions(200) })
  })

  // Per-USER activity (admin only): who signed in, last IP/place/device, how
  // long they stayed (sum of presence-ping time), plus their latest sessions.
  app.get('/api/admin/activity', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): DB picat NU mai răspunde 200 cu liste goale („nu
    // s-a strâns activitate" nemăsurat) — 500, iar panoul scrie „nu pot citi".
    const activity = await getUserActivity()
    if (!activity) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send(activity)
  })

  // Free-trial visitor analytics (admin only): where trials come from — country,
  // city, IP, total, today.
  app.get('/api/admin/demos', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): zerourile fabricate de vechiul `empty` nu mai ies
    // pe ușă — o citire picată e 500, nu „Vizite 0/0".
    const demos = await getDemoStats()
    if (!demos) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send(demos)
  })

  // Which brain models actually serve right now (admin only): a real 1-token
  // ping of the default chat + work models through Gemini direct (services/brain.ts).
  app.get('/api/admin/models', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyModels())
  })

  // Verify the brain key live (admin only): pings the Gemini chat default
  // with a 1-token call; reports ok/fail without ever exposing the key value.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyKeys())
  })

  // VERIFY ALL PRIVILEGED TOKENS (Adrian, 14 Jul): verifies LIVE all the
  // keys/tokens with access to external services and reports status without
  // exposing secret values. Includes the Gemini brain, Google
  // (service account/TTS/OAuth), Mail (SMTP+IMAP), PostgreSQL
  // and SESSION_SECRET.
  app.get('/api/admin/token-checks', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ disabled: await getDisabledGestures() })
  })
  app.post<{ Body: { disabled?: string[] } }>('/api/admin/gestures', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const list = Array.isArray(req.body?.disabled) ? req.body.disabled : []
    await setDisabledGestures(list)
    return reply.send({ ok: true, disabled: await getDisabledGestures() })
  })

  // KELION'S SELF-EXPANSION (Adrian, 25 Jul): the tools Kelion PROPOSED by
  // itself. The owner sees them and approves/rejects with ONE CLICK — an
  // approved tool becomes active instantly, no redeploy. "Independent up to
  // deploy, with my approval" — exactly the requested gate.
  app.get('/api/admin/kelion-tools', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ tools: await listKelionTools() })
  })
  app.post<{ Body: { id?: number; approve?: boolean } }>('/api/admin/kelion-tools', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
  app.post('/api/admin/reset-counters', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await resetCostCounters())
  })

  // The /api/admin/pool route was DELETED (Adrian, 30 Jul): it hand-wrote how
  // much the man thought he had in his pocket, and the panel displayed that
  // figure as fact. How much money you have is read from the bank account
  // (Enable Banking).

  // THE MONEY CIRCUIT from the Kelionai admin (Adrian, 24 Jul): the live state
  // of each payment→AI link. STRICTLY admin.
  app.get('/api/admin/money-circuit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
      costReal: await getCostSummary().catch(() => null),
      // The voice rate the estimate is computed with — read by the panel so
      // the figure next to the explanation is ALWAYS the live one (it can be
      // changed from env, and a hand-written copy in the frontend would lie).
      voiceUsdPerMin: VOICE_USD_PER_MINUTE,
      // THE BRAKE IS YOURS, AND IT SHOWS. "pauza-autonomie" existed for a long
      // time, but only as a command you had to know by heart. A limit you
      // choose is not a barrier; one I impose on you is.
      autonomiaOprita: await isOpsPaused().catch(() => false),
    })
  })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await dovezileAutonomiei())
  })

  app.post<{ Body: { oprit?: boolean } }>('/api/admin/autonomie/pauza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const oprit = req.body?.oprit === true
    await setOpsPaused(oprit)
    return reply.send({ oprit })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const redirectUrl = `https://${req.headers.host ?? 'kelionai.app'}/admin`
    const r = await incepeLegaturaPlati(redirectUrl)
    if ('error' in r) return reply.code(502).send(r)
    return reply.send(r)
  })

  app.post<{ Body: { code?: string } }>('/api/admin/plati/legatura/finalizeaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({
      rezumat: await rezumatPlati(),
      neatribuite: await listeazaPlatiNeatribuite(),
      coduriNeplatite: await listeazaCoduriNeplatite(),
      platiIncasate: await listeazaPlatiIncasate(),
      totaluri: await totaluriPlati(),
    })
  })

  app.get('/api/admin/plati/coduri-neplatite', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ ok: true, coduri: await listeazaCoduriNeplatite() })
  })

  app.get('/api/admin/plati/incasate', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ ok: true, plati: await listeazaPlatiIncasate() })
  })

  app.get('/api/admin/plati/totaluri', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ ok: true, totaluri: await totaluriPlati() })
  })

  // The admin ties a netted inflow to a person (credits through the same
  // idempotent path as automatic matching — the bank id is the reference, so
  // a double credit is refused by the unique index, not by anyone's care).
  app.post<{ Body: { id?: number; email?: string } }>('/api/admin/plati/neatribuite/atribuie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const id = Number(req.body?.id ?? 0)
    const email = String(req.body?.email ?? '').trim()
    if (!(id > 0) || !email.includes('@')) return reply.code(400).send({ error: 'bad_request' })
    const rezultat = await atribuiePlataNeatribuita(id, email)
    if (rezultat === 'creditat') return reply.send({ ok: true, rezultat })
    const cod = rezultat === 'negasit' ? 404 : rezultat === 'deja' ? 409 : 502
    return reply.code(cod).send({ ok: false, rezultat })
  })

  app.post<{ Body: { id?: number } }>('/api/admin/plati/neatribuite/ignora', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
          if (isOwner) return reply.code(400).send({ error: 'cannot_delete_admin' })
          await deleteUserData(email)
          break
        default:
          return reply.code(400).send({ error: 'bad_action' })
      }
      return reply.send(await getUserActivity())
    },
  )

  // Leads captured from visitors who left an email (admin only).
  app.get('/api/admin/leads', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): eșec de DB → 500, nu „Niciun contact încă".
    const leads = await listLeads()
    if (!leads) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ leads })
  })

  // The messages from the "Contact" form — ALWAYS saved in the DB, so the
  // owner sees them here even if email is not configured (the "contact doesn't
  // send" bug).
  app.get('/api/admin/contact-messages', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ messages: await listContactMessages() })
  })

  // Email a captured lead through the site's mail service (admin only).
  app.post<{ Body: { id?: number; to?: string; subject?: string; body?: string } }>(
    '/api/admin/lead/email',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // AUDIT ADMIN (3 aug): DB picat → 500, nu „Nicio conversație încă" — pot
    // exista vizitatori care scriu chiar atunci.
    const convos = await listVisitorConvos()
    if (!convos) return reply.code(500).send({ error: 'db_unreadable' })
    return reply.send({ convos })
  })

  app.get<{ Querystring: { conv?: string; after?: string } }>(
    '/api/admin/visitor-chat',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      // The body is shared with the public route (single source in demo.ts);
      // only the admin gate above is added here.
      return pollVisitorChat(req, reply)
    },
  )

  app.post<{ Body: { conv?: string; text?: string } }>(
    '/api/admin/visitor-chat/reply',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
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
}
