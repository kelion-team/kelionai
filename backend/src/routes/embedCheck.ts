import type { FastifyInstance } from 'fastify'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getSessionUser } from '../session.js'
import { documentToMarkdown } from '../services/markitdown.js'

// ── VERIFICATORUL DE ÎNCADRARE — nimic „doar poză" pe monitor (P2) ──────────
// Ownerul, 15 aug: „aplicațiile trebuiesc toate funcționale, nu doar poze" +
// pereții de login Google nu au voie să apară într-un iframe mort.
//
// PROBLEMA MĂSURATĂ: un site care refuză înrămarea (X-Frame-Options / CSP
// frame-ancestors) tot declanșează `onLoad` pe <iframe> — deci monitorul
// raporta „ok" în timp ce omul vedea o cutie moartă „refused to connect".
// Lista din frontend (isEmbeddable) știe DOAR de google.com; restul lumii
// trecea drept înrămabil, pe cuvânt, nu pe măsurătoare.
//
// AICI E MĂSURĂTOAREA: serverul cere anteturile paginii (HEAD, apoi GET dacă
// HEAD e refuzat), urmărește redirecturile CU gardă la fiecare pas și citește
// verdictul chiar din anteturile ei. Trei răspunsuri cinstite (regula #1):
//   incadrabil: true  — anteturile permit înrămarea;
//   incadrabil: false — refuz explicit (XFO/CSP) sau perete de login Google;
//   incadrabil: null  — NU AM PUTUT VERIFICA (timeout/rețea) — frontend-ul
//                       lasă iframe-ul, nu inventăm un refuz nemăsurat.
//
// GARDA SSRF: doar http(s); numele se rezolvă în IP și adresele private /
// loopback / link-local sunt refuzate — inclusiv la FIECARE redirect, altfel
// un 302 spre 169.254.169.254 ar ocoli poarta de la intrare.

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/
function ipPrivat(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.test(ip)
  const v6 = ip.toLowerCase()
  return (
    v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') ||
    // IPv4 mapat în IPv6 (::ffff:10.0.0.1) — aceeași gardă, altă haină.
    (v6.startsWith('::ffff:') && PRIVATE_V4.test(v6.slice(7)))
  )
}

/** URL-ul e http(s) și nu țintește (nici prin DNS) o adresă privată. */
async function urlSigur(u: URL): Promise<boolean> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return !ipPrivat(host)
  try {
    const rez = await lookup(host, { all: true })
    return rez.length > 0 && rez.every((r) => !ipPrivat(r.address))
  } catch {
    return false // nume care nu se rezolvă — nu înrămăm ce nu există
  }
}

/** Anteturile spun „nu mă înrăma"? (XFO orice valoare = refuz pentru noi —
 *  DENY evident; SAMEORIGIN tot refuz, monitorul e alt origin decât pagina.) */
function refuzaDinAnteturi(h: Headers): string | null {
  const xfo = (h.get('x-frame-options') ?? '').trim()
  if (xfo) return `X-Frame-Options: ${xfo.slice(0, 40)}`
  const csp = h.get('content-security-policy') ?? ''
  const m = /frame-ancestors\s+([^;]+)/i.exec(csp)
  if (m) {
    const surse = m[1].trim().toLowerCase()
    // Doar `*` (sau o listă care ne conține originea publică) permite; orice
    // altceva — 'none', 'self', liste de alte domenii — e refuz pentru noi.
    if (surse !== '*' && !surse.includes('kelionai.app')) return `CSP frame-ancestors ${surse.slice(0, 60)}`
  }
  return null
}

interface Verdict {
  incadrabil: boolean | null
  motiv: string
  urlFinal: string
}

// Cache 10 minute — monitorul redeschide aceleași pagini; anteturile nu se
// schimbă de la un minut la altul și nu bombardăm site-urile altora.
const cache = new Map<string, { v: Verdict; la: number }>()
const CACHE_MS = 10 * 60_000

export async function verificaIncadrarea(brut: string): Promise<Verdict> {
  const dinCache = cache.get(brut)
  if (dinCache && Date.now() - dinCache.la < CACHE_MS) return dinCache.v
  const verdict = await masoaraIncadrarea(brut)
  if (cache.size > 500) cache.clear()
  cache.set(brut, { v: verdict, la: Date.now() })
  return verdict
}

