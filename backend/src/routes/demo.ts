import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { setDemoSession, getSessionUser, makeDemoEmail } from '../session.js'
import { tryStartDemo, logVisit, touchVisit, type DemoVisit } from '../db.js'

// Look up the visitor's location from their IP for the owner's analytics:
// country/city/region, ISP and timezone. Free, no key (ipwho.is). Short
// timeout; fails to empty fields, never blocks the trial.
export async function geoLookup(ip: string): Promise<{
  country: string
  code: string
  city: string
  region: string
  isp: string
  tz: string
}> {
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
    return {
      country: j.country ?? '',
      code: j.country_code ?? '',
      city: j.city ?? '',
      region: j.region ?? '',
      isp: j.connection?.isp || j.connection?.org || '',
      tz: j.timezone?.id ?? '',
    }
  } catch {
    return empty
  }
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

// Build the full visitor profile for one request: real IP (Cloudflare-aware),
// geo, browser/OS/device, language, referrer, bot flag. Shared by the visit
// beacon and the demo start.
async function visitorProfile(
  req: FastifyRequest,
  referrer: string,
): Promise<{ ip: string; visit: DemoVisit }> {
  // Behind Cloudflare, the REAL visitor IP is in cf-connecting-ip (x-forwarded-for
  // gives the CF edge IP, which many visitors share — bad for geo AND for the
  // per-IP anti-reuse). Prefer the real-client headers, fall back to XFF.
  const hdr = (name: string): string =>
    ((req.headers[name] as string | undefined) ?? '').split(',')[0]?.trim()
  const ip = hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('x-forwarded-for') || req.ip || ''
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
    const hdr = (name: string): string =>
      ((req.headers[name] as string | undefined) ?? '').split(',')[0]?.trim()
    const ip =
      hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('x-forwarded-for') || req.ip || ''
    const touched = await touchVisit(fp, ip, email)
    if (!touched) {
      const { ip: fullIp, visit } = await visitorProfile(req, '')
      void logVisit(fp, fullIp, visit, email)
    }
    return reply.send({ ok: true })
  })

  // Start a free trial (default 3 minutes of full access). Collects the owner's
  // visitor analytics (human/bot, geo, device, language, referrer), enforces the
  // daily cap and a light per-fingerprint/IP anti-reuse.
  app.post<{ Body: { fp?: string; ref?: string } }>('/api/demo/start', async (req, reply) => {
    const fp = typeof req.body?.fp === 'string' ? req.body.fp.slice(0, 128) : ''
    const referrer = typeof req.body?.ref === 'string' ? req.body.ref.slice(0, 300) : ''
    const { ip, visit } = await visitorProfile(req, referrer)
    // Same email on the analytics row AND the session — the link that lets the
    // owner click a trial and read its conversation.
    const sessionEmail = makeDemoEmail()
    const res = await tryStartDemo(fp, ip, config.demo.capPerDay, visit, sessionEmail)
    if (!res.ok) {
      return reply.code(429).send({ error: res.reason === 'cap' ? 'cap_reached' : 'already_used' })
    }
    setDemoSession(reply, config.demo.seconds, sessionEmail)
    return reply.send({ ok: true, seconds: config.demo.seconds })
  })
}
