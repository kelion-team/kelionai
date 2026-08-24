// THE HTTP CONTRACT with the backend, ONE SINGLE declaration (Batch A of
// PROCEDURA-REFACERE-CLONE.md): tipurile astea erau redeclarate identic aici
// and in the backend (98 duplicated lines). Now they come from the common source; a TYPE
// import, so it vanishes at compile time — it adds nothing to the bundle.
import type { MoneyCircuit, UserActivityRow } from '../../../backend/src/shared/api-types'
import { apiFetch } from './transport'
export type { MoneyCircuit, UserActivityRow }

export const ADMIN_TABS = [
  'finance',
  'users',
  'share',
  'stores',
  'inbox',
  'gesturi',
  'tokenuri',
  'constructor',
  'recuperare',
  'sistem',
  'erori',
  'notificari',
  'creier',
] as const

export type AdminTab = (typeof ADMIN_TABS)[number]

export function isAdminTab(value: unknown): value is AdminTab {
  return typeof value === 'string' && (ADMIN_TABS as readonly string[]).includes(value)
}

export interface HistoryRow {
  role: string
  content: string
  created_at: string
}

// The owner's REAL money picture (admin only): real cost consumed, real
// profit, and per-AI cost. No hand-typed figures.
  // Valorile sunt raportate de backend, fără solduri fabricate în client.
export interface Finance {
  // (`spent` și `profit` au fost SCOASE — auditul admin, 3 aug: tabul nu le
  // desena, iar sursa lor din backend inventa zerouri la eșec de DB.)
  /** The cost journal, unconverted (USD end to end) — the Money tab shows
   *  ONLY this, so "total" and "azi" can't be in two currencies anymore. */
  spentUsd: number
  currency: string
  byKind: Record<string, number>
  // Consumed TODAY at the AI providers (USD, real) — the "Spent today" card.
  today: number
  /** REAL vs ESTIMATE per row: only 'masurat' rows carry the provider's own
   *  figure; the rest are internal estimates and MUST be labeled as such. */
  masurat: number
  estimat: number
  felul: Record<string, 'masurat' | 'estimat'>
}



