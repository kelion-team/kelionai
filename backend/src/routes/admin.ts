import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { pollVisitorChat } from './demo.js' // visitor chat polling from the common source
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
import { getOpenAiMonthCost } from '../services/openaiCosts.js'
import { getSerperBalance } from '../services/serperBalance.js'
import { calcPunga } from '../services/punga.js'
import { VOICE_USD_PER_MINUTE } from '../services/cost.js'
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
    return reply.send({ points: await listRecoveryPoints() })
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

  // Batch-translate a conversation's messages into Romanian (the "Translate
  // into Romanian" button in the chat viewer — testers write in any language).
  // Admin only.
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
      listBuildJobs(12).catch(() => []),
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

  // The owner's REAL-money view: provider pool loaded, remaining, spent, profit
  // (admin only). This is what the admin sees instead of the users' credits.
  app.get('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getAdminAccount())
  })

  // The brain is 100% OpenRouter (0 Kimi, 0 GLM). The fund button in the admin
  // bar: shows the REAL, EXACT balance from the OpenRouter account — "Kelion's
  // pocket" that feeds the CENTRAL brain (Adrian, 24 Jul: "OpenRouter = the
  // exact value from OpenRouter"). Plus the admin's internal fund (loaded −
  // real cost) and a `low` signal when money needs to be deposited. STRICTLY
  // admin (users don't see it).
  app.get('/api/admin/brain-credit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [pool, orBalance, vps, openaiCost, serperBalance] = await Promise.all([
      getAdminAccount(),
      getOpenRouterBalance(),
      resurseGazda(),
      // THE OPENAI PILL (Adrian: "REAL everywhere, zero fabrications"): the
      // voice spend read from the provider's own costs API, next to the
      // OpenRouter balance. Cached 5 min in the service, so this 15s poll
      // costs one upstream call per 5 minutes at most.
      getOpenAiMonthCost(),
      // THE SERPER PILL (same rule): the REAL remaining search credit read
      // from Serper's /account endpoint. Also cached 5 min in the service.
      getSerperBalance(),
    ])
    return reply.send({
      active: 'openrouter',
      // ── THE VPS, PERMANENTLY IN THE BAR (Adrian, 31 Jul: "permanently show
      // VPS on the interface in the top bar") ───────────────────────────────
      // It rides on this route, not a new one: the bar polls it every 15s
      // anyway, and reading /proc costs microseconds. An extra poller would
      // have been cost with no gain.
      // `null` when it can't be measured — the bar writes "⚠ VPS", NOT zeros.
      // A "0.0 GB / 0%" would look identical to a dead server and would be
      // exactly the error he keeps complaining about: a failed reading
      // presented as real state.
      vps,
      openrouter: {
        ok: Boolean(config.openrouter.key),
        topup: 'https://openrouter.ai/credits',
        // The REAL OpenRouter balance (USD), exactly as on their page.
        balance: orBalance.balance,
        totalCredits: orBalance.totalCredits,
        totalUsage: orBalance.totalUsage,
        currency: orBalance.currency,
        low: orBalance.low,
        threshold: orBalance.threshold,
        live: orBalance.ok,
        error: orBalance.error,
      },
      // The REAL OpenAI month-to-date spend (USD). `live: false` means
      // UNREADABLE (key missing or read failed) — the bar writes "⚠ OpenAI",
      // NEVER "$0.00" (the getOpenRouterBalance honesty rule, applied here).
      openai: {
        live: openaiCost.ok,
        monthUsd: openaiCost.ok ? openaiCost.monthUsd : undefined,
        error: openaiCost.error,
      },
      // The REAL Serper search credit (searches left). `live: false` means
      // UNREADABLE (key missing or read failed) — the bar writes "Serper ⚠",
      // NEVER "Serper 0" (the same honesty rule as the OpenAI pill).
      serper: {
        live: serperBalance.ok,
        balance: serperBalance.ok ? serperBalance.balance : undefined,
        rateLimit: serperBalance.ok ? serperBalance.rateLimit : undefined,
        error: serperBalance.error,
      },
      pool,
    })
  })

  // The REAL OpenAI spend, month-to-date (admin only) — the provider's own
  // costs API, the same reading the "OpenAI $x.xx" pill in the bar shows.
  app.get('/api/admin/openai-costs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getOpenAiMonthCost())
  })

  // The REAL picture of the owner's money (admin only): the real balance from
  // the brain provider, the real cost consumed at providers and the real
  // profit. No hand-written figure. (Stripe is fully out — 31 Jul.)
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [account, costs, orBalance, openaiCost] = await Promise.all([
      getAdminAccount(),
      getCostSummary(),
      getOpenRouterBalance(),
      getOpenAiMonthCost(),
    ])
    // ── THE SINGLE POCKET, IN ONE CURRENCY (USD) ────────────────────────────
    // Adrian, with live evidence: the header said "OpenRouter $9.99" while the
    // Money tab said "Punga: £7.99" — the SAME wallet converted with the
    // hand-written USD_TO_CURRENCY rate. A converted figure is not a measured
    // one. The pocket is now USD only (see services/punga.ts), identical to
    // what the header pill shows.
    const punga = calcPunga(orBalance.ok ? orBalance.balance : null)
    return reply.send({
      // The pocket: how much you have, with the breakdown it was added from
      // and where it's missing.
      punga,
      spent: account.spent,
      // The cost journal is kept in USD end to end (cost_events.cost_usd):
      // spentUsd/today/byKind are the SAME currency, so the Money tab no
      // longer mixes "total £" with "azi $". `account.spent` stays for older
      // callers; the tab reads spentUsd.
      spentUsd: costs.total,
      profit: account.profit,
      currency: config.billing.currency,
      byKind: costs.byKind,
      // Consumed TODAY (USD, real) — for the "Consumed today" card in the
      // Money tab.
      today: costs.today,
      // ── REAL vs ESTIMATE, WRITTEN ON EVERY ROW ────────────────────────────
      // Only brain calls carry the provider's own figure (OpenRouter
      // usage.cost). Everything else — the voice minutes especially — is a
      // fixed rate × a quantity, OUR estimate. The tab labels each row from
      // `felul`; an unlabeled estimate presented as cost is exactly the
      // "voice_minutes $204.52" fabrication this change removes.
      masurat: costs.masurat,
      estimat: costs.estimat,
      felul: costs.felul,
      // "Kelion's pocket" = the REAL, EXACT balance from the OpenRouter
      // account (USD) that feeds the CENTRAL brain (Adrian: "the exact value
      // from OpenRouter"). Only the admin sees this tab; users never get here.
      openrouter: {
        balance: orBalance.balance,
        low: orBalance.low,
        threshold: orBalance.threshold,
        live: orBalance.ok,
        topup: orBalance.topup,
      },
      // The REAL OpenAI month-to-date spend (USD, the provider's costs API) —
      // the anchor against which the internal voice estimate can be checked.
      openai: {
        live: openaiCost.ok,
        monthUsd: openaiCost.ok ? openaiCost.monthUsd : undefined,
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

  // Which brain models actually serve right now (admin only): a real 1-token
  // ping of the default chat + work models through OpenRouter (services/brain.ts).
  app.get('/api/admin/models', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyModels())
  })

  // Verify the brain key live (admin only): pings the OpenRouter chat default
  // (primary) and the work model (reserve) with a 1-token call; reports
  // ok/fail without ever exposing the key value.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyKeys())
  })

  // VERIFY ALL PRIVILEGED TOKENS (Adrian, 14 Jul): verifies LIVE all the
  // keys/tokens with access to external services and reports status without
  // exposing secret values. Includes OpenRouter, OpenAI, Google
  // (service account/TTS/OAuth), Gemini, Mail (SMTP+IMAP), PostgreSQL
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
  // (Enable Banking) and from OpenRouter.

  // THE MONEY CIRCUIT from the Kelionai admin (Adrian, 24 Jul): the live state
  // of each payment→AI link. STRICTLY admin.
  app.get('/api/admin/money-circuit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // `citirePlati` = the state of the Revolut transaction reader. Without it,
    // the panel couldn't tell "nobody paid" apart from "I can't read the
    // account" — exactly the confusion that cost a whole day on 30 Jul.
    return reply.send({
      citirePlati: stareCitirePlati(),
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
    return reply.send({ leads: await listLeads() })
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
    return reply.send({ convos: await listVisitorConvos() })
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
      return reply.send({ ok: id > 0, id })
    },
  )
}
