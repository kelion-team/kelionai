// ── CITIREA PLĂȚILOR DIN EMAILUL REVOLUT (Adrian, 3 aug: „soluția o faci pe Pro",
//    „fără cont nou", „Kelion monitorizează oricum emailul privat") ────────────
//
// Revolut Pro NU are webhook și NU are API de citire a contului pe UK (Open
// Banking prin Enable Banking acoperă doar SEE). Dar Revolut trimite un EMAIL
// la fiecare mișcare de bani, iar aplicația are deja acces la Gmailul owner-ului
// (refresh-token salvat în `google_accounts`, folosit de skill-urile Google).
// Deci citim de acolo: căutăm emailurile „Ai primit …" de la no-reply@revolut.com,
// scoatem suma + referința (unde vine codul plății) și le trecem prin ACEEAȘI
// logică de creditare ca restul (proceseazaIntrare: cod → credit, fără cod → plasă).
//
// NIMIC de configurat de owner: dacă Google e conectat (cum e), merge singur.
// Structura emailului e luată de pe un email REAL Revolut din inboxul lui, nu
// ghicită: titlu „Ai trimis/Ai primit <sumă> <valută> …", iar în corp un bloc cu
// etichetele „Sumă …" și „Referință".
import { config } from '../config.js'
import { getGoogleRefreshToken } from '../db.js'
import { refreshGoogleAccessToken } from './google.js'
import { htmlToText } from './mailbox.js'
import { proceseazaIntrare } from './openBanking.js'
import { loadKv, saveKv } from '../db.js'

export interface PlataEmail {
  /** Suma, POZITIVĂ, în unități întregi de valută (ex. 20, 249.82). */
  amount: number
  /** Valuta normalizată: GBP/EUR/USD/RON. */
  currency: string
  /** Textul de referință — aici căutăm codul plății. */
  referinta: string
}

// ── SECURITATE: creditul se activează DOAR pe un email dovedit de la Revolut ──
// Adrian, 3 aug: „dacă în email scrie Revolut că a fost plătit ȘI regăsești
// TOATE elementele de securitate, ABIA atunci se activează consumul de credite."
// Un „From: no-reply@revolut.com" se poate FALSIFICA — de aceea nu ne bazăm pe
// el, ci pe DKIM: Gmail pune în „Authentication-Results" verdictul criptografic
// (dkim=pass, header.d=revolut.com) pe care un atacator nu-l poate contraface.
// Fără dkim=pass semnat de revolut.com, emailul NU creditează, oricât ar părea
// de real. (crediteazaDupaCod cere oricum un cod KLN PENDING real — asta e a
// doua plasă; DKIM e prima.)
export function verificatDeLaRevolut(headers: { name: string; value: string }[]): boolean {
  const h = (n: string): string =>
    headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? ''
  const from = h('From').toLowerCase()
  if (!/@revolut\.com(>|\s|$)/.test(from)) return false
  const auth = h('Authentication-Results').toLowerCase()
  // dkim=pass ȘI domeniul semnatar să fie revolut.com (nu doar dkim=pass de la
  // oricine). Acceptăm și dkim aliniat pe un subdomeniu (…​.revolut.com).
  const dkimPass = /dkim=pass/.test(auth)
  const dkimRevolut = /header\.d=(?:[a-z0-9-]+\.)?revolut\.com/.test(auth)
  return dkimPass && dkimRevolut
}

// „Ai primit" = intrare; „Ai trimis" = ieșire (o ignorăm). Verificăm ambele, ca
// un email de trimitere să nu fie luat vreodată drept încasare.
export function esteIncasare(subject: string): boolean {
  const s = (subject || '').toLowerCase()
  if (/ai\s+trimis|you\s+sent|ai\s+plătit|ai\s+platit/.test(s)) return false
  return /ai\s+primit|you\s+received|ți-a\s+trimis|ti-a\s+trimis|has\s+paid\s+you|plată\s+primită|plata\s+primita/.test(s)
}