async function masoaraIncadrarea(brut: string): Promise<Verdict> {
  let u: URL
  try {
    u = new URL(brut)
  } catch {
    return { incadrabil: false, motiv: 'nu e un URL valid', urlFinal: brut }
  }
  try {
    for (let pas = 0; pas < 5; pas++) {
      if (!(await urlSigur(u))) {
        return { incadrabil: false, motiv: 'adresă privată sau protocol neacceptat', urlFinal: u.href }
      }
      // PERETELE DE LOGIN GOOGLE — verdictul cel mai important pentru owner:
      // accounts.google.com refuză ORICE înrămare; într-un iframe e mereu mort.
      if (u.hostname === 'accounts.google.com' || u.hostname.endsWith('.accounts.google.com')) {
        return { incadrabil: false, motiv: 'perete de login Google — se deschide doar în tab', urlFinal: u.href }
      }
      let r = await fetch(u.href, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(6000) })
      if (r.status === 405 || r.status === 501) {
        // Server care nu vorbește HEAD — cerem GET, dar nu citim corpul.
        r = await fetch(u.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) })
        await r.body?.cancel().catch(() => {})
      }
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location')
        if (!loc) return { incadrabil: null, motiv: `redirect ${r.status} fără destinație`, urlFinal: u.href }
        u = new URL(loc, u) // relativ sau absolut — gardat la următorul pas
        continue
      }
      const refuz = refuzaDinAnteturi(r.headers)
      if (refuz) return { incadrabil: false, motiv: refuz, urlFinal: u.href }
      return { incadrabil: true, motiv: `anteturile permit înrămarea (HTTP ${r.status})`, urlFinal: u.href }
    }
    return { incadrabil: null, motiv: 'prea multe redirecturi (5) — nu pot verifica', urlFinal: u.href }
  } catch (e) {
    // NU inventăm un refuz: o rețea căzută nu e o dovadă că pagina refuză rama.
    return {
      incadrabil: null,
      motiv: `nu pot verifica: ${String((e as Error)?.message ?? e).slice(0, 100)}`,
      urlFinal: u.href,
    }
  }
}

// ── CITITORUL DE PAGINI — „să funcționeze pagina de internet, să afișeze"
// (owner, 22 aug, pe captura cu știrile blocate) ─────────────────────────────
// Un site care refuză înrămarea (X-Frame-Options/CSP) nu mai lasă monitorul
// mort pe „nu poate fi afișată": serverul citește EL pagina — cu ACEEAȘI
// gardă SSRF și redirecturi gardate pas cu pas ca verificatorul de mai sus —
// o trece prin convertorul existent HTML→text (markitdown, cel al
// documentelor) și întoarce conținutul lizibil. Monitorul îl arată ca
// document; butonul „Deschide într-un tab nou" rămâne deasupra.
const MAX_PAGINA_B = 2_000_000 // hardcod-permis: plafon tehnic de citire (2 MB) — o pagină de articol, nu un depozit

/** Corpul răspunsului, citit ÎN FLUX cu plafon REAL (verificatorul adversarial,
 *  22 aug, BLOCANT: `arrayBuffer()` descărca TOT înainte de măsurare — un URL
 *  de 500 MB umplea memoria procesului; plafonul „anunțat" nu proteja nimic).
 *  Depășirea taie conexiunea pe loc. */
async function corpCuPlafon(r: globalThis.Response): Promise<Buffer | null> {
  const anuntat = Number(r.headers.get('content-length') ?? 0)
  if (anuntat > MAX_PAGINA_B) {
    await r.body?.cancel().catch(() => {})
    return null
  }
  const cititor = r.body?.getReader()
  if (!cititor) {
    const tot = Buffer.from(await r.arrayBuffer())
    return tot.length > MAX_PAGINA_B ? null : tot
  }
  const bucati: Buffer[] = []
  let n = 0
  for (;;) {
    const { done, value } = await cititor.read()
    if (done) break
    n += value.byteLength
    if (n > MAX_PAGINA_B) {
      await cititor.cancel().catch(() => {})
      return null
    }
    bucati.push(Buffer.from(value))
  }
  return Buffer.concat(bucati)
}

