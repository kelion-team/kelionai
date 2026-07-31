// ── CITITORUL DE TRANZACȚII DIN REVOLUT PRO ──────────────────────────────────
//
// Adrian, 30 iul: „găsești soluții și plățile mi le fac prin revolut pro" +
// „fiecare plată trebuie să fie însoțită de un cod unic".
//
// Revolut Pro nu are Merchant API, deci nu poate trimite un webhook care să ne
// spună „s-a plătit". Fără asta, creditarea rămâne manuală — exact ce a refuzat.
//
// Soluția care NU cere firmă și NU aduce un procesator între noi și banii lui:
// citim tranzacțiile CONTULUI, prin Open Banking. Banii intră direct la el, cu
// comisionul lui Revolut, iar aplicația doar SE UITĂ ce a intrat și potrivește
// codul din referință cu omul care aștepta să plătească.
//
// FURNIZORUL (31 iul 2026): **Enable Banking** — https://enablebanking.com.
// Varianta anterioară era GoCardless Bank Account Data (fostul Nordigen), dar
// GoCardless a ÎNCHIS conturile noi la finalul lui 2025 și închide serviciul
// treptat — verificat pe viu: „New signups for Bank Account Data are currently
// disabled". Enable Banking e înlocuitorul standard: self-serve, iar modul
// „Restricted Production" (conturile proprii, legate de titular) e gratuit —
// exact cazul nostru: citim contul PROPRIETARULUI, cu consimțământul lui.
//
// CE NU FACE, și e important: nu mișcă bani, nu poate plăti, nu poate scoate
// nimic din cont. Accesul e strict de CITIRE (AIS — account information).
//
// CUM SE AUTENTIFICĂ (diferit de GoCardless): aplicația are o cheie privată RSA
// a CĂREI cheie publică e încărcată în Control Panel; fiecare cerere poartă un
// JWT RS256 semnat cu cheia privată (kid = app_id). Cheia privată stă pe server,
// în env ca base64 (o singură linie — env-file nu duce PEM multi-linie).
//
// LIMITA REALĂ, neschimbată de furnizor: consimțământul dat băncii expiră
// (PSD2 — maximum 90 de zile) și trebuie reînnoit de proprietar, cu un click,
// prin ruta admin `/api/admin/plati/legatura/start` (sau SSH, vezi RUNBOOKS).
// Când se apropie, panoul trebuie să spună — altfel creditarea automată s-ar
// opri în tăcere, adică fix boala pe care n-o mai acceptăm.
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'

const API = 'https://api.enablebanking.com'

/** Cheia kv_state unde ținem contul legat. E în DB, nu în env, ca re-legarea
 *  (consimțământ reînnoit) să nu ceară republicare: ruta admin o scrie singură. */
const KV_CONT_LEGAT = 'eb_account_uid'
/** Și data expirării consimțământului — panoul poate avertiza DIN TIMP. */
const KV_CONSENT_EXPIRA = 'eb_consent_expira'

/** O intrare de bani, curățată de tot ce nu ne trebuie. */
export interface TranzactieIntrata {
  /** Referința de la bancă — cheia care face creditarea idempotentă. */
  id: string
  /** Suma, POZITIVĂ (ieșirile sunt filtrate înainte). */
  amount: number
  currency: string
  /** Textul în care căutăm codul. */
  referinta: string
}

/** Forma crudă a unei tranzacții Enable Banking (doar câmpurile folosite). */
interface EbTransaction {
  entry_reference?: string
  transaction_id?: string
  transaction_amount?: { amount?: string; currency?: string }
  credit_debit_indicator?: string
  status?: string
  remittance_information?: string[]
  debtor?: { name?: string }
}

/** JWT-ul de care are nevoie ORICE cerere. Întoarce null (nu aruncă) dacă
 *  lipsesc app_id sau cheia privată: apelantul trebuie să poată deosebi
 *  „nu e configurat" de „n-a intrat nimic" — două reacții diferite. */
function jwtPentruApi(): string | null {
  const { appId, privateKeyB64 } = config.enableBanking
  if (!appId || !privateKeyB64) return null
  const cheiePrivata = Buffer.from(privateKeyB64, 'base64').toString('utf8')
  const acum = Math.floor(Date.now() / 1000)
  try {
    return jwt.sign(
      { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: acum, exp: acum + 3600 },
      cheiePrivata,
      { algorithm: 'RS256', header: { typ: 'JWT', alg: 'RS256', kid: appId } },
    )
  } catch {
    // Cheia e stricată (base64 bun, dar nu e PEM valid) — tot „nu e configurat
    // bine" înseamnă, iar panoul trebuie să poată spune asta, nu să crape.
    return null
  }
}

