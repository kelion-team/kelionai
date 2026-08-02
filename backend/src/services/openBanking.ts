// ── THE REVOLUT PRO TRANSACTION READER ──────────────────────────────────────
//
// Adrian, 30 Jul: "you find solutions and you make my payments through
// Revolut Pro" + "every payment must come with a unique code".
//
// Revolut Pro has no Merchant API, so it can't send a webhook telling us
// "payment received". Without that, crediting stays manual — exactly what he
// refused.
//
// The solution that does NOT require a company and does NOT put a processor
// between us and his money: we read the ACCOUNT's transactions, through Open
// Banking. The money lands directly with him, with his Revolut fee, and the
// app only LOOKS at what came in and matches the code in the reference to the
// person waiting to pay.
//
// THE PROVIDER (31 Jul 2026): **Enable Banking** — https://enablebanking.com.
// The previous option was GoCardless Bank Account Data (formerly Nordigen),
// but GoCardless CLOSED new accounts at the end of 2025 and is winding the
// service down — verified live: "New signups for Bank Account Data are
// currently disabled". Enable Banking is the standard replacement:
// self-serve, and the "Restricted Production" mode (your own accounts, linked
// by the holder) is free — exactly our case: we read the OWNER's account,
// with his consent.
//
// WHAT IT DOESN'T DO, and it's important: it doesn't move money, can't pay,
// can't take anything out of the account. Access is strictly READ-ONLY
// (AIS — account information).
//
// HOW IT AUTHENTICATES (different from GoCardless): the application has an
// RSA private key WHOSE public key is uploaded in the Control Panel; every
// request carries an RS256 JWT signed with the private key (kid = app_id).
// The private key lives on the server, in env as base64 (a single line —
// env files can't hold multi-line PEM).
//
// THE REAL LIMIT, unchanged by the provider: the consent given to the bank
// expires (PSD2 — maximum 90 days) and must be renewed by the owner, with one
// click, through the admin route `/api/admin/plati/legatura/start` (or SSH,
// see RUNBOOKS). When it approaches, the panel must say so — otherwise
// automatic crediting would stop silently, i.e. exactly the disease we no
// longer accept.
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'
import { utcDay } from './timeContext.js'

const API = 'https://api.enablebanking.com'

/** The kv_state key where we keep the linked account. It's in the DB, not in
 *  env, so re-linking (renewed consent) doesn't require republishing: the
 *  admin route writes it by itself. */
const KV_CONT_LEGAT = 'eb_account_uid'

/** A money inflow, cleaned of everything we don't need. */
export interface TranzactieIntrata {
  /** The bank reference — the key that makes crediting idempotent. */
  id: string
  /** The amount, POSITIVE (outflows are filtered earlier). */
  amount: number
  currency: string
  /** The text we search for the code in. */
  referinta: string
}

/** The raw shape of an Enable Banking transaction (only the fields used). */
interface EbTransaction {
  entry_reference?: string
  transaction_id?: string
  transaction_amount?: { amount?: string; currency?: string }
  credit_debit_indicator?: string
  status?: string
  remittance_information?: string[]
  debtor?: { name?: string }
}

/** The JWT every request needs. Returns null (doesn't throw) if app_id or the
 *  private key is missing: the caller must be able to tell "not configured"
 *  apart from "nothing came in" — two different reactions. */
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
    // The key is broken (good base64, but not a valid PEM) — that still means
    // "not configured properly", and the panel must be able to say that, not
    // crash.
    return null
  }
}

/** The account we read from: env takes priority (set by deploy), otherwise
 *  the one linked through consent and saved in kv_state by the route. */
async function contulLegat(): Promise<string | null> {
  if (config.enableBanking.accountUid) return config.enableBanking.accountUid
  return (await loadKv(KV_CONT_LEGAT).catch(() => null)) ?? null
}

/** The Enable Banking → our clean shape transformation. Pure and exported, so
 *  it can be tested without network — the rules here are what decide what
 *  becomes a payment: ONLY inflows (CRDT), ONLY with a bank reference. */
