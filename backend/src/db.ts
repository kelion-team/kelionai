import pg from 'pg'
import { config } from './config.js'
import { embedText, embeddingsEnabled, cosine } from './services/embeddings.js'

let pool: pg.Pool | null = null

export function dbEnabled(): boolean {
  return Boolean(config.databaseUrl)
}

function getPool(): pg.Pool {
  if (!pool) {
    const url = config.databaseUrl
    // Local/no-TLS Postgres (VPS pe aceeași mașină, sslmode=disable explicit)
    // se conectează fără SSL; orice altă țintă primește TLS cu certificat
    // self-signed acceptat (proxy-uri gestionate).
    const noTls = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)
    const ssl = noTls ? false : { rejectUnauthorized: false }
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
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS meserie_activa INTEGER;
    -- Amprente vocale: timbru + gen + flag admin per cont.
    -- vectorul e normalizat client-side; meta păstrează valorile brute pentru debug.
    CREATE TABLE IF NOT EXISTS voiceprints (
      user_email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'unknown',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      features DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
      feature_meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_voiceprints_admin ON voiceprints (is_admin, updated_at DESC);
    -- CLIP AUDIO (Adrian, 14 iul: „trebuie să am buton play să aud vocea"): pe
    -- lângă vectorul de identificare ținem și o mostră audio scurtă (data-URL
    -- webm/opus, câteva secunde) a ultimei fraze, ca adminul s-o poată ASCULTA
    -- din panou. Doar admin o citește; nu iese niciodată în chat.
    ALTER TABLE voiceprints ADD COLUMN IF NOT EXISTS audio_clip TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS faceprints (
      user_email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      descriptor DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
      photo TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_faceprints_admin ON faceprints (is_admin, updated_at DESC);
    CREATE TABLE IF NOT EXISTS cost_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      cost_usd DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_events (created_at);
    -- Cross-session memory: durable facts Kelion learns about each user and
    -- recalls in later conversations (the Memory agent writes here).
    -- the agent column namespaces memory: Kelion keeps its own (kelion), and each
    -- specialist agent (secretary/navigator/researcher) keeps a SEPARATE memory.
    CREATE TABLE IF NOT EXISTS memories (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT 'kelion',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent TEXT NOT NULL DEFAULT 'kelion';
    DROP INDEX IF EXISTS uniq_memory;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory ON memories (user_email, agent, content);
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_email, agent, last_seen DESC);
    -- CĂUTARE REALĂ ÎN MEMORIE (Adrian, 11 iul: „calitatea memoriei" — ILIKE pe
    -- substring exact rata orice reformulare). Full-text nativ Postgres:
    -- config 'simple' (fără dicționar de limbă — tokenizează orice text ro/en
    -- mixat, fără să presupună o singură limbă), indexat GIN pentru viteză la
    -- multe amintiri. Nu e embeddings/AI (ar cere pgvector + apel API pe scriere,
    -- cost și risc de infra neconfirmată) — dar e potrivire pe CUVINTE reale, cu
    -- scor de relevanță, nu doar un substring literal.
    CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories
      USING GIN (to_tsvector('simple', content));
    -- MEMORIE SEMANTICĂ (12 iul, foaia de parcurs #5): vectorul de înțeles al
    -- amintirii (Gemini text-embedding-004), scris asincron la învățare.
    -- JSONB, nu pgvector: fără extensii de instalat, cosine se calculează în
    -- Node peste ultimele câteva sute — la volumul actual e instant.
    ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding JSONB;
    -- Prepaid credit wallet (Stripe). Balance is in the display currency (GBP);
    -- topup_ref = the credited amount of the LAST top-up, so we can show the
    -- "% of credit left" for the escalating low-credit alerts (30/20/10/5%).
    CREATE TABLE IF NOT EXISTS wallets (
      user_email TEXT PRIMARY KEY,
      balance NUMERIC(14,6) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'gbp',
      topup_ref NUMERIC(14,6) NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS topup_ref NUMERIC(14,6) NOT NULL DEFAULT 0;
    -- The owner's provider-credit pool (REAL money): the admin loads it; every
    -- AI call's real cost draws it down. remaining = loaded − total cost. Singleton.
    CREATE TABLE IF NOT EXISTS admin_pool (
      id INT PRIMARY KEY DEFAULT 1,
      loaded NUMERIC(14,6) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'gbp',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO admin_pool (id, loaded) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    -- Free-trial usage: one row per demo started — enforces the daily cost cap
    -- and a light anti-reuse (a fingerprint or IP that already tried is refused).
    CREATE TABLE IF NOT EXISTS demo_uses (
      id BIGSERIAL PRIMARY KEY,
      fingerprint TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS isp TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS tz TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS os TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS referrer TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
    -- The trial's throwaway session email — the LINK to its conversation in the
    -- messages table, so the owner can click a trial and read what interested it.
    ALTER TABLE demo_uses ADD COLUMN IF NOT EXISTS session_email TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_demo_fp ON demo_uses (fingerprint, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_demo_started ON demo_uses (started_at DESC);
    -- EVERY visitor who opens the site (not just demo starters) — the owner's
    -- real traffic analytics. Same profile columns as demo_uses.
    CREATE TABLE IF NOT EXISTS visits (
      id BIGSERIAL PRIMARY KEY,
      fingerprint TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      isp TEXT NOT NULL DEFAULT '',
      tz TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT '',
      referrer TEXT NOT NULL DEFAULT '',
      is_bot BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_visits_started ON visits (started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_visits_fp ON visits (fingerprint, started_at DESC);
    -- Per-USER analytics: tie a visit to the signed-in account, measure how
    -- long they stayed (presence pings move last_seen_at) and how active they
    -- were. The owner sees WHO was on, from what IP/place, and for how long.
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS user_email TEXT NOT NULL DEFAULT '';
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS actions INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_visits_email ON visits (user_email, last_seen_at DESC);
    -- Ledger of top-ups (+) and usage (−). stripe_ref makes top-ups idempotent
    -- so a webhook retry can never double-credit.
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      stripe_ref TEXT,
      meta TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_ref ON billing_events (stripe_ref) WHERE stripe_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_events (user_email, created_at DESC);
    -- STRIPE + CREDITS (ORDIN #6G): tabelă dedicată tranzacțiilor de cumpărare a creditelor.
    -- user_id = emailul utilizatorului (identificatorul unic folosit în tot sistemul).
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      credits NUMERIC(14,6) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_payment_intent_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status, created_at DESC);
    -- Capability gaps: things users asked for that Kelion CANNOT do yet. Kelion
    -- logs them here (via the log_unsupported_request tool); only the owner/admin
    -- reads them, to prioritise what to build next. Never shown to end users.
    CREATE TABLE IF NOT EXISTS capability_gaps (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      request TEXT NOT NULL,
      reason TEXT,
      hits INT NOT NULL DEFAULT 1,
      resolved BOOLEAN NOT NULL DEFAULT false,
      escalated BOOLEAN NOT NULL DEFAULT false,
      escalated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_gaps_open ON capability_gaps (resolved, last_seen DESC);
    -- Explicit user notes ("reține asta", "salvează-mi X") — distinct from the
    -- memories table: memories are auto-learned facts Kelion recalls silently;
    -- notes are things the user deliberately asked to save and can list/delete.
    CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_email, created_at DESC);
    -- INBOUND EMAIL (row 19): every message that lands in the contact@ mailbox,
    -- stored with the Secretary's drafted/sent reply, so the admin SEES what came
    -- in and how Kelion answered. uid is the IMAP UID (dedupe — never reply twice).
    CREATE TABLE IF NOT EXISTS inbound_emails (
      id BIGSERIAL PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      from_addr TEXT NOT NULL,
      from_name TEXT,
      subject TEXT,
      body TEXT,
      reply TEXT,
      replied BOOLEAN NOT NULL DEFAULT false,
      lang TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_inbound_recent ON inbound_emails (received_at DESC);
    -- SHARED MEMORY ("caietul comun"): the single brain shared by BOTH sides —
    -- the laptop builder and the always-on server bridge. Either writes an entry;
    -- both read the latest entries. This is how "write here, appears there; write
    -- there, appears here" works: one store, two readers/writers.
    CREATE TABLE IF NOT EXISTS shared_memory (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_shared_mem ON shared_memory (created_at DESC);
    -- Installer downloads from OUR site (/dl/*.exe|.apk) — the verifiable
    -- download log: WHO (email when signed in, else IP + country), WHAT, WHEN.
    -- Store installs are aggregate-only via the stores' own APIs; no store ever
    -- exposes downloader identities.
    CREATE TABLE IF NOT EXISTS app_downloads (
      id BIGSERIAL PRIMARY KEY,
      file TEXT NOT NULL,
      user_email TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      ua TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_file ON app_downloads (file, created_at DESC);
    -- Persistent store for images generated by Kelion (audit 9 iul 2026).
    -- Survival through redeployments: instead of in-memory Map, we use the DB.
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- App installers stored for delivery (master lives on the Linux server; the
    -- builder uploads the freshest bytes here so the QR always serves latest).
    CREATE TABLE IF NOT EXISTS app_files (
      name TEXT PRIMARY KEY,
      content BYTEA NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- WORK ORDERS for the builder — in POSTGRES because the old in-memory queue
    -- was WIPED by every deploy (the admin's "am trimis la execuție" orders
    -- silently vanished). Persisted = an order can never be lost again, and the
    -- admin can SEE the whole queue + its history in the panel.
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_workorders ON work_orders (status, created_at DESC);
    -- STAGED RELEASES (the approval gate) — persisted for the same reason: a
    -- pending release must survive a backend restart, or the owner approves
    -- into thin air.
    CREATE TABLE IF NOT EXISTS staged_releases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      approved_at TIMESTAMPTZ,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- DRIFT DE SCHEMĂ REAL (12 iul, prins de purge-phantom: eroare Postgres
    -- 42703 „column branch does not exist"): tabelul a fost creat înainte ca
    -- branch să fie adăugat în definiție, iar CREATE TABLE IF NOT EXISTS
    -- e un no-op pe un tabel deja existent — coloana rămăsese lipsă pe
    -- producție de la introducerea ei. Plasă de siguranță, ca la memories.
    ALTER TABLE staged_releases ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT '';
    -- Când s-a aprobat release-ul — folosit la expirarea aprobărilor nepublicate.
    ALTER TABLE staged_releases ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_releases ON staged_releases (status, at DESC);
    -- Tiny key-value state that must survive restarts (e.g. the bridge worker's
    -- last-seen beat — a deploy must never blink the Bridge light).
    CREATE TABLE IF NOT EXISTS kv_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS blocked_users (
      email TEXT PRIMARY KEY,
      blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      fp TEXT NOT NULL DEFAULT '',
      contacted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);
    CREATE TABLE IF NOT EXISTS visitor_chats (
      id BIGSERIAL PRIMARY KEY,
      conv_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_vchat_conv ON visitor_chats (conv_id, id);
    -- MESAJE DE CONTACT: se salvează MEREU aici, indiferent dacă emailul e
    -- configurat — ca un mesaj de contact să nu se piardă NICIODATĂ (bug 10 iul:
    -- „mesajele din contact nu se trimit"). Emailul e doar redirectare best-effort
    -- pe deasupra; adevărul e în DB, vizibil în Inbox-ul adminului.
    CREATE TABLE IF NOT EXISTS contact_messages (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'en',
      emailed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages (created_at DESC);
    -- CONECTAREA GOOGLE PERSISTENTĂ (Adrian, 10 iul: „iar îmi dai să loghez
    -- Google? reparată de 10 ori"). Cauza recurenței: refresh-token-ul trăia DOAR
    -- în cookie-ul de sesiune, deci orice re-logare/expirare/re-emitere îl pierdea.
    -- Acum îl ținem PERMANENT aici, per cont: conectezi o dată → se restaurează
    -- singur din DB la fiecare logare. Nu mai cere reconectare niciodată.
    CREATE TABLE IF NOT EXISTS google_accounts (
      email TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- ERORI DE CONSOLĂ CLIENT (Adrian, 11 iul): capturăm erorile frontend
    -- (camera, rețea, JS) ca dovezi înainte de diagnostic. Nu conțin PII.
    CREATE TABLE IF NOT EXISTS client_errors (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      stack TEXT,
      url TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_client_errors_recent ON client_errors (created_at DESC);
    -- SISTEM DE URMĂRIRE A TREPTELOR DE ABONAMENT (12 iul, ordinul lui Adrian:
    -- „sistem de urmărit când sunt repuse valorile noi, interogare când se
    -- alocă prin cheie, revenire la ordinea prestabilită automat"). Fiecare
    -- comutare (kimi→glm la cotă golită) SAU revenire automată (înapoi la
    -- treapta de sus, după cooldown) e un rând aici — worker-ul o scrie chiar
    -- în clipa tranziției, nu doar în jurnalul systemd care se pierde.
    CREATE TABLE IF NOT EXISTS tier_events (
      id BIGSERIAL PRIMARY KEY,
      worker TEXT NOT NULL,
      from_tier TEXT,
      to_tier TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tier_events_recent ON tier_events (at DESC);
  `)
}

export interface ClientErrorRow {
  id: number
  type: string
  message: string
  stack: string | null
  url: string
  ip: string
  created_at: string
}

export async function saveClientError(e: {
  type?: string
  message?: string
  stack?: string
  url?: string
  ip?: string
}): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO client_errors (type, message, stack, url, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        String(e.type ?? '').slice(0, 40),
        String(e.message ?? '').slice(0, 800),
        e.stack ? String(e.stack).slice(0, 2000) : null,
        String(e.url ?? '').slice(0, 400),
        String(e.ip ?? '').slice(0, 64),
      ],
    )
  } catch {
    /* non-fatal: nu blocăm clientul pentru un log */
  }
}

export async function listClientErrors(n = 100): Promise<ClientErrorRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<ClientErrorRow>(
      `SELECT id, type, message, stack, url, ip, created_at::text
       FROM client_errors ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(500, n))],
    )
    return r.rows
  } catch {
    return []
  }
}

export interface TierEventRow {
  id: number
  worker: string
  from_tier: string | null
  to_tier: string
  action: string
  reason: string | null
  at: string
}

export async function saveTierEvent(e: {
  worker: string
  from?: string | null
  to: string
  action: string
  reason?: string
}): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO tier_events (worker, from_tier, to_tier, action, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        String(e.worker).slice(0, 20),
        e.from ? String(e.from).slice(0, 20) : null,
        String(e.to).slice(0, 20),
        String(e.action).slice(0, 20),
        e.reason ? String(e.reason).slice(0, 500) : null,
      ],
    )
  } catch {
    /* non-fatal: nu blocăm worker-ul pentru un log */
  }
}

export async function listTierEvents(n = 50): Promise<TierEventRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<TierEventRow>(
      `SELECT id, worker, from_tier, to_tier, action, reason, at::text
       FROM tier_events ORDER BY at DESC LIMIT $1`,
      [Math.max(1, Math.min(300, n))],
    )
    return r.rows
  } catch {
    return []
  }
}

// ── Conectarea Google persistentă (refresh token per cont) ──────────────────
export async function saveGoogleRefreshToken(email: string, token: string): Promise<void> {
  if (!dbEnabled() || !email || !token) return
  try {
    await getPool().query(
      `INSERT INTO google_accounts (email, refresh_token) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET refresh_token = $2, updated_at = now()`,
      [email.toLowerCase(), token],
    )
  } catch {
    /* nu rupem logarea dacă salvarea token-ului dă rateu */
  }
}

export async function getGoogleRefreshToken(email: string): Promise<string> {
  if (!dbEnabled() || !email) return ''
  try {
    const r = await getPool().query<{ refresh_token: string }>(
      'SELECT refresh_token FROM google_accounts WHERE email = $1',
      [email.toLowerCase()],
    )
    return r.rows[0]?.refresh_token ?? ''
  } catch {
    return ''
  }
}

// ── Live visitor chat (owner ↔ anonymous visitor, via polling) ──────────────
// The visitor opens a widget on the landing; each thread is a random conv_id
// kept in their localStorage. The owner replies from the admin inbox. No login,
// no WebSocket — both sides poll for new lines.

export interface VisitorMsg {
  id: number
  role: string // 'visitor' | 'owner'
  text: string
  created_at: string
}

export async function addVisitorMessage(convId: string, role: string, text: string): Promise<number> {
  if (!dbEnabled() || !convId || !text.trim()) return 0
  try {
    const r = await getPool().query<{ id: string }>(
      'INSERT INTO visitor_chats (conv_id, role, text) VALUES ($1, $2, $3) RETURNING id',
      [convId.slice(0, 80), role === 'owner' ? 'owner' : 'visitor', text.slice(0, 4000)],
    )
    return Number(r.rows[0]?.id ?? 0)
  } catch {
    return 0
  }
}

export async function getVisitorMessages(convId: string, afterId = 0): Promise<VisitorMsg[]> {
  if (!dbEnabled() || !convId) return []
  try {
    const r = await getPool().query<VisitorMsg>(
      `SELECT id, role, text, created_at::text FROM visitor_chats
       WHERE conv_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200`,
      [convId.slice(0, 80), afterId],
    )
    return r.rows
  } catch {
    return []
  }
}

export interface VisitorConvo {
  conv_id: string
  last_text: string
  last_at: string
  total: number
  visitor_msgs: number
}

export async function listVisitorConvos(): Promise<VisitorConvo[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<VisitorConvo>(
      `SELECT conv_id,
              (ARRAY_AGG(text ORDER BY id DESC))[1] AS last_text,
              MAX(created_at)::text AS last_at,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE role = 'visitor')::int AS visitor_msgs
       FROM visitor_chats
       GROUP BY conv_id
       ORDER BY MAX(id) DESC LIMIT 100`,
    )
    return r.rows
  } catch {
    return []
  }
}

// ── Leads (visitor contact capture) ─────────────────────────────────────────
// A visitor leaves an email on the landing so the owner can reach them (the
// only real channel to an otherwise anonymous visitor).

export interface Lead {
  id: number
  email: string
  note: string
  contacted: boolean
  created_at: string
}

export async function addLead(email: string, note: string, fp: string): Promise<boolean> {
  if (!dbEnabled() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false
  try {
    await getPool().query(
      'INSERT INTO leads (email, note, fp) VALUES ($1, $2, $3)',
      [email.trim().toLowerCase().slice(0, 200), note.slice(0, 1000), fp.slice(0, 200)],
    )
    return true
  } catch {
    return false
  }
}

export async function listLeads(): Promise<Lead[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<Lead>(
      'SELECT id, email, note, contacted, created_at::text FROM leads ORDER BY created_at DESC LIMIT 200',
    )
    return r.rows
  } catch {
    return []
  }
}

export async function markLeadContacted(id: number): Promise<void> {
  if (!dbEnabled() || !(id > 0)) return
  try {
    await getPool().query('UPDATE leads SET contacted = true WHERE id = $1', [id])
  } catch {
    /* non-fatal */
  }
}

// ── Mesaje de contact (formularul „Contact") ────────────────────────────────
// Se salvează MEREU (indiferent de email) ca să nu se piardă niciun mesaj.

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

export async function saveContactMessage(m: {
  name: string
  email: string
  subject: string
  message: string
  department: string
  lang: string
  emailed: boolean
}): Promise<boolean> {
  if (!dbEnabled() || !m.email || !m.message) return false
  try {
    await getPool().query(
      `INSERT INTO contact_messages (name, email, subject, message, department, lang, emailed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        m.name.slice(0, 120),
        m.email.slice(0, 200),
        m.subject.slice(0, 200),
        m.message.slice(0, 8000),
        m.department.slice(0, 80),
        m.lang.slice(0, 5),
        m.emailed,
      ],
    )
    return true
  } catch {
    return false
  }
}

export async function listContactMessages(n = 100): Promise<ContactMessage[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<ContactMessage>(
      `SELECT id, name, email, subject, message, department, lang, emailed, created_at::text
       FROM contact_messages ORDER BY created_at DESC LIMIT $1`,
      [n],
    )
    return r.rows
  } catch {
    return []
  }
}

// ── User management (admin) ─────────────────────────────────────────────────
// The owner blocks/unblocks a user, grants credit, or wipes a user's data.
// The ADMIN is protected at the route layer (can never be blocked/deleted).

export async function isBlocked(email: string): Promise<boolean> {
  if (!dbEnabled() || !email) return false
  try {
    const r = await getPool().query('SELECT 1 FROM blocked_users WHERE email = $1', [email.toLowerCase()])
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

export async function blockUser(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  try {
    await getPool().query(
      'INSERT INTO blocked_users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email.toLowerCase()],
    )
  } catch {
    /* non-fatal */
  }
}

export async function unblockUser(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  try {
    await getPool().query('DELETE FROM blocked_users WHERE email = $1', [email.toLowerCase()])
  } catch {
    /* non-fatal */
  }
}

/** Admin grants credit straight to a user's wallet (no Stripe, no split). */
export async function grantCredit(email: string, amount: number, currency = 'gbp'): Promise<void> {
  if (!dbEnabled() || !email || !(amount !== 0)) return
  try {
    await getPool().query(
      `INSERT INTO wallets (user_email, balance, currency) VALUES ($1, $2, $3)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, updated_at = now()`,
      [email.toLowerCase(), amount, currency],
    )
  } catch {
    /* non-fatal */
  }
}

/** Wipe a user's data (messages, prefs, memories, wallet, visits, blocked flag). */
export async function deleteUserData(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  const e = email.toLowerCase()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    for (const t of ['messages', 'user_prefs', 'memories', 'wallets', 'visits', 'blocked_users']) {
      const col = t === 'blocked_users' ? 'email' : 'user_email'
      await client.query(`DELETE FROM ${t} WHERE ${col} = $1`, [e])
    }
    await client.query('COMMIT')
  } catch {
    await client.query('ROLLBACK').catch(() => {})
  } finally {
    client.release()
  }
}

// ── Work orders (persistent builder queue) ──────────────────────────────────

export interface WorkOrderRow {
  id: string
  text: string
  status: string
  created_at: string
  delivered_at: string | null
}

export async function saveWorkOrder(id: string, text: string): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query('INSERT INTO work_orders (id, text) VALUES ($1,$2)', [id, text])
}

/** Atomic pull: pending → delivered, returned once — but never deleted. */
export async function pullPendingWorkOrders(): Promise<WorkOrderRow[]> {
  if (!dbEnabled()) return []
  const r = await getPool().query<WorkOrderRow>(
    `UPDATE work_orders SET status='delivered', delivered_at=now()
     WHERE status='pending' RETURNING id, text, status, created_at, delivered_at`,
  )
  return r.rows
}

// POOL ELASTIC DE REPARATORI (Adrian, 12 iul: „mai mulți reparatori sincronizați
// care se opresc când termină și repornesc când cresc sarcinile"). Revendică UN
// SINGUR ordin, atomic și sigur pentru mai mulți workeri în paralel: `FOR UPDATE
// SKIP LOCKED` face ca doi workeri să ia MEREU ordine diferite (al doilea sare
// peste rândul blocat de primul), fără dublă-revendicare. Întoarce ordinul luat
// sau null (coadă goală → workerul iese, nu consumă).
export async function claimOneWorkOrder(): Promise<WorkOrderRow | null> {
  if (!dbEnabled()) return null
  const r = await getPool().query<WorkOrderRow>(
    `UPDATE work_orders SET status='delivered', delivered_at=now()
     WHERE id = (
       SELECT id FROM work_orders WHERE status='pending'
       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, text, status, created_at, delivered_at`,
  )
  return r.rows[0] ?? null
}

// Câte ordine așteaptă (pentru supervizor: câți workeri să pornească).
export async function countPendingWorkOrders(): Promise<number> {
  if (!dbEnabled()) return 0
  const r = await getPool().query<{ n: string }>(
    `SELECT count(*)::int AS n FROM work_orders WHERE status='pending'`,
  )
  return Number(r.rows[0]?.n ?? 0)
}

export async function listWorkOrders(n = 50): Promise<WorkOrderRow[]> {
  if (!dbEnabled()) return []
  const r = await getPool().query<WorkOrderRow>(
    'SELECT id, text, status, created_at, delivered_at FROM work_orders ORDER BY created_at DESC LIMIT $1',
    [n],
  )
  return r.rows
}

// STADIU REAL PER ORDIN (Adrian, 6 iul: registrul arăta „în lucru" la infinit —
// nu avansa după publicare). Acum stadiul se închide: delivered → published (200
// live) → certified (tester PASS). Așa lista spune adevărul, nu „în lucru" pe veci.
export async function setWorkOrderStatus(id: string, status: string): Promise<void> {
  if (!dbEnabled() || !id) return
  await getPool()
    .query('UPDATE work_orders SET status=$2 WHERE id=$1', [id, status])
    .catch(() => {})
}

// RECONCILIERE — închide ordinele blocate la „delivered" (Adrian, 8 iul: „procedura
// e defectă dacă rămân în «preluat» pe veci; reparat, iar când e gata → finalizat;
// până nu e reparat, nici vorbă să le ștergem"). CAUZA blocajului: doar UN ordin
// (cel legat de cerința deținută) poate avansa la published/certified; toate
// celelalte — lanțuri SUPERVIZOR reasignate, verificări auto (VERIFICARE PE
// CERINȚĂ / LEGEA 200) care raportează verdict pe cerință dar nu pe rândul lor,
// giveup-uri neînchise — rămâneau `delivered` la nesfârșit, fără cale spre terminal.
// Această tură ia orice ordin `delivered` care NU e cel activ deținut acum și care
// stă de mai mult de `staleMs` (abandonat/înlocuit/verificare-terminată) și îl
// mută în terminalul onest `finalized` = „închis, nu mai e în lucru". NU șterge
// nimic — doar închide stadiul, ca registrul să spună adevărul.
export async function finalizeStaleWorkOrders(
  activeOrderId: string | null,
  staleMs = 30 * 60_000,
): Promise<string[]> {
  if (!dbEnabled()) return []
  const cutoffSecs = Math.max(60, Math.floor(staleMs / 1000))
  const r = await getPool()
    .query<{ id: string }>(
      `UPDATE work_orders
         SET status='finalized'
       WHERE status='delivered'
         AND ($1::text IS NULL OR id <> $1)
         AND COALESCE(delivered_at, created_at) < now() - ($2 * interval '1 second')
       RETURNING id`,
      [activeOrderId, cutoffSecs],
    )
    .catch(() => ({ rows: [] as { id: string }[] }))
  return r.rows.map((x) => x.id)
}

// ── Staged releases (persistent approval gate) ──────────────────────────────

export interface StagedReleaseRow {
  id: string
  title: string
  detail: string
  branch: string
  status: string
  approved_at: string | null
  at: string
}

export async function saveStagedRelease(id: string, title: string, detail: string, branch = ''): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query('INSERT INTO staged_releases (id, title, detail, branch) VALUES ($1,$2,$3,$4)', [
      id,
      title,
      detail,
      branch,
    ])
  } catch {
    // Un release nesalvat nu are voie să dărâme constructorul — Adrian
    // pierde o aprobare, nu tot fluxul.
  }
}

export async function listStagedReleases(n = 50): Promise<StagedReleaseRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<StagedReleaseRow>(
      'SELECT id, title, detail, branch, status, approved_at, at FROM staged_releases ORDER BY at DESC LIMIT $1',
      [n],
    )
    return r.rows
  } catch {
    return []
  }
}

export async function setReleaseApproved(id: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      "UPDATE staged_releases SET status='approved', approved_at=now() WHERE id=$1",
      [id],
    )
  } catch {
    /* non-fatal */
  }
}

export async function setReleaseStatus(id: string, status: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query('UPDATE staged_releases SET status=$2 WHERE id=$1', [id, status])
  } catch {
    /* non-fatal */
  }
}

// ── Tiny key-value state that must SURVIVE restarts ─────────────────────────
// (e.g. the bridge worker's last-seen beat: a deploy must not blink the light).

export async function saveKv(key: string, value: string): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(
    `INSERT INTO kv_state (key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
    [key, value],
  )
}

export async function loadKv(key: string): Promise<string | null> {
  if (!dbEnabled()) return null
  const r = await getPool().query<{ value: string }>('SELECT value FROM kv_state WHERE key=$1', [
    key,
  ])
  return r.rows[0]?.value ?? null
}

// ── GESTURI: ce gesturi are voie Kelion să folosească CONTEXTUAL (Adrian, 13
// iul: panou admin cu casetă per gest). Stocăm DOAR lista dezactivată (default:
// toate active). Creierul citește lista și evită gesturile bifate ca OFF.
export async function getDisabledGestures(): Promise<string[]> {
  const raw = await loadKv('gesture_disabled')
  if (!raw) return []
  try {
    const a: unknown = JSON.parse(raw)
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export async function setDisabledGestures(list: string[]): Promise<void> {
  const clean = [...new Set(list.filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)))].slice(0, 200)
  await saveKv('gesture_disabled', JSON.stringify(clean))
}

// ── App installers: MASTER on the Linux server, DELIVERED here ──────────────
// The Linux builder pushes the freshest .exe/.apk into this table; /dl/<file>
// serves it (no-store, over HTTPS+Cloudflare). Survives redeploys → the QR
// codes ALWAYS hand out the latest version, and a new build needs NO app
// redeploy — just an upload from the server.
const appFileCache = new Map<string, { buf: Buffer; type: string }>()

export async function initAppFiles(): Promise<void> {
  if (!dbEnabled()) return
  try {
    const r = await getPool().query<{ name: string; content: Buffer; content_type: string }>(
      'SELECT name, content, content_type FROM app_files',
    )
    for (const row of r.rows) appFileCache.set(row.name, { buf: row.content, type: row.content_type })
  } catch {
    /* table may not exist yet on first boot — created by initDb */
  }
}

export function getAppFile(name: string): { buf: Buffer; type: string } | null {
  return appFileCache.get(name) ?? null
}

export async function putAppFile(name: string, buf: Buffer, type: string): Promise<void> {
  appFileCache.set(name, { buf, type }) // serve immediately, even before DB ack
  if (!dbEnabled()) return
  await getPool().query(
    `INSERT INTO app_files (name, content, content_type, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (name) DO UPDATE SET content=$2, content_type=$3, updated_at=now()`,
    [name, buf, type],
  )
}

// ── Installer download log (who downloaded what, from our own /dl) ─────────

export async function recordDownload(
  file: string,
  email: string,
  ip: string,
  country: string,
  ua: string,
): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(
    'INSERT INTO app_downloads (file, user_email, ip, country, ua) VALUES ($1,$2,$3,$4,$5)',
    [file, email, ip, country, ua.slice(0, 300)],
  )
}

export interface DownloadRow {
  file: string
  user_email: string
  ip: string
  country: string
  created_at: string
}

export async function getDownloadStats(): Promise<{
  counts: { file: string; total: number }[]
  recent: DownloadRow[]
}> {
  if (!dbEnabled()) return { counts: [], recent: [] }
  const counts = await getPool().query<{ file: string; total: number }>(
    'SELECT file, COUNT(*)::int AS total FROM app_downloads GROUP BY file',
  )
  const recent = await getPool().query<DownloadRow>(
    `SELECT file, user_email, ip, country, created_at
     FROM app_downloads ORDER BY created_at DESC LIMIT 100`,
  )
  return { counts: counts.rows, recent: recent.rows }
}

// ── Shared memory: the common notebook both sides read + write ──

export async function appendSharedMemory(source: string, content: string): Promise<void> {
  if (!dbEnabled()) return
  const c = content.trim()
  if (!c) return
  try {
    await getPool().query(
      'INSERT INTO shared_memory (source, content) VALUES ($1, $2)',
      [source.slice(0, 40), c.slice(0, 8000)],
    )
    // Keep it bounded — the last 400 entries are plenty of shared context.
    await getPool().query(
      `DELETE FROM shared_memory WHERE id NOT IN
         (SELECT id FROM shared_memory ORDER BY created_at DESC LIMIT 400)`,
    )
  } catch {
    /* shared memory is best-effort, never breaks a turn */
  }
}

export interface SharedMemoryRow {
  source: string
  content: string
  created_at: string
}

export async function getSharedMemory(limit = 30): Promise<SharedMemoryRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<SharedMemoryRow>(
      `SELECT source, content, created_at FROM (
         SELECT source, content, created_at FROM shared_memory
         ORDER BY created_at DESC LIMIT $1
       ) x ORDER BY created_at ASC`,
      [limit],
    )
    return r.rows
  } catch {
    return []
  }
}

// ── Prepaid wallet (Stripe credit) ──

export async function getBalance(email: string): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_email = $1',
      [email],
    )
    return Number(r.rows[0]?.balance ?? 0)
  } catch {
    return 0
  }
}

/** Deduct usage from the wallet (in display currency). Never throws. */
export async function debitWallet(email: string, amount: number, meta = ''): Promise<void> {
  if (!dbEnabled() || !(amount > 0)) return
  try {
    const pool = getPool()
    // NOTE: the parameter MUST be cast — Postgres cannot type a bare unary
    // "-$2" (\"operator is not unique: - unknown\") and the whole debit silently
    // failed, letting customers consume without ever being charged.
    await pool.query(
      `INSERT INTO wallets (user_email, balance) VALUES ($1, -($2::numeric))
       ON CONFLICT (user_email) DO UPDATE SET balance = wallets.balance - $2::numeric, updated_at = now()`,
      [email, amount],
    )
    await pool.query(
      `INSERT INTO billing_events (user_email, kind, amount, meta) VALUES ($1, 'usage', $2, $3)`,
      [email, -amount, meta],
    )
  } catch {
    // Never break the chat because metering failed.
  }
}

export async function getStripeCustomer(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM wallets WHERE user_email = $1',
      [email],
    )
    return r.rows[0]?.stripe_customer_id ?? null
  } catch {
    return null
  }
}

export async function setStripeCustomer(email: string, id: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO wallets (user_email, stripe_customer_id) VALUES ($1, $2)
       ON CONFLICT (user_email) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
      [email, id],
    )
  } catch {
    // Non-fatal.
  }
}

/**
 * User top-up (Stripe). The user KEEPS `userShare` (75%) as spendable credit;
 * the remaining 25% is our profit, taken up front. Idempotent on stripeRef.
 * topup_ref becomes the new full balance — the reference for the % alerts.
 */
export async function topUpUser(
  email: string,
  gross: number,
  currency: string,
  stripeRef: string,
): Promise<boolean> {
  if (!dbEnabled() || !(gross > 0) || !stripeRef) return false
  const userCredit = gross * config.stripe.userShare
  const profit = gross - userCredit
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const seen = await client.query('SELECT 1 FROM billing_events WHERE stripe_ref = $1', [stripeRef])
    if ((seen.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES ($1, 'topup', $2, $3, 'user 75%')`,
      [email, userCredit, stripeRef],
    )
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES ($1, $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES ($1, 'profit', $2, $3, 'margin 25%')`,
      [email, profit, `${stripeRef}:profit`],
    )
    await client.query('COMMIT')
    return true
  } catch {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    return false
  } finally {
    client.release()
  }
}

/** STRIPE + CREDITS (ORDIN #6G): înregistrări în tabela `transactions`. */

export interface Transaction {
  id: number
  user_id: string
  amount: number
  credits: number
  status: string
  stripe_payment_intent_id: string | null
  created_at: string
}

/** Creează o tranzacție nouă (plasare PaymentIntent). */
export async function createTransaction(
  email: string,
  amount: number,
  credits: number,
  stripePaymentIntentId: string,
): Promise<number> {
  if (!dbEnabled() || !email || !stripePaymentIntentId) return 0
  try {
    const r = await getPool().query<{ id: number }>(
      `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING
       RETURNING id`,
      [email.toLowerCase(), amount, credits, stripePaymentIntentId],
    )
    return r.rows[0]?.id ?? 0
  } catch {
    return 0
  }
}

/** Actualizează statusul unei tranzacții după ID-ul Stripe PaymentIntent. */
export async function updateTransactionStatus(
  stripePaymentIntentId: string,
  status: string,
): Promise<void> {
  if (!dbEnabled() || !stripePaymentIntentId) return
  try {
    await getPool().query(
      'UPDATE transactions SET status = $2, created_at = COALESCE(created_at, now()) WHERE stripe_payment_intent_id = $1',
      [stripePaymentIntentId, status],
    )
  } catch {
    /* non-fatal */
  }
}

/** Istoricul de cumpărături al unui utilizator. */
export async function listTransactionsForUser(email: string, limit = 50): Promise<Transaction[]> {
  if (!dbEnabled() || !email) return []
  try {
    const r = await getPool().query<Transaction>(
      `SELECT id, user_id, amount, credits, status, stripe_payment_intent_id, created_at::text
       FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [email.toLowerCase(), Math.max(1, Math.min(500, limit))],
    )
    return r.rows
  } catch {
    return []
  }
}

