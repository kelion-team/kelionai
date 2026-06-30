import pg from 'pg'
import { config } from './config.js'

let pool: pg.Pool | null = null

export function dbEnabled(): boolean {
  return Boolean(config.databaseUrl)
}

function getPool(): pg.Pool {
  if (!pool) {
    const url = config.databaseUrl
    // Railway's private network (*.railway.internal) doesn't use TLS; the public
    // proxy does (self-signed).
    const ssl = url.includes('railway.internal') ? false : { rejectUnauthorized: false }
    pool = new pg.Pool({ connectionString: url, ssl })
  }
  return pool
}

export async function initDb(): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user_email, created_at);
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_email TEXT PRIMARY KEY,
      speech_lang TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cost_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      cost_usd DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_events (created_at);
  `)
}

// Record the real provider cost of one AI call (admin-only accounting).
export async function recordCost(email: string, kind: string, costUsd: number): Promise<void> {
  if (!dbEnabled() || !(costUsd > 0)) return
  try {
    await getPool().query(
      'INSERT INTO cost_events (user_email, kind, cost_usd) VALUES ($1, $2, $3)',
      [email, kind, costUsd],
    )
  } catch {
    // Never break a request because metering failed.
  }
}

export interface CostSummary {
  total: number
  today: number
  byKind: Record<string, number>
}

export async function getCostSummary(): Promise<CostSummary> {
  const empty: CostSummary = { total: 0, today: 0, byKind: {} }
  if (!dbEnabled()) return empty
  try {
    const pool = getPool()
    const totals = await pool.query<{ total: string | null; today: string | null }>(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS total,
         COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today
       FROM cost_events`,
    )
    const kinds = await pool.query<{ kind: string; sum: string }>(
      'SELECT kind, SUM(cost_usd) AS sum FROM cost_events GROUP BY kind',
    )
    const byKind: Record<string, number> = {}
    for (const r of kinds.rows) byKind[r.kind] = Number(r.sum)
    return {
      total: Number(totals.rows[0]?.total ?? 0),
      today: Number(totals.rows[0]?.today ?? 0),
      byKind,
    }
  } catch {
    return empty
  }
}

// Per-user speech language — persists across sessions for as long as the user
// exists. Returns null when unset (the client then auto-detects).
export async function getSpeechLang(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ speech_lang: string | null }>(
      'SELECT speech_lang FROM user_prefs WHERE user_email = $1',
      [email],
    )
    return r.rows[0]?.speech_lang ?? null
  } catch {
    return null
  }
}

export async function setSpeechLangPref(email: string, lang: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO user_prefs (user_email, speech_lang, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_email) DO UPDATE SET speech_lang = $2, updated_at = now()`,
      [email, lang],
    )
  } catch {
    // Never break the chat because persistence failed.
  }
}

export async function saveMessage(
  email: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  if (!dbEnabled() || !content.trim()) return
  try {
    await getPool().query(
      'INSERT INTO messages (user_email, role, content) VALUES ($1, $2, $3)',
      [email, role, content],
    )
  } catch {
    // Never break the chat because persistence failed.
  }
}

export interface UserSummary {
  email: string
  count: number
  last: string
}

export async function listUsers(): Promise<UserSummary[]> {
  if (!dbEnabled()) return []
  const r = await getPool().query<UserSummary>(
    `SELECT user_email AS email, COUNT(*)::int AS count, MAX(created_at) AS last
     FROM messages GROUP BY user_email ORDER BY last DESC`,
  )
  return r.rows
}

export interface HistoryRow {
  role: string
  content: string
  created_at: string
}

export async function getHistory(email: string, limit = 1000): Promise<HistoryRow[]> {
  if (!dbEnabled()) return []
  const r = await getPool().query<HistoryRow>(
    `SELECT role, content, created_at FROM messages
     WHERE user_email = $1 ORDER BY created_at ASC LIMIT $2`,
    [email, limit],
  )
  return r.rows
}
