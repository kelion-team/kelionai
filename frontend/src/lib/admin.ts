// THE HTTP CONTRACT with the backend, ONE SINGLE declaration (Batch A of
// PROCEDURA-REFACERE-CLONE.md): tipurile astea erau redeclarate identic aici
// and in the backend (98 duplicated lines). Now they come from the common source; a TYPE
// import, so it vanishes at compile time — it adds nothing to the bundle.
import type { DemoRecent, DemoStats, MoneyCircuit, UserActivityRow } from '../../../backend/src/shared/api-types'
export type { DemoRecent, DemoStats, MoneyCircuit, UserActivityRow }
export interface UserSummary {
  email: string
  count: number
  last: string
}

export interface HistoryRow {
  role: string
  content: string
  created_at: string
}

// The owner's REAL money picture (admin only): live OpenRouter balance, real
// cost consumed, real profit, and per-AI cost. No hand-typed figures.
// (Stripe is fully out — 31 Jul.)
export interface Finance {
  // SINGLE POUCH, USD ONLY: the OpenRouter balance is MEASURED in USD, and a
  // £ conversion (hand-written rate) produced the "header $9.99 vs Punga
  // £7.99" contradiction — the same wallet, two figures. The pocket is now
  // exactly what the provider says, identical to the header pill.
  // `complete: false` means a source did not answer — then the total is
  // incomplete, not "zero".
  punga: {
    total: number
    complete: boolean
    currency: 'usd'
    parti: {
      openrouter: number | null
    }
  }
  spent: number
  /** The SAME cost journal as `spent`, but unconverted (USD end to end) —
   *  the Money tab shows ONLY this, so "total" and "azi" can't be in two
   *  currencies anymore. */
  spentUsd: number
  profit: number
  currency: string
  byKind: Record<string, number>
  // Consumed TODAY at the AI providers (USD, real) — the "Spent today" card.
  today: number
  /** REAL vs ESTIMATE per row: only 'masurat' rows carry the provider's own
   *  figure; the rest are internal estimates and MUST be labeled as such. */
  masurat: number
  estimat: number
  felul: Record<string, 'masurat' | 'estimat'>
  // "Kelion's pouch" — the REAL balance, straight from the OpenRouter account (USD).
  openrouter?: {
    balance: number
    low: boolean
    threshold: number
    live: boolean
    topup: string
  }
  /** The REAL OpenAI month-to-date spend (the provider's costs API).
   *  `live: false` = unreadable — the tab says so, never shows a zero. */
  openai?: {
    live: boolean
    monthUsd?: number
  }
}



export async function fetchFinance(): Promise<Finance | null> {
  try {
    const r = await fetch('/api/admin/finance', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as Finance
  } catch {
    return null
  }
}

// CIRCUITUL BANILOR (admin): starea verigilor Stripe→AI + crearea cardului.
/** The owner's lever: stops / restarts Kelion's autonomy.
 *
 *  The "pauza-autonomie" command existed since Jul 27, but you had to know it
 *  by heart and say it in chat. A brake the owner chooses himself is not a barrier —
 *  it's control. That's why it's a button, in plain sight, not a magic word. */
export async function pauzaAutonomie(oprit: boolean): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/autonomie/pauza', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oprit }),
    })
    return r.ok
  } catch {
    return false
  }
}

/** A proof of autonomy, as the server reads it from the database. */
export interface DovadaAutonomie {
  nivel: number
  ce: string
  cum: string
  dovedit: boolean
  dovada: string
  cand: string | null
}

/** Cele opt dovezi (Adrian, 31 iul: „trebuie 8 din 8 dovezi").
 *
 *  Not a list written by me: each level looks in the database for its concrete
 *  trace — an order, a PR, a measurement — and says "proven" ONLY if it found it. */