/** Toate tranzacțiile (panou admin). */
export async function listAllTransactions(limit = 200): Promise<Transaction[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<Transaction>(
      `SELECT id, user_id, amount, credits, status, stripe_payment_intent_id, created_at::text
       FROM transactions ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(500, limit))],
    )
    return r.rows
  } catch {
    return []
  }
}

/** Creditare unitară din PaymentIntent (ORDIN #6G): tranzacție + wallet + profit.
 *  Idempotent pe stripe_payment_intent_id. */
export async function topUpUserFromPaymentIntent(
  email: string,
  gross: number,
  currency: string,
  stripePaymentIntentId: string,
): Promise<boolean> {
  if (!dbEnabled() || !(gross > 0) || !stripePaymentIntentId) return false
  const userCredit = gross * config.stripe.userShare
  const profit = gross - userCredit
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const seen = await client.query('SELECT 1 FROM transactions WHERE stripe_payment_intent_id = $1', [
      stripePaymentIntentId,
    ])
    if ((seen.rowCount ?? 0) > 0) {
      // Deja există: doar actualizăm statusul și confirmăm creditul (re-try webhook).
      await client.query(
        `UPDATE transactions SET status = 'succeeded' WHERE stripe_payment_intent_id = $1`,
        [stripePaymentIntentId],
      )
      await client.query('COMMIT')
      return true
    }
    await client.query(
      `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'succeeded', $4)`,
      [email.toLowerCase(), gross, userCredit, stripePaymentIntentId],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES ($1, 'topup', $2, $3, 'user 75%')`,
      [email, userCredit, stripePaymentIntentId],
    )
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES ($1, $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES ($1, 'profit', $2, $3, 'margin 25%')`,
      [email, profit, `${stripePaymentIntentId}:profit`],
    )
    await client.query('COMMIT')
    return true
  } catch {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    return false
  } finally {
    client.release()
  }
}

/** Wallet balance + the last-top-up reference, for the low-credit % alerts. */
export async function getWalletStatus(email: string): Promise<{ balance: number; topupRef: number }> {
  if (!dbEnabled()) return { balance: 0, topupRef: 0 }
  try {
    const r = await getPool().query<{ balance: string; topup_ref: string }>(
      'SELECT balance, topup_ref FROM wallets WHERE user_email = $1',
      [email],
    )
    return { balance: Number(r.rows[0]?.balance ?? 0), topupRef: Number(r.rows[0]?.topup_ref ?? 0) }
  } catch {
    return { balance: 0, topupRef: 0 }
  }
}

/** Owner loads the provider-credit pool (real money he put at the AI providers). */
export async function loadAdminPool(amount: number): Promise<void> {
  if (!dbEnabled() || !(amount > 0)) return
  try {
    await getPool().query('UPDATE admin_pool SET loaded = loaded + $1, updated_at = now() WHERE id = 1', [amount])
  } catch {
    /* non-fatal */
  }
}

/** Owner withdraws real money from the pool (records taking it back out).
 *  Clamped at 0 so the recorded pool can't go negative. */
export async function withdrawAdminPool(amount: number): Promise<void> {
  if (!dbEnabled() || !(amount > 0)) return
  try {
    await getPool().query('UPDATE admin_pool SET loaded = GREATEST(0, loaded - $1), updated_at = now() WHERE id = 1', [amount])
  } catch {
    /* non-fatal */
  }
}

/** Owner's real-money view: pool loaded, remaining (loaded − real cost) and profit. */
// Start a free trial if allowed. Enforces the daily cap (cost guard) and a light
// anti-reuse: a fingerprint or IP that already tried within 30 days is refused.
// Fails OPEN (allows the trial) if there's no DB or a transient error, so a
// hiccup never blocks a visitor — the 3-minute limit still bounds each trial.
// Everything we know about one trial visit — the owner's professional
// analytics: who (human/bot), from where (flag/country/region/city/ISP), on
// what (browser/OS/device), speaking what, and which ad brought them (referrer).
export interface DemoVisit {
  country: string
  code: string
  city: string
  region: string
  isp: string
  tz: string
  browser: string
  os: string
  device: string
  lang: string
  referrer: string
  isBot: boolean
}

const EMPTY_VISIT: DemoVisit = {
  country: '', code: '', city: '', region: '', isp: '', tz: '',
  browser: '', os: '', device: '', lang: '', referrer: '', isBot: false,
}

export async function tryStartDemo(
  fingerprint: string,
  ip: string,
  visit: DemoVisit = EMPTY_VISIT,
  sessionEmail = '',
): Promise<{ ok: boolean; reason?: 'cap' | 'used' }> {
  if (!dbEnabled()) return { ok: true }
  try {
    const pool = getPool()
    // FĂRĂ plafon global pe număr de probe (Adrian, 13 iul: „10 minute pe
    // utilizator, nu există limită la câți testează"). Limita reală e per
    // sesiune (10 min, DEMO_SECONDS) — nu pe câți vizitatori intră într-o zi.
    // Rămâne DOAR garda anti-reabuz per amprentă/IP de mai jos.
    if (fingerprint || ip) {
      const used = Number(
        (
          await pool.query<{ n: string }>(
            `SELECT COUNT(*) AS n FROM demo_uses
             WHERE started_at >= now() - interval '30 days'
               AND ((fingerprint <> '' AND fingerprint = $1) OR (ip <> '' AND ip = $2))`,
            [fingerprint, ip],
          )
        ).rows[0]?.n ?? 0,
      )
      if (used > 0) return { ok: false, reason: 'used' }
    }
    await pool.query(
      `INSERT INTO demo_uses
         (fingerprint, ip, country, country_code, city, region, isp, tz,
          browser, os, device, lang, referrer, is_bot, session_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        fingerprint, ip, visit.country, visit.code, visit.city, visit.region,
        visit.isp, visit.tz, visit.browser, visit.os, visit.device, visit.lang,
        visit.referrer, visit.isBot, sessionEmail,
      ],
    )
    return { ok: true }
  } catch {
    return { ok: true }
  }
}