export function mapeazaTranzactii(raw: EbTransaction[]): TranzactieIntrata[] {
  const out: TranzactieIntrata[] = []
  for (const t of raw) {
    // Only `BOOK`ed usually gets here (we filter at request time), but we
    // don't trust the server: a pending transaction can disappear — we'd be
    // crediting on money that can bounce back, with no way to take it back.
    if (t.status && t.status !== 'BOOK') continue
    // Outflows don't interest us: they credit nobody.
    if (t.credit_debit_indicator !== 'CRDT') continue
    const suma = Number(t.transaction_amount?.amount ?? '0')
    if (!(suma > 0)) continue
    const id = t.entry_reference ?? t.transaction_id ?? ''
    if (!id) continue
    // The code can land in any of the reference fields, depending on the bank
    // — we glue them all and search everything. The payer's name is included
    // too: some people write the code there.
    const referinta = [...(t.remittance_information ?? []), t.debtor?.name ?? '']
      .filter(Boolean)
      .join(' ')
    out.push({ id, amount: suma, currency: (t.transaction_amount?.currency ?? config.billing.currency).toLowerCase(), referinta })
  }
  return out
}

/** The INFLOW transactions from the linked account.
 *
 *  `null` = couldn't read (missing configuration, expired consent, service
 *  down). `[]` = read fine, but nothing came in. Two different things, two
 *  different values — rule no. 1 from CLAUDE.md, applied here from the
 *  start. */
export async function tranzactiiIntrate(): Promise<TranzactieIntrata[] | null> {
  const token = jwtPentruApi()
  if (!token) return null
  const uid = await contulLegat()
  if (!uid) return null
  // The last 14 days are enough: pending codes expire after 2 hours, and
  // crediting is idempotent on the bank reference, so re-reading doesn't
  // double.
  const deLa = utcDay(-14)
  const r = await fetch(
    `${API}/accounts/${encodeURIComponent(uid)}/transactions?transaction_status=BOOK&date_from=${deLa}`,
    { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
  ).catch(() => null)
  if (!r || !r.ok) return null
  const j = (await r.json().catch(() => ({}))) as { transactions?: EbTransaction[] }
  return mapeazaTranzactii(j.transactions ?? [])
}

// ── LINKING THE ACCOUNT (PSD2 consent) ──────────────────────────────────────
//
// Two steps, called by the admin route (or from the runbook, over SSH):
//   1. `incepeLegaturaPlati`  → the URL where the owner approves in Revolut
//   2. `finalizeazaLegaturaPlati(code)` → we save the account in kv_state
// Consent expires in max. 90 days (PSD2) — that's why we also keep the date,
// so the panel can say "renew it" BEFORE the reading dies.

/** Step 1: start the authorization and return the URL to open in the browser.
 *  `redirectUrl` MUST be in the application's redirect list in the Control
 *  Panel — otherwise Enable Banking refuses the request. */
export async function incepeLegaturaPlati(redirectUrl: string): Promise<{ url: string } | { error: string }> {
  const token = jwtPentruApi()
  if (!token) return { error: 'missing ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY_B64' }
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
  if (!r) return { error: 'cannot reach Enable Banking' }
  const j = (await r.json().catch(() => ({}))) as { url?: string; message?: string }
  if (!r.ok || !j.url) return { error: `Enable Banking refused (${r.status}): ${j.message ?? 'no details'}` }
  return { url: j.url }
}

/** Step 2: with the code returned by the bank, we create the session and save
 *  the account. Returns how many accounts the bank gave (as proof), not their
 *  details. */
export async function finalizeazaLegaturaPlati(code: string): Promise<{ conturi: number } | { error: string }> {
  const token = jwtPentruApi()
  if (!token) return { error: 'missing Enable Banking keys' }
  if (!code) return { error: 'missing the code from the return URL' }
  const r = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!r) return { error: 'cannot reach Enable Banking' }
  const j = (await r.json().catch(() => ({}))) as { session_id?: string; accounts?: { uid?: string }[]; message?: string }
  if (!r.ok) return { error: `session refused (${r.status}): ${j.message ?? 'no details'}` }
  const uid = j.accounts?.find((a) => a.uid)?.uid
  if (!uid) return { error: 'the bank gave no account in the session' }
  await saveKv(KV_CONT_LEGAT, uid)
  return { conturi: j.accounts?.length ?? 1 }
}

// ── THE LOOP THAT CREDITS BY ITSELF ─────────────────────────────────────────
//
// "at payment it automatically switches to which code/client" (Adrian). This
// is where the circle closes: we read what came in, search for the code,
// credit the person. It runs periodically, because nobody can notify us —
// Revolut Pro has no webhook.
import { crediteazaDupaCod, refCreditatDeja, salveazaPlataNeatribuita } from '../db.js'

/** The last pass: what we found and what we did. The panel reads it so it can
 *  say whether the system is actually working — a read that fails MUST NOT
 *  look like "nobody paid". */
