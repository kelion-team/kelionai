import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  logVisit,
  touchVisit,
  addLead,
  addVisitorMessage,
  getVisitorMessages,
  type DemoVisit,
} from '../db.js'

// Look up the visitor's location from their IP for the owner's analytics:
// country/city/region, ISP and timezone. Free, no key (ipwho.is). Short
// timeout; fails to empty fields, never blocks the trial.
export interface GeoInfo {
  country: string
  code: string
  city: string
  region: string
  isp: string
  tz: string
}
export async function geoLookup(ip: string): Promise<GeoInfo> {
  const empty = { country: '', code: '', city: '', region: '', isp: '', tz: '' }
  if (!ip || ip.startsWith('127.') || ip.startsWith('::') || ip.startsWith('10.') || ip.startsWith('192.168.'))
    return empty
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 2500)
    const r = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,city,region,timezone.id,connection.isp,connection.org`,
      { signal: ctrl.signal },
    )
    clearTimeout(to)
    if (!r.ok) return empty
    const j = (await r.json()) as {
      success?: boolean
      country?: string
      country_code?: string
      city?: string
      region?: string
      timezone?: { id?: string }
      connection?: { isp?: string; org?: string }
    }
    if (!j.success) return empty
    const info = {
      country: j.country ?? '',
      code: j.country_code ?? '',
      city: j.city ?? '',
      region: j.region ?? '',
      isp: j.connection?.isp || j.connection?.org || '',
      tz: j.timezone?.id ?? '',
    }
    if (info.country || info.city) geoIpCache.set(ip, info)
    return info
  } catch {
    return empty
  }
}

// Non-blocking variant for the chat hot path: returns the cached lookup
// instantly (null when not resolved yet) and warms the cache in the background.
// The IP fallback for location must NEVER delay a reply.
const geoIpCache = new Map<string, GeoInfo>()
const geoIpInFlight = new Set<string>()
export function geoLookupCached(ip: string): GeoInfo | null {
  if (!ip) return null
  const hit = geoIpCache.get(ip)
  if (hit) return hit
  if (!geoIpInFlight.has(ip)) {
    geoIpInFlight.add(ip)
    void geoLookup(ip).finally(() => geoIpInFlight.delete(ip))
  }
  return null
}

// Classify the visitor's user-agent: browser, OS, device class — and whether it
// looks like a BOT (crawler/headless/script) rather than a human.
function parseUa(ua: string): { browser: string; os: string; device: string; isBot: boolean } {
  const u = ua.toLowerCase()
  const isBot =
    !ua ||
    /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|scrapy|curl|wget|python-requests|httpclient|go-http|java\//.test(
      u,
    )
  let browser = 'Other'
  if (u.includes('edg/')) browser = 'Edge'
  else if (u.includes('opr/') || u.includes('opera')) browser = 'Opera'
  else if (u.includes('samsungbrowser')) browser = 'Samsung Internet'
  else if (u.includes('firefox/')) browser = 'Firefox'
  else if (u.includes('chrome/') || u.includes('crios/')) browser = 'Chrome'
  else if (u.includes('safari/')) browser = 'Safari'
  let os = 'Other'
  if (u.includes('windows')) os = 'Windows'
  else if (u.includes('android')) os = 'Android'
  else if (u.includes('iphone') || u.includes('ipad') || u.includes('ios')) os = 'iOS'
  else if (u.includes('mac os') || u.includes('macintosh')) os = 'macOS'
  else if (u.includes('linux')) os = 'Linux'
  const device = /mobi|android|iphone|ipad/.test(u) ? 'mobile' : 'desktop'
  return { browser, os, device, isBot }
}

// IP-ul REAL al vizitatorului în spatele Cloudflare: cf-connecting-ip (XFF dă IP-ul
// edge-ului CF, comun multor vizitatori — rău pentru geo ȘI anti-reuse). Preferă
// antetele real-client, cade pe XFF apoi req.ip. Era copiat în demo (×2) și chat
// (services→routes) — o singură sursă exportată (principiul permanent: unic, fără dup).
export function clientIp(req: FastifyRequest): string {
  const hdr = (name: string): string =>
    ((req.headers[name] as string | undefined) ?? '').split(',')[0]?.trim()
  return hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('x-forwarded-for') || req.ip || ''
}

// Build the full visitor profile for one request: real IP (Cloudflare-aware),
// geo, browser/OS/device, language, referrer, bot flag. Shared by the visit
// beacon and the demo start.
async function visitorProfile(
  req: FastifyRequest,
  referrer: string,
): Promise<{ ip: string; visit: DemoVisit }> {
  const ip = clientIp(req)
  const ua = (req.headers['user-agent'] as string | undefined) ?? ''
  const lang = ((req.headers['accept-language'] as string | undefined) ?? '').split(',')[0]?.trim() ?? ''
  const { browser, os, device, isBot } = parseUa(ua)
  const geo = await geoLookup(ip)
  return { ip, visit: { ...geo, browser, os, device, lang, referrer, isBot } }
}

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  // Visit beacon: EVERY landing-page visitor lands in the owner's analytics
  // (deduped 6h server-side). Public, fire-and-forget, never fails the page.
  app.post<{ Body: { fp?: string; ref?: string } }>('/api/visit', async (req, reply) => {
    const fp = typeof req.body?.fp === 'string' ? req.body.fp.slice(0, 128) : ''
    const referrer = typeof req.body?.ref === 'string' ? req.body.ref.slice(0, 300) : ''
    const { ip, visit } = await visitorProfile(req, referrer)
    void logVisit(fp, ip, visit)
    return reply.send({ ok: true })
  })

  // Presence ping (signed-in app, every ~60s): builds the owner's per-USER
  // analytics — WHO is on, from what IP/place/device, and for HOW LONG. The
  // cheap path just extends the current session row; geo is only looked up
  // when a brand-new session row must be created.
  app.post<{ Body: { fp?: string } }>('/api/visit/ping', async (req, reply) => {
    const fp = typeof req.body?.fp === 'string' ? req.body.fp.slice(0, 128) : ''
    const email = getSessionUser(req)?.email ?? ''
    const ip = clientIp(req)
    const touched = await touchVisit(fp, ip, email)
    if (!touched) {
      const { ip: fullIp, visit } = await visitorProfile(req, '')
      void logVisit(fp, fullIp, visit, email)
    }
    return reply.send({ ok: true })
  })

  // FĂRĂ tier gratuit (Adrian: „se scot total minutele de test, userii cumpără
  // să probeze"). Vizita e în continuare urmărită (analytics de mai sus), dar
  // NIMENI nu mai primește o sesiune gratuită — accesul cere cont + credite.

  // A visitor leaves their email (the only real channel to an anonymous visitor):
  // stored as a lead the owner can then email from the admin panel. Public but
  // rate-limited by the global limiter; validated + capped server-side.
  app.post<{ Body: { email?: string; note?: string; fp?: string } }>('/api/lead', async (req, reply) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : ''
    const fp = typeof req.body?.fp === 'string' ? req.body.fp : ''
    const ok = await addLead(email, note, fp)
    if (!ok) return reply.code(400).send({ error: 'bad_email' })
    return reply.send({ ok: true })
  })

  // Live chat widget (visitor side). The visitor keeps a random conv_id in their
  // localStorage; they SEND messages and POLL for the owner's replies. Public,
  // rate-limited by the global limiter; conv_id is just a thread handle.
  app.post<{ Body: { conv?: string; text?: string } }>('/api/visitor-chat/send', async (req, reply) => {
    const conv = typeof req.body?.conv === 'string' ? req.body.conv : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    if (!conv || !text.trim()) return reply.code(400).send({ error: 'bad_request' })
    const id = await addVisitorMessage(conv, 'visitor', text)
    return reply.send({ ok: id > 0, id })
  })

  app.get<{ Querystring: { conv?: string; after?: string } }>(
    '/api/visitor-chat/poll',
    async (req, reply) => {
      const conv = typeof req.query?.conv === 'string' ? req.query.conv : ''
      const after = Number(req.query?.after ?? 0) || 0
      if (!conv) return reply.code(400).send({ error: 'bad_request' })
      return reply.send({ messages: await getVisitorMessages(conv, after) })
    },
  )
}