/**
 * Record a plain SITE VISIT (anyone who opens the landing page — not just demo
 * starters). Deduped: the same fingerprint/IP within 6 hours counts once, so a
 * refresh doesn't inflate the numbers. Fire-and-forget; never throws.
 */
export async function logVisit(
  fingerprint: string,
  ip: string,
  visit: DemoVisit = EMPTY_VISIT,
  userEmail = '',
): Promise<void> {
  if (!dbEnabled()) return
  try {
    const pool = getPool()
    if (fingerprint || ip) {
      const seen = Number(
        (
          await pool.query<{ n: string }>(
            `SELECT COUNT(*) AS n FROM visits
             WHERE started_at >= now() - interval '6 hours'
               AND ((fingerprint <> '' AND fingerprint = $1) OR (ip <> '' AND ip = $2))`,
            [fingerprint, ip],
          )
        ).rows[0]?.n ?? 0,
      )
      if (seen > 0) return
    }
    await pool.query(
      `INSERT INTO visits
         (fingerprint, ip, country, country_code, city, region, isp, tz,
          browser, os, device, lang, referrer, is_bot, user_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        fingerprint, ip, visit.country, visit.code, visit.city, visit.region,
        visit.isp, visit.tz, visit.browser, visit.os, visit.device, visit.lang,
        visit.referrer, visit.isBot, userEmail,
      ],
    )
  } catch {
    /* analytics must never break the page */
  }
}

/**
 * Presence ping from the signed-in app: extends the CURRENT session row (same
 * user/fingerprint/IP within 6h) — last_seen_at is how the owner sees "how
 * long they stayed"; actions counts the pings. Also stamps the account email
 * onto a session that started anonymously on the landing page. Returns false
 * when no session row matched (caller then inserts a fresh one, WITH geo).
 */
export async function touchVisit(
  fingerprint: string,
  ip: string,
  email: string,
): Promise<boolean> {
  if (!dbEnabled()) return true
  try {
    const r = await getPool().query(
      `UPDATE visits
       SET last_seen_at = now(), actions = actions + 1,
           user_email = CASE WHEN user_email = '' THEN $3 ELSE user_email END
       WHERE id = (SELECT id FROM visits
                   WHERE started_at >= now() - interval '6 hours'
                     AND ((user_email <> '' AND user_email = $3)
                          OR (fingerprint <> '' AND fingerprint = $1)
                          OR (ip <> '' AND ip = $2))
                   ORDER BY started_at DESC LIMIT 1)`,
      [fingerprint, ip, email],
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return true /* analytics must never break the app */
  }
}

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

// The owner's per-USER activity: WHO signed in, from what IP/place/device,
// how long they stayed (presence pings), how active they were, plus their
// latest sessions one by one. Admin only.
export async function getUserActivity(): Promise<{
  users: UserActivityRow[]
  sessions: UserSessionRow[]
}> {
  if (!dbEnabled()) return { users: [], sessions: [] }
  try {
    const pool = getPool()
    const users = (
      await pool.query<UserActivityRow>(
        `SELECT v.user_email AS email,
                COUNT(*)::int AS sessions,
                COALESCE(SUM(EXTRACT(EPOCH FROM (v.last_seen_at - v.started_at))), 0)::float AS seconds,
                COALESCE(SUM(v.actions), 0)::int AS actions,
                COALESCE(MAX(m.n), 0)::int AS messages,
                MAX(v.last_seen_at)::text AS last_seen,
                (ARRAY_AGG(v.ip ORDER BY v.last_seen_at DESC))[1] AS last_ip,
                (ARRAY_AGG(v.city ORDER BY v.last_seen_at DESC))[1] AS city,
                (ARRAY_AGG(v.country ORDER BY v.last_seen_at DESC))[1] AS country,
                (ARRAY_AGG(v.country_code ORDER BY v.last_seen_at DESC))[1] AS code,
                (ARRAY_AGG(v.device ORDER BY v.last_seen_at DESC))[1] AS device,
                (ARRAY_AGG(v.browser ORDER BY v.last_seen_at DESC))[1] AS browser,
                EXISTS(SELECT 1 FROM blocked_users b WHERE b.email = v.user_email) AS blocked,
                COALESCE((SELECT w.balance FROM wallets w WHERE w.user_email = v.user_email), 0)::float AS balance
         FROM visits v
         LEFT JOIN (SELECT user_email, COUNT(*)::int AS n
                    FROM messages GROUP BY user_email) m
           ON m.user_email = v.user_email
         WHERE v.user_email <> ''
         GROUP BY v.user_email
         ORDER BY MAX(v.last_seen_at) DESC
         LIMIT 200`,
      )
    ).rows
    const sessions = (
      await pool.query<UserSessionRow>(
        `SELECT user_email AS email, started_at::text,
                EXTRACT(EPOCH FROM (last_seen_at - started_at))::float AS seconds,
                actions, ip, city, country, country_code AS code, device
         FROM visits WHERE user_email <> ''
         ORDER BY started_at DESC LIMIT 100`,
      )
    ).rows
    return { users, sessions }
  } catch {
    return { users: [], sessions: [] }
  }
}

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
  // For a DEMO row: the throwaway email whose conversation the owner can open.
  // Empty for plain visits (they never chatted).
  session_email: string
  // CE L-A INTERESAT: prima întrebare/temă a vizitatorului din proba demo (semnal
  // real de interes). Gol pentru vizitele fără chat.
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

// The owner's visitor analytics (admin only): EVERY site visit + every demo
// try — totals, a breakdown by country across both, and the latest arrivals
// (each row tagged visit/demo) with their full profile.
export async function getDemoStats(): Promise<DemoStats> {
  const empty: DemoStats = {
    total: 0, today: 0, bots: 0, visitsTotal: 0, visitsToday: 0, byCountry: [], recent: [],
  }
  if (!dbEnabled()) return empty
  try {
    const pool = getPool()
    const counts = (
      await pool.query<{ total: string; today: string; bots: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now())) AS today,
                COUNT(*) FILTER (WHERE is_bot) AS bots
         FROM demo_uses`,
      )
    ).rows[0]
    const vCounts = (
      await pool.query<{ total: string; today: string; bots: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now())) AS today,
                COUNT(*) FILTER (WHERE is_bot) AS bots
         FROM visits`,
      )
    ).rows[0]
    const byCountry = (
      await pool.query<{ country: string; country_code: string; n: string }>(
        `SELECT COALESCE(NULLIF(country,''),'Unknown') AS country, country_code,
                COUNT(*) AS n
         FROM (SELECT country, country_code FROM demo_uses
               UNION ALL SELECT country, country_code FROM visits) AS x
         GROUP BY country, country_code ORDER BY COUNT(*) DESC LIMIT 30`,
      )
    ).rows.map((r) => ({ country: r.country, code: r.country_code, count: Number(r.n) }))
    const recent = (
      await pool.query<{
        kind: 'visit' | 'demo'
        ip: string
        country: string
        country_code: string
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
        session_email: string
        topic: string
      }>(
        `SELECT * FROM (
           SELECT 'demo'::text AS kind, d.ip, d.country, d.country_code, d.city, d.region, d.isp,
                  d.browser, d.os, d.device, d.lang, d.referrer, d.is_bot, d.started_at, d.session_email,
                  COALESCE((SELECT m.content FROM messages m
                            WHERE m.user_email = d.session_email AND m.role = 'user'
                            ORDER BY m.created_at ASC LIMIT 1), '') AS topic
           FROM demo_uses d
           UNION ALL
           SELECT 'visit'::text AS kind, ip, country, country_code, city, region, isp,
                  browser, os, device, lang, referrer, is_bot, started_at, '' AS session_email, '' AS topic
           FROM visits
         ) AS x ORDER BY started_at DESC LIMIT 60`,
      )
    ).rows.map((r) => ({
      kind: r.kind,
      ip: r.ip,
      country: r.country,
      code: r.country_code,
      city: r.city,
      region: r.region,
      isp: r.isp,
      browser: r.browser,
      os: r.os,
      device: r.device,
      lang: r.lang,
      referrer: r.referrer,
      is_bot: r.is_bot,
      started_at: r.started_at,
      session_email: r.session_email,
      topic: r.topic ?? '',
    }))
    return {
      total: Number(counts?.total ?? 0),
      today: Number(counts?.today ?? 0),
      bots: Number(counts?.bots ?? 0) + Number(vCounts?.bots ?? 0),
      visitsTotal: Number(vCounts?.total ?? 0),
      visitsToday: Number(vCounts?.today ?? 0),
      byCountry,
      recent,
    }
  } catch {
    return empty
  }
}

export async function getAdminAccount(): Promise<{
  loaded: number
  remaining: number
  spent: number
  profit: number
}> {
  const empty = { loaded: 0, remaining: 0, spent: 0, profit: 0 }
  if (!dbEnabled()) return empty
  try {
    const pool = getPool()
    const loaded = Number(
      (await pool.query<{ loaded: string }>('SELECT loaded FROM admin_pool WHERE id = 1')).rows[0]?.loaded ?? 0,
    )
    const costUsd = Number(
      (await pool.query<{ t: string | null }>('SELECT COALESCE(SUM(cost_usd),0) AS t FROM cost_events')).rows[0]?.t ?? 0,
    )
    const spent = costUsd * config.stripe.usdToCurrency
    const profit = Number(
      (
        await pool.query<{ t: string | null }>(
          "SELECT COALESCE(SUM(amount),0) AS t FROM billing_events WHERE kind = 'profit'",
        )
      ).rows[0]?.t ?? 0,
    )
    return { loaded, remaining: loaded - spent, spent, profit }
  } catch {
    return empty
  }
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

export async function saveGeneratedImage(id: string, mime: string, data: Buffer): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query('INSERT INTO generated_images (id, mime, data) VALUES ($1, $2, $3)', [
      id,
      mime,
      data,
    ])
  } catch {
    //
  }
}

export async function loadGeneratedImage(id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query('SELECT mime, data FROM generated_images WHERE id = $1', [id])
    const row = r.rows[0]
    if (!row) return null
    return { mime: row.mime, data: row.data }
  } catch {
    return null
  }
}

export interface CostSummary {
  total: number
  today: number
  byKind: Record<string, number>
}

// Costul de AZI, pe motoare (Adrian, 11 iul, aprobat: „6 da" — raportul zilnic
// de bani): doar evenimentele zilei curente, grupate pe fel, cele mai scumpe
// primele. Abonamentele fixe (Kimi/GLM) nu trec pe aici — doar API-urile
// plătite la consum (tts/asr/memory/chat-API/căutare/imagini).
export async function getCostToday(): Promise<{ kind: string; sum: number }[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<{ kind: string; sum: string }>(
      `SELECT kind, SUM(cost_usd) AS sum FROM cost_events
        WHERE created_at >= date_trunc('day', now())
        GROUP BY kind ORDER BY SUM(cost_usd) DESC`,
    )
    return r.rows.map((x) => ({ kind: x.kind, sum: Number(x.sum) }))
  } catch {
    return []
  }
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

// Per-user active "meserie" (role/persona) — id into MESERII, or null when
// the user has no role active. Same persistence pattern as speech_lang.
export async function getMeserieActiva(email: string): Promise<number | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ meserie_activa: number | null }>(
      'SELECT meserie_activa FROM user_prefs WHERE user_email = $1',
      [email],
    )
    return r.rows[0]?.meserie_activa ?? null
  } catch {
    return null
  }
}

export async function setMeserieActivaPref(email: string, id: number | null): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO user_prefs (user_email, meserie_activa, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_email) DO UPDATE SET meserie_activa = $2, updated_at = now()`,
      [email, id],
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
  try {
    const r = await getPool().query<UserSummary>(
      `SELECT user_email AS email, COUNT(*)::int AS count, MAX(created_at) AS last
       FROM messages GROUP BY user_email ORDER BY last DESC`,
    )
    return r.rows
  } catch {
    return []
  }
}

