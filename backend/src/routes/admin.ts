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
import { stareCitirePlati, incepeLegaturaPlati, finalizeazaLegaturaPlati } from '../services/openBanking.js'
import { stareAutonomie } from '../services/autonomie.js'
import { isOpsPaused, setOpsPaused } from '../services/runbooks.js'
import { dovezileAutonomiei } from '../services/dovezi.js'
import { isArmed as isLockArmed, hasUnlock, grantUnlock, verifyLockSecret, setLockSecret } from '../services/adminLock.js'
import { listRecoveryPoints, createRecoveryPoint, restoreToPoint } from '../services/recovery.js'
import { getOpenRouterBalance } from '../services/openrouter.js'
import { resurseGazda } from '../services/resurse.js'
import { triageGaps } from '../services/gapsTriage.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { envCheck, envOrphans, envSummary, processStartedAt } from '../services/envCheck.js'
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
    const [pool, orBalance, vps] = await Promise.all([
      getAdminAccount(),
      getOpenRouterBalance(),
      resurseGazda(),
    ])
    return reply.send({
      active: 'openrouter',
      // ── VPS-UL, PERMANENT ÎN BARĂ (Adrian, 31 iul: „afișează permanent VPS
      // pe interfață în bara de sus") ───────────────────────────────────────
      // Merge pe ruta asta, nu pe una nouă: bara o sondează oricum la 15s, iar
      // citirea din /proc costă microsecunde. Un poller în plus ar fi fost cost
      // fără câștig.
      // `null` când nu se poate măsura — bara scrie „⚠ VPS", NU zerouri. Un
      // „0.0 GB / 0%" ar arăta identic cu un server mort și ar fi exact eroarea
      // pe care o tot reproșează: citire picată prezentată ca stare reală.
      vps,
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
      pool,
    })
  })

  // Imaginea REALĂ a banilor ownerului (doar admin): soldul real de la
  // furnizorul creierului, costul real consumat la furnizori și profitul real.
  // Nicio cifră scrisă de mână. (Stripe a ieșit total — 31 iul.)
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [account, costs, orBalance] = await Promise.all([
      getAdminAccount(),
      getCostSummary(),
      getOpenRouterBalance(),
    ])
    // ── PUNGA UNICĂ (Adrian, 30 iul: „o singură pungă... nu rămâne decât REAL,
    // fără hardcode") ────────────────────────────────────────────────────────
    // O singură valoare, ADUNATĂ din sursele externe verificabile la sursa lor.
    // Dacă o sursă nu răspunde, spunem că lipsește (`complete: false`) — nu o
    // socotim zero, fiindcă „£0 pentru că n-am putut citi" arată exact ca
    // „£0 pentru că n-ai bani", și alea două nu sunt același lucru.
    const usdInMoneda = config.billing.usdToCurrency
    const parti = {
      openrouter: orBalance.ok ? orBalance.balance * usdInMoneda : null,
    }
    const complete = Object.values(parti).every((v) => v !== null)
    const total = Object.values(parti).reduce<number>((s, v) => s + (v ?? 0), 0)
    return reply.send({
      // Punga: cât ai, cu defalcarea din care s-a adunat și de unde lipsește.
      punga: { total: Math.round(total * 100) / 100, complete, parti },
      spent: account.spent,
      profit: account.profit,
      currency: config.billing.currency,
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
      // Chei pe care LE AI în proces, dar sub un nume pe care codul nu-l citea.
      // Ăsta e răspunsul la „am scris-o de zeci de ori": ai scris-o, eu mă
      // uitam în altă parte. Doar NUMELE, niciodată valorile.
      orphans: envOrphans(),
      // Ora pornirii procesului: răspunde la întrebarea care chiar contează —
      // „am scris cheia ÎNAINTE sau DUPĂ ce a pornit aplicația?"
      startedAt: processStartedAt(),
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
  // ai se citește din contul bancar (Enable Banking) și de la OpenRouter.

  // CIRCUITUL BANILOR din adminul Kelionai (Adrian, 24 iul): starea live a
  // fiecărei verigi plată→AI. STRICT admin.
  app.get('/api/admin/money-circuit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // `citirePlati` = starea cititorului de tranzacții Revolut. Fără el, panoul
    // n-ar putea deosebi „n-a plătit nimeni" de „nu pot citi contul" — exact
    // confuzia care a costat o zi întreagă pe 30 iul.
    return reply.send({
      citirePlati: stareCitirePlati(),
      // `autonomie` = ultima trecere a buclei care îi dă lui Kelion de lucru
      // FĂRĂ să-i ceară cineva (Adrian, 30 iul: „fă-l autonom"). Se afișează
      // din același motiv ca restul: ca „bucla lucrează" să fie o citire, nu
      // o afirmație a mea.
      autonomie: stareAutonomie(),
      // COSTUL LA VEDERE (Adrian, 30 iul: „am nevoie să văd, nu frâne").
      // Exista ca unealtă — trebuia să ÎNTREBE ca să afle. Acum e în panou,
      // lângă bani: total, azi, și pe ce s-a dus. Nu taie nimic; arată.
      costReal: await getCostSummary().catch(() => null),
      // FRÂNA E A TA, ȘI SE VEDE. „pauza-autonomie" exista de mult, dar doar ca
      // o comandă pe care trebuia s-o știi pe de rost. O limită pe care o alegi
      // tu nu e o barieră; una pe care ți-o pun eu, da.
      autonomiaOprita: await isOpsPaused().catch(() => false),
    })
  })
  // FRÂNA TA, LA UN CLICK (Adrian, 30 iul: „cele 6 trebuiesc, dar nu frâne" —
  // asta nu e o frână pusă de mine peste el, e maneta pe care o ții TU).
  // „pauza-autonomie" exista din 27 iul, dar numai ca o comandă pe care trebuia
  // s-o știi pe de rost și s-o spui lui Kelion. Acum e un buton, la vedere.
  // CELE OPT DOVEZI (Adrian, 31 iul: „trebuie 8 din 8 dovezi"). Nivelul
  // autonomiei nu mai e o afirmație de-a mea într-un chat care se pierde: e o
  // CITIRE din bază. Fiecare nivel își caută urma concretă — un ordin, un PR, o
  // măsurătoare — și spune „dovedit" doar dacă a găsit-o. Altfel spune ce
  // anume ar fi dovada. Regula #1, aplicată propriei noastre evidențe.
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

  // ── LEGAREA CONTULUI REVOLUT (consimțământ PSD2, Enable Banking) ───────────
  // Două rute care duc owner-ul prin consimțământ fără SSH:
  //   1. start  → URL-ul de deschis în browser (aprobarea se dă în app Revolut)
  //   2. finalizeaza → cu codul din URL-ul de întoarcere, salvăm contul legat
  // Consimțământul expiră la max. 90 zile (PSD2) — aceleași rute îl reînnoiesc.
  // `redirect_url` trebuie declarat în Control Panel Enable Banking.
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

  // Aici au stat rutele de card virtual Stripe, depunere/payout prin Stripe și
  // vânzarea de credite cu link de plată Stripe. Șterse odată cu Stripe (31
  // iul): vânzarea de credite se face acum prin cod unic + transfer Revolut,
  // iar creditarea manuală rămâne pe /api/admin/user (action: 'credit').

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