export async function fetchDoveziAutonomie(): Promise<{ dovedite: number; din: number; dovezi: DovadaAutonomie[] } | null> {
  try {
    const r = await fetch('/api/admin/autonomie/dovezi', { credentials: 'include' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function fetchMoneyCircuit(): Promise<MoneyCircuit | null> {
  try {
    const r = await fetch('/api/admin/money-circuit', { credentials: 'include' })
    return r.ok ? ((await r.json()) as MoneyCircuit) : null
  } catch {
    return null
  }
}

// ── THE PAYMENTS PANEL (M3, Aug 2): codes + the unattributed net ────────────
export interface PlatiAdmin {
  rezumat: {
    emise: number
    platite: number
    inAsteptare: number
    neatribuite: number
    recente: { code: string; email: string; amount: number; currency: string; status: string; createdAt: string; paidAt: string | null }[]
  } | null
  neatribuite: { id: number; bankRef: string; referinta: string; amount: number; currency: string; seenAt: string }[]
}
export async function fetchPlati(): Promise<PlatiAdmin | null> {
  try {
    const r = await fetch('/api/admin/plati', { credentials: 'include' })
    return r.ok ? ((await r.json()) as PlatiAdmin) : null
  } catch {
    return null
  }
}
/** Returns the server's verdict ('creditat' | 'deja' | 'negasit' | 'esec') —
 *  shown as-is, so a double credit REFUSED is never displayed as an error. */
export async function atribuiePlata(id: number, email: string): Promise<string> {
  try {
    const r = await fetch('/api/admin/plati/neatribuite/atribuie', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, email }),
    })
    const j = (await r.json().catch(() => ({}))) as { rezultat?: string }
    return j.rezultat ?? (r.ok ? 'creditat' : 'esec')
  } catch {
    return 'esec'
  }
}
export async function ignoraPlata(id: number): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/plati/neatribuite/ignora', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    return r.ok
  } catch {
    return false
  }
}
// AICI A STAT `fetchCardKey` — cheia efemera prin care se afisa numarul cardului
// virtual Stripe (Issuing Elements). It went away with the card: the component that
// folosea (CardReveal) a fost stearsa.

// AICI AU STAT `CardAddress`, `createAiCard`, `adminPayout` si `ownerDeposit` —
// crearea cardului virtual Stripe, retragerea profitului si depunerea in punga.
// Toate trei mergeau prin Stripe, iar Stripe a iesit pe 30 iul: userii platesc pe
// linkul Revolut, banii intra direct in contul lui Adrian, iar furnizorii se
// pay with his card. The back-end routes stay until the transition is confirmed
// live, but the interface no longer calls them.

// HERE STOOD `sellCredits` — X credits → a Stripe payment link for the user.
// Deleted together with Stripe (31 Jul): credit sales go through the unique
// code + Revolut transfer flow, and manual crediting stays on /api/admin/user.

// Owner adds money to, or withdraws money from, the provider-credit pool.
// Returns true on success so the caller can refresh the finance view.

// Market control (admin only): LIVE presence in the four install locations
// (checked against the real store pages, not dashboards) + the verifiable
// download log from our own /dl (who: email when signed in, else IP+country).
export interface StoreRow {
  key: string
  name: string
  store: string
  url: string
  listed: boolean
}
export interface DownloadRow {
  file: string
  user_email: string
  ip: string
  country: string
  created_at: string
}
export interface StoresData {
  stores: StoreRow[]
  downloads: { counts: { file: string; total: number }[]; recent: DownloadRow[] }
}

export async function fetchStores(): Promise<StoresData | null> {
  try {
    const r = await fetch('/api/admin/stores', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as StoresData
  } catch {
    return null
  }
}

// The persistent ORDER BOOK: every task sent to execution — what, when, and
// whether the builder picked it up. Survives every deploy (Postgres).
// Free-trial visitor analytics (admin only): the full professional picture —
// who (human/bot), from where (country/region/city/ISP), on what device, which
// browser, speaking what, and which ad brought them.


export async function fetchDemos(): Promise<DemoStats | null> {
  try {
    const r = await fetch('/api/admin/demos', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as DemoStats
  } catch {
    return null
  }
}

// Per-USER activity (admin only): who signed in, last IP/place/device, how
// long they stayed in total, and their latest sessions one by one.

export interface UserSessionRow {
  email: string
  started_at: string
  seconds: number
  actions: number
  ip: string
  city: string
  country: string
  code: string
  device: string
}

export interface UserActivity {
  users: UserActivityRow[]
  sessions: UserSessionRow[]
}

// Leads: visitors who left their email so the owner can reach them.
export interface Lead {
  id: number
  email: string
  note: string
  contacted: boolean
  created_at: string
}

export async function fetchLeads(): Promise<Lead[]> {
  try {
    const r = await fetch('/api/admin/leads', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { leads: Lead[] }).leads
  } catch {
    return []
  }
}

export async function emailLead(
  id: number,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/lead/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, to, subject, body }),
    })
    return r.ok
  } catch {
    return false
  }
}

// Live visitor chat — owner side (inbox + reply).
export interface VisitorConvo {
  conv_id: string
  last_text: string
  last_at: string
  total: number
  visitor_msgs: number
}
export interface VisitorMsg {
  id: number
  role: string
  text: string
  created_at: string
}

export async function fetchVisitorConvos(): Promise<VisitorConvo[]> {
  try {
    const r = await fetch('/api/admin/visitor-chats', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { convos: VisitorConvo[] }).convos
  } catch {
    return []
  }
}

export async function fetchVisitorChat(conv: string, after = 0): Promise<VisitorMsg[]> {
  try {
    const r = await fetch(
      `/api/admin/visitor-chat?conv=${encodeURIComponent(conv)}&after=${after}`,
      { credentials: 'include' },
    )
    if (!r.ok) return []
    return ((await r.json()) as { messages: VisitorMsg[] }).messages
  } catch {
    return []
  }
}