/** Contul din care citim: env-ul are prioritate (setat de deploy), altfel
 *  cel legat prin consimțământ și salvat în kv_state de rută. */
async function contulLegat(): Promise<string | null> {
  if (config.enableBanking.accountUid) return config.enableBanking.accountUid
  return (await loadKv(KV_CONT_LEGAT).catch(() => null)) ?? null
}

/** Transformarea Enable Banking → forma noastră curată. Pură și exportată,
 *  ca s-o poată testa fără rețea — regulile de aici sunt cele care decid
 *  ce ajunge plată: DOAR intrări (CRDT), DOAR cu referință de bancă. */
export function mapeazaTranzactii(raw: EbTransaction[]): TranzactieIntrata[] {
  const out: TranzactieIntrata[] = []
  for (const t of raw) {
    // DOAR `BOOK`ed ajunge aici de obicei (filtrăm la cerere), dar nu ne
    // bazăm pe server: o tranzacție pending poate dispărea — creditam pe bani
    // care se pot întoarce și n-am mai avea de unde să-i luăm înapoi.
    if (t.status && t.status !== 'BOOK') continue
    // Ieșirile nu ne interesează: nu creditează pe nimeni.
    if (t.credit_debit_indicator !== 'CRDT') continue
    const suma = Number(t.transaction_amount?.amount ?? '0')
    if (!(suma > 0)) continue
    const id = t.entry_reference ?? t.transaction_id ?? ''
    if (!id) continue
    // Codul poate ajunge în oricare din câmpurile de referință, în funcție de
    // bancă — le lipim pe toate și căutăm în tot. Numele plătitorului intră și
    // el: unii oameni scriu codul acolo.
    const referinta = [...(t.remittance_information ?? []), t.debtor?.name ?? '']
      .filter(Boolean)
      .join(' ')
    out.push({ id, amount: suma, currency: (t.transaction_amount?.currency ?? 'gbp').toLowerCase(), referinta })
  }
  return out
}

/** Tranzacțiile INTRATE din contul legat.
 *
 *  `null` = n-am putut citi (lipsă configurare, consimțământ expirat, serviciu
 *  picat). `[]` = am citit, dar n-a intrat nimic. Două lucruri diferite, două
 *  valori diferite — regula nr. 1 din CLAUDE.md, aplicată de la început aici. */
export async function tranzactiiIntrate(): Promise<TranzactieIntrata[] | null> {
  const token = jwtPentruApi()
  if (!token) return null
  const uid = await contulLegat()
  if (!uid) return null
  // Ultimele 14 zile ajung: codurile în așteptare expiră la 2 ore, iar
  // creditarea e idempotentă pe referința băncii, deci recitirea nu dublează.
  const deLa = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const r = await fetch(
    `${API}/accounts/${encodeURIComponent(uid)}/transactions?transaction_status=BOOK&date_from=${deLa}`,
    { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
  ).catch(() => null)
  if (!r || !r.ok) return null
  const j = (await r.json().catch(() => ({}))) as { transactions?: EbTransaction[] }
  return mapeazaTranzactii(j.transactions ?? [])
}

// ── LEGAREA CONTULUI (consimțământul PSD2) ───────────────────────────────────
//
// Doi pași, chemați de ruta admin (sau din runbook, prin SSH):
//   1. `incepeLegaturaPlati`  → URL-ul unde owner-ul aprobă în Revolut
//   2. `finalizeazaLegaturaPlati(code)` → salvăm contul în kv_state
// Consimțământul expiră la max. 90 de zile (PSD2) — de-ia ținem și data, ca
// panoul să poată spune „se reînnoiește" ÎNAINTE să moară citirea.

/** Pasul 1: pornește autorizarea și întoarce URL-ul de deschis în browser.
 *  `redirectUrl` TREBUIE să fie în lista de redirect-uri a aplicației din
 *  Control Panel — altfel Enable Banking refuză cererea. */
export async function incepeLegaturaPlati(redirectUrl: string): Promise<{ url: string } | { error: string }> {
  const token = jwtPentruApi()
  if (!token) return { error: 'lipsesc ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY_B64' }
  const validPanaLa = new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString()
  const r = await fetch(`${API}/auth`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      access: { valid_until: validPanaLa },
      aspsp: { name: config.enableBanking.aspspName, country: config.enableBanking.aspspCountry },
      state: crypto.randomUUID(),
      redirect_url: redirectUrl,
      psu_type: 'personal',
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!r) return { error: 'nu pot ajunge la Enable Banking' }
  const j = (await r.json().catch(() => ({}))) as { url?: string; message?: string }
  if (!r.ok || !j.url) return { error: `Enable Banking a refuzat (${r.status}): ${j.message ?? 'fără detalii'}` }
  await saveKv(KV_CONSENT_EXPIRA, validPanaLa).catch(() => undefined)
  return { url: j.url }
}

/** Pasul 2: cu codul întors de bancă, creăm sesiunea și salvăm contul.
 *  Întoarce câte conturi a dat banca (ca dovadă), nu detaliile lor. */
export async function finalizeazaLegaturaPlati(code: string): Promise<{ conturi: number } | { error: string }> {
  const token = jwtPentruApi()
  if (!token) return { error: 'lipsesc cheile Enable Banking' }
  if (!code) return { error: 'lipsește codul din URL-ul de întoarcere' }
  const r = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!r) return { error: 'nu pot ajunge la Enable Banking' }
  const j = (await r.json().catch(() => ({}))) as { session_id?: string; accounts?: { uid?: string }[]; message?: string }
  if (!r.ok) return { error: `sesiune refuzată (${r.status}): ${j.message ?? 'fără detalii'}` }
  const uid = j.accounts?.find((a) => a.uid)?.uid
  if (!uid) return { error: 'banca nu a dat niciun cont în sesiune' }
  await saveKv(KV_CONT_LEGAT, uid)
  return { conturi: j.accounts?.length ?? 1 }
}