/** Entitățile uzuale din titlu → text (verificatorul: `Știri &amp; Politică`
 *  ajungea LITERAL pe ecran). Pură. */
export function decodeazaEntitati(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

type PaginaCitita = { ok: true; titlu: string; text: string; urlFinal: string } | { ok: false; motiv: string }
// Cache 10 min + deduplicare în zbor (verificatorul: fiecare click re-descărca
// pagina și pornea ALT proces markitdown de până la 30s — pe un singur VPS,
// stivă de procese; embed-check avea cache, cititorul nu).
const cachePagini = new Map<string, { v: PaginaCitita; la: number }>()
const inZbor = new Map<string, Promise<PaginaCitita>>()

export async function citestePagina(brut: string): Promise<PaginaCitita> {
  const dinCache = cachePagini.get(brut)
  if (dinCache && Date.now() - dinCache.la < CACHE_MS) return dinCache.v
  const deja = inZbor.get(brut)
  if (deja) return deja
  const promisiune = citestePaginaReal(brut)
    .then((v) => {
      if (cachePagini.size > 200) cachePagini.clear()
      cachePagini.set(brut, { v, la: Date.now() })
      return v
    })
    .finally(() => inZbor.delete(brut))
  inZbor.set(brut, promisiune)
  return promisiune
}

async function citestePaginaReal(brut: string): Promise<PaginaCitita> {
  let u: URL
  try {
    u = new URL(brut)
  } catch {
    return { ok: false, motiv: 'nu e un URL valid' }
  }
  // MARGINE DECLARATĂ (verificatorul): între rezolvarea DNS din urlSigur și
  // fetch-ul propriu-zis există o fereastră teoretică de DNS-rebinding
  // (TOCTOU). Garda rulează totuși la FIECARE pas de redirect, ținta e o rută
  // autentificată, iar închiderea completă ar cere un dispatcher cu IP fixat —
  // schimbare de infrastructură, nu de rută; rămâne consemnată, nu ascunsă.
  try {
    for (let pas = 0; pas < 5; pas++) {
      if (!(await urlSigur(u))) return { ok: false, motiv: 'adresă privată sau protocol neacceptat' }
      const r = await fetch(u.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location')
        await r.body?.cancel().catch(() => {})
        if (!loc) return { ok: false, motiv: `redirect ${r.status} fără destinație` }
        u = new URL(loc, u)
        continue
      }
      if (!r.ok) return { ok: false, motiv: `pagina a răspuns HTTP ${r.status}` }
      const tip = (r.headers.get('content-type') ?? '').toLowerCase()
      if (!/text\/html|text\/plain|application\/xhtml/.test(tip)) {
        return { ok: false, motiv: `nu e o pagină de citit (content-type: ${tip.slice(0, 60) || 'necunoscut'})` }
      }
      const brutBytes = await corpCuPlafon(r)
      if (!brutBytes) return { ok: false, motiv: 'pagina e prea mare pentru citire (peste 2 MB)' }
      const html = brutBytes.toString('utf8')
      const titluBrut = (/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
      const titlu = decodeazaEntitati(titluBrut)
      const text = await documentToMarkdown(brutBytes, 'pagina.html')
      if (!text.trim()) return { ok: false, motiv: 'pagina nu a produs niciun text lizibil' }
      return { ok: true, titlu: titlu || u.hostname, text, urlFinal: u.href }
    }
    return { ok: false, motiv: 'prea multe redirecturi (5)' }
  } catch (e) {
    return { ok: false, motiv: `citirea a picat: ${String((e as Error)?.message ?? e).slice(0, 100)}` }
  }
}

export async function embedCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url?: string } }>('/api/embed-check', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const url = String(req.query?.url ?? '').slice(0, 2000)
    if (!url) return reply.code(400).send({ error: 'fara_url' })
    return reply.send(await verificaIncadrarea(url))
  })
  app.get<{ Querystring: { url?: string } }>('/api/citeste-pagina', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const url = String(req.query?.url ?? '').slice(0, 2000)
    if (!url) return reply.code(400).send({ error: 'fara_url' })
    const r = await citestePagina(url)
    if (!r.ok) return reply.code(422).send({ error: 'necitibil', motiv: r.motiv })
    return reply.send(r)
  })
}