export async function replyVisitorChat(conv: string, text: string): Promise<number> {
  try {
    const r = await fetch('/api/admin/visitor-chat/reply', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conv, text }),
    })
    if (!r.ok) return 0
    return ((await r.json()) as { id: number }).id
  } catch {
    return 0
  }
}

// Admin action on a user: block / unblock / credit (amount) / delete.
// Returns the refreshed activity so the caller can update the list in place.
export async function manageUser(
  email: string,
  action: 'block' | 'unblock' | 'credit' | 'delete',
  amount?: number,
): Promise<UserActivity | null> {
  try {
    const r = await fetch('/api/admin/user', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action, amount }),
    })
    if (!r.ok) return null
    return (await r.json()) as UserActivity
  } catch {
    return null
  }
}

export interface InboundEmail {
  id: number
  from_addr: string
  from_name: string | null
  subject: string | null
  body: string | null
  reply: string | null
  replied: boolean
  received_at: string
}

export async function fetchInbound(): Promise<InboundEmail[]> {
  try {
    const r = await fetch('/api/admin/inbound', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { emails?: InboundEmail[] }).emails ?? []
  } catch {
    return []
  }
}

// LIVE INBOX — the REAL contact@kelionai.app mailbox read directly via IMAP (latest
// messages, read or not), so the admin sees everything in the box, not just new mail.
export interface MailboxLiveItem {
  uid: number
  from: string
  fromName: string
  subject: string
  date: string
  seen: boolean
}
export async function fetchMailboxLive(): Promise<MailboxLiveItem[]> {
  try {
    const r = await fetch('/api/admin/mailbox-live', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { emails?: MailboxLiveItem[] }).emails ?? []
  } catch {
    return []
  }
}

// Messages from the "Contact" form — always saved in the DB, visible even if
// emailul nu e configurat.
export interface ContactMessage {
  id: number
  name: string
  email: string
  subject: string
  message: string
  department: string
  lang: string
  emailed: boolean
  created_at: string
}

export async function fetchContactMessages(): Promise<ContactMessage[]> {
  try {
    const r = await fetch('/api/admin/contact-messages', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { messages?: ContactMessage[] }).messages ?? []
  } catch {
    return []
  }
}

export async function fetchActivity(): Promise<UserActivity | null> {
  try {
    const r = await fetch('/api/admin/activity', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as UserActivity
  } catch {
    return null
  }
}

export async function fetchUsers(): Promise<UserSummary[]> {
  const r = await fetch('/api/admin/users', { credentials: 'include' })
  if (!r.ok) return []
  const j = (await r.json()) as { users?: UserSummary[] }
  return j.users ?? []
}

export async function fetchHistory(email: string): Promise<HistoryRow[]> {
  const r = await fetch(`/api/admin/history?email=${encodeURIComponent(email)}`, {
    credentials: 'include',
  })
  if (!r.ok) return []
  const j = (await r.json()) as { history?: HistoryRow[] }
  return j.history ?? []
}

// Batch-translates a conversation's messages into Romanian (the "Translate to Romanian"
// button in the chat viewer). Returns translations aligned 1:1 with the input, plus
// `failed` — how many messages came back as the UNTRANSLATED ORIGINAL because the
// translation service failed for them (or the whole request failed, in which case
// failed = all). The caller must surface that count, not show it as a clean translation.
export interface TranslateRoResult {
  translations: string[]
  failed: number
}

export async function translateToRo(texts: string[]): Promise<TranslateRoResult> {
  if (texts.length === 0) return { translations: [], failed: 0 }
  try {
    const r = await fetch('/api/admin/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ texts, target: 'Romanian' }),
    })
    if (!r.ok) return { translations: texts, failed: texts.length }
    const j = (await r.json()) as { translations?: string[]; failed?: number }
    if (Array.isArray(j.translations) && j.translations.length === texts.length) {
      return { translations: j.translations, failed: typeof j.failed === 'number' ? j.failed : 0 }
    }
    return { translations: texts, failed: texts.length }
  } catch {
    return { translations: texts, failed: texts.length }
  }
}

// Capability gaps: things users asked for that Kelion can't do yet (admin only).
export interface CapabilityGap {
  id: number
  user_email: string
  request: string
  reason: string | null
  hits: number
  resolved: boolean
  escalated?: boolean
  // Kelion's autonomous decision: "DE IMPLEMENTAT: ..." / "ÎNCHIS AUTONOM: ...".
  triage?: string | null
  created_at: string
  last_seen: string
}

