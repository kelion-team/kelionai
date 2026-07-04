import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  getAdminAccount,
  loadAdminPool,
  getDemoStats,
  getUserActivity,
  getDownloadStats,
  listInboundEmails,
  markGapEscalated,
} from '../db.js'
import { verifyKeys, verifyModels } from '../services/anthropic.js'
import { getStripeBalance } from '../services/stripe.js'
import { bridgeRepair, bridgeAsk, bridgeOnline } from './bridge.js'

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

  // Mark a gap resolved / reopen it (admin only). Used by the "Reject" button.
  app.post<{ Body: { id?: number; resolved?: boolean } }>('/api/admin/gaps/resolve', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const id = Number(req.body?.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad_request' })
    await setGapResolved(id, req.body?.resolved !== false)
    return reply.send({ ok: true })
  })

  // Escalate a gap to the owner's developer (Claude Code) through the bridge —
  // the "Escaladează către Claude" button. Forwards the request text as a
  // build/repair task and marks the gap resolved. If the bridge isn't running,
  // nothing is sent and the gap stays open (the UI tells the admin to start it).
  app.post<{ Body: { id?: number } }>('/api/admin/gaps/escalate', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const id = Number(req.body?.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad_request' })
    const gap = (await getCapabilityGaps(true)).find((g) => g.id === id)
    if (!gap) return reply.code(404).send({ error: 'not_found' })
    // Adrian's flow (4 iul): escalation lands in the PERSISTENT order registry
    // (visible as pending in Admin → Jurnal), and the gap STAYS in this list —
    // he cleans it himself with "Rezolvat" only after the fix is deployed and
    // HE has tested it. Nothing disappears before his eyes confirm it.
    bridgeRepair(
      `Cerere de la utilizatori (din culegerea de dorințe a lui Kelion), escaladată de admin — ` +
        `construiește/adaugă această capacitate în aplicația Kelionai: "${gap.request}"` +
        (gap.reason ? ` (motiv notat: ${gap.reason})` : ''),
    )
    // Tag it as sent — it stays visible (marcat „trimis la creier") and is
    // CLEARED automatically când deploy-ul reușește (healthcheck 200).
    await markGapEscalated(id)
    return reply.send({ escalated: true, online: true })
  })

  // CRITERIU DECIZIONAL (Adrian, 4 iul): pentru fiecare cerere deschisă, întreabă
  // CREIERUL dacă e DEJA implementată. DA → o șterge definitiv din listă. NU → o
  // trimite la constructor (și rămâne marcată, dispare singură la deploy reușit).
  // Așa nu se retrimite orbește ce s-a făcut deja, iar lista se curăță singură.
  app.post('/api/admin/gaps/triage', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    // TOATE cererile deschise (nu doar cele netrimise) — o cerere „trimisă" dar
    // neconstruită trebuie re-verificată; ce e făcut iese, restul (re)pleacă.
    const open = await getCapabilityGaps(false)
    if (open.length === 0) return reply.send({ done: 0, sent: 0, checked: 0 })
    if (!bridgeOnline()) return reply.send({ done: 0, sent: 0, checked: 0, offline: true })

    const prompt =
      'Ești creierul Kelionai și cunoști starea REALĂ a aplicației (monitor live pas-cu-pas + bară de proces, ' +
      'voce sintetizată pe server Chirp 3 trimisă prin punte, microfon full-duplex cu filtru de zgomot și VOX, ' +
      'punte cu 10 canale, limba userului aplicată, camera→creier, emailuri contact@, etc). ' +
      'Pentru FIECARE capacitate cerută mai jos, decide dacă e DEJA implementată în aplicația de acum. ' +
      'Răspunde STRICT o linie pe cerere, exact în formatul: `<id> DONE` sau `<id> TODO` (fără altceva pe linie).\n\n' +
      open.map((g) => `${g.id}: ${g.request}`).join('\n')
    const verdict = (await bridgeAsk(prompt, [], 120_000)) || ''

    let done = 0
    let sent = 0
    for (const g of open) {
      const m = new RegExp(`(?:^|\\n)\\s*${g.id}\\s*[:.\\-]?\\s*(DONE|TODO)`, 'i').exec(verdict)
      const isDone = m ? m[1].toUpperCase() === 'DONE' : false
      if (isDone) {
        await setGapResolved(g.id, true) // s-a făcut deja → scoasă definitiv
        done++
      } else if (!g.escalated) {
        // nefăcut și încă netrimis → la constructor, marcată „trimisă"
        bridgeRepair(
          `Cerere de la utilizatori (culegerea lui Kelion), triată de admin — construiește/adaugă: ` +
            `"${g.request}"${g.reason ? ` (motiv: ${g.reason})` : ''}`,
        )
        await markGapEscalated(g.id)
        sent++
      }
      // nefăcut ȘI deja trimis → rămâne în listă (așteaptă construirea); nu spamăm.
    }
    return reply.send({ done, sent, checked: open.length })
  })

  // The owner's REAL-money view: provider pool loaded, remaining, spent, profit
  // (admin only). This is what the admin sees instead of the users' credits.
  app.get('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getAdminAccount())
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
      spent: account.spent,
      profit: account.profit,
      currency: stripe?.currency ?? 'gbp',
      byKind: costs.byKind,
    })
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
  // Fable 5 and the Opus 4.8 reserve.
  app.get('/api/admin/models', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyModels())
  })

  // Verify the brain's Anthropic keys live (admin only). Pings the primary and
  // reserve keys with a 1-token call; reports ok/fail per key without ever
  // exposing the key values.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyKeys())
  })

  // Record money the owner loaded into the provider-credit pool (admin only).
  app.post<{ Body: { amount?: number } }>('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return reply.code(400).send({ error: 'bad_request' })
    await loadAdminPool(amount)
    return reply.send(await getAdminAccount())
  })
}
