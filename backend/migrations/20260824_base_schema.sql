BEGIN;

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
-- Reminder only: it never initiates or pulls a payment.
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS low_credit_reminder_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS low_credit_threshold_minor BIGINT;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS suggested_topup_minor BIGINT;
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
-- THE GENERIC OPERATIONAL JOURNAL: task state is separate from individual
-- tool results, so a response never becomes "completed" merely because a
-- model emitted text or an executor was invoked. It stores only normalized
-- evidence and safe metadata; raw tool output belongs to neither the DB nor
-- the general context.
CREATE TABLE IF NOT EXISTS operational_tasks (
  id UUID PRIMARY KEY,
  user_email TEXT NOT NULL,
  turn_id UUID NOT NULL,
  objective TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'observing',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_operational_tasks_user_state
  ON operational_tasks (user_email, state, updated_at DESC);
-- dovada_faptelor citește ultimele N sarcini ale userului pe created_at:
-- fără indexul ăsta, un user intens (o sarcină pe tură) ar plăti un sort
-- peste toate rândurile lui la fiecare provocare (agentul de integrare).
CREATE INDEX IF NOT EXISTS idx_operational_tasks_user_created
  ON operational_tasks (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_tasks_turn
  ON operational_tasks (turn_id);
CREATE TABLE IF NOT EXISTS operational_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES operational_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  capability TEXT,
  outcome_state TEXT,
  code TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operational_events_task
  ON operational_events (task_id, created_at);
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
  cost_usd_micros BIGINT NOT NULL CHECK (cost_usd_micros >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_events (created_at);
CREATE TABLE IF NOT EXISTS provider_usage_events (
  response_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  session_id TEXT,
  model TEXT NOT NULL,
  service_tier TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT NOT NULL DEFAULT 0,
  reasoning_output_tokens BIGINT NOT NULL DEFAULT 0,
  input_audio_tokens BIGINT NOT NULL DEFAULT 0,
  output_audio_tokens BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage_events (created_at DESC);
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
-- Semantic memory keeps the configured OpenAI embedding output alongside the
-- memory, written asynchronously at learning time.
-- JSONB, not pgvector: no extensions to install, cosine is computed in
-- Node over the last few hundred — instant at current volume.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding JSONB;
-- SMART MEMORY (owner, 19 aug: „schimba... cu toate atuurile de imbunatatire").
-- Modelul de memorie tipizată, studiat din TencentDB Agent memory: TIP
-- (identity/preference/relationship/project/episodic/fact), IMPORTANȚĂ (0..1) și
-- EXPIRARE. Recall-ul le cântărește (services/memoryRank.ts): similaritate ×
-- importanță × decădere-în-timp. ADITIV, IF NOT EXISTS — memoriile vechi rămân
-- valide (tip NULL = generic, importanță neutră, fără expirare). Cosinusul rămâne
-- în Node: la scara unui user pgvector n-ar aduce nimic măsurabil (analiză 19 aug).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_type TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance REAL;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- Product money is stored as integer minor units. Provider expense is a
-- separate USD-micros ledger and never changes this balance.
CREATE TABLE IF NOT EXISTS wallets (
  user_email TEXT PRIMARY KEY,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  topup_ref_minor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
-- data; verified payment and provider-expense ledgers are the sources of
-- truth. Existing databases remove this retired table during migration.
DROP TABLE IF EXISTS admin_pool;
-- Privacy-minimised analytics. There is no row or identifier per anonymous
-- person: only daily counters by safe app path and coarse country code.
CREATE TABLE IF NOT EXISTS visit_daily (
  day DATE NOT NULL DEFAULT current_date,
  path TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT '',
  views BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, path, country_code)
);
CREATE INDEX IF NOT EXISTS idx_visit_daily_day ON visit_daily (day DESC);
-- Signed-in presence is aggregated by account and day. It deliberately has
-- no IP, user-agent, device, referrer, GPS or biometric field.
CREATE TABLE IF NOT EXISTS user_presence_daily (
  user_email TEXT NOT NULL,
  day DATE NOT NULL DEFAULT current_date,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actions BIGINT NOT NULL DEFAULT 0 CHECK (actions >= 0),
  pages TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_email, day)
);
CREATE INDEX IF NOT EXISTS idx_user_presence_last ON user_presence_daily (last_seen_at DESC);
-- The ledger of top-ups (+) and consumptions (−) — the structure is below.
-- ── REGISTRUL DE AUDIT (P26 — owner, 15 aug, LEGE: „se scrie doar unde e
-- necesar dar cu istoric salvat cu dovezi cine a modificat, trasabilitate
-- 24 din 24 de ore"). Fiecare modificare de date de om lasă urmă: cine,
-- când, ce anume, valoarea veche → nouă. Tabelul e el însuși sub scut
-- (TABELE_PROTEJATE) — o trasabilitate care se poate șterge nu e niciuna.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  la TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL DEFAULT '',
  actiune TEXT NOT NULL DEFAULT '',
  tabel TEXT NOT NULL DEFAULT '',
  cheie TEXT NOT NULL DEFAULT '',
  vechi TEXT NOT NULL DEFAULT '',
  nou TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_la ON audit_log (la DESC);
-- ── VIDEOTECA LUI KELION (P30a — owner, 15 aug: „sa vada un videoclip…
-- sa extraga ideile principale si informatiile din clip, sa le catalogheze
-- si sa le invete"). Fiecare clip văzut = un rând: sursa, fișa întreagă
-- (idei/informații/momente), cine a cerut, tokenii + costul REAL măsurat.
-- Sub scutul datelor (LEGEA P26): ce a învățat nu se șterge.
CREATE TABLE IF NOT EXISTS video_invatat (
  id BIGSERIAL PRIMARY KEY,
  la TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerut_de TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  titlu TEXT NOT NULL DEFAULT '',
  fisa TEXT NOT NULL DEFAULT '',
  tokeni INT NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_video_invatat_la ON video_invatat (la DESC);
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
-- plățile verificate care nu pot fi atribuite imediat rămân recuperabile.
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
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  policy_version TEXT NOT NULL,
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
  gross_minor BIGINT NOT NULL,
  user_credit_minor BIGINT NOT NULL,
  credits BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  policy_version TEXT NOT NULL,
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
-- to each other: a requirement row, an order in
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
-- Persistent store for images generated by Kelion (audit 9 Jul 2026).
-- Survival through redeployments: instead of in-memory Map, we use the DB.
CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
-- The isolated Constructor worker may attach its configured execution tier
-- and a measured external cost. NULL means the worker did not report a cost;
-- it is never interpreted as zero.
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS brain TEXT;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION;
-- ARHIVAREA ORDINELOR VECHI (Adrian, K9 + K13: „de ascuns cele vechi din
-- panou" + „sistem automat de curățare care arhivează când e gata"). Un ordin
-- terminat (done/failed) mai vechi se ARHIVEAZĂ (nu se șterge — rămâne
-- recuperabil): iese din panou, dar nu se pierde. Bucla de autonomie
-- arhivează singură; panoul (listBuildJobs) le exclude.
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS arhivat BOOLEAN NOT NULL DEFAULT false;
-- Constructorul rulează într-un worker Codex separat de procesul web. Web-ul
-- păstrează numai starea cozii și dovezile etapelor; nu deține worktree,
-- credentiale GitHub sau autentificarea ChatGPT a workerului.
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS codex_task_id TEXT;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS constructor_stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS commit_sha TEXT;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS live_version TEXT;
-- MAPE-K INCIDENT REGISTER: every terminal constructor failure becomes one
-- durable case. The normalized order fingerprint is unique, so recurrence
-- reopens the same case instead of spawning disconnected alerts.
CREATE TABLE IF NOT EXISTS constructor_incidents (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'open',
  stage TEXT NOT NULL DEFAULT 'unknown_stage',
  cause_code TEXT NOT NULL DEFAULT 'unknown',
  cause_summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  responsible TEXT NOT NULL DEFAULT 'kelion',
  next_action TEXT NOT NULL,
  verification TEXT,
  lesson TEXT,
  recurrence_count INT NOT NULL DEFAULT 1,
  strategy JSONB,
  strategy_action_fingerprint TEXT,
  strategy_evidence_fingerprint TEXT,
  strategy_decision_count INT NOT NULL DEFAULT 0,
  strategy_pending BOOLEAN NOT NULL DEFAULT false,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
ALTER TABLE constructor_incidents ADD COLUMN IF NOT EXISTS strategy JSONB;
ALTER TABLE constructor_incidents ADD COLUMN IF NOT EXISTS strategy_action_fingerprint TEXT;
ALTER TABLE constructor_incidents ADD COLUMN IF NOT EXISTS strategy_evidence_fingerprint TEXT;
ALTER TABLE constructor_incidents ADD COLUMN IF NOT EXISTS strategy_decision_count INT NOT NULL DEFAULT 0;
ALTER TABLE constructor_incidents ADD COLUMN IF NOT EXISTS strategy_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_constructor_incidents_state
  ON constructor_incidents (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_constructor_incidents_job
  ON constructor_incidents (job_id);
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
  submission_session UUID NOT NULL,
  contacted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS submission_session UUID;
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
-- Subscription-tier tracking records each worker tier transition and recovery
-- durably instead of relying on an ephemeral process journal.
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

COMMIT;