function normalizeazaValuta(v: string): string {
  const t = (v || '').trim().toLowerCase()
  if (t === '£' || t === 'gbp') return 'GBP'
  if (t === '€' || t === 'eur') return 'EUR'
  if (t === '$' || t === 'usd') return 'USD'
  if (t === 'lei' || t === 'ron') return 'RON'
  return v.toUpperCase()
}

// „249,82" (RO) / „1,234.56" (EN) / „625" → număr. Ultima virgulă SAU punct cu
// exact 2 zecimale în coadă e separatorul zecimal; restul sunt mii.
export function numarDinText(brut: string): number | null {
  const s = (brut || '').replace(/\s/g, '')
  if (!/\d/.test(s)) return null
  const decimal = /[.,]\d{2}$/.test(s) ? s.slice(-3, -2) : ''
  let intreg: string
  let zecimale = ''
  if (decimal) {
    intreg = s.slice(0, -3).replace(/[.,]/g, '')
    zecimale = s.slice(-2)
  } else {
    intreg = s.replace(/[.,]/g, '')
  }
  const n = Number(zecimale ? `${intreg}.${zecimale}` : intreg)
  return Number.isFinite(n) && n > 0 ? n : null
}

const RE_SUMA_VALUTA =
  /([\d][\d.,]*)\s*(£|€|\$|GBP|EUR|USD|RON|lei)|(£|€|\$|GBP|EUR|USD|RON|lei)\s*([\d][\d.,]*)/i

/** Din titlul + corpul (text simplu) al unui email Revolut de încasare, scoate
 *  suma, valuta și referința. `null` dacă nu e o încasare sau nu găsim suma. */
export function extragePlata(subject: string, textCorp: string): PlataEmail | null {
  if (!esteIncasare(subject)) return null
  const corp = textCorp || ''

  // Suma: întâi din corp, de lângă eticheta „Sumă" (cea mai sigură), apoi din titlu.
  let amount: number | null = null
  let currency = ''
  const langaSuma = /Sum[ăa][^\n]*\n\s*([^\n]+)/i.exec(corp)?.[1] ?? ''
  for (const sursa of [langaSuma, subject, corp]) {
    const m = RE_SUMA_VALUTA.exec(sursa)
    if (!m) continue
    const numar = m[1] ?? m[4] ?? ''
    const val = m[2] ?? m[3] ?? ''
    const n = numarDinText(numar)
    if (n) {
      amount = n
      currency = normalizeazaValuta(val)
      break
    }
  }
  if (amount === null) return null

  // Referința: valoarea de sub eticheta „Referință"/„Reference" din bloc.
  const ref =
    /Referin[țt][ăa][^\n]*\n\s*([^\n]+)/i.exec(corp)?.[1] ??
    /Reference[^\n]*\n\s*([^\n]+)/i.exec(corp)?.[1] ??
    ''
  return { amount, currency: currency || 'GBP', referinta: ref.trim() }
}

// ── Citirea propriu-zisă din Gmail ──────────────────────────────────────────

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'

async function tokenGmail(): Promise<string | null> {
  const refresh = await getGoogleRefreshToken(config.adminEmail).catch(() => '')
  if (!refresh) return null
  const t = await refreshGoogleAccessToken(refresh).catch(() => null)
  return t?.accessToken ?? null
}

function corpDinPayload(payload: unknown): string {
  // Preferă text/plain; altfel curăță text/html. Parcurge părțile recursiv.
  const dec = (data?: string): string =>
    data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : ''
  let plain = ''
  let html = ''
  const vezi = (p: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): void => {
    if (!p) return
    if (p.mimeType === 'text/plain' && p.body?.data) plain += dec(p.body.data)
    else if (p.mimeType === 'text/html' && p.body?.data) html += dec(p.body.data)
    for (const sub of p.parts ?? []) vezi(sub as typeof p)
  }
  vezi(payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] })
  return plain.trim() || htmlToText(html)
}

let ultima: { la: string; ok: boolean; detaliu: string } | null = null
export function starePlatiEmail(): { la: string; ok: boolean; detaliu: string } | null {
  return ultima
}

