import pg from 'pg'
import { randomBytes } from 'node:crypto'
// THE HTTP CONTRACT, a single declaration (Batch A) — see src/shared/api-types.ts.
import type { DemoRecent, DemoStats, UserActivityRow } from './shared/api-types.js'
export type { DemoRecent, DemoStats, UserActivityRow }
import { config } from './config.js'
import { embedText, embeddingsEnabled, cosine } from './services/embeddings.js'
import { esteDuplicat } from './services/cerinteDedup.js'

let pool: pg.Pool | null = null

export function dbEnabled(): boolean {
  return Boolean(config.databaseUrl)
}

// Exported for the live "PostgreSQL" check in tokenChecks (SELECT 1).
export function getPool(): pg.Pool {
  if (!pool) {
    const url = config.databaseUrl
    // Local/no-TLS Postgres (VPS on the same machine, explicit sslmode=disable)
    // connects without SSL; any other target gets TLS with a self-signed
    // certificate accepted (managed proxies).
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
    -- THE VOICE CHOSEN BY EACH PERSON (Adrian, 30 Jul: "he can set the app with
    -- whatever AI he wants and whatever voice he wants... it's remembered per
    -- user"). Until now the voice came from the environment, so it was ONE for
    -- everyone.
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS voice TEXT;
    -- AUTO TOP-UP, per user (Adrian, Aug 1: "auto-pay selectable with a
    -- checkbox when the user pays"). The rails (Revolut pay-link) cannot pull
    -- money by themselves, so "enabled" means: when the balance drops below
    -- the threshold, the app PREPARES the payment (unique code + link) and
    -- the user confirms with one tap. Stored here so it survives sessions.
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS autorecharge_enabled BOOLEAN NOT NULL DEFAULT false;
    -- The 20/10 column defaults are only a STORAGE BACKSTOP for rows written
    -- without values; the application-level defaults come from config.billing
    -- (autoRechargeThreshold/autoRechargeAmount) — see getAutoRecharge.
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS autorecharge_threshold INTEGER NOT NULL DEFAULT 20;
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS autorecharge_amount INTEGER NOT NULL DEFAULT 10;
    -- EVIDENȚA TIMPILOR DE REZOLVARE (Adrian, 3 aug: „un sistem care ține evidența
    -- timpilor de rezolvare, ca să se poată măsura" + auto-învățare în spate).
    -- O linie per sarcină reală: cât a durat creierul, ce model, câte runde,
    -- reușită sau nu. Din asta învață bucla din spate (services/autoInvatare.ts).
    CREATE TABLE IF NOT EXISTS task_timings (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT,
      ms INTEGER NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT true,
      rounds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_task_timings_kind ON task_timings (kind, created_at);
    -- Voiceprints: timbre + gender + admin flag per account.
    -- The vector is normalized client-side; meta keeps the raw values for debug.
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
    -- AUDIO CLIP (Adrian, 14 Jul: "I need a play button to hear the voice"):
    -- besides the identification vector we also keep a short audio sample
    -- (webm/opus data-URL, a few seconds) of the last phrase, so the admin can
    -- LISTEN to it from the panel. Only the admin reads it; it never goes out
    -- to chat.
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
    -- GUEST VOICES (Adrian, Aug 1): the holder may explicitly ask Kelion to
    -- also talk with another person (wife, son, friend...). That person's
    -- voiceprint + photo + RELATION to the holder are stored here — but only
    -- after the holder's explicit approval (approved=true). Unknown voices
    -- without the holder's request are ignored entirely.
    CREATE TABLE IF NOT EXISTS voice_guests (
      id BIGSERIAL PRIMARY KEY,
      account_email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      relation TEXT NOT NULL DEFAULT '',
      features DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
      feature_meta JSONB NOT NULL DEFAULT '{}',
      photo TEXT NOT NULL DEFAULT '',
      approved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_voice_guests_account ON voice_guests (account_email, approved, updated_at DESC);
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
    -- REAL MEMORY SEARCH (Adrian, 11 Jul: "memory quality" — ILIKE on an exact
    -- substring missed any rephrasing). Native Postgres full-text: 'simple'
    -- config (no language dictionary — tokenizes any mixed ro/en text without
    -- assuming a single language), GIN-indexed for speed with many memories.
    -- It's not embeddings/AI (that would require pgvector + an API call on
    -- write, cost and unconfirmed infra risk) — but it matches real WORDS, with
    -- a relevance score, not just a literal substring.
    CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories
      USING GIN (to_tsvector('simple', content));
    -- SEMANTIC MEMORY (12 Jul, roadmap #5): the meaning vector of the memory
    -- (Gemini text-embedding-004), written asynchronously at learning time.
    -- JSONB, not pgvector: no extensions to install, cosine is computed in
    -- Node over the last few hundred — instant at current volume.
    ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding JSONB;
    -- The prepaid credit wallet. The balance is in display currency (GBP);
    -- topup_ref = the amount credited at the LAST top-up, so we can show
    -- "% of credit left" for the escalated alerts (30/20/10/5%).
    CREATE TABLE IF NOT EXISTS wallets (
      user_email TEXT PRIMARY KEY,
      balance NUMERIC(14,6) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'gbp',
      topup_ref NUMERIC(14,6) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS topup_ref NUMERIC(14,6) NOT NULL DEFAULT 0;
    -- Stripe is fully out (Adrian, 31 Jul: "the leftovers are not needed") —
    -- the old Stripe customer column is dropped, it had no history to keep.
    ALTER TABLE wallets DROP COLUMN IF EXISTS stripe_customer_id;
    -- THE admin_pool TABLE IS DEAD — dropped, not created (audit, Aug 3).
    -- Its comment used to say "the owner's provider-credit pool (REAL money):
    -- the admin loads it" — i.e. a figure TYPED by hand ("+ Add money"),
    -- presented as the pocket. Adrian killed that on 30 Jul ("one single
    -- pocket... only real remains, no hardcode"): loadAdminPool/
    -- withdrawAdminPool were deleted, NOTHING reads this table anymore, and
    -- the live DB confirms it — one row, (1, 0.000000), untouched since
    -- Jul 23. A table that only holds a hand-seeded zero is a seed with false
    -- data; the real pocket is READ from Revolut (Enable Banking) and
    -- OpenRouter. DROP, not CREATE: existing databases get cleaned on boot.
    DROP TABLE IF EXISTS admin_pool;
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
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
    -- CE AU VIZITAT (owner, 13 aug: „dacă la raport nu am și ce au vizitat, nu
    -- mă ajută cu nimic"). Lista secțiunilor deschise de acel vizitator în
    -- sesiune (acasă / aplicație / credite / manual / autentificare), listă
    -- distinctă separată prin virgulă, acumulată pe același rând, plafonată.
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS pages TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_visits_email ON visits (user_email, last_seen_at DESC);
    -- The ledger of top-ups (+) and consumptions (−) — the structure is below.
    -- ── PAYMENTS VIA REVOLUT PRO, WITH A UNIQUE CODE (Adrian, 30 Jul) ────────
    -- "nowadays, having to manually manage thousands of potential users, is
    -- that what you offer?" — he was right. For a payment to credit ITSELF you
    -- must know WHO paid, and Revolut Pro has no webhook to tell us.
    --
    -- His solution: "every payment must come with a unique code". The code
    -- leaves with the user to the payment and comes back in the transaction
    -- reference; the app reads the account transactions and matches the code
    -- to the person.
    --
    -- Why a code and not the amount (my first idea, wrong): the amount can be
    -- fixed by the link and can be altered by fees before it lands — two
    -- things we don't control. The code passes untouched through both.
    CREATE TABLE IF NOT EXISTS payment_codes (
      code TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      -- pending → paid (credited) | expired (never paid) | manual (assigned by admin)
      status TEXT NOT NULL DEFAULT 'pending',
      -- the bank transaction reference, so the same payment never credits twice
      bank_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_paycode_user ON payment_codes (user_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paycode_status ON payment_codes (status, created_at DESC);
    -- THE SAME PAYMENT NEVER CREDITS TWICE, no matter how many reads overlap.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_paycode_bankref ON payment_codes (bank_ref) WHERE bank_ref IS NOT NULL;
    -- THE NET (M2, Aug 2): an inflow the reader could NOT tie to anyone lands
    -- HERE — it never disappears into a local counter again (the old code
    -- counted faraCod++ and threw the payment away; the M2 order and
    -- RAMAS-DE-FACUT §G promised this table while it did not exist).
    -- bank_ref UNIQUE = the 5-minute reader can see the same transaction on
    -- every pass forever without duplicating rows.
    CREATE TABLE IF NOT EXISTS plati_neatribuite (
      id SERIAL PRIMARY KEY,
      bank_ref TEXT NOT NULL UNIQUE,
      referinta TEXT,
      amount NUMERIC(14,6) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      -- noua → atribuita (the admin gave it to a user) | ignorata (the owner's
      -- unrelated income — the account also receives money that isn't a top-up)
      status TEXT NOT NULL DEFAULT 'noua',
      resolved_email TEXT,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_neatrib_status ON plati_neatribuite (status, seen_at DESC);
    -- KELION'S PROJECT MEMORY (his own request, Aug 2: "persistent, structured
    -- working memory... a project context I can query and update
    -- programmatically, not just chat history"). Keyed notes he writes and
    -- reads through his own tools — they survive every restart and deploy,
    -- unlike the conversation window.
    CREATE TABLE IF NOT EXISTS memorie_proiect (
      cheie TEXT PRIMARY KEY,
      continut TEXT NOT NULL,
      actualizat TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- AGENȚII ADĂUGAȚI DE OWNER din pagina de admin (Adrian, 4 aug: „când mai
    -- vreau un model de agent să pot pune și să fie creat automat"). Se lipesc
    -- la rosterul din cod (rosterViu) și intră automat pe /api/a2a și în
    -- consola Enterprise la următorul ocol de creare.
    CREATE TABLE IF NOT EXISTS agenti_custom (
      id TEXT PRIMARY KEY,
      nume TEXT NOT NULL,
      rol TEXT NOT NULL,
      efort TEXT,
      doar_admin BOOLEAN NOT NULL DEFAULT false,
      creat TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- The ledger of top-ups (+) and consumptions (−). The "ref" column makes
    -- top-ups idempotent: the same payment is never credited twice, no matter
    -- how many reads or retries overlap.
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      ref TEXT,
      meta TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Stripe is fully out (31 Jul): the old column is dropped entirely
    -- (it had no history worth keeping) and replaced by "ref".
    ALTER TABLE billing_events DROP COLUMN IF EXISTS stripe_ref CASCADE;
    ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS ref TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_billing_ref ON billing_events (ref) WHERE ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_events (user_email, created_at DESC);
    -- CREDITS (ORDER #6G): dedicated table for credit purchase transactions.
    -- user_id = the user's email (the unique identifier used across the system).
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      credits NUMERIC(14,6) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE transactions DROP COLUMN IF EXISTS stripe_payment_intent_id CASCADE;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_ref TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_transactions_ref ON transactions (payment_ref) WHERE payment_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status, created_at DESC);
    -- Capability gaps: things users asked for that Kelion CANNOT do yet. Kelion
    -- logs them here (via the log_unsupported_request tool); only the owner/admin
    -- reads them, to prioritise what to build next. Never shown to end users.
    -- ── REQUIREMENTS MANAGEMENT (Adrian, 30 Jul: "I need advanced systems
    -- assigned to Kelion for requirements management, advanced evaluations of
    -- the offered solutions") ────────────────────────────────────────────────
    -- Until now, an owner requirement lived in three places that didn't talk
    -- to each other: a row in RAMAS-DE-FACUT.md (hand-written), an order in
    -- build_jobs (no link to the requirement) and, sometimes, only in chat —
    -- where it got lost. The result: "I asked you dozens of times" was TRUE
    -- and unprovable. Here a requirement has a single place, with its whole
    -- journey: what was asked, how it's proven done, which OPTIONS were
    -- evaluated and with what scores, which was chosen and why, which order
    -- carried it, and what was MEASURED at the end.
    CREATE TABLE IF NOT EXISTS cerinte (
      id BIGSERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      sursa TEXT NOT NULL DEFAULT 'owner',
      -- noua → analizata (has evaluated options) → in_lucru → livrata →
      -- verificata (with measured proof) | respinsa (with reason)
      stare TEXT NOT NULL DEFAULT 'noua',
      -- How it's PROVEN to be done. Written at the start, not the end, so the
      -- target doesn't move after something has been delivered.
      criteriu TEXT,
      optiuni TEXT,      -- JSON: the evaluated options, with scores and risks
      aleasa TEXT,       -- the chosen option + WHY
      dovada TEXT,       -- what was measured at the end (not what was declared)
      job_id BIGINT,
      pr_url TEXT,
      -- HOW URGENT it is, for the OWNER (1 = burning, 9 = can wait). Without
      -- it, work happens in the order things were written — and you get a
      -- button fixed while payments are down. It's not a brake: it changes
      -- the ORDER, not what it's allowed to do.
      prioritate INT NOT NULL DEFAULT 5,
      -- HOW HARD it is (1..5), set by it at evaluation. From it, the HAND that
      -- works is chosen: a big model on a hard task, a free one on a rename.
      -- Without it, a hard task started on a small model, burned turns
      -- rambling, and failed.
      dificultate INT NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE cerinte ADD COLUMN IF NOT EXISTS prioritate INT NOT NULL DEFAULT 5;
    ALTER TABLE cerinte ADD COLUMN IF NOT EXISTS dificultate INT NOT NULL DEFAULT 3;
    CREATE INDEX IF NOT EXISTS idx_cerinte_stare ON cerinte (stare, prioritate, created_at);

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
    -- Kelion's AUTONOMOUS TRIAGE (Adrian, 24 Jul): his decision on each
    -- uncovered request — "TO IMPLEMENT: ..." or "AUTONOMOUSLY CLOSED: ...".
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS triage TEXT;
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_gaps_open ON capability_gaps (resolved, last_seen DESC);
    -- KELION'S SELF-EXPANSION (Adrian, 25 Jul: "Kelion must be able to install
    -- tools by itself, independently, up to deploy — with my approval"). Kelion
    -- PROPOSES a new tool (an HTTP call, as data, not arbitrary code): name,
    -- what it does, parameters, method+URL. The owner APPROVES it with one
    -- click in admin → it becomes ACTIVE instantly, no redeploy. Safety: HTTPS
    -- only, no internal IPs, no executable code — Kelion can only run tools
    -- approved by the admin.
    CREATE TABLE IF NOT EXISTS kelion_tools (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      http_method TEXT NOT NULL DEFAULT 'GET',
      http_url TEXT NOT NULL,
      http_headers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      proposed_by TEXT NOT NULL DEFAULT 'kelion',
      rationale TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_kelion_tools_status ON kelion_tools (status, created_at DESC);
    -- Explicit user notes ("remember this", "save X for me") — distinct from the
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
    -- SHARED MEMORY ("the common notebook"): the single brain shared by BOTH sides —
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
    -- Persistent store for images generated by Kelion (audit 9 Jul 2026).
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
    -- THE BUILDER (Adrian, 27 Jul: "Kelion must be able to create any software
    -- the admin asks"). The build-order queue: Kelion (or the admin from the
    -- panel) puts the order here; the worker on the VPS (cron, short jobs, NOT
    -- daemons) picks it up, builds in the workshop (separate clone), runs build
    -- + tests and opens the PR. Merging stays with Adrian (his rule, 27 Jul).
    CREATE TABLE IF NOT EXISTS build_jobs (
      id BIGSERIAL PRIMARY KEY,
      ordered_by TEXT NOT NULL,
      order_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      branch TEXT,
      pr_url TEXT,
      tokens BIGINT NOT NULL DEFAULT 0,
      log TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs (status, created_at);
    -- LIVE PROGRESS (autonomy Stage 4, 29 Jul): the builder's current step
    -- (cloned → editing X → build → opening PR...) so it appears on the monitor
    -- and Kelion can NARRATE it. Updated along the way by
    -- POST /api/constructor/progress.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS progress TEXT;
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ;
    -- THE INDEPENDENT VERIFICATION VERDICT (autonomy Stage 6, 29 Jul): "Done" is
    -- no longer the worker's word — after the PR, the worker waits for CI
    -- (verify) on a clean machine and writes 'green' / 'red' / 'in progress'
    -- here. Kelion can NARRATE it ("Done, verified by CI") and the owner sees
    -- it in the report.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS ci TEXT;
    -- THE BRAIN USED + ITS MEASURED COST (Adrian, Aug 2: "Everything FREE.
    -- The admin can EXPRESSLY request the paid Fable 5 brain for the
    -- CONSTRUCTOR only"): the worker writes 'fable-5' or 'free' here, plus the
    -- cost in USD as MEASURED from OpenRouter's usage.cost (null when the
    -- provider didn't report one — never estimated). This makes paid orders
    -- distinguishable in the Money views without any fabrication.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS brain TEXT;
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION;
    -- ARHIVAREA ORDINELOR VECHI (Adrian, K9 + K13: „de ascuns cele vechi din
    -- panou" + „sistem automat de curățare care arhivează când e gata"). Un ordin
    -- terminat (done/failed) mai vechi se ARHIVEAZĂ (nu se șterge — rămâne
    -- recuperabil): iese din panou, dar nu se pierde. Bucla de autonomie
    -- arhivează singură; panoul (listBuildJobs) le exclude.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS arhivat BOOLEAN NOT NULL DEFAULT false;
    -- WORK ORDERS for the builder — in POSTGRES because the old in-memory queue
    -- was WIPED by every deploy (the admin's "sent to execution" orders
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
    -- REAL SCHEMA DRIFT (12 Jul, caught by purge-phantom: Postgres error 42703
    -- "column branch does not exist"): the table had been created before branch
    -- was added to the definition, and CREATE TABLE IF NOT EXISTS is a no-op on
    -- an existing table — the column had stayed missing in production since its
    -- introduction. Safety net, same as memories.
    ALTER TABLE staged_releases ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT '';
    -- When the release was approved — used for expiring unpublished approvals.
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
    -- CONTACT MESSAGES: they are ALWAYS saved here, whether email is configured
    -- or not — so a contact message is NEVER lost (bug 10 Jul: "contact
    -- messages don't get sent"). Email is just best-effort forwarding on top;
    -- the truth is in the DB, visible in the admin's Inbox.
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
    -- LOCAL ACCOUNTS (Adrian, 26 Jul: "other non-Gmail login solutions... yes,
    -- start, including letting them create one"). Identity = the email, exactly
    -- like Google — wallet/history/memory/voiceprint are already tied to the
    -- email, so a local account AUTOMATICALLY gets every feature (except the
    -- skills on personal Google data, impossible without a Google account).
    -- Password: scrypt (node:crypto), hex "salt:hash" format — zero new
    -- dependencies.
    CREATE TABLE IF NOT EXISTS local_accounts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- One-time links (magic link + password reset): we keep ONLY the token
    -- hash (a DB dump can't log anyone in), with expiry.
    CREATE TABLE IF NOT EXISTS login_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- PERSISTENT GOOGLE CONNECTION (Adrian, 10 Jul: "you're making me log into
    -- Google again? fixed 10 times"). The recurrence cause: the refresh token
    -- lived ONLY in the session cookie, so any re-login/expiry/re-issue lost
    -- it. Now we keep it PERMANENTLY here, per account: connect once → it
    -- restores itself from the DB at every login. Never asks to reconnect
    -- again.
    CREATE TABLE IF NOT EXISTS google_accounts (
      email TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- CLIENT CONSOLE ERRORS (Adrian, 11 Jul): we capture frontend errors
    -- (camera, network, JS) as evidence before diagnosis. They contain no PII.
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
    -- SUBSCRIPTION-TIER TRACKING SYSTEM (12 Jul, Adrian's order: "a system to
    -- track when new values are restored, query when allocated by key, return
    -- to the preset order automatically"). Every switch (kimi→glm at an empty
    -- quota) OR automatic return (back to the top tier, after cooldown) is a
    -- row here — the worker writes it at the very moment of the transition, not
    -- just in the systemd journal that gets lost.
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
    /* non-fatal: we don't block the client for a log */
  }
}

// „ERORI DE CLIENT" CARE ÎNSEAMNĂ CU ADEVĂRAT INTERFAȚĂ RUPTĂ (owner, 13 aug:
// „să nu mai numere simptomele [PERF] ca «erori UI rupt» — emailul fals de 23 de
// erori"). Simptomele de PERFORMANȚĂ (fir principal blocat, ceas lent — tastate
// cu tipul `perf`, marcaj `[PERF]`) NU sunt interfață stricată: sunt un semnal
// SEPARAT pe care creierul îl vede în continuare (inelul din contextul chatului
// + db_query pe client_errors). Sentinela (emailul) și scanarea de sănătate
// (problema `erori_client`) numără DOAR erorile reale — o singură definiție,
// folosită în ambele locuri, ca să nu mai plece alarme false. Filtrăm și după
// tip (rândurile noi), și după marcaj (rândurile vechi, încă `f12`, din fereastră).
/** Pure logic: does a client error row represent a REAL UI error (not a perf symptom)?
 *  Used by the SQL query AND by tests — one definition, no drift. */
export function isRealClientError(type: string | null, message: string | null): boolean {
  if (type === 'perf') return false
  if (message && message.includes('[PERF]')) return false
  return true
}

export async function countClientErrorsLastHour(): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM client_errors
        WHERE created_at > now() - interval '1 hour'
          AND type <> 'perf'
          AND message NOT LIKE '%[PERF]%'`,
    )
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

// ── ERORILE DIN BROWSER (F12), LA CERERE (owner, 14 aug: „kelion să vadă F12") ──
// Inelul din memorie (clientErrors.ts) injectează în context DOAR ultimele 15 min
// ale userului CURENT. Ăsta e cititorul DURABIL, din DB, pe care unealta
// `client_errors` îl cheamă când Kelion vrea să VADĂ activ erorile din browser —
// mai vechi de 15 min, sau după o repornire. Implicit exclude simptomele [PERF]
// (nu-s interfață stricată), dar le poate include la cerere.
export interface ClientErrorRow {
  created_at: string
  type: string
  message: string
  url: string
}
export async function recentClientErrorRows(hours = 24, limit = 40, includePerf = false): Promise<ClientErrorRow[]> {
  if (!dbEnabled()) return []
  const h = Math.max(1, Math.min(720, Math.floor(hours) || 24))
  const lim = Math.max(1, Math.min(200, Math.floor(limit) || 40))
  const perfFiltru = includePerf ? '' : "AND type <> 'perf' AND message NOT LIKE '%[PERF]%'"
  try {
    const r = await getPool().query<ClientErrorRow>(
      `SELECT created_at::text AS created_at, type, left(message, 400) AS message, url
         FROM client_errors
        WHERE created_at > now() - ($1 || ' hours')::interval
          ${perfFiltru}
        ORDER BY created_at DESC
        LIMIT $2`,
      [h, lim],
    )
    return r.rows
  } catch {
    return []
  }
}

export interface ClientErrorGroup {
  created_at: string
  user_email: string | null
  message: string
  n: string
}

/** Client errors GROUPED by message, for the admin panel.
 *
 *  This query used to live hand-written IN THE ROUTE (admin.ts), while a
 *  `listClientErrors` that nobody called lay here: two places for the same
 *  job, one of them dead. jscpd couldn't catch it (the text differed), but
 *  it's exactly a violation of the "single, no duplicates" principle — plus a
 *  route that touched the database directly, bypassing this layer. Now: a
 *  single source, here. */
export async function listClientErrorGroups(hours = 48, limit = 30): Promise<ClientErrorGroup[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<ClientErrorGroup>(
      `SELECT max(created_at)::text AS created_at, user_email, left(message, 200) AS message, count(*)::text AS n
       FROM client_errors WHERE created_at > now() - ($1 || ' hours')::interval
       GROUP BY user_email, left(message, 200)
       ORDER BY max(created_at) DESC LIMIT $2`,
      [Math.max(1, Math.min(720, hours)), Math.max(1, Math.min(200, limit))],
    )
    return r.rows
  } catch {
    return []
  }
}

// SELF-HEALING (Adrian, 27 Jul: "Kelion must be able to collect errors that
// appear under each user automatically and fix them, shipping the repaired
// version to all users afterwards"). We group client errors by message (first
// 200 chars) and return ONLY the RECURRING ones — seen many times, by several
// users (distinct IPs) in the given window. That way the builder doesn't take
// on an isolated/environmental incident, but a real, repeated bug.
export interface RecurringError {
  message: string
  count: number
  users: number
  sampleStack: string | null
  sampleUrl: string
  firstSeen: string
  lastSeen: string
}
export async function recurringClientErrors(hours = 24, minCount = 5, minUsers = 2): Promise<RecurringError[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<{
      message: string
      count: string
      users: string
      stack: string | null
      url: string
      first_seen: string
      last_seen: string
    }>(
      `SELECT left(message, 200) AS message,
              count(*) AS count,
              count(DISTINCT ip) AS users,
              (array_agg(stack ORDER BY created_at DESC))[1] AS stack,
              (array_agg(url   ORDER BY created_at DESC))[1] AS url,
              min(created_at)::text AS first_seen,
              max(created_at)::text AS last_seen
         FROM client_errors
        WHERE created_at > now() - ($1 || ' hours')::interval
          AND message <> ''
          -- LIVE SYMPTOMS have their own reader (simptomeLiveRecente) and their
          -- own self-heal pass; excluding them here keeps the two paths from
          -- filing the SAME failure twice.
          AND type NOT LIKE 'live:%'
          -- exclude noise that can't be fixed in code: opaque cross-origin
          -- errors, network outages, browser extensions.
          AND message NOT ILIKE 'Script error%'
          AND message NOT ILIKE '%NetworkError%'
          AND message NOT ILIKE '%Failed to fetch%'
          AND message NOT ILIKE '%Load failed%'
          AND message NOT ILIKE '%ResizeObserver%'
        GROUP BY left(message, 200)
       HAVING count(*) >= $2 AND count(DISTINCT ip) >= $3
        ORDER BY count(*) DESC
        LIMIT 20`,
      [hours, minCount, minUsers],
    )
    return r.rows.map((x) => ({
      message: x.message,
      count: Number(x.count),
      users: Number(x.users),
      sampleStack: x.stack,
      sampleUrl: x.url,
      firstSeen: x.first_seen,
      lastSeen: x.last_seen,
    }))
  } catch {
    return []
  }
}

// ── LIVE SYMPTOMS — silent internal failures made VISIBLE ────────────────────
//
// Adrian, 12 aug: „vreau autonomia si kelion sa vada tot ce pica, acces de admin
// pe toate logurile". The self-heal loop above only ever saw errors the BROWSER
// reported. What broke SILENTLY on the server or the UI — the camera that gives
// no frame, a route that throws, the brain that returns no text — reached
// NOWHERE, so it reached no repair either. That is exactly why "Kelion doesn't
// see": there was nothing recorded for it to reach.
//
// These functions make such failures land in the SAME table the admin already
// watches (client_errors), tagged with a `live:<fel>` type, so they stop being
// silent AND self-heal can pick them up (see selfHeal.ts). The bar is LOWER than
// recurringClientErrors on purpose: a mute chat is severe even at one user (the
// owner himself) — so there is NO "2 distinct users" requirement here.
export async function recordSimptomLive(
  fel: string,
  detaliu: string,
  extra?: { url?: string; ip?: string },
): Promise<void> {
  // Reuses the visible, admin-watched store; the `live:` prefix is what the
  // reader and the recurring-errors exclusion key on.
  await saveClientError({
    type: `live:${String(fel).replace(/[^a-z0-9-]/gi, '').slice(0, 32)}`,
    message: detaliu,
    url: extra?.url,
    ip: extra?.ip,
  })
}

export interface SimptomLive {
  /** The kind, without the `live:` prefix — e.g. `fara-vedere`, `chat-mut`, `ruta-crapata`. */
  fel: string
  /** The concrete detail: what failed, exactly (grouped by first 200 chars). */
  message: string
  count: number
  sampleUrl: string
  lastSeen: string
}

/** The recent LIVE symptoms, grouped by kind + message — for self-heal and the
 *  panel. Deliberately NO minimum-users bar: a single occurrence of a mute chat
 *  is a real failure, not noise. `minCount` lets the caller demand recurrence
 *  per kind (e.g. a one-off „camera off" shouldn't be treated as a bug). */
export async function simptomeLiveRecente(hours = 6, minCount = 1): Promise<SimptomLive[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<{
      fel: string
      message: string
      count: string
      url: string
      last_seen: string
    }>(
      `SELECT type AS fel,
              left(message, 200) AS message,
              count(*) AS count,
              (array_agg(url ORDER BY created_at DESC))[1] AS url,
              max(created_at)::text AS last_seen
         FROM client_errors
        WHERE created_at > now() - ($1 || ' hours')::interval
          AND type LIKE 'live:%'
          AND message <> ''
        GROUP BY type, left(message, 200)
       HAVING count(*) >= $2
        ORDER BY max(created_at) DESC
        LIMIT 20`,
      [Math.max(1, Math.min(720, hours)), Math.max(1, minCount)],
    )
    return r.rows.map((x) => ({
      fel: String(x.fel).replace(/^live:/, ''),
      message: x.message,
      count: Number(x.count),
      sampleUrl: x.url ?? '',
      lastSeen: x.last_seen,
    }))
  } catch {
    return []
  }
}

// ── Persistent Google connection (refresh token per account) ────────────────
export async function saveGoogleRefreshToken(email: string, token: string): Promise<void> {
  if (!dbEnabled() || !email || !token) return
  try {
    await getPool().query(
      `INSERT INTO google_accounts (email, refresh_token) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET refresh_token = $2, updated_at = now()`,
      [email.toLowerCase(), token],
    )
  } catch {
    /* don't break the login if saving the token fails */
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

// AUDIT ADMIN (3 aug, Chat live): DB picat întorcea [] cu 200 → panoul afișa
// „Nicio conversație încă" deși vizitatorii puteau scrie chiar atunci. null la
// eșec — ruta răspunde 500, iar pollul de 5s al panoului reîncearcă singur.
export async function listVisitorConvos(): Promise<VisitorConvo[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<VisitorConvo>(
      `SELECT conv_id,
              (ARRAY_AGG(text ORDER BY id DESC))[1] AS last_text,
              MAX(created_at)::text AS last_at,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE role = 'visitor')::int AS visitor_msgs
       FROM visitor_chats
       -- SELF-CLEANING (Adrian, 31 Jul: "and what about these?" — three
       -- "conversations" from 25 Jul that were only "Test QA automat — mesaj
       -- de verificare (ignora)"). Automated probes are not visitors; they
       -- have no business in the list you read to see who wrote to you. They
       -- stay in the table, but no longer appear. The filter is on TEXT, not
       -- date, so it also catches tomorrow's probes.
       WHERE conv_id NOT IN (
         SELECT DISTINCT conv_id FROM visitor_chats
         WHERE text ILIKE '%Test QA automat%' OR text ILIKE '%mesaj de verificare (ignora)%'
       )
       GROUP BY conv_id
       ORDER BY MAX(id) DESC LIMIT 100`,
    )
    return r.rows
  } catch {
    return null
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

// AUDIT ADMIN (3 aug, tab Vizitatori): eșecul citirii colapsa în [] → panoul
// afișa „Niciun contact încă" fără nicio măsurătoare. null la eșec → 500.
export async function listLeads(): Promise<Lead[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<Lead>(
      'SELECT id, email, note, contacted, created_at::text FROM leads ORDER BY created_at DESC LIMIT 200',
    )
    return r.rows
  } catch {
    return null
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

// ── Contact messages (the "Contact" form) ───────────────────────────────────
// ALWAYS saved (regardless of email) so no message is ever lost.

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

// Întoarce id-ul rândului (sau null la eșec) — ca `emailed` să poată fi
// actualizat DUPĂ ce trimiterea chiar s-a măsurat (auditul admin, 3 aug:
// „✉️ redirecționat" era scris ÎNAINTE de orice trimitere).
export async function saveContactMessage(m: {
  name: string
  email: string
  subject: string
  message: string
  department: string
  lang: string
  emailed: boolean
}): Promise<number | null> {
  if (!dbEnabled() || !m.email || !m.message) return null
  try {
    const r = await getPool().query<{ id: number }>(
      `INSERT INTO contact_messages (name, email, subject, message, department, lang, emailed)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
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
    return Number(r.rows[0]?.id ?? 0) || null
  } catch {
    return null
  }
}

/** Marchează un mesaj de contact ca REDIRECȚIONAT pe email — se cheamă doar
 *  după ce sendMail a întors true (măsurat, nu presupus). */
export async function marcheazaContactEmailat(id: number): Promise<void> {
  if (!dbEnabled() || !(id > 0)) return
  try {
    await getPool().query('UPDATE contact_messages SET emailed = true WHERE id = $1', [id])
  } catch {
    /* non-fatal — rândul rămâne onest pe „doar salvat" */
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

/** Admin grants credit straight to a user's wallet (a gift, no split). */
export async function grantCredit(email: string, amount: number, currency = config.billing.currency): Promise<void> {
  if (!dbEnabled() || !email || !(amount !== 0)) return
  const e = email.toLowerCase()
  try {
    await getPool().query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES ($1, $2, $3, greatest($2, 0))
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2,
             topup_ref = greatest(wallets.balance + $2, wallets.topup_ref),
             updated_at = now()`,
      [e, amount, currency],
    )
    // AUDIT TRAIL (audit 24 Jul, P2-2): the admin's gift was invisible — no
    // billing_events, no transactions → a hole in the audit trail + the user
    // stayed on "first top-up £20" despite having a balance. Now both ledgers
    // see it.
    await getPool().query(
      `INSERT INTO billing_events (user_email, kind, amount, ref, meta)
       VALUES ($1, 'grant', $2, $3, 'credit admin')`,
      [e, amount, `grant:${e}:${Date.now()}`],
    )
    await getPool().query(
      `INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
       VALUES ($1, $2, $3, 'admin_grant', NULL)`,
      [e, amount, Math.floor(amount / config.billing.creditValue)],
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
    // Full GDPR (audit 24 Jul): besides conversation data, biometric data
    // (voice/face prints), notes and linked Google accounts are also deleted.
    // NOTHING personal remains. (Columns differ across tables — careful: an
    // error inside a Postgres transaction poisons ALL of it, so the list
    // contains ONLY tables+columns verified in the schema above.)
    const targets: [string, string][] = [
      ['messages', 'user_email'], ['user_prefs', 'user_email'], ['memories', 'user_email'],
      ['wallets', 'user_email'], ['visits', 'user_email'], ['blocked_users', 'email'],
      ['voiceprints', 'user_email'], ['faceprints', 'user_email'], ['notes', 'user_email'],
      ['google_accounts', 'email'], ['cost_events', 'user_email'],
    ]
    for (const [t, col] of targets) {
      await client.query(`DELETE FROM ${t} WHERE ${col} = $1`, [e])
    }
    // The FINANCIAL LEDGER (transactions, billing_events) is NOT deleted — the
    // law requires keeping payments — but it is ANONYMIZED: the email becomes
    // an irreversible marker, so it's no longer personal data, while the
    // accounting stays whole.
    await client.query(`UPDATE transactions SET user_id = 'deleted-user' WHERE user_id = $1`, [e])
    await client.query(`UPDATE billing_events SET user_email = 'deleted-user' WHERE user_email = $1`, [e])
    await client.query('COMMIT')
  } catch {
    await client.query('ROLLBACK').catch(() => {})
  } finally {
    client.release()
  }
}

// ── Work orders (persistent builder queue) ──────────────────────────────────

export async function saveWorkOrder(id: string, text: string): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query('INSERT INTO work_orders (id, text) VALUES ($1,$2)', [id, text])
}

// ── Staged releases (persistent approval gate) ──────────────────────────────

// ── Tiny key-value state that must SURVIVE restarts ─────────────────────────
// (e.g. the bridge worker's last-seen beat: a deploy must not blink the light).

// ── LOCAL ACCOUNTS (email + password / magic link) ──────────────────────────
export interface LocalAccount {
  email: string
  name: string
  pass_hash: string
}
export async function getLocalAccount(email: string): Promise<LocalAccount | null> {
  if (!dbEnabled()) return null
  const r = await getPool().query<LocalAccount>(
    'SELECT email, name, pass_hash FROM local_accounts WHERE email=$1',
    [email.toLowerCase().trim()],
  )
  return r.rows[0] ?? null
}
export async function upsertLocalAccount(email: string, name: string, passHash: string): Promise<void> {
  if (!dbEnabled()) throw new Error('db_unavailable')
  await getPool().query(
    `INSERT INTO local_accounts (email, name, pass_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE local_accounts.name END, pass_hash = EXCLUDED.pass_hash`,
    [email.toLowerCase().trim(), name.slice(0, 120), passHash],
  )
}
export async function saveLoginToken(tokenHash: string, email: string, purpose: 'magic' | 'reset', ttlMin: number): Promise<void> {
  if (!dbEnabled()) throw new Error('db_unavailable')
  await getPool().query(
    `INSERT INTO login_tokens (token_hash, email, purpose, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [tokenHash, email.toLowerCase().trim(), purpose, String(ttlMin)],
  )
}
/** Consume the token (single use, unexpired) → its email, otherwise null. */
export async function consumeLoginToken(tokenHash: string, purpose: 'magic' | 'reset'): Promise<string | null> {
  if (!dbEnabled()) return null
  const r = await getPool().query<{ email: string }>(
    `UPDATE login_tokens SET used = true
     WHERE token_hash=$1 AND purpose=$2 AND used=false AND expires_at > now()
     RETURNING email`,
    [tokenHash, purpose],
  )
  return r.rows[0]?.email ?? null
}

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

export async function deleteKv(key: string): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query('DELETE FROM kv_state WHERE key=$1', [key])
}

// ── GESTURES: which gestures Kelion is allowed to use CONTEXTUALLY (Adrian,
// 13 Jul: admin panel with a checkbox per gesture). We store ONLY the disabled
// list (default: all active). The brain reads the list and avoids the gestures
// checked OFF.
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

// AUDIT ADMIN (3 aug, tab Magazine): fără DB, {counts:[]} arăta în panou ca
// „Nicio descărcare înregistrată încă" — un zero fără măsurătoare. `dbOk`
// spune dacă cifrele CHIAR vin dintr-o citire; false → panoul scrie „nu pot
// citi jurnalul", nu zeroul fals.
export async function getDownloadStats(): Promise<{
  dbOk: boolean
  counts: { file: string; total: number }[]
  recent: DownloadRow[]
}> {
  if (!dbEnabled()) return { dbOk: false, counts: [], recent: [] }
  try {
    const counts = await getPool().query<{ file: string; total: number }>(
      'SELECT file, COUNT(*)::int AS total FROM app_downloads GROUP BY file',
    )
    const recent = await getPool().query<DownloadRow>(
      `SELECT file, user_email, ip, country, created_at
       FROM app_downloads ORDER BY created_at DESC LIMIT 100`,
    )
    return { dbOk: true, counts: counts.rows, recent: recent.rows }
  } catch {
    return { dbOk: false, counts: [], recent: [] }
  }
}

// ── Shared memory: the common notebook both sides read + write ──

// ── Prepaid wallet (credit wallet) ──

// ── ONE PERSON'S EMAIL, ONE SINGLE FORM, ACROSS THE WHOLE APP ───────────────
//
// Found first at the wallet (tests, 30 Jul): top-ups had long been writing
// `lower($1)` (audit P2-3), but balance READS and CHARGING used the email
// EXACTLY as it comes from the session. Local login lowercases it; Google
// login does NOT. For an email with capitals ("Ion@Firma.ro") the user paid,
// the credit landed on one row, the app read another → showed him 0 credits
// and stopped him at the paywall, while his consumption opened a SECOND
// wallet, in the negative.
//
// The same crack was open at PREFERENCES (language, role), at AUTO-TOP-UP
// (money: the setting was no longer read → the user was left without credit
// although he had enabled it), at MODEL SELECTION and at avatar layout. All
// of them are now written and read through this single key — one only,
// exported.
export const userKey = (email: string): string => String(email ?? '').trim().toLowerCase()
const walletKey = userKey

/** ── O CITIRE CARE SPUNE DACĂ A REUȘIT (M7b, 8 aug 2026) ───────────────────
 *
 *  Adrian: „le faci corect, măsurat și rezolvat". Continuarea lui M7a (soldul).
 *  Aceleași două capcane, în toate citirile de mai jos:
 *
 *      if (!dbEnabled()) return []      →  „nu e nicio bază"  citit ca „0 rânduri"
 *      catch { return [] }              →  „interogarea a crăpat" citit la fel
 *
 *  Panoul desena apoi „0 utilizatori", „£0.00", „nicio tranzacție" — adică
 *  exact minciuna din regula #1, fix în minutul în care ai nevoie de adevăr.
 *
 *  Un singur înveliș, ca să nu se repete tiparul de cinci ori (și ca poarta de
 *  dubluri să nu aibă ce reclama). O listă GOALĂ citită cu succes rămâne o
 *  listă goală — ăla e un fapt. Doar imposibilitatea de a citi se numește. */
export type Citire<T> = { citit: true; valoare: T } | { citit: false; motiv: string }

async function citireDb<T>(ce: string, fn: () => Promise<T>): Promise<Citire<T>> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    return { citit: true, valoare: await fn() }
  } catch (e) {
    return { citit: false, motiv: `${ce} a picat: ${e instanceof Error ? e.message.slice(0, 140) : String(e)}` }
  }
}

/** ── SOLDUL: „N-AM PUTUT CITI" NU E „AI ZERO" (8 aug 2026) ─────────────────
 *
 *  `getBalance` întorcea `0` și când baza nu era configurată, și când
 *  interogarea crăpa. Consecința nu era cosmetică — soldul e ZID:
 *
 *    chat.ts     : `getBalance(...) <= 0` → paywall („Ai rămas fără credit")
 *    realtime.ts : `bal <= 0` → `stop` → i se TAIE vocea
 *    billing.ts  : £0.00 pe ecran
 *
 *  Adică un sughiț de bază de date îi spunea unui om care ȘI-A PLĂTIT creditul
 *  că a rămas fără bani, și îl bloca. Familia „£0.00", în forma ei cea mai
 *  scumpă.
 *
 *  Aici citirea spune ce s-a întâmplat. Zero RĂMÂNE zero când chiar nu există
 *  rând (utilizator nou, portofel gol) — ăla e un fapt citit, nu o presupunere.
 *  Doar imposibilitatea de a citi se numește pe nume. */
export type CitireSold = { citit: true; sold: number } | { citit: false; motiv: string }

export async function citesteSold(email: string): Promise<CitireSold> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    const r = await getPool().query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_email = $1',
      [walletKey(email)],
    )
    // Fără rând = portofel inexistent = zero REAL, citit. Nu e același lucru
    // cu „n-am ajuns la bază".
    return { citit: true, sold: Number(r.rows[0]?.balance ?? 0) }
  } catch (e) {
    return { citit: false, motiv: `citirea portofelului a picat: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
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
      [walletKey(email), amount],
    )
    await pool.query(
      `INSERT INTO billing_events (user_email, kind, amount, meta) VALUES ($1, 'usage', $2, $3)`,
      [walletKey(email), -amount, meta],
    )
  } catch (e) {
    // We don't break the chat if charging fails — but NEVER silently (audit 27
    // Jul: exactly this empty catch once hid "users consume without being
    // charged"). The error goes into the journal → server_logs → admin audit.
    console.error(`[money] debitWallet FAILED for ${email}, amount ${amount}: ${String(e).slice(0, 200)}`)
  }
}

// The payment idempotency guard: an already-recorded reference is NOT credited
// a second time. Called inside an open transaction (the caller ROLLBACKs if
// true). A single source here (the permanent principle: single, no duplicates).
async function billingRefSeen(client: pg.PoolClient, ref: string): Promise<boolean> {
  const seen = await client.query('SELECT 1 FROM billing_events WHERE ref = $1', [ref])
  return (seen.rowCount ?? 0) > 0
}

/**
 * Top up the user's wallet (payment confirmed — e.g. a Revolut transfer read
 * through Enable Banking). The user KEEPS `userShare` (75%) as spendable
 * credit; the remaining 25% is our profit, taken upfront. Idempotent on `ref`
 * (the payment's unique reference). topup_ref becomes the new full balance —
 * the reference for the percentage alerts.
 */
export async function topUpUser(
  email: string,
  gross: number,
  currency: string,
  ref: string,
): Promise<boolean> {
  if (!dbEnabled() || !(gross > 0) || !ref) return false
  const userCredit = gross * config.billing.userShare
  const profit = gross - userCredit
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    if (await billingRefSeen(client, ref)) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, ref, meta)
       VALUES (lower($1), 'topup', $2, $3, 'user 75%')`,
      [email, userCredit, ref],
    )
    // NORMALIZED email (audit P2-3: an email credited here with a different
    // case was NEVER read by the balance endpoint) + topup_ref = the NEW full
    // BALANCE (audit P1-3: only the last top-up falsified the alert
    // percentage).
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES (lower($1), $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = wallets.balance + $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, ref, meta)
       VALUES (lower($1), 'profit', $2, $3, 'margin 25%')`,
      [email, profit, `${ref}:profit`],
    )
    // VISIBLE ACCOUNTING (Adrian, 24 Jul: "to see for REAL in the database who
    // topped up, how much, and the money split"). Every top-up leaves the full
    // accounting row, in the SAME SQL transaction: the gross amount paid, the
    // credits received (75%), the user and the payment's unique reference.
    await client.query(
      `INSERT INTO transactions (user_id, amount, credits, status, payment_ref)
       VALUES ($1, $2, $3, 'paid', $4)
       ON CONFLICT (payment_ref) DO UPDATE SET status = 'paid'`,
      [email.toLowerCase(), gross, Math.floor(userCredit / config.billing.creditValue), ref],
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

/** Records in the `transactions` table (ORDER #6G). */

export interface Transaction {
  id: number
  user_id: string
  amount: number
  credits: number
  status: string
  payment_ref: string | null
  created_at: string
}

/** A user's purchase history. */
export async function listTransactionsForUser(email: string, limit = 50): Promise<Transaction[]> {
  if (!dbEnabled() || !email) return []
  try {
    const r = await getPool().query<Transaction>(
      `SELECT id, user_id, amount, credits, status, payment_ref, created_at::text
       FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [email.toLowerCase(), Math.max(1, Math.min(500, limit))],
    )
    return r.rows
  } catch {
    return []
  }
}

/** All transactions (admin panel). */
export async function citesteTranzactii(limit = 200): Promise<Citire<Transaction[]>> {
  return citireDb('citirea tranzacțiilor', async () => {
    const r = await getPool().query<Transaction>(
      `SELECT id, user_id, amount, credits, status, payment_ref, created_at::text
       FROM transactions ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(500, limit))],
    )
    return r.rows
  })
}

/** Wallet balance + the last-top-up reference, for the low-credit % alerts. */
/** Ca `citesteSold`, dar cu referința ultimei alimentări (procentul rămas).
 *  Aceeași regulă: o citire imposibilă NU se scrie ca „0 credite". */
export type CitirePortofel = { citit: true; balance: number; topupRef: number } | { citit: false; motiv: string }

export async function citestePortofel(email: string): Promise<CitirePortofel> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    const r = await getPool().query<{ balance: string; topup_ref: string }>(
      'SELECT balance, topup_ref FROM wallets WHERE user_email = lower($1)',
      [email],
    )
    return { citit: true, balance: Number(r.rows[0]?.balance ?? 0), topupRef: Number(r.rows[0]?.topup_ref ?? 0) }
  } catch (e) {
    return { citit: false, motiv: `citirea portofelului a picat: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
  }
}

// Here used to live `loadAdminPool` and `withdrawAdminPool` — the "+ Add
// money" / "− Take out money" buttons that HAND-WROTE how much the man
// thought he had in his pocket. Deleted (Adrian, 30 Jul: "one single
// pocket... only real remains, no hardcode"). How much money you have is read
// from the Revolut account (through Enable Banking) and from OpenRouter,
// which actually hold it; it's no longer declared anywhere.

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

/**
 * Record a plain SITE VISIT (anyone who opens the landing page — not just demo
 * starters). Deduped: the same fingerprint/IP within 6 hours counts once, so a
 * refresh doesn't inflate the numbers. Fire-and-forget; never throws.
 */
/**
 * Adaugă o secțiune în lista `pages` a unui rând de vizită — DISTINCT (nu
 * repetă), separată prin virgulă, plafonată la 400 de caractere. Reutilizată
 * de logVisit (pe dedup) și de touchVisit, ca „ce au vizitat" să se strângă pe
 * ACELAȘI rând, fără să umfle numărul de vizite. Best-effort; nu aruncă.
 */
async function appendPagina(id: number | string, path: string): Promise<void> {
  const p = path.slice(0, 32)
  if (!dbEnabled() || !p) return
  try {
    await getPool().query(
      `UPDATE visits SET pages = CASE
         WHEN pages = '' THEN $2
         WHEN position(',' || $2 || ',' in ',' || pages || ',') > 0 THEN pages
         ELSE left(pages || ',' || $2, 400)
       END
       WHERE id = $1`,
      [id, p],
    )
  } catch {
    /* analytics must never break the app */
  }
}

export async function logVisit(
  fingerprint: string,
  ip: string,
  visit: DemoVisit = EMPTY_VISIT,
  userEmail = '',
  path = '',
): Promise<void> {
  if (!dbEnabled()) return
  try {
    const pool = getPool()
    if (fingerprint || ip) {
      // Deja numărat în fereastra de 6h? Nu adăugăm rând nou (nu umflăm
      // cifrele) — dar REȚINEM secțiunea nou deschisă pe același rând, ca
      // raportul să arate „ce au vizitat" (owner, 13 aug).
      const seen = (
        await pool.query<{ id: string }>(
          `SELECT id FROM visits
           WHERE started_at >= now() - interval '6 hours'
             AND ((fingerprint <> '' AND fingerprint = $1) OR (ip <> '' AND ip = $2))
           ORDER BY started_at DESC LIMIT 1`,
          [fingerprint, ip],
        )
      ).rows[0]
      if (seen) {
        await appendPagina(seen.id, path)
        return
      }
    }
    await pool.query(
      `INSERT INTO visits
         (fingerprint, ip, country, country_code, city, region, isp, tz,
          browser, os, device, lang, referrer, is_bot, user_email, pages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        fingerprint, ip, visit.country, visit.code, visit.city, visit.region,
        visit.isp, visit.tz, visit.browser, visit.os, visit.device, visit.lang,
        visit.referrer, visit.isBot, userEmail, path.slice(0, 32),
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
  path = '',
): Promise<boolean> {
  if (!dbEnabled()) return true
  try {
    const r = await getPool().query<{ id: string }>(
      `UPDATE visits
       SET last_seen_at = now(), actions = actions + 1,
           user_email = CASE WHEN user_email = '' THEN $3 ELSE user_email END
       WHERE id = (SELECT id FROM visits
                   WHERE started_at >= now() - interval '6 hours'
                     AND ((user_email <> '' AND user_email = $3)
                          OR (fingerprint <> '' AND fingerprint = $1)
                          OR (ip <> '' AND ip = $2))
                   ORDER BY started_at DESC LIMIT 1)
       RETURNING id`,
      [fingerprint, ip, email],
    )
    const id = r.rows[0]?.id
    if (id) await appendPagina(id, path) // „ce au vizitat" pe rândul curent
    return (r.rowCount ?? 0) > 0
  } catch {
    return true /* analytics must never break the app */
  }
}

/**
 * GOLEȘTE BAZA DE VIZITATORI (owner, 13 aug: „golești baza de date de vizitatori,
 * cine va fi acolo va avea o poză cu acceptul lor"). Șterge TOATE rândurile din
 * `visits` — analiza de vizitatori + pozele de vizitator (photo_url), ca de-aici
 * încolo tot ce apare în raport să fie cu consimțământ (poarta GDPR). NU atinge
 * conturile, plățile, faceprints-urile utilizatorilor logați. Întoarce câte
 * rânduri a șters (măsurat), sau -1 dacă baza nu e disponibilă (nu inventăm 0).
 */
export async function purgeVisits(): Promise<number> {
  if (!dbEnabled()) return -1
  const r = await getPool().query('DELETE FROM visits')
  return r.rowCount ?? 0
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
// AUDIT ADMIN (3 aug, tab Utilizatori): o eroare de DB întorcea {users:[],
// sessions:[]} cu 200 — panoul afișa „încă nu s-a strâns activitate", o
// afirmație nemăsurată (forma „Cardul: necreat"). Acum: null la eșec → ruta
// răspunde 500, panoul spune „nu pot citi", nu „nu există activitate".
export async function getUserActivity(): Promise<{
  users: UserActivityRow[]
  sessions: UserSessionRow[]
} | null> {
  if (!dbEnabled()) return null
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
                COALESCE((SELECT w.balance FROM wallets w WHERE w.user_email = v.user_email), 0)::float AS balance,
                COALESCE((SELECT SUM(c.cost_usd) FROM cost_events c WHERE c.user_email = v.user_email), 0)::float AS "consumedUsd"
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
    return null
  }
}



// The owner's visitor analytics (admin only): EVERY site visit — totals, a
// breakdown by country, and the latest arrivals with their full profile.
// The "demo probes" half is DEAD (nothing writes demo_uses anymore), so we no
// longer query that table; the demo fields stay 0/empty so the SHAPE of the
// DemoStats type doesn't change (the frontend doesn't break).
// AUDIT ADMIN (3 aug, tab Vizitatori): o eroare de DB întorcea `empty`
// (visitsTotal:0, bots:0) cu 200 — cardurile arătau „Vizite 0/0" ca măsurătoare,
// fix tiparul „£0.00" din 30 iul. Acum: null la eșec (ruta răspunde 500, panoul
// scrie „nu pot citi"), zerourile rămân DOAR pentru o citire reușită.
export async function getDemoStats(): Promise<DemoStats | null> {
  if (!dbEnabled()) return null
  try {
    const pool = getPool()
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
         FROM visits
         GROUP BY country, country_code ORDER BY COUNT(*) DESC LIMIT 30`,
      )
    ).rows.map((r) => ({ country: r.country, code: r.country_code, count: Number(r.n) }))
    const recent = (
        // Rândul citit din DB e chiar DemoRecent, dar cu `country_code` în loc de
        // `code` (mapat mai jos). Derivat din tip, nu re-scris — altfel lista de
        // câmpuri se dublează literă cu literă cu DemoRecent (poarta jscpd).
      await pool.query<Omit<DemoRecent, 'code'> & { country_code: string }>(
        // FULL VISIT PROFILE (Adrian, 31 Jul: "visitors, this field must give
        // full information about the visit"). Two things that change how you
        // read a row were missing: the TIMEZONE (the `tz` column existed in
        // the table and wasn't read — it tells you HIS time, not yours) and
        // whether it's the FIRST visit or a returning one (same fingerprint
        // earlier). A visitor coming back for the third time is not the same
        // thing as one who landed on the site once.
        `SELECT 'visit'::text AS kind, v.ip, v.country, v.country_code, v.city, v.region, v.isp,
                v.browser, v.os, v.device, v.lang, v.referrer, v.is_bot, v.started_at,
                '' AS session_email, '' AS topic, v.tz, v.photo_url, v.pages,
                (SELECT COUNT(*)::int - 1 FROM visits p
                  WHERE p.fingerprint = v.fingerprint AND p.fingerprint <> ''
                    AND p.started_at <= v.started_at) AS vizite_anterioare
         FROM visits v ORDER BY v.started_at DESC LIMIT 60`,
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
      tz: r.tz ?? '',
      vizite_anterioare: Math.max(0, Number(r.vizite_anterioare ?? 0)),
      photo_url: r.photo_url ?? '',
      pages: r.pages ?? '',
    }))
    return {
      total: 0,
      today: 0,
      bots: Number(vCounts?.bots ?? 0),
      visitsTotal: Number(vCounts?.total ?? 0),
      visitsToday: Number(vCounts?.today ?? 0),
      byCountry,
      recent,
    }
  } catch {
    return null
  }
}

// ── THE OWNER'S REAL ACCOUNTING — NOTHING DECLARED BY HAND ──────────────────
//
// Adrian, 30 Jul: "one single pocket, remove the lies from the platform; only
// REAL remains, no hardcode."
//
// What there was before: `loaded` — a figure TYPED into the panel ("+ Add
// money" / "− Take out money") — and `remaining = loaded − spent`. Nothing
// ever checked it against Stripe or OpenRouter. Meaning the panel could show
// "you still have £50" while the provider account was at zero. A figure the
// man writes is not a measurement, it's an opinion — and with money, an
// opinion displayed as fact is a lie. DELETED, together with the buttons that
// wrote it.
//
// What remains here is ONLY measurements:
//   • `spent`  — the sum of the REAL costs reported by providers on each call
//                (cost_events, written by recordCost from their response);
//   • `profit` — the sum of margins from the payments ledger (billing_events),
//                which comes from real verified payments, not estimates.
// The actual pocket (how much you have left) is NO LONGER kept here: it's read
// LIVE from the Revolut account (through Enable Banking). (Soldul OpenRouter a
// dispărut odată cu furnizorul — extirpat, 3 aug; starea creierului Gemini se
// vede prin pingul live geminiLive().) The source of truth is with the bank.
//
// AICI A STAT `getAdminAccount` (spent/profit). ȘTEARSĂ (auditul admin, 3 aug):
// `spent` era EXACT suma pe care tabul Bani o citește deja din getCostSummary
// (același SELECT SUM(cost_usd)), `profit` nu era desenat nicăieri, iar la
// eșec funcția inventa {spent:0, profit:0} — fix tiparul „£0.00" din 30 iul.
// Consumatorii ei (ruta /api/admin/pool, câmpul `pool` din brain-credit și
// spent/profit din finance) au fost scoși odată cu ea.

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

// EVIDENȚA TIMPILOR (Adrian, 3 aug). Fire-and-forget, ca recordCost — nu rupe
// niciodată tura dacă măsurarea eșuează. `ms` = durata reală a creierului.
export interface TaskTiming {
  email: string
  kind: string
  model?: string | null
  ms: number
  ok?: boolean
  rounds?: number | null
}
export async function recordTiming(t: TaskTiming): Promise<void> {
  if (!dbEnabled() || !(t.ms >= 0)) return
  try {
    await getPool().query(
      'INSERT INTO task_timings (user_email, kind, model, ms, ok, rounds) VALUES ($1,$2,$3,$4,$5,$6)',
      [t.email, t.kind, t.model ?? null, Math.round(t.ms), t.ok ?? true, t.rounds ?? null],
    )
  } catch {
    // Never break a request because timing failed.
  }
}

export interface TimingRow {
  kind: string
  model: string | null
  ms: number
  ok: boolean
  rounds: number | null
  created_at: string
}
export async function recentTimings(limit = 500): Promise<TimingRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<TimingRow>(
      'SELECT kind, model, ms, ok, rounds, created_at FROM task_timings ORDER BY created_at DESC LIMIT $1',
      [Math.max(1, Math.min(5000, limit))],
    )
    return r.rows
  } catch {
    return []
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
  } catch (e) {
    // NUMIT, nu înghițit (8 aug, captura „nu poate fi redat"): dacă INSERT-ul
    // pică tăcut, imaginea trăiește DOAR în memoria procesului — următoarea
    // publicare o șterge și monitorul arată un 404 drept „codec neacceptat".
    console.error(`[imagine] salvarea în DB a picat (imaginea NU supraviețuiește restartului): ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`)
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
  /** How much of `total` comes from a provider MEASUREMENT (OpenRouter
   *  `usage.cost` — the money it said it took). */
  masurat: number
  /** How much is OUR ESTIMATE, with fixed rates written in `cost.ts` (voice
   *  minutes × $0.35, TTS characters, Serper calls…). It's not what it cost —
   *  it's what we believe it cost. Adrian, 31 Jul: "where did the $504 value
   *  come from?" — from here, and it should have been written from the
   *  start. */
  estimat: number
  /** What kind of figure each row is, so the panel can't present it wrong. */
  felul: Record<string, 'masurat' | 'estimat'>
}

// The only kind of cost that comes MEASURED from the provider: brain calls,
// where OpenRouter returns `usage.cost` with its real money. Everything else
// is fixed rates I wrote — useful as an order of magnitude, false as "real".
// 'gemini' și 'image' SCOASE de aici (agenții de debug, 3 aug, verdict REAL):
// după migrarea pe cheia Tier 2, Google NU întoarce dolari în răspuns —
// tokenii sunt măsurați, dar prețul e tariful publicat scris de mână
// (geminiDirect.ts) → după chiar definiția acestui set, e „estimat", nu
// „măsurat". Un 0 (sau orice produs tarif×tokeni) afișat ca „măsurat" e exact
// cifra falsă din regula #1.
const COSTURI_MASURATE = new Set(['chat', 'memory'])

// ── PASTILA GEMINI (Adrian, 3 aug: „vreau să văd și aici creditul de la gemini") ─
// Gemini Tier 2 e plătit postpaid pe contul Google al ownerului — nu are un
// „sold" ca OpenRouter. Măsura ONESTĂ e cheltuiala reală făcută pe apelurile
// google-direct, luată din PROPRIUL nostru jurnal (cost_events, kind='gemini',
// scris cu usageMetadata-ul lui Gemini). Luna curentă, ca pastila OpenAI.
// Întotdeauna „live" (e jurnalul nostru, mereu citibil); 0 REAL înseamnă 0
// cheltuit luna asta, nu o citire eșuată.
/** ── CHELTUIALA LUNII PE FURNIZOR (Adrian, 8 aug: „raportarea reală a
 *  creditului rămas pe fiecare AI") ─────────────────────────────────────────
 *
 *  Citirea de mai jos era lipită de `kind = 'gemini'`. Ca să pot spune, pentru
 *  FIECARE furnizor, cât s-a dus din creditul lui, suma trebuie să se poată
 *  cere pe orice set de feluri. Un fel care se termină în `*` e prefix — vocea
 *  se înregistrează ca `tts:google`, `tts:eleven` etc., deci `tts:*`.
 *
 *  `ok:false` NU e „0 dolari": e „n-am putut citi". Apelantul e obligat să facă
 *  diferența — de-aia cifra vine împreună cu ea, nu singură. */
// Corpul comun al celor două sume pe feluri (9 aug, jscpd — erau aproape
// identice). `filtruTimp` e o clauză SQL de timp CONTROLATĂ DE COD (nu vine
// niciodată din input, deci fără risc de injecție); `paramTimp` = parametrul
// ei ($3), sau undefined când clauza n-are parametru. Felurile: exact = exact,
// `*` la coadă = prefix.
async function sumaCostPeKinduri(
  kinds: string[],
  filtruTimp: string,
  paramTimp?: string,
): Promise<{ ok: boolean; usd: number }> {
  if (!dbEnabled() || kinds.length === 0) return { ok: false, usd: 0 }
  const exacte = kinds.filter((k) => !k.endsWith('*'))
  const prefixe = kinds.filter((k) => k.endsWith('*')).map((k) => `${k.slice(0, -1)}%`)
  const params: unknown[] = [exacte, prefixe]
  if (paramTimp !== undefined) params.push(paramTimp)
  try {
    const r = await getPool().query<{ s: string | null }>(
      `SELECT COALESCE(SUM(cost_usd), 0) AS s
         FROM cost_events
        WHERE ${filtruTimp}
          AND (kind = ANY($1::text[]) OR kind LIKE ANY($2::text[]))`,
      params,
    )
    return { ok: true, usd: Number(r.rows[0]?.s ?? 0) }
  } catch {
    return { ok: false, usd: 0 }
  }
}

export async function cheltuialaLunaPeKinduri(kinds: string[]): Promise<{ ok: boolean; usd: number }> {
  return sumaCostPeKinduri(kinds, "created_at >= date_trunc('month', now())")
}

/** ── CHELTUIALA DE LA UN MOMENT DAT (Adrian, 8 aug: „asta trebuie să scadă
 *  real cum e afișat la ei pe site") ──────────────────────────────────────────
 *
 *  Creditul declarat de owner e soldul DIN MOMENTUL declarării. Ca pastila să
 *  scadă corect, din el se scade DOAR ce s-a cheltuit DUPĂ acel moment — nu
 *  luna întreagă (luna ar include și banii arși ÎNAINTE de declarare, iar
 *  pastila ar minți în jos). Aceeași semantică a felurilor ca la sora ei de
 *  mai sus: exact = exact, `*` la coadă = prefix. */
export async function cheltuialaDeLaPeKinduri(
  deLaIso: string,
  kinds: string[],
): Promise<{ ok: boolean; usd: number }> {
  if (!Number.isFinite(Date.parse(deLaIso))) return { ok: false, usd: 0 }
  return sumaCostPeKinduri(kinds, 'created_at >= $3::timestamptz', deLaIso)
}

export async function getGeminiMonthUsd(): Promise<{ ok: boolean; monthUsd: number }> {
  const r = await cheltuialaLunaPeKinduri(['gemini'])
  return { ok: r.ok, monthUsd: r.usd }
}

/** ── RESETTING THE CONSUMPTION COUNTERS ─────────────────────────────────────
 *
 *  Adrian, 30 Jul: "reset all counters to 0; only the AI money, let it
 *  reflect what credits are now; for the rest, zero out what was consumed."
 *  And immediately: "it must be put in the right place, because credits once
 *  consumed do NOT get refunded."
 *
 *  That's why we delete EXACTLY one thing: `cost_events` — the journal of our
 *  costs at providers, i.e. "how much it cost us". This counter is only
 *  history; nobody reads it to decide anything.
 *
 *  INTENTIONALLY UNTOUCHED:
 *    • `wallets`       — the users' credits. Consumed = consumed; putting them
 *                        back would mean a refund nobody asked for.
 *    • `billing_events`— the real payments ledger (top-ups, margins, refunds).
 *                        It's accounting; it's only deleted on account deletion.
 *    • `transactions`  — each person's purchase history.
 *
 *  The AI money (the pocket) has nothing to reset: it's read LIVE from the
 *  bank account (through Enable Banking) and from the brain provider, so it
 *  always reflects what's there now. */
export async function resetCostCounters(): Promise<{ ok: boolean; sterse: number }> {
  if (!dbEnabled()) return { ok: false, sterse: 0 }
  try {
    const r = await getPool().query('DELETE FROM cost_events')
    return { ok: true, sterse: r.rowCount ?? 0 }
  } catch {
    return { ok: false, sterse: 0 }
  }
}

/** Rezumatul costurilor, ca CITIRE (M7b, 8 aug — ultima rămasă): `getCostSummary`
 *  întorcea zerouri și când baza era picată — fix tiparul „£0.00" din 30 iul,
 *  o citire eșuată prezentată ca fapt. Acum: ori cifrele măsurate, ori
 *  `{citit:false, motiv}` — iar consumatorii spun „nu pot citi", nu „0". */
export async function citesteRezumatCost(): Promise<Citire<CostSummary>> {
  return citireDb('citirea jurnalului de cost', async () => {
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
    const felul: Record<string, 'masurat' | 'estimat'> = {}
    let masurat = 0
    let estimat = 0
    for (const r of kinds.rows) {
      const v = Number(r.sum)
      byKind[r.kind] = v
      const e = COSTURI_MASURATE.has(r.kind)
      felul[r.kind] = e ? 'masurat' : 'estimat'
      if (e) masurat += v
      else estimat += v
    }
    return {
      total: Number(totals.rows[0]?.total ?? 0),
      today: Number(totals.rows[0]?.today ?? 0),
      byKind,
      masurat,
      estimat,
      felul,
    }
  })
}

// Per-user speech language — persists across sessions for as long as the user
// exists. Returns null when unset (the client then auto-detects).
export async function getSpeechLang(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ speech_lang: string | null }>(
      'SELECT speech_lang FROM user_prefs WHERE user_email = $1',
      [userKey(email)],
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
      [userKey(email), lang],
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
      [userKey(email)],
    )
    return r.rows[0]?.meserie_activa ?? null
  } catch {
    return null
  }
}

/** The voice chosen by the user (null = the app's default). */
export async function getVoicePref(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ voice: string | null }>(
      'SELECT voice FROM user_prefs WHERE user_email = $1',
      [userKey(email)],
    )
    return r.rows[0]?.voice ?? null
  } catch {
    return null
  }
}

export async function setVoicePref(email: string, voice: string | null): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO user_prefs (user_email, voice, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_email) DO UPDATE SET voice = $2, updated_at = now()`,
      [userKey(email), voice],
    )
  } catch {
    // Don't break the voice if saving the preference fails.
  }
}

export async function setMeserieActivaPref(email: string, id: number | null): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO user_prefs (user_email, meserie_activa, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_email) DO UPDATE SET meserie_activa = $2, updated_at = now()`,
      [userKey(email), id],
    )
  } catch {
    // Never break the chat because persistence failed.
  }
}

// ── AUTO TOP-UP (the checkbox in Settings / on the credits page) ────────────
// Same single-key persistence pattern as the other preferences. The shape is
// always returned complete (defaults included), so the UI never guesses.
export interface AutoRechargePrefs {
  enabled: boolean
  /** credits — below this, the app prepares the payment automatically */
  threshold: number
  /** pounds — the pack prepared each time (multiple of 5, like any top-up) */
  topupAmount: number
}

export async function getAutoRecharge(email: string): Promise<AutoRechargePrefs> {
  // The defaults are OWNER SETTINGS from config (Billing section), not magic
  // numbers buried here — threshold in credits, amount in display currency.
  const def: AutoRechargePrefs = {
    enabled: false,
    threshold: config.billing.autoRechargeThreshold,
    topupAmount: config.billing.autoRechargeAmount,
  }
  if (!dbEnabled()) return def
  try {
    const r = await getPool().query<{
      autorecharge_enabled: boolean
      autorecharge_threshold: number
      autorecharge_amount: number
    }>(
      'SELECT autorecharge_enabled, autorecharge_threshold, autorecharge_amount FROM user_prefs WHERE user_email = $1',
      [userKey(email)],
    )
    const row = r.rows[0]
    if (!row) return def
    return {
      enabled: !!row.autorecharge_enabled,
      threshold: Number(row.autorecharge_threshold ?? def.threshold),
      topupAmount: Number(row.autorecharge_amount ?? def.topupAmount),
    }
  } catch {
    return def
  }
}

export async function setAutoRecharge(email: string, p: AutoRechargePrefs): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO user_prefs (user_email, autorecharge_enabled, autorecharge_threshold, autorecharge_amount, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_email) DO UPDATE
         SET autorecharge_enabled = $2, autorecharge_threshold = $3, autorecharge_amount = $4, updated_at = now()`,
      [userKey(email), p.enabled, p.threshold, p.topupAmount],
    )
  } catch {
    // Never break the app because a preference failed to save.
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

export async function citesteUtilizatori(): Promise<Citire<UserSummary[]>> {
  return citireDb('citirea utilizatorilor', async () => {
    const r = await getPool().query<UserSummary>(
      `SELECT user_email AS email, COUNT(*)::int AS count, MAX(created_at) AS last
       FROM messages GROUP BY user_email ORDER BY last DESC`,
    )
    return r.rows
  })
}

// ── MESSENGER KELION↔KELION (Adrian, 11 aug) — rezolvarea „apelează-l pe X" la un
// user REAL. Nu există o tabelă master de conturi (identitatea e emailul), deci
// numele vin din local_accounts / voiceprints / faceprints, iar emailul e cheia
// peste tot. Căutăm după email (exact/parțial) SAU nume (exact/parțial) și dedup
// pe email (preferăm rândul cu nume). Folosit de services/apel.ts la inițiere.
export interface UtilizatorApel {
  email: string
  name: string
}
export async function cautaUtilizatorApel(termen: string): Promise<Citire<UtilizatorApel[]>> {
  return citireDb('căutarea utilizatorului pentru apel', async () => {
    const t = termen.toLowerCase().trim()
    if (!t) return []
    const like = `%${t}%`
    const r = await getPool().query<UtilizatorApel>(
      `SELECT email, name FROM (
         SELECT lower(email) AS email, name FROM local_accounts
         UNION
         SELECT lower(user_email) AS email, name FROM voiceprints
         UNION
         SELECT lower(user_email) AS email, name FROM faceprints
         UNION
         SELECT lower(email) AS email, NULL::text AS name FROM google_accounts
       ) u
       WHERE lower(u.email) = $1 OR lower(u.email) LIKE $2
          OR lower(coalesce(u.name,'')) = $1 OR lower(coalesce(u.name,'')) LIKE $2
       LIMIT 12`,
      [t, like],
    )
    const map = new Map<string, UtilizatorApel>()
    for (const row of r.rows) {
      const ex = map.get(row.email)
      if (!ex || (!ex.name && row.name)) map.set(row.email, { email: row.email, name: row.name || '' })
    }
    return [...map.values()]
  })
}

export interface HistoryRow {
  role: string
  content: string
  created_at: string
}

export async function citesteIstoric(email: string, limit = 1000): Promise<Citire<HistoryRow[]>> {
  return citireDb('citirea istoricului', async () => {
    const r = await getPool().query<HistoryRow>(
      `SELECT role, content, created_at FROM messages
       WHERE user_email = $1 ORDER BY created_at ASC LIMIT $2`,
      [email, limit],
    )
    return r.rows
  })
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

/** Caută în istoricul COMPLET de chat al userului (voce + scris) după cuvinte-
 *  cheie — accesul lui Kelion la conversații mai vechi decât fereastra de
 *  continuitate de 24 de ture (Adrian, 10 aug: „Kelion trebuie să aibă acces la
 *  istoricul de chat al meu cu el"). */
export async function cautaIstoric(email: string, query: string, limit = 20): Promise<HistoryRow[]> {
  if (!dbEnabled() || !query.trim()) return []
  try {
    const r = await getPool().query<HistoryRow>(
      `SELECT role, content, created_at FROM messages
         WHERE user_email = $1 AND content ILIKE $2
         ORDER BY created_at DESC LIMIT $3`,
      [email, `%${query.trim().slice(0, 120)}%`, Math.min(Math.max(limit, 1), 50)],
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
    // Real full-text (Adrian, 11 Jul): each keyword is an OR term in the
    // query, with PREFIX MATCHING (`:*`) — it finds memories containing ANY
    // word that STARTS with the search term (cafea → cafeaua, catches the
    // Romanian plural/declension without a language dictionary), in ANY
    // order, not just an exact literal substring. PROVEN with real tests
    // (local Postgres): 'simple' config without prefix missed "cafeaua" when
    // searching "cafea" (a regression vs ILIKE) — the prefix fixes exactly
    // that. Results are SORTED by relevance (`ts_rank`), not just recency —
    // an old but highly relevant fact is no longer buried by a recent but
    // off-topic one.
    // Each token must remain ONE alphanumeric word — everything else (spaces,
    // punctuation, tsquery operators) REMOVED completely, not just replaced
    // with a space (a leftover internal space breaks to_tsquery syntax, proven
    // with a real test: "o'reilly!" → "o reilly" → syntax error).
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

// Forgetting on demand (#20, Adrian 10 Jul): the user is the master of his
// memory — "forget that..." deletes the facts matching the fragment. Returns
// how many were deleted, so Kelion can confirm honestly (0 = found nothing to
// forget).
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
  // Kelion's autonomous decision ("TO IMPLEMENT: ..." / "AUTONOMOUSLY CLOSED: ...").
  triage?: string | null
  created_at: string
  last_seen: string
}

/**
 * Record a request Kelion couldn't fulfil. Near-identical open requests are
 * de-duplicated (hits++ and recency refreshed) so the list stays a signal, not
 * a flood. Never throws — logging a gap must never affect the conversation.
 */
// Întoarce `true` DOAR când s-a înregistrat un gol NOU (nu la duplicat) — ca
// apelantul să poată anunța owner-ul o singură dată (K14), nu la fiecare repetare.
export async function logCapabilityGap(email: string, request: string, reason = ''): Promise<boolean> {
  const req = request.trim().slice(0, 500)
  if (!dbEnabled() || !req) return false
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
      return false
    }
    await pool.query(
      'INSERT INTO capability_gaps (user_email, request, reason) VALUES ($1, $2, $3)',
      [email, req, reason.trim().slice(0, 500) || null],
    )
    return true
  } catch {
    // Best-effort — never break the chat because gap logging failed.
    return false
  }
}

/** Open capability gaps, most-requested / most-recent first (admin only). */
// ── REQUIREMENTS: a single place, with the whole journey ────────────────────
export interface Cerinta {
  id: number
  text: string
  sursa: string
  stare: string
  criteriu: string | null
  prioritate: number
  dificultate: number
  optiuni: string | null
  aleasa: string | null
  dovada: string | null
  job_id: number | null
  pr_url: string | null
  created_at: Date
  updated_at: Date
}

/** Write a requirement. Duplicates are not added: same request, same row —
 *  otherwise the list would fill with variations of the same thing and it
 *  would stop being management and become noise. */
export async function adaugaCerinta(
  text: string,
  sursa = 'owner',
  criteriu?: string,
  prioritate = 5,
): Promise<number> {
  if (!dbEnabled()) return 0
  const t = text.trim().slice(0, 4000)
  if (!t) return 0
  try {
    // DEDUP FUZZY (K16): nu doar text identic, ci și reformulări (diacritice,
    // punctuație, ordinea cuvintelor) — o cerință deja deschisă, chiar spusă
    // altfel, nu mai intră a doua oară (dubluri = timp + bani irosiți în buclă).
    const deschise = await getPool().query<{ id: string | number; text: string }>(
      `SELECT id, text FROM cerinte WHERE stare <> 'respinsa' ORDER BY created_at DESC LIMIT 200`,
    )
    for (const row of deschise.rows) {
      if (esteDuplicat(t, String(row.text))) return Number(row.id)
    }
    const r = await getPool().query<{ id: string | number }>(
      'INSERT INTO cerinte (text, sursa, criteriu, prioritate) VALUES ($1,$2,$3,$4) RETURNING id',
      [t, sursa, criteriu ?? null, Math.max(1, Math.min(9, Math.round(prioritate) || 5))],
    )
    return Number(r.rows[0]?.id ?? 0)
  } catch {
    return 0
  }
}

export async function listeazaCerinte(stare?: string, limit = 100): Promise<Cerinta[]> {
  if (!dbEnabled()) return []
  try {
    const r = stare
      ? await getPool().query<Cerinta>(
          'SELECT * FROM cerinte WHERE stare = $1 ORDER BY prioritate ASC, created_at ASC LIMIT $2',
          [stare, limit],
        )
      : await getPool().query<Cerinta>('SELECT * FROM cerinte ORDER BY created_at DESC LIMIT $1', [limit])
    return r.rows
  } catch {
    return []
  }
}

/** Move the requirement along its journey. Only the given fields are touched
 *  — the rest stay. */
export async function actualizeazaCerinta(
  id: number,
  p: Partial<Pick<Cerinta, 'stare' | 'criteriu' | 'optiuni' | 'aleasa' | 'dovada' | 'pr_url' | 'prioritate' | 'dificultate'>> & { job_id?: number },
): Promise<void> {
  if (!dbEnabled() || !id) return
  const campuri: string[] = []
  const val: unknown[] = [id]
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    val.push(v)
    campuri.push(`${k} = $${val.length}`)
  }
  if (!campuri.length) return
  try {
    await getPool().query(`UPDATE cerinte SET ${campuri.join(', ')}, updated_at = now() WHERE id = $1`, val)
  } catch {
    /* never break the turn for a bookkeeping write */
  }
}

/** How many days a RESOLVED gap stays in the list before it removes itself. */
const ZILE_GOL_REZOLVAT = 7

export async function getCapabilityGaps(includeResolved = false, limit = 200): Promise<CapabilityGap[]> {
  if (!dbEnabled()) return []
  try {
    // SELF-CLEANING (Adrian, 31 Jul: "what's with all these? if they're no
    // longer needed they must self-clean"). The panel held requests marked
    // "Resolved" from 27-28 Jul — some saying "I have no code tools", about
    // tools it has had since. A resolved row stays a week (so you see it if
    // you look in those days), then leaves by itself. No button to press.
    void getPool()
      .query(`DELETE FROM capability_gaps WHERE resolved = true AND last_seen < now() - interval '${ZILE_GOL_REZOLVAT} days'`)
      .catch(() => {})
    const where = includeResolved ? '' : 'WHERE resolved = false'
    const r = await getPool().query<CapabilityGap>(
      `SELECT id, user_email, request, reason, hits, resolved, escalated, triage, created_at, last_seen
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

/** Șterge DEFINITIV o cerere neacoperită (Adrian, 3 aug: „trebuie să aibă
 *  butoane de ștergere, sau rezolvate și arhivate"). Rezolvarea = arhivare
 *  (rândul iese din lista implicită, rămâne la „toate"); asta e ștergerea
 *  adevărată, pentru zgomot/duplicate. `true` doar dacă rândul chiar a existat. */
export async function deleteCapabilityGap(id: number): Promise<boolean> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return false
  try {
    const r = await getPool().query('DELETE FROM capability_gaps WHERE id = $1', [id])
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

/** Kelion's triage decision on a gap (+ any automatic closing). */
export async function setGapTriage(id: number, triage: string, resolved: boolean): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      'UPDATE capability_gaps SET triage = $2, triaged_at = now(), resolved = $3 WHERE id = $1',
      [id, triage.slice(0, 500), resolved],
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
    // The meaning vector, ASYNCHRONOUSLY (doesn't hold the turn): if the
    // embedding fails, the memory stays anyway — full-text finds it by words.
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

// BACKFILL (12 Jul): memories from before semantic memory also get a vector,
// in small batches (called periodically from index.ts) — after a few hours the
// whole past is searchable by meaning. Negligible cost (Gemini embeddings).
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

// SEMANTIC RECALL (12 Jul): the memories closest in MEANING to the question —
// complements full-text (which requires shared words). The vectors of the last
// ~400 memories are compared in Node (cosine); a threshold so we don't inject
// noise.
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

// ── Explicit user notes ("remember this") ──

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

// ── KELION'S SELF-EXPANSION — tools proposed by it, approved by the owner ───
export interface KelionTool {
  id: number
  name: string
  description: string
  paramsJson: string
  httpMethod: string
  httpUrl: string
  httpHeaders: string
  status: string
  rationale: string | null
  createdAt: string
}

/** Kelion proposes a new tool (stays 'pending' until the owner approves). */
export async function proposeKelionTool(t: {
  name: string
  description: string
  paramsJson: string
  httpMethod: string
  httpUrl: string
  httpHeaders?: string
  rationale?: string
}): Promise<number | null> {
  if (!dbEnabled()) return null
  const name = t.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
  if (!name || !/^https:\/\//i.test(t.httpUrl)) return null // HTTPS only
  try {
    const r = await getPool().query<{ id: number }>(
      `INSERT INTO kelion_tools (name, description, params_json, http_method, http_url, http_headers, rationale, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       ON CONFLICT (name) DO UPDATE SET description=$2, params_json=$3, http_method=$4, http_url=$5, http_headers=$6, rationale=$7, status='pending', created_at=now(), decided_at=NULL
       RETURNING id`,
      [name, t.description.slice(0, 500), t.paramsJson || '{}', (t.httpMethod || 'GET').toUpperCase(), t.httpUrl, t.httpHeaders || '{}', t.rationale?.slice(0, 500) ?? null],
    )
    return r.rows[0]?.id ?? null
  } catch {
    return null
  }
}

/** Kelion's tools by status ('pending' | 'approved' | 'rejected'). */
export async function listKelionTools(status?: string): Promise<KelionTool[]> {
  if (!dbEnabled()) return []
  try {
    const r = status
      ? await getPool().query('SELECT * FROM kelion_tools WHERE status=$1 ORDER BY created_at DESC', [status])
      : await getPool().query('SELECT * FROM kelion_tools ORDER BY created_at DESC')
    return r.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id), name: String(row.name), description: String(row.description),
      paramsJson: String(row.params_json), httpMethod: String(row.http_method), httpUrl: String(row.http_url),
      httpHeaders: String(row.http_headers), status: String(row.status),
      rationale: (row.rationale as string) ?? null, createdAt: String(row.created_at),
    }))
  } catch {
    return []
  }
}

/** The owner approves/rejects a proposed tool (one click in admin). */
export async function decideKelionTool(id: number, approve: boolean): Promise<boolean> {
  if (!dbEnabled()) return false
  try {
    const r = await getPool().query(
      `UPDATE kelion_tools SET status=$2, decided_at=now() WHERE id=$1`,
      [id, approve ? 'approved' : 'rejected'],
    )
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

// Which of these UIDs are ALREADY in inbound_emails. The poller's pre-filter
// (26 Jul): lets it download the body ONLY for new messages, not for all of
// the last 100 — bulk downloading was the cause of the timeouts that kept the
// mailbox dead. On any error we return the empty set: the poller then
// downloads at most the capped batch and the dedupe in saveInboundEmail
// (ON CONFLICT) still prevents any double reply.
export async function knownInboundUids(uids: string[]): Promise<Set<string>> {
  if (!dbEnabled() || uids.length === 0) return new Set()
  try {
    const r = await getPool().query('SELECT uid FROM inbound_emails WHERE uid = ANY($1)', [uids])
    return new Set(r.rows.map((x: { uid: string }) => String(x.uid)))
  } catch {
    return new Set()
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
  // The median pitch — the gender is inferred from THIS (robust to tracker
  // spikes). Optional: old clients don't send it.
  pitchMedian?: number
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
  // THE PAIRED FACE (Adrian, Aug 1: „every voiceprint must be paired with an
  // image capture” — it WAS saved, in `faceprints`, but the panel never
  // showed it, so it looked unexecuted). The list now joins the photo.
  hasFace: boolean
  facePhoto: string
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
  face_photo?: string | null
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
    hasFace: !!r.face_photo,
    facePhoto: r.face_photo || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function saveVoiceprint(
  v: {
    email: string
    name: string
    gender: VoiceprintRow['gender']
    isAdmin: boolean
    features: number[]
    featureMeta: VoiceFeatureMeta
    audioClip?: string
  },
  opts: { adapt?: boolean } = {},
): Promise<void> {
  if (!dbEnabled() || !v.email) return
  try {
    // Plafon 256 (Adrian, 6 aug): amprenta NEURALĂ (wespeaker) are 256 de valori —
    // vechiul cap de 64 o tăia și o rupea. Cele vechi (9/64) încap în continuare.
    let vec = v.features.filter((x) => Number.isFinite(x)).slice(0, 256)
    let gender = v.gender
    let featureMeta: VoiceFeatureMeta = v.featureMeta
    // ADAPTATION, NOT OVERWRITE (Adrian, Aug 1: his print flip-flopped
    // male↔female as single bad pitch readings rewrote it on every matching
    // turn). On an adaptation save: (1) the stored GENDER wins — it was set at
    // enrolment from a full phrase and never flips on one utterance; (2) the
    // vector BLENDS (70% old + 30% new) so one bad read can't drag the
    // reference away from the holder's real timbre; (3) the meta blends the
    // same way, keeping the stored gender's pitch evidence.
    if (opts.adapt) {
      const cur = await getPool().query<{
        features: number[]
        gender: VoiceprintRow['gender']
        feature_meta: VoiceFeatureMeta
      }>('SELECT features, gender, feature_meta FROM voiceprints WHERE user_email = $1', [v.email.toLowerCase()])
      const old = cur.rows[0]
      if (old?.features?.length) {
        if (old.gender && old.gender !== 'unknown') gender = old.gender
        const len = Math.min(old.features.length, vec.length)
        vec = vec.map((x, i) => (i < len ? 0.7 * old.features[i] + 0.3 * x : x))
        const om = old.feature_meta ?? ({} as VoiceFeatureMeta)
        featureMeta = {
          ...v.featureMeta,
          pitchMean: om.pitchMean ? 0.7 * om.pitchMean + 0.3 * v.featureMeta.pitchMean : v.featureMeta.pitchMean,
          pitchMedian:
            om.pitchMedian && v.featureMeta.pitchMedian
              ? 0.7 * om.pitchMedian + 0.3 * v.featureMeta.pitchMedian
              : (v.featureMeta.pitchMedian ?? om.pitchMedian),
        }
      }
    }
    // The audio sample: we only keep it if it's reasonable in size (≤ ~600KB
    // base64, a few seconds of webm/opus). Too big → we don't store it, but
    // identification still works.
    const clip = typeof v.audioClip === 'string' && v.audioClip.length <= 600_000 ? v.audioClip : ''
    await getPool().query(
      `INSERT INTO voiceprints
         (user_email, name, gender, is_admin, features, feature_meta, audio_clip, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_email) DO UPDATE
         SET name = $2, gender = $3, is_admin = $4, features = $5,
             feature_meta = $6,
             -- new clip only if one arrived; otherwise keep the old sample.
             audio_clip = CASE WHEN $7 <> '' THEN $7 ELSE voiceprints.audio_clip END,
             updated_at = now()`,
      [v.email.toLowerCase(), v.name, gender, v.isAdmin, vec, JSON.stringify(featureMeta), clip],
    )
  } catch {
    // Never break the chat because voiceprint persistence failed.
  }
}

// The audio sample of a voiceprint (data-URL) — only for the "play" button in
// admin.
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

// ── GUEST VOICES (Adrian, Aug 1) ─────────────────────────────────────────────
// The people the HOLDER explicitly allows to talk to Kelion on his account
// (wife, son, daughter, friend...). The print + relation are remembered for
// future chats — but ONLY after the holder approves (approve_guest_voice).
export interface GuestVoiceRow {
  id: number
  accountEmail: string
  name: string
  relation: string
  features: number[]
  approved: boolean
  hasPhoto: boolean
  createdAt: string
  updatedAt: string
}

interface GuestVoiceDbRow {
  id: string
  account_email: string
  name: string
  relation: string
  features: number[]
  approved: boolean
  has_photo: boolean
  created_at: Date
  updated_at: Date
}

function rowToGuestVoice(r: GuestVoiceDbRow): GuestVoiceRow {
  return {
    id: Number(r.id),
    accountEmail: r.account_email,
    name: r.name,
    relation: r.relation,
    features: Array.isArray(r.features) ? r.features : [],
    approved: r.approved,
    hasPhoto: r.has_photo,
    createdAt: r.created_at?.toISOString?.() ?? '',
    updatedAt: r.updated_at?.toISOString?.() ?? '',
  }
}

export async function saveGuestVoice(g: {
  accountEmail: string
  name: string
  relation: string
  features: number[]
  featureMeta: unknown
}): Promise<number | null> {
  if (!dbEnabled() || !g.accountEmail) return null
  try {
    const vec = g.features.filter((x) => Number.isFinite(x)).slice(0, 64)
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO voice_guests (account_email, name, relation, features, feature_meta, updated_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [g.accountEmail.toLowerCase(), g.name, g.relation, vec, JSON.stringify(g.featureMeta ?? {})],
    )
    return r.rows[0] ? Number(r.rows[0].id) : null
  } catch {
    return null
  }
}

export async function listGuestVoices(accountEmail: string, onlyApproved = false): Promise<GuestVoiceRow[]> {
  if (!dbEnabled() || !accountEmail) return []
  try {
    const r = await getPool().query<GuestVoiceDbRow>(
      `SELECT id, account_email, name, relation, features, approved,
              (photo <> '') AS has_photo, created_at, updated_at
       FROM voice_guests
       WHERE account_email = $1 ${onlyApproved ? 'AND approved' : ''}
       ORDER BY updated_at DESC LIMIT 50`,
      [accountEmail.toLowerCase()],
    )
    return r.rows.map(rowToGuestVoice)
  } catch {
    return []
  }
}

// The newest guest print still awaiting the holder's approval.
export async function latestPendingGuest(accountEmail: string): Promise<GuestVoiceRow | null> {
  if (!dbEnabled() || !accountEmail) return null
  try {
    const r = await getPool().query<GuestVoiceDbRow>(
      `SELECT id, account_email, name, relation, features, approved,
              (photo <> '') AS has_photo, created_at, updated_at
       FROM voice_guests
       WHERE account_email = $1 AND NOT approved
       ORDER BY updated_at DESC LIMIT 1`,
      [accountEmail.toLowerCase()],
    )
    return r.rows[0] ? rowToGuestVoice(r.rows[0]) : null
  } catch {
    return null
  }
}

// The holder's decision on a guest print: approve (optionally correcting the
// name/relation) or reject (the row is deleted — the voice returns to being
// ignored).
export async function decideGuestVoice(id: number, approve: boolean, name?: string, relation?: string): Promise<boolean> {
  if (!dbEnabled() || !id) return false
  try {
    if (approve) {
      await getPool().query(
        `UPDATE voice_guests SET approved = true,
           name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
           relation = CASE WHEN $3 <> '' THEN $3 ELSE relation END,
           updated_at = now()
         WHERE id = $1`,
        [id, name ?? '', relation ?? ''],
      )
    } else {
      await getPool().query('DELETE FROM voice_guests WHERE id = $1 AND NOT approved', [id])
    }
    return true
  } catch {
    return false
  }
}

// The guest's photo (the camera frame that rode along on their turn).
export async function attachGuestPhoto(id: number, photo: string): Promise<void> {
  if (!dbEnabled() || !id || !photo) return
  try {
    if (photo.length > 900_000) return // same sanity cap as the voice clip
    await getPool().query('UPDATE voice_guests SET photo = $2, updated_at = now() WHERE id = $1', [id, photo])
  } catch {
    /* never break the chat for a photo */
  }
}

// Forget guest(s) by name (the holder's "uită-o pe X"). Returns how many.
export async function forgetGuestVoices(accountEmail: string, name: string): Promise<number> {
  if (!dbEnabled() || !accountEmail || !name) return 0
  try {
    const r = await getPool().query(
      'DELETE FROM voice_guests WHERE account_email = $1 AND lower(name) = lower($2)',
      [accountEmail.toLowerCase(), name.trim()],
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}

export async function listVoiceprints(limit = 200): Promise<VoiceprintRow[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<VoiceprintDbRow>(
      `SELECT v.user_email, v.name, v.gender, v.is_admin, v.features, v.feature_meta,
              (v.audio_clip <> '') AS has_audio,
              NULLIF(f.photo, '') AS face_photo,
              v.created_at, v.updated_at
       FROM voiceprints v
       LEFT JOIN faceprints f ON f.user_email = v.user_email
       ORDER BY v.updated_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows.map(rowToVoiceprint)
  } catch {
    return []
  }
}

// The common core of the two distances (normalized voice + raw face): the sum
// of squared differences across components + the compared length. Single
// source — the two functions differ ONLY in the final normalization (single,
// no duplicates).
function sumSquaredDiff(a: number[], b: number[]): { sum: number; len: number } {
  const len = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    sum += d * d
  }
  return { sum, len }
}

/** Euclidean distance between two equal-length vectors. */
export function vectorDistance(a: number[], b: number[]): number {
  const { sum, len } = sumSquaredDiff(a, b)
  if (len === 0) return Infinity
  return Math.sqrt(sum / len)
}

// Here used to live `identifyVoiceprint` — it searched through ALL voiceprints
// for "who is speaking" (1:N). Nobody ever called it. The product rule is ONE
// person per account (Adrian, 29 Jul), so the correct recognition is the one
// that actually runs: 1:1 VERIFICATION — "is it the account holder or someone
// else?" (chat.ts and realtime.ts, via vectorDistance). Deleted: abandoned
// code, not capability.

// ── Face identification by faceprint (128-d descriptor from face-api) ───────
// Camera on + voice = Kelion automatically captures the speaker's face,
// compares it with the account holder's reference and tells the brain
// "holder / someone else". NO button — triggered by voice, same as voiceprint.

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

/** RAW Euclidean distance (not normalized) — the face-api convention,
 *  threshold ~0.6. */
export function faceDistance(a: number[], b: number[]): number {
  const { sum, len } = sumSquaredDiff(a, b)
  if (len === 0) return Infinity
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
    // We keep the thumbnail small (avoids DB bloat); if missing, we don't
    // overwrite.
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

// ── THE BUILDER — the build-order queue (Adrian, 27 Jul) ────────────────────
export interface BuildJob {
  id: number
  orderedBy: string
  orderText: string
  status: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  branch: string | null
  prUrl: string | null
  tokens: number
  log: string | null
  progress: string | null
  ci: string | null
  // Aug 2: which brain ran the order ('fable-5' | 'free') and the cost in USD
  // as measured from OpenRouter (null = not reported by the provider).
  brain: string | null
  costUsd: number | null
  createdAt: string
  updatedAt: string
}

interface BuildJobDbRow {
  id: string | number
  ordered_by: string
  order_text: string
  status: string
  attempts: number
  branch: string | null
  pr_url: string | null
  tokens: string | number
  log: string | null
  progress?: string | null
  ci?: string | null
  brain?: string | null
  cost_usd?: string | number | null
  created_at: Date
  updated_at: Date
}

function rowToBuildJob(r: BuildJobDbRow): BuildJob {
  return {
    id: Number(r.id),
    orderedBy: r.ordered_by,
    orderText: r.order_text,
    status: (['queued', 'running', 'done', 'failed'].includes(r.status) ? r.status : 'failed') as BuildJob['status'],
    attempts: r.attempts,
    branch: r.branch,
    prUrl: r.pr_url,
    tokens: Number(r.tokens),
    log: r.log,
    progress: r.progress ?? null,
    ci: r.ci ?? null,
    brain: r.brain ?? null,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function createBuildJob(orderedBy: string, orderText: string): Promise<number> {
  if (!dbEnabled()) return 0
  const r = await getPool().query<{ id: string | number }>(
    'INSERT INTO build_jobs (ordered_by, order_text) VALUES ($1, $2) RETURNING id',
    [orderedBy.toLowerCase(), orderText],
  )
  return Number(r.rows[0]?.id ?? 0)
}

/** Ordinele EȘUATE de tot din ultimele `hours` ore — pentru ochiul auto-vindecării
 *  (owner, 14 aug: „rezolvată definitiv partea cu eșuatul ordinelor"): un ordin
 *  mort nu are voie să moară în tăcere; alarma se dă o singură dată per ordin. */
export async function listFailedBuildJobsRecent(
  hours = 24,
): Promise<{ id: number; orderText: string; log: string; attempts: number }[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<{ id: string | number; order_text: string; log: string; attempts: number }>(
      `SELECT id, order_text, COALESCE(log,'') AS log, attempts FROM build_jobs
       WHERE status='failed' AND updated_at > now() - ($1 || ' hours')::interval
       ORDER BY updated_at DESC LIMIT 20`,
      [String(hours)],
    )
    return r.rows.map((x) => ({ id: Number(x.id), orderText: x.order_text, log: x.log, attempts: x.attempts }))
  } catch {
    return []
  }
}

// Cât timp de TĂCERE (fără nicio raportare de progres) până când un ordin
// „running" e considerat BLOCAT — worker-ul lui a murit (omorât de `timeout
// 1800` din constructor-worker.sh) și nimeni nu-l mai duce. Era 40 de minute
// (Adrian, 5 aug: „pleacă enorm de greu să rezolve orice cerere" — un job agățat
// ținea coada blocată 40 de minute). E scăzut la 15: worker-ul viu trimite
// progres la fiecare pas, iar pasul cel mai lung fără bătaie de inimă e un `npm`
// cu timeout de 10 min — deci 15 min de tăcere = worker mort, sigur. Flock-ul de
// pe VPS (un singur worker odată) apără oricum de dubla-execuție.
const MIN_JOB_BLOCAT = 15

// The worker takes ONE order: the oldest "queued", or a stuck "running"
// (>15 min silent — the agent was killed by timeout). Over 2 attempts → failed,
// so an impossible order doesn't block the queue forever.
export async function claimNextBuildJob(): Promise<BuildJob | null> {
  if (!dbEnabled()) return null
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE build_jobs SET status='failed', log = COALESCE(log,'') || E'\\n[abandoned: 3 attempts exhausted]', updated_at = now()
       WHERE status='running' AND updated_at < now() - interval '${MIN_JOB_BLOCAT} minutes' AND attempts >= 3`,
    )
    const r = await client.query<BuildJobDbRow>(
      `UPDATE build_jobs SET status='running', attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM build_jobs
         WHERE status='queued' OR (status='running' AND updated_at < now() - interval '${MIN_JOB_BLOCAT} minutes')
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
    )
    await client.query('COMMIT')
    return r.rows[0] ? rowToBuildJob(r.rows[0]) : null
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return null
  } finally {
    client.release()
  }
}

export async function reportBuildJob(
  id: number,
  fields: { status: 'done' | 'failed'; branch?: string; prUrl?: string; tokens?: number; log?: string; ci?: string; brain?: string; costUsd?: number },
): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(
    `UPDATE build_jobs SET status=$2, branch=COALESCE($3, branch), pr_url=COALESCE($4, pr_url),
       tokens = tokens + $5, log = $6, ci = COALESCE($7, ci), brain = COALESCE($8, brain), cost_usd = COALESCE($9, cost_usd),
       updated_at = now() WHERE id = $1`,
    [
      id,
      fields.status,
      fields.branch ?? null,
      fields.prUrl ?? null,
      fields.tokens ?? 0,
      (fields.log ?? '').slice(-20000) || null,
      fields.ci ?? null,
      fields.brain ?? null,
      fields.costUsd ?? null,
    ],
  )
}

// AUDIT ADMIN (3 aug, Constructor): eroarea de DB colapsa în [] cu 200 →
// coada apărea „goală" deși nu fusese citită. null la eșec; consumatorii
// best-effort (audit, health, dovezi) cad explicit pe `?? []`, iar ruta
// panoului răspunde 500 ca UI-ul să scrie „nu pot citi coada".
export async function listBuildJobs(limit = 40): Promise<BuildJob[] | null> {
  if (!dbEnabled()) return null
  try {
    // Exclude ARHIVATELE (K9): ordinele vechi terminate nu mai încarcă panoul,
    // dar rămân în DB (recuperabile), nu se pierd.
    const r = await getPool().query<BuildJobDbRow>(
      'SELECT * FROM build_jobs WHERE arhivat = false ORDER BY created_at DESC LIMIT $1',
      [limit],
    )
    return r.rows.map(rowToBuildJob)
  } catch {
    return null
  }
}

/** Cât a cheltuit constructorul AZI — suma `cost_usd` MĂSURATĂ a joburilor de
 *  azi (UTC). Pentru plafonul zilnic de ardere (B8/K15). Doar cifre reale de la
 *  furnizor; joburile fără cost raportat (ex. RunPod pe timp-GPU) nu se numără —
 *  nu inventăm o cheltuială. */
export async function cheltuitAziConstructor(): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ s: string | null }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS s FROM build_jobs
        WHERE cost_usd IS NOT NULL AND updated_at::date = (now() AT TIME ZONE 'UTC')::date`,
    )
    return Number(r.rows[0]?.s ?? 0) || 0
  } catch {
    return 0
  }
}

/** AUTO-ARHIVARE (K9 + K13): ordinele TERMINATE (done/failed) mai vechi de
 *  `zile` se marchează arhivate — ies din panou, rămân în DB. Nu atinge niciodată
 *  ordinele vii (queued/running). Întoarce câte a arhivat. Rulată de bucla de
 *  autonomie (curățenie automată, „când e gata"). */
export async function arhiveazaBuildJobsVechi(zile = 1): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const z = Math.max(1, Math.min(90, Math.round(zile) || 1))
    const r = await getPool().query(
      `UPDATE build_jobs SET arhivat = true
        WHERE arhivat = false
          AND status IN ('done','failed')
          AND updated_at < now() - ($1 || ' days')::interval`,
      [z],
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}

// LIVE PROGRESS (Stage 4): writes the builder's current step. ONLY on active
// jobs (`running`) — doesn't overwrite the terminal state of a done/failed
// job.
export async function updateBuildJobProgress(id: number, progress: string): Promise<void> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return
  try {
    await getPool().query(
      `UPDATE build_jobs SET progress=$2, progress_at=now(), updated_at=now() WHERE id=$1 AND status='running'`,
      [id, progress.slice(0, 500)],
    )
  } catch {
    /* progress is best-effort — it stops nothing if it fails */
  }
}

// The jobs for the LIVE DISPLAY on the monitor (Stage 4b): the active ones
// (queued / running) PLUS the RECENTLY finished (last 10 min). Without
// "recently finished", the panel would delete the job at the very moment it
// becomes "Done"/"Failed" — exactly the state Adrian wants to SEE. Active
// first, then by how recently they moved; a few, as many as fit on screen.
export async function listMonitorBuildJobs(): Promise<BuildJob[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<BuildJobDbRow>(
      `SELECT * FROM build_jobs
         WHERE status IN ('queued','running')
            OR (status IN ('done','failed') AND updated_at > now() - interval '10 minutes')
       ORDER BY
         CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,
         COALESCE(progress_at, updated_at, created_at) DESC
       LIMIT 10`,
    )
    return r.rows.map(rowToBuildJob)
  } catch {
    return []
  }
}

// ── KELION POATE STĂPÂNI ORDINELE (Adrian, 3 aug: „kelion nu are instrument să
// modifice, să șteargă, sau să le șteargă în grup") ─────────────────────────
// Până acum putea DOAR să creeze (build_software) și să vadă (constructor_status).
// Acum poate și: să șteargă unul, să șteargă în GRUP (toate eșuate / toate
// terminate), să reia (opțional cu textul reformulat = „modifică"), și să
// anuleze unul în curs. Toate ADMIN-only, expuse prin unealta `constructor_manage`.

/** Șterge DEFINITIV un ordin după id. `true` dacă a existat și s-a șters. */
export async function deleteBuildJob(id: number): Promise<boolean> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return false
  try {
    const r = await getPool().query('DELETE FROM build_jobs WHERE id=$1', [id])
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

/** Ștergere în GRUP după stare. `scope`: 'failed' (doar eșuate), 'done' (doar
 *  terminate), 'failed_done' (eșuate + terminate — cele „istorice", NU cele în
 *  curs), 'all' (chiar tot). Nu atinge NICIODATĂ ordinele 'queued'/'running'
 *  decât la 'all' — un ordin viu nu se șterge din greșeală. Întoarce câte a șters. */
// AUDIT ADMIN (3 aug): la eroare de DB întorcea 0 → panoul afișa „Curățat: 0
// ordine șterse." ca rezultat măsurat, deși ștergerea nu rulase deloc (zeroul
// fals interzis de regula #1). null = eșec (ruta răspunde 500); 0 rămâne
// posibil DOAR ca număr real de rânduri șterse.
export async function deleteBuildJobsByScope(
  scope: 'failed' | 'done' | 'failed_done' | 'all',
): Promise<number | null> {
  if (!dbEnabled()) return null
  const stariCurente: Record<typeof scope, string[] | null> = {
    failed: ['failed'],
    done: ['done'],
    failed_done: ['failed', 'done'],
    all: null, // null = fără filtru (chiar tot)
  }
  const stari = stariCurente[scope]
  try {
    const r =
      stari === null
        ? await getPool().query('DELETE FROM build_jobs')
        : await getPool().query('DELETE FROM build_jobs WHERE status = ANY($1)', [stari])
    return r.rowCount ?? 0
  } catch {
    return null
  }
}

/** Reia un ordin (îl repune în coadă). Opțional cu textul REFORMULAT — asta e
 *  „modificarea": schimbă comanda și o repornește curat (attempts=0). Întoarce
 *  jobul actualizat sau null.
 *
 *  ACCEPTĂ ȘI 'running' (Adrian, 5 aug: „dacă apăs reia reparația nu face nimic"
 *  — ordinul #94 era agățat în 'running', worker-ul lui murise, dar butonul
 *  „reia" chema retryBuildJob care ignora 'running' → 409 → buton mort). Când
 *  OMUL apasă reia, e o comandă explicită: „ăsta e blocat, repornește-l". Un
 *  worker cu adevărat viu ar fi trimis progres în ultimele 15 min; dacă totuși
 *  mai raportează după reluare, e cazul de graniță acceptat — ordinul rulează o
 *  dată, nu se pierde. Nu mai lăsăm un job mort să țină coada blocată. */
export async function retryBuildJob(id: number, newOrderText?: string): Promise<BuildJob | null> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return null
  const text = (newOrderText ?? '').trim()
  try {
    const r = await getPool().query<BuildJobDbRow>(
      `UPDATE build_jobs
         SET status='queued', attempts=0,
             order_text = CASE WHEN $2 <> '' THEN $2 ELSE order_text END,
             log = COALESCE(log,'') || E'\\n[repus în coadă de owner${text ? ' cu ordin reformulat' : ''}]',
             updated_at = now()
       WHERE id=$1 AND status IN ('failed','done','queued','running')
       RETURNING *`,
      [id, text.slice(0, 4000)],
    )
    return r.rows[0] ? rowToBuildJob(r.rows[0]) : null
  } catch {
    return null
  }
}

/** Anulează un ordin în curs sau în coadă: îl trece pe 'failed' cu marcaj de
 *  anulare, ca lucrătorul să nu-l mai ia. `true` dacă exista ceva de oprit. */
export async function cancelBuildJob(id: number): Promise<boolean> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return false
  try {
    const r = await getPool().query(
      `UPDATE build_jobs
         SET status='failed',
             log = COALESCE(log,'') || E'\\n[anulat de owner]',
             updated_at = now()
       WHERE id=$1 AND status IN ('queued','running')`,
      [id],
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

// AUTOMATIC HEALING OF ORDERS THAT FAILED ON MONEY (Adrian, 27 Jul: "why
// doesn't the healing system see it, fix it? — automatically?"): an order that
// failed because the brain had no credit (402/credits) is not an impossible
// order — it's an order that FELL TO POVERTY. When the pocket is positive
// again, we requeue it OURSELVES, once only (a marker in the log so we don't
// cycle), with the attempts counter reset.
export async function requeueMoneyFailedBuildJobs(): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ id: string | number }>(
      `UPDATE build_jobs
         SET status='queued', attempts=0,
             log = COALESCE(log,'') || E'\\n[healer: requeued — it had failed on lack of credit, the pocket is full again]',
             updated_at = now()
       WHERE status='failed'
         AND updated_at > now() - interval '72 hours'
         AND log ~* '(402|requires more credits|insufficient credits)'
         AND log NOT LIKE '%[healer: requeued%'
       RETURNING id`,
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}

// ── KELION'S EYES ON THE PERMANENT STORAGE (Adrian, 27 Jul: "access to any of
// the app's databases") — the full schema + direct SQL, for the admin tools
// db_tables/db_query in chat. Caps: 200 rows out and a 10s statement_timeout,
// so a heavy query can't choke the live app.
export async function dbTablesOverview(): Promise<string> {
  if (!dbEnabled()) return JSON.stringify({ error: 'db_indisponibil' })
  try {
    const cols = await getPool().query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    )
    const counts = await getPool().query<{ relname: string; n: string }>(
      `SELECT relname, n_live_tup AS n FROM pg_stat_user_tables ORDER BY relname`,
    )
    const nByTable = new Map(counts.rows.map((r) => [r.relname, Number(r.n)]))
    const tables: Record<string, { rows: number; columns: string[] }> = {}
    for (const c of cols.rows) {
      tables[c.table_name] ??= { rows: nByTable.get(c.table_name) ?? 0, columns: [] }
      tables[c.table_name].columns.push(`${c.column_name} ${c.data_type}`)
    }
    return JSON.stringify({ database: 'postgres (the app)', tables })
  } catch (e) {
    return JSON.stringify({ error: String((e as Error).message ?? e) })
  }
}

export async function dbQuery(sql: string): Promise<string> {
  if (!dbEnabled()) return JSON.stringify({ error: 'db_indisponibil' })
  const text = sql.trim()
  if (!text) return JSON.stringify({ error: 'sql_gol' })
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = '10s'`)
    const r = await client.query(text)
    await client.query('COMMIT')
    const rows = (r.rows ?? []).slice(0, 200)
    return JSON.stringify({
      command: r.command,
      rowCount: r.rowCount ?? rows.length,
      rows,
      truncated: (r.rows?.length ?? 0) > 200 ? true : undefined,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return JSON.stringify({ error: String((e as Error).message ?? e) })
  } finally {
    client.release()
  }
}

// ── PAYMENT WITH A UNIQUE CODE (Adrian, 30 Jul: "every payment must come with
// a unique code") ─────────────────────────────────────────────────────────────
//
// The flow, end to end:
//   1. the user presses "add credit"  → `creeazaCodPlata` gives him a code
//   2. he pays in Revolut, with the code in the reference
//   3. the transaction reader finds the code → `crediteazaDupaCod` gives him
//      the credits
//
// The code is not a secret — it's just a label tying the payment to the
// person. That's why it can be short and easy to type. What matters is that it
// doesn't repeat while pending.

/** Alphabet WITHOUT the characters that get confused when read/typed:
 *  0/O, 1/I/L. The person copies it from the screen into the banking app —
 *  every ambiguous character is a payment that lands "unassigned" and manual
 *  work for the admin. */
const COD_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function codNou(): string {
  const b = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += COD_ALFABET[b[i] % COD_ALFABET.length]
  // Grouped 4+4: easier to read and type than a long string.
  return `KLN-${s.slice(0, 4)}-${s.slice(4)}`
}

export interface CodPlata {
  code: string
  amount: number
  currency: string
}

/** Give the user a new code for the payment he's starting NOW. */
export async function creeazaCodPlata(email: string, amount: number, currency = config.billing.currency): Promise<CodPlata | null> {
  if (!dbEnabled() || !email || !(amount > 0)) return null
  const e = email.toLowerCase().trim()
  // Collision is practically impossible (31^8), but "practically impossible"
  // is not "impossible", and here two people's money would get mixed: we
  // retry.
  for (let i = 0; i < 5; i++) {
    const code = codNou()
    try {
      await getPool().query(
        `INSERT INTO payment_codes (code, user_email, amount, currency) VALUES ($1, $2, $3, $4)`,
        [code, e, amount, currency],
      )
      return { code, amount, currency }
    } catch {
      /* code already exists → try again */
    }
  }
  return null
}

/** Find the code in a bank reference text and credit, ONCE only.
 *
 *  `bankRef` is the bank's transaction identifier: it's what makes crediting
 *  idempotent. The same transaction read ten times credits once — guaranteed
 *  by the unique index, not by the caller's care.
 *
 *  Returns the credited email, or null if no code was found, or if the
 *  payment had already been credited. */
export async function crediteazaDupaCod(
  referinta: string,
  suma: number,
  moneda: string,
  bankRef: string,
): Promise<string | null> {
  if (!dbEnabled() || !referinta || !(suma > 0) || !bankRef) return null
  // The code may come glued to other text ("payment KLN-AB12-CD34 credits"),
  // in lowercase, or with spaces instead of dashes — we accept them all.
  const m = referinta.toUpperCase().replace(/\s+/g, '-').match(/KLN-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  if (!m) return null
  const code = m[0]
  const client = await getPool().connect()
  let email = ''
  try {
    await client.query('BEGIN')
    // `FOR UPDATE` + the status condition: two simultaneous reads can't both
    // take the same code.
    const r = await client.query(
      `SELECT user_email FROM payment_codes WHERE code = $1 AND status = 'pending' FOR UPDATE`,
      [code],
    )
    const row = r.rows[0] as { user_email?: string } | undefined
    if (!row?.user_email) {
      await client.query('ROLLBACK')
      return null
    }
    email = row.user_email
    await client.query('ROLLBACK') // release the lock: crediting opens its own transaction
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return null
  } finally {
    client.release()
  }
  // ORDER MATTERS, and it's chosen deliberately: WE CREDIT FIRST, close the
  // code after.
  //
  // `topUpUser` is idempotent on the reference (the unique index on `ref`), so
  // a second read of the same transaction can't credit twice. If we closed the
  // code first and crediting failed, the person would be left with the payment
  // "closed" and no credits — i.e. exactly paid-but-not-delivered. Conversely,
  // if crediting succeeds and closing the code fails, the next read retries:
  // crediting doesn't repeat (idempotent), and the code closes then.
  const ok = await topUpUser(email, suma, moneda, bankRef)
  if (!ok) return null
  await getPool()
    .query(
      `UPDATE payment_codes SET status = 'paid', bank_ref = $2, paid_at = now(), amount = $3
        WHERE code = $1 AND status = 'pending'`,
      [code, bankRef, suma],
    )
    .catch(() => null)
  return email
}

/** The user's still-pending code from the last 2 hours — REUSED so three
 *  clicks on "add credit" don't mint three valid codes and leave the person
 *  guessing which one to write. (The old comment here described the
 *  unattributed-payments net — a feature that lived only in prose; the real
 *  net is below: `salveazaPlataNeatribuita` & friends.) */
export async function codPlataInAsteptare(email: string): Promise<CodPlata | null> {
  if (!dbEnabled() || !email) return null
  const r = await getPool()
    .query(
      `SELECT code, amount, currency FROM payment_codes
        WHERE user_email = $1 AND status = 'pending' AND created_at > now() - interval '2 hours'
        ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase().trim()],
    )
    .catch(() => null)
  const row = r?.rows[0] as { code?: string; amount?: string; currency?: string } | undefined
  return row?.code ? { code: row.code, amount: Number(row.amount ?? 0), currency: row.currency ?? config.billing.currency } : null
}

// ── THE NET: UNATTRIBUTED PAYMENTS (M2, Aug 2) ─────────────────────────────
//
// "O plată fără cod, sau cu cod greșit, ajunge în plati_neatribuite — nu
// dispare" (the M2 order). Until today that sentence was prose: the reader
// counted the unmatched inflow in a local variable and threw it away. Now
// every inflow the reader could not credit lands in the table, exactly once
// (bank_ref UNIQUE + ON CONFLICT DO NOTHING), and the admin assigns or
// dismisses it from the panel. Better to ask than to credit the wrong person.

export interface PlataNeatribuita {
  id: number
  bankRef: string
  referinta: string
  amount: number
  currency: string
  status: string
  seenAt: string
}

/** Record an inflow nobody could be credited for. Idempotent on the bank's
 *  transaction id — the 5-minute reader re-sees old transactions forever.
 *  Returns true only when the row is NEW. */
export async function salveazaPlataNeatribuita(
  bankRef: string,
  referinta: string,
  amount: number,
  currency: string,
): Promise<boolean> {
  if (!dbEnabled() || !bankRef || !(amount > 0)) return false
  const r = await getPool()
    .query(
      `INSERT INTO plati_neatribuite (bank_ref, referinta, amount, currency) VALUES ($1, $2, $3, $4)
        ON CONFLICT (bank_ref) DO NOTHING`,
      [bankRef, referinta || '', amount, currency || config.billing.currency],
    )
    .catch(() => null)
  return (r?.rowCount ?? 0) > 0
}

/** A payment already credited must NOT re-enter the net: after a code is
 *  closed (status 'paid'), the same bank transaction keeps appearing in every
 *  read, `crediteazaDupaCod` correctly returns null for it — and without this
 *  guard every SUCCESSFUL payment would land in the net one pass later,
 *  dressed up as a problem. The ledger's `ref` is the bank id, so one lookup
 *  answers it. */
export async function refCreditatDeja(bankRef: string): Promise<boolean> {
  if (!dbEnabled() || !bankRef) return false
  const r = await getPool()
    .query(`SELECT 1 FROM billing_events WHERE ref = $1`, [bankRef])
    .catch(() => null)
  return (r?.rowCount ?? 0) > 0
}

/** The open rows of the net, newest first — what the panel shows.
 *
 *  AUDIT ADMIN (3 aug, plasa): o citire EȘUATĂ colapsa în [] și panoul afișa
 *  senin „Nimic în plasă." — un gol fals, exact ce interzice regula #1 (aici
 *  stau banii pe care nu i-a potrivit nimeni). Acum null = citirea a picat
 *  (UI-ul o spune ca eșec), [] = plasa e CHIAR goală. */
export async function listeazaPlatiNeatribuite(limit = 50): Promise<PlataNeatribuita[] | null> {
  if (!dbEnabled()) return null
  const r = await getPool()
    .query(
      `SELECT id, bank_ref, referinta, amount, currency, status, seen_at FROM plati_neatribuite
        WHERE status = 'noua' ORDER BY seen_at DESC LIMIT $1`,
      [limit],
    )
    .catch(() => null)
  if (!r) return null
  return r.rows.map((row) => {
    const x = row as {
      id?: number
      bank_ref?: string
      referinta?: string
      amount?: string
      currency?: string
      status?: string
      seen_at?: string
    }
    return {
      id: Number(x.id ?? 0),
      bankRef: String(x.bank_ref ?? ''),
      referinta: String(x.referinta ?? ''),
      amount: Number(x.amount ?? 0),
      currency: String(x.currency ?? config.billing.currency),
      status: String(x.status ?? 'noua'),
      seenAt: String(x.seen_at ?? ''),
    }
  })
}

/** The admin ties a netted payment to a person. Credits THROUGH `topUpUser`
 *  with the bank id as the reference — so if the code-matching path somehow
 *  processes the same transaction later, the unique ledger index refuses the
 *  double, not anyone's care. Returns:
 *  'creditat' (done) · 'negasit' (no open row with this id) ·
 *  'deja' (that bank transaction had already credited someone) · 'esec'. */
export async function atribuiePlataNeatribuita(
  id: number,
  email: string,
): Promise<'creditat' | 'negasit' | 'deja' | 'esec'> {
  if (!dbEnabled() || !(id > 0) || !email) return 'esec'
  const e = email.toLowerCase().trim()
  const r = await getPool()
    .query(
      `SELECT bank_ref, amount, currency FROM plati_neatribuite WHERE id = $1 AND status = 'noua'`,
      [id],
    )
    .catch(() => null)
  const row = r?.rows[0] as { bank_ref?: string; amount?: string; currency?: string } | undefined
  if (!row?.bank_ref) return 'negasit'
  const ok = await topUpUser(e, Number(row.amount ?? 0), row.currency ?? config.billing.currency, row.bank_ref)
  if (!ok) {
    // `topUpUser` is idempotent on the reference: false here means either the
    // transaction had already credited someone, or the write failed. Tell the
    // truth apart — the caller shows different messages for them.
    return (await refCreditatDeja(row.bank_ref)) ? 'deja' : 'esec'
  }
  await getPool()
    .query(
      `UPDATE plati_neatribuite SET status = 'atribuita', resolved_email = $2, resolved_at = now()
        WHERE id = $1 AND status = 'noua'`,
      [id, e],
    )
    .catch(() => null)
  return 'creditat'
}

/** The admin dismisses a netted inflow (the owner's unrelated income). */
export async function ignoraPlataNeatribuita(id: number): Promise<boolean> {
  if (!dbEnabled() || !(id > 0)) return false
  const r = await getPool()
    .query(
      `UPDATE plati_neatribuite SET status = 'ignorata', resolved_at = now() WHERE id = $1 AND status = 'noua'`,
      [id],
    )
    .catch(() => null)
  return (r?.rowCount ?? 0) > 0
}

/** The panel's summary (M3): codes issued/paid + the open net, with the most
 *  recent codes so the admin sees WHO owes what and who paid. Every figure is
 *  a count from the database — a failed read returns null, never zeros. */
/** Câmpurile comune ale unui rând `payment_codes` (dedup — evită clonul jscpd
 *  dintre `rezumatPlati` și `listeazaCoduriNeplatite`). `statusImplicit` păstrează
 *  exact defaultul fiecărui apelant (rezumat: '', neplătite: 'pending'). */
function codPlataBaza(
  x: Record<string, unknown>,
  statusImplicit = '',
): { code: string; email: string; amount: number; currency: string; status: string } {
  return {
    code: String(x.code ?? ''),
    email: String(x.user_email ?? ''),
    amount: Number(x.amount ?? 0),
    currency: String(x.currency ?? config.billing.currency),
    status: String(x.status ?? statusImplicit),
  }
}

export interface RezumatPlati {
  emise: number
  platite: number
  inAsteptare: number
  neatribuite: number
  recente: { code: string; email: string; amount: number; currency: string; status: string; createdAt: string; paidAt: string | null }[]
}
export async function rezumatPlati(): Promise<RezumatPlati | null> {
  if (!dbEnabled()) return null
  try {
    const stari = await getPool().query(`SELECT status, count(*)::int AS n FROM payment_codes GROUP BY status`)
    const net = await getPool().query(`SELECT count(*)::int AS n FROM plati_neatribuite WHERE status = 'noua'`)
    const recente = await getPool().query(
      `SELECT code, user_email, amount, currency, status, created_at, paid_at FROM payment_codes
        ORDER BY created_at DESC LIMIT 30`,
    )
    const numar = (st: string): number =>
      Number((stari.rows as { status?: string; n?: number }[]).find((r2) => r2.status === st)?.n ?? 0)
    const total = (stari.rows as { n?: number }[]).reduce((s, r2) => s + Number(r2.n ?? 0), 0)
    return {
      emise: total,
      platite: numar('paid'),
      inAsteptare: numar('pending'),
      neatribuite: Number((net.rows[0] as { n?: number } | undefined)?.n ?? 0),
      recente: (recente.rows as Record<string, unknown>[]).map((x) => ({
        ...codPlataBaza(x),
        createdAt: String(x.created_at ?? ''),
        paidAt: x.paid_at ? String(x.paid_at) : null,
      })),
    }
  } catch {
    return null // a failed read is not an empty ledger (rule no. 1)
  }
}

// ── KELION'S PROJECT MEMORY (his own request, Aug 2) ────────────────────────
// Structured, keyed, persistent — the working context he asked for. The tools
// (memorie_pune / memorie_ia / memorie_lista) go through here. Content only;
// no secrets (the secrets tools have their own guarded path).

// ── AGENȚII CUSTOM AI OWNERULUI (4 aug: „să pot pune și să fie creat automat") ─

/** Lista agenților adăugați din admin — formă identică cu rosterul din cod. */
export async function listaAgentiCustom(): Promise<
  { id: string; nume: string; rol: string; efort?: 'low' | 'high'; doarAdmin?: boolean }[]
> {
  if (!dbEnabled()) return []
  const r = await getPool()
    .query(`SELECT id, nume, rol, efort, doar_admin FROM agenti_custom ORDER BY creat`)
    .catch(() => null)
  return ((r?.rows ?? []) as { id: string; nume: string; rol: string; efort?: string; doar_admin?: boolean }[]).map((x) => ({
    id: x.id,
    nume: x.nume,
    rol: x.rol,
    efort: x.efort === 'high' ? 'high' : undefined,
    doarAdmin: x.doar_admin === true ? true : undefined,
  }))
}

/** Adaugă un agent custom. Întoarce null la succes sau motivul refuzului. */
export async function adaugaAgentCustom(a: {
  id: string
  nume: string
  rol: string
  efort?: 'low' | 'high'
  doarAdmin?: boolean
}): Promise<string | null> {
  if (!dbEnabled()) return 'baza de date nu e configurată'
  const r = await getPool()
    .query(
      `INSERT INTO agenti_custom (id, nume, rol, efort, doar_admin) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (id) DO NOTHING`,
      [a.id, a.nume.slice(0, 80), a.rol.slice(0, 500), a.efort === 'high' ? 'high' : null, a.doarAdmin === true],
    )
    .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
  if (typeof r === 'string') return `scrierea a picat: ${r.slice(0, 150)}`
  if (r && r.rowCount === 0) return `există deja un agent cu id-ul „${a.id}"`
  return null
}

/** Write (upsert) a memory entry. Empty content DELETES the key — one verb,
 *  no separate delete tool for the model to fumble. */
export async function memoriePune(cheie: string, continut: string): Promise<string> {
  if (!dbEnabled()) return 'baza de date nu e configurată'
  const k = cheie.trim().slice(0, 200)
  if (!k) return 'cheia lipsește'
  if (!continut.trim()) {
    await getPool().query(`DELETE FROM memorie_proiect WHERE cheie = $1`, [k]).catch(() => null)
    return `șters: ${k}`
  }
  const r = await getPool()
    .query(
      `INSERT INTO memorie_proiect (cheie, continut, actualizat) VALUES ($1, $2, now())
        ON CONFLICT (cheie) DO UPDATE SET continut = $2, actualizat = now()`,
      [k, continut.slice(0, 20_000)],
    )
    .catch(() => null)
  return r ? `scris: ${k} (${continut.length} caractere)` : 'scrierea a picat'
}

export interface CodNeplatit {
  code: string
  email: string
  amount: number
  currency: string
  status: string
  createdAt: string
  expirata: boolean
}

export async function listeazaCoduriNeplatite(): Promise<CodNeplatit[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query(
      `SELECT code, user_email, amount, currency, status, created_at
       FROM payment_codes
       WHERE status IN ('pending', 'expired')
       ORDER BY created_at DESC LIMIT 100`
    )
    const nowMs = Date.now()
    return (r.rows as Record<string, unknown>[]).map((x) => {
      const createdAt = String(x.created_at ?? '')
      const createdMs = new Date(createdAt).getTime()
      const baza = codPlataBaza(x, 'pending')
      const expirata =
        baza.status === 'expired' ||
        (baza.status === 'pending' && !isNaN(createdMs) && nowMs - createdMs > 2 * 3600 * 1000)
      return { ...baza, createdAt, expirata }
    })
  } catch {
    return null
  }
}

export interface PlataIncasata {
  code: string
  email: string
  amount: number
  currency: string
  paidAt: string
  bankRef: string
}

export async function listeazaPlatiIncasate(): Promise<PlataIncasata[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query(
      `SELECT code, user_email, amount, currency, paid_at, bank_ref
       FROM payment_codes
       WHERE status = 'paid'
       ORDER BY paid_at DESC NULLS LAST LIMIT 100`
    )
    return (r.rows as Record<string, unknown>[]).map((x) => ({
      code: String(x.code ?? ''),
      email: String(x.user_email ?? ''),
      amount: Number(x.amount ?? 0),
      currency: String(x.currency ?? config.billing.currency),
      paidAt: String(x.paid_at ?? ''),
      bankRef: String(x.bank_ref ?? ''),
    }))
  } catch {
    return null
  }
}

export interface TotaluriPlati {
  totalAzi: number
  totalLunaAsta: number
  moneda: string
}

export async function totaluriPlati(): Promise<TotaluriPlati | null> {
  if (!dbEnabled()) return null
  try {
    const rAzi = await getPool().query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS sum_azi FROM payment_codes WHERE status = 'paid' AND paid_at >= CURRENT_DATE`
    )
    const rLuna = await getPool().query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS sum_luna FROM payment_codes WHERE status = 'paid' AND paid_at >= date_trunc('month', CURRENT_DATE)`
    )
    const sumAzi = Number((rAzi.rows[0] as { sum_azi?: number | string })?.sum_azi ?? 0)
    const sumLuna = Number((rLuna.rows[0] as { sum_luna?: number | string })?.sum_luna ?? 0)
    return {
      totalAzi: sumAzi,
      totalLunaAsta: sumLuna,
      moneda: config.billing.currency || 'EUR',
    }
  } catch {
    return null
  }
}

/** Read one memory entry, whole. */
export async function memorieIa(cheie: string): Promise<string> {
  if (!dbEnabled()) return 'baza de date nu e configurată'
  const r = await getPool()
    .query(`SELECT continut, actualizat FROM memorie_proiect WHERE cheie = $1`, [cheie.trim()])
    .catch(() => null)
  const row = r?.rows[0] as { continut?: string; actualizat?: string } | undefined
  return row?.continut ? `[${row.actualizat}] ${row.continut}` : `nimic sub cheia „${cheie}"`
}

/** List keys (optionally by prefix), newest first — the index of his memory. */
export async function memorieLista(prefix = ''): Promise<string> {
  if (!dbEnabled()) return 'baza de date nu e configurată'
  const r = await getPool()
    .query(
      `SELECT cheie, length(continut)::int AS marime, actualizat FROM memorie_proiect
        WHERE cheie LIKE $1 ORDER BY actualizat DESC LIMIT 100`,
      [`${prefix.trim()}%`],
    )
    .catch(() => null)
  const rows = (r?.rows ?? []) as { cheie?: string; marime?: number; actualizat?: string }[]
  if (!rows.length) return prefix ? `nicio cheie cu prefixul „${prefix}"` : 'memoria e goală'
  return rows.map((x) => `${x.cheie} (${x.marime} car., ${x.actualizat})`).join('\n')
}