export interface HistoryRow {
  role: string
  content: string
  created_at: string
}

export async function getHistory(email: string, limit = 1000): Promise<HistoryRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<HistoryRow>(
      `SELECT role, content, created_at FROM messages
       WHERE user_email = $1 ORDER BY created_at ASC LIMIT $2`,
      [email, limit],
    )
    return r.rows
  } catch {
    return []
  }
}

// The LAST n messages (chronological) — what the chat panel reloads at start
// so a page refresh never "loses" the conversation on screen again.
export async function getRecentHistory(email: string, n = 60): Promise<HistoryRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<HistoryRow>(
      `SELECT role, content, created_at FROM (
         SELECT role, content, created_at FROM messages
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2
       ) AS x ORDER BY created_at ASC`,
      [email, n],
    )
    return r.rows
  } catch {
    return []
  }
}

// ── Cross-session memory (the Memory agent's store) ──
export interface Memory {
  content: string
}

/** Most recently relevant durable facts, for one agent's memory namespace. */
export async function getMemories(email: string, limit = 40, agent = 'kelion'): Promise<Memory[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<Memory>(
      `SELECT content FROM memories WHERE user_email = $1 AND agent = $2 ORDER BY last_seen DESC LIMIT $3`,
      [email, agent, limit],
    )
    return r.rows
  } catch {
    return []
  }
}