/** O trecere: caută emailurile Revolut de încasare din ultimele zile, creditează
 *  ce se potrivește, pune restul în plasă. Returnează câți useri s-au creditat.
 *  Un eșec de citire NU se raportează ca „0 plăți" — se spune că n-am putut citi
 *  (regula #1: un read picat nu e o măsurătoare). */
export async function verificaPlatiEmail(): Promise<number> {
  const token = await tokenGmail()
  if (!token) {
    ultima = {
      la: new Date().toISOString(),
      ok: false,
      detaliu: 'Google neconectat pentru admin (refresh-token lipsă) — nu pot citi emailurile Revolut',
    }
    return 0
  }
  // NU depindem de un filtru pe care owner-ul trebuie să-l facă: căutăm direct
  // emailurile de la revolut.com (merge și dacă folderul e gol), DAR includem și
  // eticheta lui, dacă le-a filat acolo (Adrian, 3 aug: „acolo să ajungă"). Așa
  // le prindem oricum. Dovada că e chiar Revolut o dă DKIM-ul, per-mesaj, mai jos.
  const q = encodeURIComponent(
    `(from:revolut.com OR label:${config.revolut.mailLabel}) newer_than:7d`,
  )
  const listRes = await fetch(`${GMAIL}?maxResults=25&q=${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  if (!listRes || !listRes.ok) {
    ultima = { la: new Date().toISOString(), ok: false, detaliu: 'Gmail n-a răspuns la listare' }
    return 0
  }
  const list = (await listRes.json().catch(() => ({}))) as { messages?: { id: string }[] }
  const ids = (list.messages ?? []).map((m) => m.id)

  let creditati = 0
  let incasari = 0
  let respinse = 0
  for (const id of ids) {
    const mRes = await fetch(`${GMAIL}/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    if (!mRes || !mRes.ok) continue
    const m = (await mRes.json().catch(() => ({}))) as {
      payload?: { headers?: { name: string; value: string }[] }
    }
    const headers = m.payload?.headers ?? []
    // POARTA DE SECURITATE: dovadă criptografică (DKIM) că e chiar de la Revolut.
    // Fără ea, sărim mesajul — nu creditează un email nesemnat/falsificat.
    if (!verificatDeLaRevolut(headers)) {
      respinse++
      continue
    }
    const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? ''
    if (!esteIncasare(subject)) continue
    const plata = extragePlata(subject, corpDinPayload(m.payload))
    if (!plata) continue
    incasari++
    // id-ul stabil al plății = id-ul mesajului Gmail → creditarea e idempotentă
    // (refCreditatDeja împiedică dublul credit la fiecare trecere).
    const r = await proceseazaIntrare({
      id: `gmail:${id}`,
      referinta: plata.referinta,
      amount: plata.amount,
      currency: plata.currency,
    }).catch(() => ({ fel: 'vechi' as const }))
    if (r.fel === 'creditat') creditati++
  }
  ultima = {
    la: new Date().toISOString(),
    ok: true,
    detaliu:
      `${ids.length} emailuri în „${config.revolut.mailLabel}" · ${incasari} încasări · ` +
      `${creditati} creditate${respinse ? ` · ${respinse} respinse (securitate/DKIM)` : ''}`,
  }
  await saveKv('plati:email:ultima', JSON.stringify(ultima)).catch(() => {})
  return creditati
}

/** Bucla: la pornire (după ce containerul e gata) și apoi din câteva în câteva
 *  minute, citește emailurile Revolut și creditează. Costă zero (Gmail e gratuit,
 *  nu atinge creierul plătit). */
export function startPlatiEmail(): void {
  void loadKv('plati:email:ultima')
    .then((v) => {
      if (v && !ultima) ultima = JSON.parse(v)
    })
    .catch(() => {})
  const ruleaza = (): void => void verificaPlatiEmail().catch(() => {})
  setTimeout(() => {
    ruleaza()
    setInterval(ruleaza, 3 * 60 * 1000)
  }, 90 * 1000)
}