export async function fetchFinance(): Promise<Finance | null> {
  try {
    const r = await apiFetch('/api/admin/finance', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as Finance
  } catch {
    return null
  }
}

// ── CREDIT PER FURNIZOR AI, cu BEC (owner, 13 aug) ──────────────────────────
// Sursa bogată pe care backendul o calcula deja (crediteAI) dar frontendul n-o
// citea. `bec` vine derivat de pe server (o singură logică, testată): verde =
// are credit, roșu = fără (402/0), gri = nu pot verifica. `facturare` = pagina
// de reîncărcare a furnizorului (click-ul becului duce acolo).
export type BecCredit = 'verde' | 'rosu' | 'gri'
export interface CreditAIFurnizor {
  furnizor: string
  alimenteaza: string
  cheieConfigurata: boolean
  ramas: { masurat: boolean; valoare?: { cantitate: number; unitate: string }; motiv?: string }
  cheltuitLuna: { masurat: boolean; valoare?: { usd: number }; motiv?: string }
  serveste?: { masurat: boolean; valoare?: { da: boolean; detaliu?: string }; motiv?: string }
  facturare?: string
  bec: BecCredit
}

export async function fetchCreditAI(): Promise<CreditAIFurnizor[] | null> {
  try {
    const r = await apiFetch('/api/admin/credit-ai', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { furnizori: CreditAIFurnizor[] }
    return Array.isArray(j.furnizori) ? j.furnizori : null
  } catch {
    return null
  }
}

/** Clasa CSS a unui bec de credit. ROȘU (gol / 402) PÂLPÂIE — owner, 13 aug:
 *  „când e gol becul pâlpâie roșu"; e semnalul că exact acolo trebuie pus credit.
 *  Verde/gri stau liniștite. O singură definiție, folosită și în bară, și în admin. */
export function clasaBec(bec: string): string {
  return `bec bec-${bec}${bec === 'rosu' ? ' palpaie' : ''}`
}

// ── Evaluarea unui ordin de constructor (owner, 13 aug) ─────────────────────
export interface EvalRandAI {
  cheie: 'openai' | 'codex_worker'
  nume: string
  descriere: string
  scor: number
  potrivire: string
  bec: 'verde' | 'rosu' | 'gri' | null
}
export interface EvalConstructor {
  trece: boolean
  motiv: string
  capacitatiNecesare: string[]
  clasament: EvalRandAI[]
  aiRecomandat: 'openai' | 'codex_worker' | null
}

/** Evaluează cerința ÎNAINTE de trimitere: poarta de calitate + AI-urile potrivite
 *  pe capacitate, cu credit live. `null` dacă apelul pică (nu inventăm verdict). */
export async function evalueazaOrdinConstructor(order: string): Promise<EvalConstructor | null> {
  try {
    const r = await apiFetch('/api/admin/constructor/evalueaza', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!r.ok) return null
    return (await r.json()) as EvalConstructor
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
// (pauzaAutonomie a MURIT pe 16 aug — LEGEA ownerului: autonomia pornită
// permanent, fără off; ruta de pe server a rămas doar ca răspuns cinstit.)

export async function fetchMoneyCircuit(): Promise<MoneyCircuit | null> {
  try {
    const r = await apiFetch('/api/admin/money-circuit', { credentials: 'include' })
    return r.ok ? ((await r.json()) as MoneyCircuit) : null
  } catch {
    return null
  }
}

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
  created_at: string
}
export interface StoresData {
  stores: StoreRow[]
  /** `dbOk:false` = jurnalul de descărcări NU s-a putut citi (auditul admin,
   *  3 aug) — counts goale nu înseamnă atunci „nicio descărcare". */
  downloads: { dbOk: boolean; counts: { file: string; total: number }[]; recent: DownloadRow[] }
}

export async function fetchStores(): Promise<StoresData | null> {
  try {
    const r = await apiFetch('/api/admin/stores', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as StoresData
  } catch {
    return null
  }
}

// Per-USER activity (admin only): who signed in, device class and how
// long they stayed in total — UN rând pe adresă, cu device-urile dedesubt
// (P6, 15 aug; lista plată de sesiuni care repeta același om a fost scoasă).

export interface UserActivity {
  users: UserActivityRow[]
}

// Admin action on a user: block / unblock / credit (minor units) / delete.
// Returns the refreshed activity so the caller can update the list in place.
export async function manageUser(
  email: string,
  action: 'block' | 'unblock' | 'credit' | 'delete',
  amountMinor?: number,
): Promise<UserActivity | null> {
  try {
    const r = await apiFetch('/api/admin/user', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action, amountMinor }),
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

// null = citirea a EȘUAT (auditul admin, 3 aug: o sesiune expirată vopsea
// simultan trei secțiuni din Inbox ca „goale" — trei ❌ dintr-un singur apel).
export async function fetchInbound(): Promise<InboundEmail[] | null> {
  try {
    const r = await apiFetch('/api/admin/inbound', { credentials: 'include' })
    if (!r.ok) return null
    return ((await r.json()) as { emails?: InboundEmail[] }).emails ?? []
  } catch {
    return null
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
/** Răspunsul cutiei spune și DE CE e goală lista (auditul admin, 3 aug):
 *  `ok:false` + `motiv` ('mail_neconfigurat' sau eroarea IMAP) = citire
 *  eșuată; `ok:true` + emails [] = INBOX-ul chiar e gol. null = ruta însăși
 *  a picat (rețea/403/500). Trei stări, trei texte în panou. */
export interface MailboxLiveResult {
  ok: boolean
  motiv: string | null
  emails: MailboxLiveItem[]
}
export async function fetchMailboxLive(): Promise<MailboxLiveResult | null> {
  try {
    const r = await apiFetch('/api/admin/mailbox-live', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as Partial<MailboxLiveResult>
    return { ok: j.ok === true, motiv: j.motiv ?? null, emails: j.emails ?? [] }
  } catch {
    return null
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

// null = citirea a EȘUAT (auditul admin, 3 aug) — nu „Niciun mesaj de contact".
export async function fetchContactMessages(): Promise<ContactMessage[] | null> {
  try {
    const r = await apiFetch('/api/admin/contact-messages', { credentials: 'include' })
    if (!r.ok) return null
    return ((await r.json()) as { messages?: ContactMessage[] }).messages ?? []
  } catch {
    return null
  }
}

export async function fetchActivity(): Promise<UserActivity | null> {
  try {
    const r = await apiFetch('/api/admin/activity', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as UserActivity
  } catch {
    return null
  }
}

// AUDIT ADMIN (3 aug): fetchUsers/fetchHistory erau SINGURELE funcții de aici
// fără try/catch — o eroare de rețea arunca (loading blocat pe veci +
// unhandled rejection), iar un 403/500 colapsa în [] („No history yet." /
// „Nu a scris niciun mesaj" pentru o citire picată). null = eșec, spus ca atare.
export async function fetchHistory(email: string): Promise<HistoryRow[] | null> {
  try {
    const r = await apiFetch(`/api/admin/history?email=${encodeURIComponent(email)}`, {
      credentials: 'include',
    })
    if (!r.ok) return null
    const j = (await r.json()) as { history?: HistoryRow[] }
    return j.history ?? []
  } catch {
    return null
  }
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
    const r = await apiFetch('/api/admin/translate', {
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

// ── LISTA DE ERORI, CE E FIECARE (Adrian, 12 aug) ──────────────────────────────
// Fața vizuală a autodiagnosticului: erorile din browser (grupate) + defectele de
// sistem, fiecare cu „ce este". null = citirea a EȘUAT (nu confunda „n-am putut
// citi" cu „nicio eroare" — tiparul tabului admin, 3 aug).
export type SeveritateEroare = 'critic' | 'important' | 'minor'
export interface EroareBrowser {
  text: string
  ceEste: string
  severitate: SeveritateEroare
  categorie: string
  cate: number
  cine: string | null
  cand: string
}
export interface ProblemaSistem {
  sursa: 'server' | 'ordin'
  text: string
  ceEste: string
  severitate: SeveritateEroare
  categorie: string
}
export interface EroriAdmin {
  browser: EroareBrowser[]
  sistem: ProblemaSistem[]
}
export async function fetchErori(): Promise<EroriAdmin | null> {
  try {
    const r = await apiFetch('/api/admin/erori', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as Partial<EroriAdmin>
    return { browser: j.browser ?? [], sistem: j.sistem ?? [] }
  } catch {
    return null
  }
}

// ── NOTIFICĂRI PENTRU OWNER (K14) ──────────────────────────────────────────────
// Cereri noi care cer atenția: plată neatribuită, cerere neacoperită. null =
// citirea a EȘUAT (nu „zero notificări").
export interface NotificareAdmin {
  id: number
  type: 'scris' | 'voce' | 'plata_neatribuita'
  title: string
  message: string
  read: boolean
  createdAt: string
}
export async function fetchNotificari(): Promise<NotificareAdmin[] | null> {
  try {
    const r = await apiFetch('/api/admin/notificari', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { notificari?: NotificareAdmin[] }
    return j.notificari ?? []
  } catch {
    return null
  }
}
export async function markNotificareCitit(id: number): Promise<boolean> {
  try {
    const r = await apiFetch(`/api/admin/notificari/${id}/citit`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return false
    const j = (await r.json()) as { ok?: boolean }
    return !!j.ok
  } catch {
    return false
  }
}

// ── CONFIGURAȚIA CREIERULUI OPENAI ─────────────────────────────────────────
export interface CreierModel {
  id: string
  nume: string
  tag?: string
  isAuto?: boolean
  isCustom?: boolean
}
export interface CreierAdmin {
  activ: 'openai'
  modelCustom: string
  modele: CreierModel[]
}
export async function fetchCreier(): Promise<CreierAdmin | null> {
  try {
    const r = await apiFetch('/api/admin/creier', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as CreierAdmin
  } catch {
    return null
  }
}

export interface CodexAdmin {
  worker: {
    state: 'ready' | 'offline' | 'setup_required' | 'unknown'
    lastHeartbeat: string | null
  }
  setupInstructions: string | null
  taskUrl: string | null
  status: string | null
  internalCostUsd: number | null
}

export function codexTaskUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const u = new URL(value)
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.hostname !== 'chatgpt.com' ||
      !u.pathname.startsWith('/codex/')
    ) return null
    return u.toString()
  } catch {
    return null
  }
}

const CODEX_WORKER_STATES = new Set(['ready', 'offline', 'setup_required', 'unknown'])

/** Starea workerului Codex separat. Loginul și credentialele rămân în worker. */
export async function fetchCodexAdmin(): Promise<CodexAdmin | null> {
  try {
    const r = await apiFetch('/api/admin/codex', { cache: 'no-store' })
    if (!r.ok) return null
    const raw = (await r.json()) as Record<string, unknown>
    const workerRaw = raw.worker && typeof raw.worker === 'object'
      ? raw.worker as Record<string, unknown>
      : {}
    const state = typeof workerRaw.state === 'string' && CODEX_WORKER_STATES.has(workerRaw.state)
      ? workerRaw.state as CodexAdmin['worker']['state']
      : 'unknown'
    const internalCost = typeof raw.internalCostUsd === 'number'
      ? raw.internalCostUsd
      : null
    const heartbeat = typeof workerRaw.lastHeartbeat === 'string' &&
      Number.isFinite(Date.parse(workerRaw.lastHeartbeat))
      ? workerRaw.lastHeartbeat.slice(0, 64)
      : null
    return {
      worker: {
        state,
        lastHeartbeat: heartbeat,
      },
      setupInstructions: typeof raw.setupInstructions === 'string'
        ? raw.setupInstructions.slice(0, 1_000)
        : null,
      taskUrl: codexTaskUrl(raw.taskUrl),
      status: typeof raw.status === 'string' ? raw.status.slice(0, 240) : null,
      internalCostUsd: internalCost !== null && Number.isFinite(internalCost) && internalCost >= 0
        ? internalCost
        : null,
    }
  } catch {
    return null
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
    const r = await apiFetch('/api/admin/env-check', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as EnvCheckResult
  } catch {
    return null
  }
}

export async function fetchTokenChecks(): Promise<TokenChecksResult | null> {
  try {
    const r = await apiFetch('/api/admin/token-checks', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as TokenChecksResult
  } catch {
    return null
  }
}