// Relevance recall: memories whose content matches any of the given words
// (names, places, specifics from the user's question). This is what keeps an
// OLD but important fact findable once the recency window has moved past it —
// long-term memory must scale beyond "the last 40 things learned".
export async function searchMemories(
  email: string,
  agent: string,
  words: string[],
  limit = 12,
): Promise<Memory[]> {
  if (!dbEnabled() || words.length === 0) return []
  try {
    // Full-text real (Adrian, 11 iul): fiecare cuvânt-cheie e un termen OR în
    // interogare, cu POTRIVIRE DE PREFIX (`:*`) — găsește amintiri care conțin
    // ORICE cuvânt ce ÎNCEPE cu termenul căutat (cafea → cafeaua, prinde
    // pluralul/declinarea ro fără dicționar de limbă), în ORICE ordine, nu doar
    // un substring literal exact. DOVEDIT cu teste reale (Postgres local): config
    // 'simple' fără prefix rata "cafeaua" la căutarea "cafea" (regresie față de
    // ILIKE) — prefixul repară exact asta. Rezultatele sunt SORTATE după
    // relevanță (`ts_rank`), nu doar recență — un fapt vechi dar foarte relevant
    // nu mai e îngropat de unul recent dar nepotrivit.
    // Fiecare token trebuie să rămână UN singur cuvânt alfanumeric — orice
    // rest (spații, punctuație, operatori tsquery) SCOS complet, nu doar
    // înlocuit cu spațiu (un rest de spațiu intern rupe sintaxa to_tsquery,
    // dovedit cu un test real: "o'reilly!" → "o reilly" → eroare de sintaxă).
    const clean = words
      .slice(0, 8)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean)
    if (clean.length === 0) return []
    const orQuery = clean
      .map((_, i) => `to_tsquery('simple', (($2::text[])[${i + 1}]) || ':*')`)
      .join(' || ')
    const r = await getPool().query<Memory>(
      `SELECT content FROM memories
       WHERE user_email = $1 AND agent = $3
         AND to_tsvector('simple', content) @@ (${orQuery})
       ORDER BY ts_rank(to_tsvector('simple', content), (${orQuery})) DESC, last_seen DESC
       LIMIT $4`,
      [email, clean, agent, limit],
    )
    return r.rows
  } catch {
    return []
  }
}

