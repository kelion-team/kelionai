import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  listAllTransactions,
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  getAdminAccount,
  loadAdminPool,
  withdrawAdminPool,
  blockUser,
  unblockUser,
  grantCredit,
  deleteUserData,
  listLeads,
  listContactMessages,
  markLeadContacted,
  listVisitorConvos,
  getVisitorMessages,
  addVisitorMessage,
  getDemoStats,
  getUserActivity,
  getDownloadStats,
  listInboundEmails,
  getDisabledGestures,
  setDisabledGestures,
} from '../db.js'
import { verifyKeys, verifyModels } from '../services/brain.js'
import { triageGaps } from '../services/gapsTriage.js'
import { runAllTokenChecks } from '../services/tokenChecks.js'
import { screenshotUrl } from '../services/browser.js'
import { geminiVision } from '../services/google.js'
import { getStripeBalance } from '../services/stripe.js'
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
  // arată dacă cheia OpenRouter e configurată + fondul REAL al adminului
  // (loaded − cost real), nu nelimitat, cu link direct spre alimentare.
  app.get('/api/admin/brain-credit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const pool = await getAdminAccount()
    return reply.send({
      active: 'openrouter',
      openrouter: {
        ok: Boolean(config.openrouter.key),
        topup: 'https://openrouter.ai/credits',
      },
      pool,
    })
  })

  // The owner's REAL money picture (admin only): live Stripe balance (revenue
  // held at Stripe), real provider cost consumed, real profit, and the per-AI
  // cost breakdown. No hand-typed figures.
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [stripe, account, costs] = await Promise.all([
      getStripeBalance(),
      getAdminAccount(),
      getCostSummary(),
    ])
    return reply.send({
      stripe,
      loaded: account.loaded,
      remaining: account.remaining,
      spent: account.spent,
      profit: account.profit,
      currency: stripe?.currency ?? 'gbp',
      byKind: costs.byKind,
      // Consumat AZI (USD, real) — pentru cardul „Consumat azi" din tabul Bani.
      today: costs.today,
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

  // VERIFICARE VIZUALĂ din ADMIN (Adrian, 13 iul: „nu se dă la admin dacă nu e
  // 200"): admin-ul poate rula visual-check prin SESIUNE (nu prin secretul VPS)
  // — screenshot + Gemini judecă dacă rezultatul cerut se vede. 403 dacă nu-i admin.
  app.post<{ Body: { url?: string; criteria?: string; fullPage?: boolean } }>(
    '/api/admin/visual-check',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      const url = String(req.body?.url ?? 'https://kelionai.app').trim()
      const criteria = String(req.body?.criteria ?? '').trim()
      if (!criteria) return reply.code(400).send({ error: 'bad_request', note: 'criteria required' })
      const shot = await screenshotUrl(url, { fullPage: req.body?.fullPage === true })
      if ('error' in shot) return reply.send({ ok: false, verdict: 'necunoscut', note: `screenshot: ${shot.error}` })
      const question =
        `Verifici VIZUAL un screenshot al aplicației web kelionai.app. Rezultatul cerut: "${criteria}". ` +
        `Răspunde STRICT: prima linie "VIZUAL: DA" dacă se vede clar, sau "VIZUAL: NU" dacă nu. Apoi o propoziție cu ce vezi.`
      const answer = await geminiVision(shot.jpegBase64, question)
      if (!answer) return reply.send({ ok: false, verdict: 'necunoscut', note: 'gemini_vision_indisponibil' })
      const m = answer.match(/VIZUAL:\s*(DA|NU)/i)
      return reply.send({ ok: true, verdict: m ? (m[1].toUpperCase() === 'DA' ? 'DA' : 'NU') : 'necunoscut', detail: answer.slice(0, 800) })
    },
  )

  // Record money the owner ADDS to or WITHDRAWS from the provider-credit pool
  // (admin only). direction 'withdraw' takes money out; anything else adds.
  app.post<{ Body: { amount?: number; direction?: string } }>('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return reply.code(400).send({ error: 'bad_request' })
    if (req.body?.direction === 'withdraw') await withdrawAdminPool(amount)
    else await loadAdminPool(amount)
    return reply.send(await getAdminAccount())
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
      const conv = typeof req.query?.conv === 'string' ? req.query.conv : ''
      const after = Number(req.query?.after ?? 0) || 0
      if (!conv) return reply.code(400).send({ error: 'bad_request' })
      return reply.send({ messages: await getVisitorMessages(conv, after) })
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