// Triggers Kelion's autonomous triage over all open gaps.
export async function runGapsTriage(): Promise<{ triaged: number; kept: number; closed: number } | null> {
  try {
    const r = await fetch('/api/admin/gaps/triage', { method: 'POST', credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as { triaged: number; kept: number; closed: number }
  } catch {
    return null
  }
}

// THE FALLS AUDIT (Adrian, Jul 27: "here you must see all the audits and
// all the falls") — the aggregate from /api/admin/audit, shown under gaps.
export interface AuditReport {
  health?: {
    ok?: boolean
    info?: Record<string, unknown>
    probleme?: { id: string; grav: string; desc: string; reparabil: string }[]
  }
  serverErrors?: { t: string; level: number; msg: string }[]
  clientErrors?: { created_at: string; user_email: string | null; message: string; n: string }[]
  failedJobs?: { id: number; order: string; updated: string }[]
}

export async function fetchAudit(): Promise<AuditReport | null> {
  try {
    const r = await fetch('/api/admin/audit', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as AuditReport
  } catch {
    return null
  }
}

export async function fetchGaps(all = false): Promise<CapabilityGap[]> {
  try {
    const r = await fetch(`/api/admin/gaps${all ? '?all=1' : ''}`, { credentials: 'include' })
    if (!r.ok) return []
    const j = (await r.json()) as { gaps?: CapabilityGap[] }
    return j.gaps ?? []
  } catch {
    return []
  }
}

export async function resolveGap(id: number, resolved = true): Promise<void> {
  try {
    await fetch('/api/admin/gaps/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, resolved }),
    })
  } catch {
    /* non-fatal */
  }
}

// Registered voiceprints (admin only).
export interface VoiceprintRow {
  email: string
  name: string
  gender: 'male' | 'female' | 'unknown'
  isAdmin: boolean
  hasAudio: boolean
  hasFace: boolean
  facePhoto: string
  updatedAt: string
}

export async function fetchVoiceprints(): Promise<VoiceprintRow[]> {
  try {
    const r = await fetch('/api/voiceprint/list', { credentials: 'include' })
    if (!r.ok) return []
    const j = (await r.json()) as { rows?: unknown[] }
    return (j.rows ?? []).map((row: unknown) => {
      const r = row as Record<string, unknown>
      return {
        email: String(r.email ?? ''),
        name: String(r.name ?? ''),
        gender: String(r.gender ?? 'unknown') as VoiceprintRow['gender'],
        isAdmin: Boolean(r.isAdmin ?? r.is_admin),
        hasAudio: Boolean(r.hasAudio ?? r.has_audio),
        hasFace: Boolean(r.hasFace ?? r.has_face),
        facePhoto: String(r.facePhoto ?? r.face_photo ?? ''),
        updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
      }
    })
  } catch {
    return []
  }
}

// A voiceprint's audio sample (data-URL) — for the „play” button in the panel.
export async function fetchVoiceprintAudio(email: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/voiceprint/audio?email=${encodeURIComponent(email)}`, {
      credentials: 'include',
    })
    if (!r.ok) return null
    const j = (await r.json()) as { clip?: string }
    return typeof j.clip === 'string' && j.clip ? j.clip : null
  } catch {
    return null
  }
}

export async function deleteVoiceprint(email: string): Promise<boolean> {
  try {
    const r = await fetch('/api/voiceprint/me', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return r.ok
  } catch {
    return false
  }
}

// ── Verificare tokenuri cu drepturi (admin only) ───────────────────────────
export interface TokenCheck {
  name: string
  status: 'ok' | 'not_configured' | 'fail' | `fail_${number}`
  detail?: string
  requiredScope?: string
}

export interface TokenChecksResult {
  ok: number
  notConfigured: number
  failed: number
  total: number
  checks: TokenCheck[]
}

/** Which keys the server sees RIGHT NOW. Answers "I've written them dozens of times"
 *  vs. "(not configured)": a written key doesn't automatically reach the process that
 *  runs. Contains NO values — only names, presence and length. */
export interface EnvCheckResult {
  vars: { name: string; what: string; present: boolean; length: number; breaks: string; foundAs?: string; accepts: string[] }[]
  /** Names of keys the server HAS, but which the code wasn't reading. */
  orphans: string[]
  summary: { total: number; lipsa: number; goale: number; nume: string[] }
  /** Process start time: a key written AFTER this is not loaded yet. */
  startedAt: string
}

export async function fetchEnvCheck(): Promise<EnvCheckResult | null> {
  try {
    const r = await fetch('/api/admin/env-check', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as EnvCheckResult
  } catch {
    return null
  }
}

export async function fetchTokenChecks(): Promise<TokenChecksResult | null> {
  try {
    const r = await fetch('/api/admin/token-checks', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as TokenChecksResult
  } catch {
    return null
  }
}