// Uitare la cerere (#20, Adrian 10 iul): userul e stăpân pe memoria lui —
// „uită că..." șterge faptele care se potrivesc fragmentului. Întoarce câte au
// fost șterse, ca Kelion să confirme sincer (0 = n-a găsit nimic de uitat).
export async function deleteMemory(
  email: string,
  fragment: string,
  agent = 'kelion',
): Promise<number> {
  const f = fragment.trim().replaceAll('%', '').replaceAll('_', '')
  if (!dbEnabled() || f.length < 3) return 0
  try {
    const r = await getPool().query(
      `DELETE FROM memories WHERE user_email = $1 AND agent = $2 AND content ILIKE $3`,
      [email, agent, `%${f}%`],
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}

// ── Capability gaps (admin-only "what Kelion can't do yet" monitor) ──
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

/**
 * Record a request Kelion couldn't fulfil. Near-identical open requests are
 * de-duplicated (hits++ and recency refreshed) so the list stays a signal, not
 * a flood. Never throws — logging a gap must never affect the conversation.
 */
export async function logCapabilityGap(email: string, request: string, reason = ''): Promise<void> {
  const req = request.trim().slice(0, 500)
  if (!dbEnabled() || !req) return
  try {
    const pool = getPool()
    const dup = await pool.query<{ id: number }>(
      `SELECT id FROM capability_gaps
       WHERE resolved = false AND lower(request) = lower($1) LIMIT 1`,
      [req],
    )
    if ((dup.rowCount ?? 0) > 0) {
      await pool.query(
        'UPDATE capability_gaps SET hits = hits + 1, last_seen = now() WHERE id = $1',
        [dup.rows[0].id],
      )
      return
    }
    await pool.query(
      'INSERT INTO capability_gaps (user_email, request, reason) VALUES ($1, $2, $3)',
      [email, req, reason.trim().slice(0, 500) || null],
    )
  } catch {
    // Best-effort — never break the chat because gap logging failed.
  }
}

/** Open capability gaps, most-requested / most-recent first (admin only). */
export async function getCapabilityGaps(includeResolved = false, limit = 200): Promise<CapabilityGap[]> {
  if (!dbEnabled()) return []
  try {
    const where = includeResolved ? '' : 'WHERE resolved = false'
    const r = await getPool().query<CapabilityGap>(
      `SELECT id, user_email, request, reason, hits, resolved, escalated, created_at, last_seen
       FROM capability_gaps ${where}
       ORDER BY resolved ASC, hits DESC, last_seen DESC LIMIT $1`,
      [limit],
    )
    return r.rows
  } catch {
    return []
  }
}

/** Mark a gap resolved (or reopen it) — admin only. */
export async function setGapResolved(id: number, resolved: boolean): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query('UPDATE capability_gaps SET resolved = $2 WHERE id = $1', [id, resolved])
  } catch {
    /* non-fatal */
  }
}

