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
  `)
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
