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