/** Mark a gap as sent to the brain (escalated) — it stays visible, tagged, until
 * a successful deploy clears it automatically. */
export async function markGapEscalated(id: number): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      'UPDATE capability_gaps SET escalated = true, escalated_at = now() WHERE id = $1',
      [id],
    )
  } catch {
    /* non-fatal */
  }
}

/** Save a learned fact (idempotent: re-learning just refreshes its recency). */
export async function addMemory(email: string, content: string, agent = 'kelion'): Promise<void> {
  const c = content.trim()
  if (!dbEnabled() || !c) return
  try {
    await getPool().query(
      `INSERT INTO memories (user_email, agent, content) VALUES ($1, $2, $3)
       ON CONFLICT (user_email, agent, content) DO UPDATE SET last_seen = now()`,
      [email, agent, c],
    )
    // Vectorul de înțeles, ASINCRON (nu ține tura pe loc): dacă embedding-ul
    // pică, amintirea rămâne oricum — full-text-ul o găsește după cuvinte.
    if (embeddingsEnabled()) {
      void embedText(c)
        .then((v) => {
          if (!v) return
          return getPool().query(
            `UPDATE memories SET embedding = $4
             WHERE user_email = $1 AND agent = $2 AND content = $3`,
            [email, agent, c, JSON.stringify(v)],
          )
        })
        .catch(() => {})
    }
  } catch {
    // Never break the chat because memory write failed.
  }
}

// BACKFILL (12 iul): amintirile de dinaintea memoriei semantice primesc și ele
// vector, în loturi mici (apelat periodic din index.ts) — după câteva ore tot
// trecutul e căutabil după sens. Cost neglijabil (embeddings Gemini).
export async function backfillMemoryEmbeddings(batch = 40): Promise<number> {
  if (!dbEnabled() || !embeddingsEnabled()) return 0
  try {
    const r = await getPool().query<{ id: string; content: string }>(
      `SELECT id, content FROM memories WHERE embedding IS NULL ORDER BY last_seen DESC LIMIT $1`,
      [batch],
    )
    let done = 0
    for (const row of r.rows) {
      const v = await embedText(row.content)
      if (!v) continue
      await getPool().query(`UPDATE memories SET embedding = $2 WHERE id = $1`, [
        row.id,
        JSON.stringify(v),
      ])
      done++
    }
    return done
  } catch {
    return 0
  }
}

// RECALL SEMANTIC (12 iul): amintirile cele mai apropiate ca SENS de întrebare
// — completează full-text-ul (care cere cuvinte comune). Vectorii ultimelor
// ~400 de amintiri se compară în Node (cosine); prag ca să nu injectăm zgomot.
export async function semanticMemories(
  email: string,
  agent: string,
  query: string,
  limit = 8,
): Promise<Memory[]> {
  if (!dbEnabled() || !embeddingsEnabled()) return []
  try {
    const qv = await embedText(query)
    if (!qv) return []
    const r = await getPool().query<{ content: string; embedding: number[] | null }>(
      `SELECT content, embedding FROM memories
       WHERE user_email = $1 AND agent = $2 AND embedding IS NOT NULL
       ORDER BY last_seen DESC LIMIT 400`,
      [email, agent],
    )
    return r.rows
      .map((row) => ({
        content: row.content,
        score: Array.isArray(row.embedding) ? cosine(qv, row.embedding) : 0,
      }))
      .filter((x) => x.score > 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ content: x.content }))
  } catch {
    return []
  }
}

// ── Explicit user notes ("reține asta") ──

export interface Note {
  id: number
  title: string | null
  content: string
  createdAt: string
}

/** Save a note the user explicitly asked Kelion to remember. Returns its id. */
export async function saveNote(email: string, content: string, title?: string): Promise<number | null> {
  const c = content.trim()
  if (!dbEnabled() || !c) return null
  try {
    const r = await getPool().query<{ id: number }>(
      'INSERT INTO notes (user_email, title, content) VALUES ($1, $2, $3) RETURNING id',
      [email, title?.trim() || null, c],
    )
    return r.rows[0]?.id ?? null
  } catch {
    return null
  }
}

/** List a user's saved notes, most recent first. */
export async function listNotes(email: string, limit = 50): Promise<Note[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<{ id: number; title: string | null; content: string; created_at: string }>(
      'SELECT id, title, content, created_at FROM notes WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2',
      [email, limit],
    )
    return r.rows.map((row) => ({ id: row.id, title: row.title, content: row.content, createdAt: row.created_at }))
  } catch {
    return []
  }
}

