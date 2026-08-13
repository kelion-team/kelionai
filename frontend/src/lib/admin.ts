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

// The owner's REAL money picture (admin only): real cost consumed, real
// profit, and per-AI cost. No hand-typed figures.
// (Stripe is fully out — 31 Jul. „Punga" — soldul OpenRouter — și cheltuiala
// OpenAI au fost EXTIRPATE pe 3 aug, împreună cu furnizorii.)
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
    const r = await fetch('/api/admin/finance', { credentials: 'include' })
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
    const r = await fetch('/api/admin/credit-ai', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { furnizori: CreditAIFurnizor[] }
    return Array.isArray(j.furnizori) ? j.furnizori : null
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
export interface CodNeplatit {
  code: string
  email: string
  amount: number
  currency: string
  status: string
  createdAt: string
  expirata: boolean
}

export interface PlataIncasata {
  code: string
  email: string
  amount: number
  currency: string
  paidAt: string
  bankRef: string
}

export interface TotaluriPlati {
  totalAzi: number
  totalLunaAsta: number
  moneda: string
}

export interface PlatiAdmin {
  rezumat: {
    emise: number
    platite: number
    inAsteptare: number
    neatribuite: number
    recente: { code: string; email: string; amount: number; currency: string; status: string; createdAt: string; paidAt: string | null }[]
  } | null
  /** null = citirea plasei a EȘUAT — se scrie ca eșec, niciodată ca „Nimic în plasă"; [] = plasa e chiar goală. */
  neatribuite: { id: number; bankRef: string; referinta: string; amount: number; currency: string; seenAt: string }[] | null
  coduriNeplatite: CodNeplatit[] | null
  platiIncasate: PlataIncasata[] | null
  totaluri: TotaluriPlati | null
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
  /** `dbOk:false` = jurnalul de descărcări NU s-a putut citi (auditul admin,
   *  3 aug) — counts goale nu înseamnă atunci „nicio descărcare". */
  downloads: { dbOk: boolean; counts: { file: string; total: number }[]; recent: DownloadRow[] }
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

// null = citirea a EȘUAT (auditul admin, 3 aug) — tabul o scrie ca eșec,
// nu ca „Niciun contact încă".
export async function fetchLeads(): Promise<Lead[] | null> {
  try {
    const r = await fetch('/api/admin/leads', { credentials: 'include' })
    if (!r.ok) return null
    return ((await r.json()) as { leads: Lead[] }).leads
  } catch {
    return null
  }
}

/** Verdictul MĂSURAT al trimiterii (auditul admin, 3 aug): vechiul boolean
 *  colapsa 400 (adresă/subiect invalide) cu 502 (SMTP a refuzat) și cu rețeaua
 *  picată, iar alerta inventa cauza „verifică MAIL_PASS". Acum alerta spune ce
 *  s-a măsurat: 'ok' | 'bad_request' | 'send_failed' | 'network'. */
export async function emailLead(
  id: number,
  to: string,
  subject: string,
  body: string,
): Promise<'ok' | 'bad_request' | 'send_failed' | 'network'> {
  try {
    const r = await fetch('/api/admin/lead/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, to, subject, body }),
    })
    if (r.ok) return 'ok'
    return r.status === 400 ? 'bad_request' : 'send_failed'
  } catch {
    return 'network'
  }
}

// (Chat live vizitatori — SCOS 10 aug: tabul a fost eliminat din admin #959,
// iar funcțiile lib rămăseseră cod mort. Curățate ca poarta „exporturi fără
// utilizator" să fie verde.)

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

// null = citirea a EȘUAT (auditul admin, 3 aug: o sesiune expirată vopsea
// simultan trei secțiuni din Inbox ca „goale" — trei ❌ dintr-un singur apel).
export async function fetchInbound(): Promise<InboundEmail[] | null> {
  try {
    const r = await fetch('/api/admin/inbound', { credentials: 'include' })
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
    const r = await fetch('/api/admin/mailbox-live', { credentials: 'include' })
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
    const r = await fetch('/api/admin/contact-messages', { credentials: 'include' })
    if (!r.ok) return null
    return ((await r.json()) as { messages?: ContactMessage[] }).messages ?? []
  } catch {
    return null
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

// AUDIT ADMIN (3 aug): fetchUsers/fetchHistory erau SINGURELE funcții de aici
// fără try/catch — o eroare de rețea arunca (loading blocat pe veci +
// unhandled rejection), iar un 403/500 colapsa în [] („No history yet." /
// „Nu a scris niciun mesaj" pentru o citire picată). null = eșec, spus ca atare.
export async function fetchUsers(): Promise<UserSummary[] | null> {
  try {
    const r = await fetch('/api/admin/users', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { users?: UserSummary[] }
    return j.users ?? []
  } catch {
    return null
  }
}

export async function fetchHistory(email: string): Promise<HistoryRow[] | null> {
  try {
    const r = await fetch(`/api/admin/history?email=${encodeURIComponent(email)}`, {
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
// `error` PĂSTRAT în tip (auditul admin, 3 aug): backend-ul răspunde 200 și
// când creierul pică ({triaged:0, error:'brain_unavailable'|'bad_brain_json'})
// — vechiul tip îl tăia și butonul tăcea, indiferent de rezultat.
// (runGapsTriage / fetchAudit + AuditReport — SCOS 10 aug: cod mort după
// curățarea adminului #959; niciun apelant. `fetchGaps` de mai jos rămâne, e viu.)

// null = citirea a EȘUAT (auditul admin, 3 aug): contractul tabului e „a
// dispărut = auto-rezolvat", deci un [] fals pe 403/500 se citea ca „totul
// rezolvat" și refresh-ul de 15s ȘTERGEA lista bună de pe ecran.
export async function fetchGaps(all = false): Promise<CapabilityGap[] | null> {
  try {
    const r = await fetch(`/api/admin/gaps${all ? '?all=1' : ''}`, { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { gaps?: CapabilityGap[] }
    return j.gaps ?? []
  } catch {
    return null
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
    const r = await fetch('/api/admin/erori', { credentials: 'include' })
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
    const r = await fetch('/api/admin/notificari', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { notificari?: NotificareAdmin[] }
    return j.notificari ?? []
  } catch {
    return null
  }
}
export async function markNotificareCitit(id: number): Promise<boolean> {
  try {
    const r = await fetch(`/api/admin/notificari/${id}/citit`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return false
    const j = (await r.json()) as { ok?: boolean }
    return !!j.ok
  } catch {
    return false
  }
}

// ── PLAFONUL ZILNIC DE ARDERE (B8/K15) ─────────────────────────────────────────
export interface PlafonConstructor {
  activ: boolean
  plafon: number
  cheltuit: number
}
export async function fetchPlafon(): Promise<PlafonConstructor | null> {
  try {
    const r = await fetch('/api/admin/plafon-constructor', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as PlafonConstructor
  } catch {
    return null
  }
}
export async function setPlafon(body: { plafon?: number; activ?: boolean }): Promise<PlafonConstructor | null> {
  try {
    const r = await fetch('/api/admin/plafon-constructor', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    return (await r.json()) as PlafonConstructor
  } catch {
    return null
  }
}

// (resolveGap — SCOS 10 aug: cod mort după curățarea adminului #959, niciun apelant.)

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

// null = citirea a EȘUAT (auditul admin, 3 aug) — o pană de DB/rețea nu mai
// arată identic cu „chiar nu există amprente" (factorul de voce al ownerului).
export async function fetchVoiceprints(): Promise<VoiceprintRow[] | null> {
  try {
    const r = await fetch('/api/voiceprint/list', { credentials: 'include' })
    if (!r.ok) return null
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
    return null
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
    if (!r.ok) return false
    // CORPUL, nu doar statusul (auditul admin, 3 aug): backend-ul răspunde
    // 200 cu {ok:false} când DELETE-ul din DB pică — rândul dispărea din
    // listă „șters" și reapărea la refresh-ul de 10s.
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null
    return j?.ok === true
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

// ── Cereri neacoperite & Plăți neatribuite ──────────────────────────────
export interface PlataNeatribuita {
  id: number
  suma: number
  moneda: string
  referinta: string | null
  banca: string | null
  status: string
  detalii?: string | null
  created_at: string
}

export interface CodNeplatit {
  cod: string
  user_email: string
  suma: number
  status: string
  created_at: string
}

// (CereriNeacoperiteData / fetchCereriNeacoperite — SCOS 10 aug: cod mort după
// curățarea adminului #959, niciun apelant.)
