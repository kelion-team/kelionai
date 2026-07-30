import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { pollVisitorChat } from './demo.js' // poll conv vizitator din sursa comună
import {
  listAllTransactions,
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  getAdminAccount,
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
} from '../db.js'
import { systemHealth } from '../services/health.js'
import { recentLogs } from '../services/logbuffer.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { isArmed as isLockArmed, hasUnlock, grantUnlock, verifyLockSecret, setLockSecret } from '../services/adminLock.js'
import { listRecoveryPoints, createRecoveryPoint, restoreToPoint } from '../services/recovery.js'
import { getOpenRouterBalance } from '../services/openrouter.js'
import { triageGaps } from '../services/gapsTriage.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { envCheck, envSummary, processStartedAt, stripeMode } from '../services/envCheck.js'
import { getStripeBalance, createSaleCheckout, getMoneyCircuit, createKelionCard, createCardEphemeralKey, createOwnerDeposit, createAdminPayout, lastAutoFundStatus } from '../services/stripe.js'
import { sendMail } from '../services/mail.js'
import { fetchRecentInbox } from '../services/mailbox.js'
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
  // ── LACĂTUL ADMIN (Adrian, 27 iul) — rutele de deblocare. Gate-ul global din
  // index.ts scutește /api/admin/unlock*; tot ce e aici cere însă sesiune de
  // admin. Secretul e ales de Adrian în Admin→Securitate și trăiește doar ca
  // hash scrypt în kv; amprenta vocală potrivită deblochează automat (vezi
  // routes/realtime.ts). Starea — clientul decide ce arată pe buton.
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

  // Setarea/schimbarea secretului. Nearmat → oricând (prima armare); armat →
  // doar dintr-o sesiune DEJA deblocată (panoul deschis implică asta).
  app.post<{ Body: { secret?: string } }>('/api/admin/unlock/secret', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const armed = await isLockArmed()
    if (armed && !hasUnlock(req, user.email)) return reply.code(423).send({ error: 'admin_locked' })
    const secret = String(req.body?.secret ?? '').trim()
    if (secret.length < 4) return reply.code(400).send({ error: 'secret_prea_scurt' })
    await setLockSecret(secret)
    grantUnlock(reply, user.email, 'secret') // browserul care armează rămâne deblocat
    return reply.send({ ok: true })
  })

  // PUNCTE DE RECUPERARE (Adrian, 27 iul): meniul „Recuperare" din admin —
  // versiunile salvate (tag-uri git, oglindite pe VPS ca .bundle/.tar.gz) cu
  // detalii clare, + buton de salvare a versiunii curente.
  app.get('/api/admin/backups', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ points: await listRecoveryPoints() })
  })
  app.post<{ Body: { note?: string } }>('/api/admin/backups', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const r = await createRecoveryPoint(String(req.body?.note ?? ''))
    if (!r.ok) return reply.code(500).send(r)
    return reply.send(r)
  })
  // RESTAURAREA dintr-un punct salvat (Adrian, 27 iul: butoane de selecție în
  // admin). Aduce master la starea tag-ului cu un commit nou → publicarea pe
  // VPS pornește singură. Acțiune grea → confirmarea e în UI, dublă.
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

  // INBOX LIVE (Adrian, 10 iul) — citește cutia REALĂ contact@kelionai.app prin
  // IMAP (ultimele mesaje, citite sau nu), ca adminul să vadă tot ce e în cutie,
  // nu doar mailul nou pe care l-a prins poller-ul. Doar-citire, admin only.
  app.get('/api/admin/mailbox-live', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ emails: await fetchRecentInbox(40) })
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

  // Traduce în bloc mesajele unei conversații în română (buton „Tradu în română"
  // din vizualizarea chaturilor — testerii scriu în orice limbă). Admin only.
  app.post<{ Body: { texts?: unknown; target?: unknown } }>('/api/admin/translate', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const raw = req.body?.texts
    const texts = Array.isArray(raw) ? raw.slice(0, 300).map((t) => String(t ?? '')) : []
    if (texts.length === 0) return reply.send({ translations: [] })
    const target = typeof req.body?.target === 'string' && req.body.target ? req.body.target : 'Romanian'
    return reply.send({ translations: await translateMany(texts, target) })
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

  // AUDITUL COMPLET AL CĂZUTELOR (Adrian, 27 iul: „aici trebuie să vezi toate
  // auditurile și toate căzutele"): tabul Cereri neacoperite arată, pe lângă
  // gaps, TOT ce a căzut — erorile de server (F12-ul de server), erorile de
  // client (F12-ul browserului), ordinele de construcție eșuate și problemele
  // de sănătate (live vs master, rulări roșii, disc, DB, sold creier).
  app.get('/api/admin/audit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [healthRaw, jobs, clientErrors] = await Promise.all([
      systemHealth().catch(() => '{}'),
      listBuildJobs(12).catch(() => []),
      listClientErrorGroups(48, 30).catch(() => []),
    ])
    let health: unknown = {}
    try {
      health = JSON.parse(healthRaw)
    } catch {
      /* sănătatea indisponibilă — restul auditului rămâne */
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

  // TRIAJUL AUTONOM (Adrian, 24 iul): Kelion decide singur pe fiecare gap —
  // valoros (rămâne, „DE IMPLEMENTAT") sau închis automat cu motiv. Butonul din
  // admin doar declanșează; aceeași funcție rulează și zilnic, autonom.
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

  // The owner's REAL-money view: provider pool loaded, remaining, spent, profit
  // (admin only). This is what the admin sees instead of the users' credits.
  app.get('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getAdminAccount())
  })

  // Creierul e 100% OpenRouter (0 Kimi, 0 GLM). Butonul de fond din bara de admin:
  // arată SOLDUL REAL, EXACT din contul OpenRouter — „punga lui Kelion" din care
  // se alimentează creierul CENTRAL (Adrian, 24 iul: „OpenRouter = valoarea
  // exactă din OpenRouter"). Plus fondul intern al adminului (loaded − cost real)
  // și un semnal `low` când e nevoie să depună bani. STRICT admin (userii nu văd).
  app.get('/api/admin/brain-credit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [pool, orBalance, stripeBal] = await Promise.all([
      getAdminAccount(),
      getOpenRouterBalance(),
      getStripeBalance(),
    ])
    return reply.send({
      active: 'openrouter',
      openrouter: {
        ok: Boolean(config.openrouter.key),
        topup: 'https://openrouter.ai/credits',
        // Soldul REAL din OpenRouter (USD), exact ca pe pagina lor.
        balance: orBalance.balance,
        totalCredits: orBalance.totalCredits,
        totalUsage: orBalance.totalUsage,
        currency: orBalance.currency,
        low: orBalance.low,
        threshold: orBalance.threshold,
        live: orBalance.ok,
        error: orBalance.error,
      },
      // PUNGA STRIPE în bară (Adrian, 24 iul: „după OpenRouter, banii în
      // Stripe, reali") — disponibil + în tranzit, doar pentru admin.
      stripe: stripeBal
        ? { available: stripeBal.available, pending: stripeBal.pending, currency: stripeBal.currency }
        : null,
      pool,
    })
  })

  // The owner's REAL money picture (admin only): live Stripe balance (revenue
  // held at Stripe), real provider cost consumed, real profit, and the per-AI
  // cost breakdown. No hand-typed figures.
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [stripe, account, costs, orBalance, circuit] = await Promise.all([
      getStripeBalance(),
      getAdminAccount(),
      getCostSummary(),
      getOpenRouterBalance(),
      getMoneyCircuit(),
    ])
    // ── PUNGA UNICĂ (Adrian, 30 iul: „o singură pungă... nu rămâne decât REAL,
    // fără hardcode") ────────────────────────────────────────────────────────
    // Banii tăi stau, fizic, în trei locuri pe care NU le putem contopi (așa e
    // construit Stripe: cardul virtual are obligatoriu punga lui separată, iar
    // creditul de la furnizorul creierului e la el în cont). Ce PUTEM face — și
    // ce lipsea — e să nu mai existe o a patra cifră, scrisă de mână.
    //
    // Deci: o singură valoare, ADUNATĂ din cele trei surse externe, fiecare
    // verificabilă la sursa ei. Dacă o sursă nu răspunde, spunem că lipsește
    // (`complete: false`) — nu o socotim zero, fiindcă „£0 pentru că n-am putut
    // citi" arată exact ca „£0 pentru că n-ai bani", și alea două nu sunt
    // același lucru.
    const usdInMoneda = config.stripe.usdToCurrency
    const parti = {
      stripeAvailable: stripe?.available ?? null,
      stripePending: stripe?.pending ?? null,
      // Punga cardului: EXACT ce-a răspuns `/v1/balance`, nu ce-a răspuns altă
      // rută. Aici scria `circuit.error ? null : …` — adică un 403 pe
      // `/v1/account` (setările contului) făcea punga cardului să pară
      // necitibilă, deși soldul se citise perfect. Eroarea unei întrebări
      // otrăvea răspunsul alteia.
      stripeIssuing: circuit.issuingAvailable,
      openrouter: orBalance.ok ? orBalance.balance * usdInMoneda : null,
    }
    const complete = Object.values(parti).every((v) => v !== null)
    const total = Object.values(parti).reduce<number>((s, v) => s + (v ?? 0), 0)
    return reply.send({
      stripe,
      // Punga: cât ai, cu defalcarea din care s-a adunat și de unde lipsește.
      punga: { total: Math.round(total * 100) / 100, complete, parti },
      spent: account.spent,
      profit: account.profit,
      currency: stripe?.currency ?? 'gbp',
      byKind: costs.byKind,
      // Consumat AZI (USD, real) — pentru cardul „Consumat azi" din tabul Bani.
      today: costs.today,
      // „Punga lui Kelion" = soldul REAL, EXACT din contul OpenRouter (USD) din
      // care se alimentează creierul CENTRAL (Adrian: „valoarea exactă din
      // OpenRouter"). Doar adminul vede acest tab; userii nu ajung aici.
      openrouter: {
        balance: orBalance.balance,
        low: orBalance.low,
        threshold: orBalance.threshold,
        live: orBalance.ok,
        topup: orBalance.topup,
      },
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
    return reply.send(await getUserActivity())
  })

  // Free-trial visitor analytics (admin only): where trials come from — country,
  // city, IP, total, today.
  app.get('/api/admin/demos', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getDemoStats())
  })

  // Which brain models actually serve right now (admin only): live ping of
  // Kimi (primar) și GLM (rezervă). Vechiul provider scos complet (Adrian, 12 iul).
  app.get('/api/admin/models', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyModels())
  })

  // Verify the brain keys live (admin only): Kimi (primar) + GLM (rezervă). Pings
  // each with a 1-token call; reports ok/fail without ever exposing the key value.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyKeys())
  })

  // VERIFICARE TOATE TOKENURILE CU DREPTURI (Adrian, 14 iul): verifică LIVE toate
  // cheile/tokenurile cu acces la servicii externe și raportează statusul fără să
  // expună valori secrete. Include OpenRouter, OpenAI, Stripe, Google (service
  // account/TTS/OAuth), Gemini, Mail (SMTP+IMAP), LiveKit, PostgreSQL și SESSION_SECRET.
  app.get('/api/admin/token-checks', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const checks = await runAllTokenChecks()
    const ok = checks.filter((c) => c.status === 'ok').length
    const notConfigured = checks.filter((c) => c.status === 'not_configured').length
    const failed = checks.length - ok - notConfigured
    return reply.send({ ok, notConfigured, failed, total: checks.length, checks })
  })

  // ── CE CHEI VEDE SERVERUL CHIAR ACUM (Adrian, 30 iul: „toate cheile au fost
  // scrise de zeci de ori") ────────────────────────────────────────────────
  // Panoul spunea „(neconfigurat)" în timp ce omul spunea „le-am scris". Ambele
  // pot fi adevărate: o cheie SCRISĂ nu ajunge automat în procesul care rulează
  // — poate fi în alt fișier decât cel dat lui docker, scrisă DUPĂ pornirea
  // containerului (deci neîncărcată până la repornire), sau pusă ca secret în
  // GitHub fără să fi rulat `vps-set-env`. Ruta asta întreabă PROCESUL, nu omul.
  // NU întoarce valori — doar numele, dacă e prezentă, și lungimea.
  app.get('/api/admin/env-check', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({
      vars: envCheck(),
      summary: envSummary(),
      // Ora pornirii procesului: răspunde la întrebarea care chiar contează —
      // „am scris cheia ÎNAINTE sau DUPĂ ce a pornit aplicația?"
      startedAt: processStartedAt(),
      stripeMode: stripeMode(),
    })
  })

  // GESTURI (Adrian, 13 iul): panoul admin citește/scrie ce gesturi are voie
  // Kelion să folosească contextual. Doar admin (403 altfel). Stocăm lista
  // DEZACTIVATĂ (default: toate active).
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

  // AUTO-EXTINDEREA LUI KELION (Adrian, 25 iul): uneltele pe care Kelion și le-a
  // PROPUS singur. Owner-ul le vede și aprobă/respinge cu UN CLICK — o unealtă
  // aprobată devine activă instant, fără redeploy. „Independent până la deploy,
  // cu aprobarea mea" — exact poarta cerută.
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

  // RESETAREA CONTOARELOR DE CONSUM (Adrian, 30 iul). Șterge DOAR jurnalul
  // costurilor noastre la furnizori. Portofelele userilor, registrul plăților și
  // istoricul de cumpărare rămân NEATINSE — creditele consumate nu se dau înapoi,
  // iar contabilitatea nu se rescrie. Cere sesiune de admin, ca tot ce e aici.
  app.post('/api/admin/reset-counters', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await resetCostCounters())
  })

  // Ruta /api/admin/pool a fost ȘTEARSĂ (Adrian, 30 iul): scria de mână cât
  // credea omul că are în pungă, iar panoul afișa cifra aia ca fapt. Câți bani
  // ai se citește acum de la Stripe și OpenRouter, care chiar îi țin.

  // CIRCUITUL BANILOR din adminul Kelionai (Adrian, 24 iul): starea live a
  // fiecărei verigi Stripe→AI + crearea cardului virtual prin API. STRICT admin.
  app.get('/api/admin/money-circuit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // ALIMENTAREA AUTOMATĂ A CARDULUI, VIZIBILĂ (audit „cod abandonat", 29 iul):
    // `lastAutoFundStatus` exista, dar n-o citea nimeni — deci dacă alimentarea
    // automată a cardului lui Kelion EȘUA, nu se vedea nicăieri: creierul rămânea
    // fără bani „din senin". Acum ultima încercare (când, reușită sau nu, cu
    // motivul) intră în circuitul banilor din admin, lângă restul verigilor.
    return reply.send({ ...(await getMoneyCircuit()), autoFund: lastAutoFundStatus() })
  })
  app.post<{ Body: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string } }>(
    '/api/admin/money-circuit/card',
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // Adresa titularului vine de la owner (vezi comentariul din createKelionCard):
    // înainte era inventată în cod, ceea ce putea da refuz la verificarea de adresă.
    const r = await createKelionCard(user.email, {
      line1: String(req.body?.line1 ?? ''),
      line2: req.body?.line2 ? String(req.body.line2) : undefined,
      city: String(req.body?.city ?? ''),
      postal_code: String(req.body?.postal_code ?? ''),
      country: String(req.body?.country ?? 'GB'),
    })
    if ('error' in r) return reply.code(r.error === 'bad_address' ? 400 : 502).send(r)
    return reply.send({ ok: true, ...r })
  })

  // NUMĂRUL CARDULUI ÎN PANOU (Adrian, 30 iul: „nu mă descurc, intră și ajută-mă").
  // Schimbă nonce-ul făcut de Stripe.js în browser pe o cheie efemeră de 15 min.
  // Serverul NU vede cifrele cardului — vede un nonce; numărul se randează
  // într-un iframe Stripe. Poarta e dublă, cum cere Stripe pentru ruta asta:
  // sesiune de admin ȘI încuietoarea de admin ridicată (dacă e armată), fiindcă
  // dincolo de ea stă un instrument de plată.
  app.post<{ Body: { card_id?: string; nonce?: string } }>('/api/admin/money-circuit/card-key', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    if ((await isLockArmed()) && !hasUnlock(req, user.email)) return reply.code(403).send({ error: 'locked' })
    const r = await createCardEphemeralKey(String(req.body?.card_id ?? ''), String(req.body?.nonce ?? ''))
    if ('error' in r) return reply.code(502).send(r)
    return reply.send(r)
  })

  // DEPUNEREA OWNERULUI (Adrian, 24 iul: „de unde din admin depun bani să
  // ajungă în Stripe și din Stripe în OpenRouter?"): checkout marcat
  // owner_deposit — bani în pungă FĂRĂ credite; transferul automat îi duce
  // spre card → AI. STRICT admin.
  app.post<{ Body: { pounds?: number } }>('/api/admin/deposit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const pounds = Math.round(Number(req.body?.pounds ?? 0))
    if (!(pounds > 0) || pounds > 2000) return reply.code(400).send({ error: 'bad_amount' })
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    const r = await createOwnerDeposit(user.email, pounds, baseUrl)
    if ('error' in r) return reply.code(502).send(r)
    return reply.send({ ok: true, url: r.url, pounds })
  })

  // PAYOUT ADMIN (Adrian, 24 iul: „să scrie clar PAYOUT admin, către cardul
  // declarat REAL"): declanșează payout-ul Stripe din admin — merge prin design
  // DOAR către contul bancar/cardul real din Settings→Payouts, niciodată către
  // cardul virtual. Pe extras: „PAYOUT ADMIN". STRICT admin.
  app.post<{ Body: { pounds?: number } }>('/api/admin/payout', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const pounds = Number(req.body?.pounds ?? 0)
    if (!(pounds > 0) || pounds > 10_000) return reply.code(400).send({ error: 'bad_amount' })
    const r = await createAdminPayout(pounds)
    if ('error' in r) return reply.code(502).send(r)
    return reply.send({ ok: true, ...r })
  })

  // VÂNZARE DE CREDITE (Adrian, 24 iul: „se vând X credite pe bani; butonul de
  // credite e doar la admin"). Adminul alege userul + X credite → primește
  // linkul de plată Stripe pe care i-l trimite userului. La plată, userul
  // primește EXACT X credite (webhook/reconciliere pe metadata sale_credits),
  // cu tranzacția în registru. Userii NU au buton de cumpărare — doar afișare.
  app.post<{ Body: { email?: string; credits?: number } }>('/api/admin/sell-credits', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const credits = Math.floor(Number(req.body?.credits ?? 0))
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'bad_email' })
    if (!(credits > 0) || credits > 100_000) return reply.code(400).send({ error: 'bad_credits' })
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    const r = await createSaleCheckout(email, credits, baseUrl)
    if ('error' in r) return reply.code(502).send(r)
    return reply.send({ ok: true, url: r.url, pounds: r.pounds, credits, email })
  })

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
          await grantCredit(email, amount, config.stripe.currency)
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
    return reply.send({ leads: await listLeads() })
  })

  // Mesajele din formularul „Contact" — salvate MEREU în DB, deci owner-ul le
  // vede aici chiar dacă emailul nu e configurat (bug „contactul nu se trimite").
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
    return reply.send({ convos: await listVisitorConvos() })
  })

  app.get<{ Querystring: { conv?: string; after?: string } }>(
    '/api/admin/visitor-chat',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      // Corpul e comun cu ruta publică (sursă unică în demo.ts); aici doar poarta
      // de admin de mai sus e în plus.
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
      return reply.send({ ok: id > 0, id })
    },
  )
}