/** Delete one of the user's own notes. Returns whether a row was actually removed. */
export async function deleteNote(email: string, id: number): Promise<boolean> {
  if (!dbEnabled()) return false
  try {
    const r = await getPool().query('DELETE FROM notes WHERE id = $1 AND user_email = $2', [id, email])
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

export interface InboundEmail {
  id: number
  uid: string
  from_addr: string
  from_name: string | null
  subject: string | null
  body: string | null
  reply: string | null
  replied: boolean
  lang: string | null
  received_at: string
}

// Record an inbound email. Returns true if it was NEW (inserted) — false if the
// UID was already seen, so the mailbox poller never replies to the same mail twice.
export async function saveInboundEmail(m: {
  uid: string
  from_addr: string
  from_name?: string
  subject?: string
  body?: string
}): Promise<boolean> {
  if (!dbEnabled() || !m.uid) return false
  try {
    const r = await getPool().query(
      `INSERT INTO inbound_emails (uid, from_addr, from_name, subject, body)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (uid) DO NOTHING`,
      [m.uid, m.from_addr.slice(0, 300), m.from_name?.slice(0, 200) ?? null, m.subject?.slice(0, 500) ?? null, m.body?.slice(0, 20000) ?? null],
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

// Mark an inbound email answered, storing the reply text + detected language.
export async function setInboundReplied(uid: string, reply: string, lang: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      'UPDATE inbound_emails SET replied = true, reply = $2, lang = $3 WHERE uid = $1',
      [uid, reply.slice(0, 20000), lang.slice(0, 5)],
    )
  } catch {
    /* non-fatal */
  }
}

/** Recent inbound emails + their replies, newest first (admin panel). */
export async function listInboundEmails(limit = 50): Promise<InboundEmail[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<InboundEmail>(
      `SELECT id, uid, from_addr, from_name, subject, body, reply, replied, lang, received_at
       FROM inbound_emails ORDER BY received_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows
  } catch {
    return []
  }
}

// ── Speaker identification by voiceprint ───────────────────────────────────

export interface VoiceFeatureMeta {
  pitchMean: number
  pitchStd: number
  pitchMin: number
  pitchMax: number
  centroid: number
  rolloff: number
  zcr: number
  energy: number
  jitter: number
  shimmer: number
}

export interface VoiceprintRow {
  email: string
  name: string
  gender: 'male' | 'female' | 'unknown'
  isAdmin: boolean
  features: number[]
  featureMeta: VoiceFeatureMeta
  hasAudio: boolean
  createdAt: string
  updatedAt: string
}

interface VoiceprintDbRow {
  user_email: string
  name: string
  gender: string
  is_admin: boolean
  features: number[]
  feature_meta: VoiceFeatureMeta
  has_audio?: boolean
  created_at: string
  updated_at: string
}

function rowToVoiceprint(r: VoiceprintDbRow): VoiceprintRow {
  return {
    email: r.user_email,
    name: r.name,
    gender: (r.gender as VoiceprintRow['gender']) || 'unknown',
    isAdmin: r.is_admin,
    features: r.features || [],
    featureMeta: r.feature_meta || ({} as VoiceFeatureMeta),
    hasAudio: !!r.has_audio,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function saveVoiceprint(v: {
  email: string
  name: string
  gender: VoiceprintRow['gender']
  isAdmin: boolean
  features: number[]
  featureMeta: VoiceFeatureMeta
  audioClip?: string
}): Promise<void> {
  if (!dbEnabled() || !v.email) return
  try {
    const vec = v.features.filter((x) => Number.isFinite(x)).slice(0, 64)
    // Mostra audio: o păstrăm doar dacă e rezonabilă ca mărime (≤ ~600KB base64,
    // câteva secunde webm/opus). Prea mare → n-o stocăm, dar identificarea merge.
    const clip = typeof v.audioClip === 'string' && v.audioClip.length <= 600_000 ? v.audioClip : ''
    await getPool().query(
      `INSERT INTO voiceprints
         (user_email, name, gender, is_admin, features, feature_meta, audio_clip, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_email) DO UPDATE
         SET name = $2, gender = $3, is_admin = $4, features = $5,
             feature_meta = $6,
             -- clip nou doar dacă a venit unul; altfel păstrăm mostra veche.
             audio_clip = CASE WHEN $7 <> '' THEN $7 ELSE voiceprints.audio_clip END,
             updated_at = now()`,
      [v.email.toLowerCase(), v.name, v.gender, v.isAdmin, vec, JSON.stringify(v.featureMeta), clip],
    )
  } catch {
    // Never break the chat because voiceprint persistence failed.
  }
}

// Mostra audio a unei amprente (data-URL) — doar pentru butonul „play" din admin.
export async function getVoiceprintAudio(email: string): Promise<string | null> {
  if (!dbEnabled() || !email) return null
  try {
    const r = await getPool().query<{ audio_clip: string }>(
      'SELECT audio_clip FROM voiceprints WHERE user_email = $1',
      [email.toLowerCase()],
    )
    const clip = r.rows[0]?.audio_clip
    return clip ? clip : null
  } catch {
    return null
  }
}

export async function getVoiceprint(email: string): Promise<VoiceprintRow | null> {
  if (!dbEnabled() || !email) return null
  try {
    const r = await getPool().query<VoiceprintDbRow>(
      `SELECT user_email, name, gender, is_admin, features, feature_meta,
              created_at, updated_at
       FROM voiceprints WHERE user_email = $1`,
      [email.toLowerCase()],
    )
    return r.rows[0] ? rowToVoiceprint(r.rows[0]) : null
  } catch {
    return null
  }
}

export async function deleteVoiceprint(email: string): Promise<boolean> {
  if (!dbEnabled() || !email) return false
  try {
    await getPool().query('DELETE FROM voiceprints WHERE user_email = $1', [email.toLowerCase()])
    return true
  } catch {
    return false
  }
}

export async function listVoiceprints(limit = 200): Promise<VoiceprintRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<VoiceprintDbRow>(
      `SELECT user_email, name, gender, is_admin, features, feature_meta,
              (audio_clip <> '') AS has_audio, created_at, updated_at
       FROM voiceprints ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows.map(rowToVoiceprint)
  } catch {
    return []
  }
}

/** Euclidean distance between two equal-length vectors. */
export function vectorDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return Infinity
  let sum = 0
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    sum += d * d
  }
  return Math.sqrt(sum / len)
}

export async function identifyVoiceprint(
  vector: number[],
  threshold: number,
): Promise<(VoiceprintRow & { distance: number }) | null> {
  if (!dbEnabled() || vector.length === 0) return null
  try {
    const rows = await listVoiceprints(1000)
    let best: (VoiceprintRow & { distance: number }) | null = null
    for (const row of rows) {
      if (!row.features || row.features.length === 0) continue
      const d = vectorDistance(vector, row.features)
      if (d < threshold && (!best || d < best.distance)) {
        best = { ...row, distance: d }
      }
    }
    return best
  } catch {
    return null
  }
}

// ── Face identification by faceprint (128-d descriptor de la face-api) ───────
// Camera pornită + voce = Kelion prinde automat fața vorbitorului, o compară cu
// referința titularului contului și îi zice creierului „titular / altcineva".
// NICIUN buton — declanșat de voce, ca la voiceprint.

export interface FaceprintRow {
  email: string
  name: string
  isAdmin: boolean
  descriptor: number[]
  photo: string
  createdAt: string
  updatedAt: string
}

interface FaceprintDbRow {
  user_email: string
  name: string
  is_admin: boolean
  descriptor: number[]
  photo: string
  created_at: string
  updated_at: string
}

function rowToFaceprint(r: FaceprintDbRow): FaceprintRow {
  return {
    email: r.user_email,
    name: r.name,
    isAdmin: r.is_admin,
    descriptor: r.descriptor || [],
    photo: r.photo || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Distanță euclidiană BRUTĂ (nu normalizată) — convenția face-api, prag ~0.6. */
export function faceDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return Infinity
  let sum = 0
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    sum += d * d
  }
  return Math.sqrt(sum)
}

export async function saveFaceprint(f: {
  email: string
  name: string
  isAdmin: boolean
  descriptor: number[]
  photo?: string
}): Promise<void> {
  if (!dbEnabled() || !f.email) return
  try {
    const vec = f.descriptor.filter((x) => Number.isFinite(x)).slice(0, 128)
    if (vec.length === 0) return
    // Miniatura o păstrăm mică (evită umflarea DB); dacă lipsește, nu suprascriem.
    const photo = (f.photo || '').slice(0, 200_000)
    await getPool().query(
      `INSERT INTO faceprints
         (user_email, name, is_admin, descriptor, photo, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_email) DO UPDATE
         SET name = $2, is_admin = $3, descriptor = $4,
             photo = CASE WHEN $5 = '' THEN faceprints.photo ELSE $5 END,
             updated_at = now()`,
      [f.email.toLowerCase(), f.name, f.isAdmin, vec, photo],
    )
  } catch {
    // Never break the chat because faceprint persistence failed.
  }
}

export async function getFaceprint(email: string): Promise<FaceprintRow | null> {
  if (!dbEnabled() || !email) return null
  try {
    const r = await getPool().query<FaceprintDbRow>(
      `SELECT user_email, name, is_admin, descriptor, photo, created_at, updated_at
       FROM faceprints WHERE user_email = $1`,
      [email.toLowerCase()],
    )
    return r.rows[0] ? rowToFaceprint(r.rows[0]) : null
  } catch {
    return null
  }
}

export async function deleteFaceprint(email: string): Promise<boolean> {
  if (!dbEnabled() || !email) return false
  try {
    await getPool().query('DELETE FROM faceprints WHERE user_email = $1', [email.toLowerCase()])
    return true
  } catch {
    return false
  }
}

export async function listFaceprints(limit = 200): Promise<FaceprintRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<FaceprintDbRow>(
      `SELECT user_email, name, is_admin, descriptor, photo, created_at, updated_at
       FROM faceprints ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows.map(rowToFaceprint)
  } catch {
    return []
  }
}
