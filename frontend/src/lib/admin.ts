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

// The owner's REAL money picture (admin only): live Stripe balance, real cost
// consumed, real profit, and per-AI cost. Replaces the old hand-typed pool.
export interface Finance {
  stripe: { available: number; pending: number; currency: string } | null
  loaded: number
  remaining: number
  spent: number
  profit: number
  currency: string
  byKind: Record<string, number>
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

// Owner adds money to, or withdraws money from, the provider-credit pool.
// Returns true on success so the caller can refresh the finance view.
export async function updatePool(amount: number, direction: 'add' | 'withdraw'): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/pool', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, direction }),
    })
    return r.ok
  } catch {
    return false
  }
}

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
export interface WorkOrder {
  id: string
  text: string
  status: string
  created_at: string
  delivered_at: string | null
}

export async function fetchWorkOrders(): Promise<WorkOrder[]> {
  try {
    const r = await fetch('/api/admin/workorders', { credentials: 'include' })
    if (!r.ok) return []
    const j = (await r.json()) as { orders?: WorkOrder[] }
    return j.orders ?? []
  } catch {
    return []
  }
}

// Free-trial visitor analytics (admin only): the full professional picture —
// who (human/bot), from where (country/region/city/ISP), on what device, which
// browser, speaking what, and which ad brought them.
export interface DemoRecent {
  kind: 'visit' | 'demo'
  ip: string
  country: string
  code: string
  city: string
  region: string
  isp: string
  browser: string
  os: string
  device: string
  lang: string
  referrer: string
  is_bot: boolean
  started_at: string
  // For a DEMO row: the throwaway email whose conversation the owner can open
  // (click the row). Empty for plain visits.
  session_email: string
  // Ce l-a interesat: prima întrebare/temă din proba demo. Gol la vizite simple.
  topic: string
}

export interface DemoStats {
  total: number
  today: number
  bots: number
  visitsTotal: number
  visitsToday: number
  byCountry: { country: string; code: string; count: number }[]
  recent: DemoRecent[]
}

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
export interface UserActivityRow {
  email: string
  sessions: number
  seconds: number
  actions: number
  messages: number
  last_seen: string
  last_ip: string
  city: string
  country: string
  code: string
  device: string
  browser: string
  blocked: boolean
  balance: number
}

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

// Approval gate: releases the server builder staged, awaiting the owner's OK.
export interface StagedRelease {
  id: string
  title: string
  detail: string
  branch?: string
  status: 'pending' | 'approved' | 'rejected' | 'deployed' | 'blocked'
  at: string
}

export async function fetchReleases(): Promise<StagedRelease[]> {
  try {
    const r = await fetch('/api/admin/releases', { credentials: 'include' })
    if (!r.ok) return []
    return ((await r.json()) as { releases?: StagedRelease[] }).releases ?? []
  } catch {
    return []
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

// INBOX LIVE — cutia REALĂ contact@kelionai.app citită direct prin IMAP (ultimele
// mesaje, citite sau nu), ca adminul să vadă tot ce e în cutie, nu doar mailul nou.
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

// Mesajele din formularul „Contact" — salvate mereu în DB, vizibile chiar dacă
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

export async function decideRelease(id: string, decision: 'approve' | 'reject'): Promise<void> {
  try {
    await fetch('/api/admin/releases/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, decision }),
    })
  } catch {
    /* non-fatal */
  }
}

export interface GithubTokenStatus {
  ok: boolean
  since: string | null
}

export async function fetchGithubTokenStatus(): Promise<GithubTokenStatus | null> {
  try {
    const r = await fetch('/api/admin/github-token-status', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as GithubTokenStatus
  } catch {
    return null
  }
}

export async function resetGithubToken(): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/github-token-reset', {
      method: 'POST',
      credentials: 'include',
    })
    return r.ok
  } catch {
    return false
  }
}

// The builder's full work journal (admin only) — the history the live monitor
// deliberately does not carry around.
export async function fetchDevLog(): Promise<string[]> {
  try {
    const r = await fetch('/api/admin/devlog', { credentials: 'include' })
    if (!r.ok) return []
    const j = (await r.json()) as { log?: string[] }
    return j.log ?? []
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

// Traduce în bloc mesajele unei conversații în română (butonul „Tradu în română"
// din vizualizarea chaturilor). Întoarce traducerile aliniate 1:1 cu intrarea;
// pe eroare, întoarce textele originale ca să nu se golească afișajul.
export async function translateToRo(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return []
  try {
    const r = await fetch('/api/admin/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ texts, target: 'Romanian' }),
    })
    if (!r.ok) return texts
    const j = (await r.json()) as { translations?: string[] }
    return Array.isArray(j.translations) && j.translations.length === texts.length ? j.translations : texts
  } catch {
    return texts
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
  created_at: string
  last_seen: string
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

// Escalate a gap to the developer via the bridge. Returns whether
// it was actually sent (online) so the UI can tell the admin to start the bridge.
export async function escalateGap(id: number): Promise<{ escalated: boolean; online: boolean }> {
  try {
    const r = await fetch('/api/admin/gaps/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id }),
    })
    if (!r.ok) return { escalated: false, online: false }
    return (await r.json()) as { escalated: boolean; online: boolean }
  } catch {
    return { escalated: false, online: false }
  }
}

// Triaj decizional: creierul verifică fiecare cerere deschisă — cele DEJA făcute
// se șterg, restul pleacă la constructor. Întoarce câte s-au curățat / trimis.
export async function triageGaps(): Promise<{ done: number; sent: number; offline?: boolean }> {
  try {
    const r = await fetch('/api/admin/gaps/triage', { method: 'POST', credentials: 'include' })
    if (!r.ok) return { done: 0, sent: 0 }
    return (await r.json()) as { done: number; sent: number; offline?: boolean }
  } catch {
    return { done: 0, sent: 0 }
  }
}

// Amprente vocale înregistrate (admin only).
export interface VoiceprintRow {
  email: string
  name: string
  gender: 'male' | 'female' | 'unknown'
  isAdmin: boolean
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
        updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
      }
    })
  } catch {
    return []
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