let ultimaCitire: { la: string; ok: boolean; detaliu: string } | null = null
export function stareCitirePlati(): { la: string; ok: boolean; detaliu: string } | null {
  return ultimaCitire
}

/** One pass: read, match, credit. Returns how many users were credited
 *  now. */
export async function verificaPlatiNoi(): Promise<number> {
  const tranzactii = await tranzactiiIntrate()
  if (tranzactii === null) {
    // We do NOT stay silent and do NOT report "0 payments": we couldn't read,
    // which is something else entirely. If we wrote 0, the owner would
    // believe nobody is paying.
    ultimaCitire = {
      la: new Date().toISOString(),
      ok: false,
      detaliu: !config.enableBanking.appId
        ? 'not configured (Enable Banking keys missing)'
        : !(await contulLegat())
          ? 'account not linked (done from Admin → Money or the runbook)'
          : 'cannot read transactions — consent may be expired, renew it from Admin → Money',
    }
    return 0
  }
  let creditati = 0
  let inPlasa = 0
  for (const t of tranzactii) {
    const rezultat = await proceseazaIntrare(t)
    if (rezultat.fel === 'creditat') {
      creditati++
      console.log(`[PLATI] ${rezultat.email} credited with ${t.amount} ${t.currency} (transaction ${t.id})`)
    } else if (rezultat.fel === 'plasa') {
      inPlasa++
      console.log(`[PLATI] inflow ${t.id} (${t.amount} ${t.currency}) landed in the net — no matching code`)
    }
  }
  ultimaCitire = {
    la: new Date().toISOString(),
    ok: true,
    detaliu: `${tranzactii.length} inflows read · ${creditati} credited · ${inPlasa} new in the net`,
  }
  return creditati
}

/** One inflow's fate — THE NET IS REAL now (M2, Aug 2). Before, an unmatched
 *  inflow was counted in a local variable and thrown away, while the M2 order
 *  and RAMAS-DE-FACUT §G described a `plati_neatribuite` table that did not
 *  exist. Now: match → credit; no match → the net, exactly once.
 *  The `refCreditatDeja` guard matters: a code closes at 'paid', but the bank
 *  keeps returning the same transaction on every 5-minute read forever —
 *  without the guard, every SUCCESSFUL payment would re-enter the net one
 *  pass later, dressed up as a problem.
 *  Exported so the end-to-end money test (M5) can walk a transaction through
 *  the REAL decision, not through a copy of it. */
export async function proceseazaIntrare(t: {
  id: string
  referinta: string
  amount: number
  currency: string
}): Promise<{ fel: 'creditat'; email: string } | { fel: 'vechi' } | { fel: 'plasa' }> {
  const email = await crediteazaDupaCod(t.referinta, t.amount, t.currency, t.id).catch(() => null)
  if (email) return { fel: 'creditat', email }
  if (await refCreditatDeja(t.id).catch(() => false)) return { fel: 'vechi' }
  const nou = await salveazaPlataNeatribuita(t.id, t.referinta, t.amount, t.currency).catch(() => false)
  return nou ? { fel: 'plasa' } : { fel: 'vechi' }
}

/** Start the periodic check. Without keys it does nothing and doesn't say it
 *  a thousand times — once, at startup, AND in the panel: before (audit
 *  2 aug, „nu apare acel rând"), `ultimaCitire` stayed null forever, so the
 *  „Citirea plăților" row simply DIDN'T RENDER — the admin saw nothing
 *  instead of seeing what's missing, by name. */
export function startCitirePlati(): void {
  if (!config.enableBanking.appId || !config.enableBanking.privateKeyB64) {
    const lipsesc = [
      !config.enableBanking.appId ? 'ENABLE_BANKING_APP_ID' : '',
      !config.enableBanking.privateKeyB64 ? 'ENABLE_BANKING_PRIVATE_KEY_B64' : '',
    ]
      .filter(Boolean)
      .join(' + ')
    ultimaCitire = {
      la: new Date().toISOString(),
      ok: false,
      detaliu: `neconfigurat — lipsește: ${lipsesc}`,
    }
    console.log(`[PLATI] automatic reading is off: ${lipsesc} missing`)
    return
  }
  // Every 5 minutes: often enough that the person doesn't wait for credits,
  // rare enough that we don't hammer the bank's API for nothing.
  setTimeout(() => {
    void verificaPlatiNoi().catch(() => 0)
    setInterval(() => void verificaPlatiNoi().catch(() => 0), 5 * 60 * 1000)
  }, 30_000)
}
