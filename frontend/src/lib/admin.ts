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

export interface CostSummary {
  total: number
  today: number
  byKind: Record<string, number>
}

export async function fetchCosts(): Promise<CostSummary | null> {
  try {
    const r = await fetch('/api/admin/costs', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as CostSummary
  } catch {
    return null
  }
}

// The owner's REAL money picture (admin only): live Stripe balance, real cost
// consumed, real profit, and per-AI cost. Replaces the old hand-typed pool.
export interface Finance {
  stripe: { available: number; pending: number; currency: string } | null
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

// Approval gate: releases the server builder staged, awaiting the owner's OK.
export interface StagedRelease {
  id: string
  title: string
  detail: string
  status: 'pending' | 'approved' | 'rejected' | 'deployed'
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

// Claude's full work journal (admin only) — the history the live monitor
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

// Capability gaps: things users asked for that Kelion can't do yet (admin only).
export interface CapabilityGap {
  id: number
  user_email: string
  request: string
  reason: string | null
  hits: number
  resolved: boolean
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

// Escalate a gap to the developer (Claude Code) via the bridge. Returns whether
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