/** Cât mai e din consimțământ — pentru avertismentul DIN TIMP din panou. */
export async function consentExpiraLa(): Promise<string | null> {
  return (await loadKv(KV_CONSENT_EXPIRA).catch(() => null)) ?? null
}

// ── BUCLA CARE CREDITEAZĂ SINGURĂ ────────────────────────────────────────────
//
// „la plată se trece automat la ce cod/client" (Adrian). Aici se închide cercul:
// citim ce a intrat, căutăm codul, creditam omul. Rulează periodic, fiindcă
// nimeni nu ne poate anunța — Revolut Pro n-are webhook.
import { crediteazaDupaCod } from '../db.js'

/** Ultima trecere: ce am găsit și ce am făcut. Panoul îl citește ca să poată
 *  spune dacă sistemul chiar lucrează — o citire care nu merge NU are voie să
 *  arate ca „n-a plătit nimeni". */
let ultimaCitire: { la: string; ok: boolean; detaliu: string } | null = null
export function stareCitirePlati(): { la: string; ok: boolean; detaliu: string } | null {
  return ultimaCitire
}

/** O trecere: citește, potrivește, creditează. Întoarce câți useri au fost
 *  creditați acum. */
export async function verificaPlatiNoi(): Promise<number> {
  const tranzactii = await tranzactiiIntrate()
  if (tranzactii === null) {
    // NU tăcem și NU raportăm „0 plăți": n-am putut citi, ceea ce e cu totul
    // altceva. Dacă am scrie 0, owner-ul ar crede că nu plătește nimeni.
    ultimaCitire = {
      la: new Date().toISOString(),
      ok: false,
      detaliu: !config.enableBanking.appId
        ? 'nu e configurat (lipsesc cheile Enable Banking)'
        : !(await contulLegat())
          ? 'nu e legat contul (se face din Admin → Bani sau runbook)'
          : 'nu pot citi tranzacțiile — consimțământul poate fi expirat, se reînnoiește din Admin → Bani',
    }
    return 0
  }
  let creditati = 0
  let faraCod = 0
  for (const t of tranzactii) {
    const email = await crediteazaDupaCod(t.referinta, t.amount, t.currency, t.id).catch(() => null)
    if (email) {
      creditati++
      console.log(`[PLATI] ${email} creditat cu ${t.amount} ${t.currency} (tranzactia ${t.id})`)
    } else if (t.referinta && !/KLN-/i.test(t.referinta)) {
      // Intrare fără codul nostru: poate fi orice alt venit al lui, nu neapărat
      // o plată ratată. O numărăm, n-o tratăm ca eroare.
      faraCod++
    }
  }
  ultimaCitire = {
    la: new Date().toISOString(),
    ok: true,
    detaliu: `${tranzactii.length} intrări citite · ${creditati} creditate · ${faraCod} fără codul nostru`,
  }
  return creditati
}

/** Pornește verificarea periodică. Fără chei nu face nimic și n-o spune de o
 *  mie de ori — o singură dată, la pornire. */
export function startCitirePlati(): void {
  if (!config.enableBanking.appId || !config.enableBanking.privateKeyB64) {
    console.log('[PLATI] citirea automată e oprită: lipsesc cheile Enable Banking')
    return
  }
  // La 5 minute: destul de des cât omul să nu aștepte după credite, destul de
  // rar cât să nu batem degeaba în API-ul băncii.
  setTimeout(() => {
    void verificaPlatiNoi().catch(() => 0)
    setInterval(() => void verificaPlatiNoi().catch(() => 0), 5 * 60 * 1000)
  }, 30_000)
}
