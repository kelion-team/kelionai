import pg from 'pg'
import { randomBytes } from 'node:crypto'
// CONTRACTUL HTTP, o singură declarație (Lotul A) — vezi src/shared/api-types.ts.
import type { DemoRecent, DemoStats, UserActivityRow } from './shared/api-types.js'
export type { DemoRecent, DemoStats, UserActivityRow }
import { config } from './config.js'
import { embedText, embeddingsEnabled, cosine } from './services/embeddings.js'

let pool: pg.Pool | null = null

export function dbEnabled(): boolean {
  return Boolean(config.databaseUrl)
}

// Exportat pentru verificarea live „PostgreSQL" din tokenChecks (SELECT 1).
export function getPool(): pg.Pool {
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
    -- VOCEA ALEASĂ DE FIECARE OM (Adrian, 30 iul: „își poate seta aplicația cu
    -- ce AI dorește și ce voce dorește... se ține minte per user"). Până acum
    -- vocea venea din mediu, deci era UNA pentru toți.
    ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS voice TEXT;
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
    -- ── PLĂȚI PRIN REVOLUT PRO, CU COD UNIC (Adrian, 30 iul) ─────────────────
    -- „în ziua de azi să ai gestiune manuală la mii de potențiali useri, asta
    -- oferi tu?" — avea dreptate. Ca plata să se crediteze SINGURĂ trebuie știut
    -- CINE a plătit, iar Revolut Pro nu are webhook care să ne spună.
    --
    -- Soluția lui: „fiecare plată trebuie să fie însoțită de un cod unic".
    -- Codul pleacă cu userul la plată și se întoarce în referința tranzacției;
    -- aplicația citește tranzacțiile din cont și potrivește codul cu omul.
    --
    -- De ce cod și nu suma (prima mea idee, greșită): suma poate fi fixată de
    -- link și poate fi modificată de comision până ajunge în cont — două lucruri
    -- pe care nu le controlăm. Codul trece neatins prin amândouă.
    CREATE TABLE IF NOT EXISTS payment_codes (
      code TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      amount NUMERIC(14,6) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      -- pending → paid (creditat) | expired (n-a plătit) | manual (atribuit de admin)
      status TEXT NOT NULL DEFAULT 'pending',
      -- referința tranzacției din bancă, ca aceeași plată să nu crediteze de două ori
      bank_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_paycode_user ON payment_codes (user_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paycode_status ON payment_codes (status, created_at DESC);
    -- ACEEAȘI PLATĂ NU CREDITEAZĂ DE DOUĂ ORI, oricâte citiri se suprapun.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_paycode_bankref ON payment_codes (bank_ref) WHERE bank_ref IS NOT NULL;
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
    -- ── GESTIUNEA CERINȚELOR (Adrian, 30 iul: „am nevoie de sisteme avansate
    -- alocate lui Kelion de gestiune a cerințelor, evaluări avansate pe
    -- soluțiile oferite") ──────────────────────────────────────────────────
    -- Până acum, o cerință a ownerului trăia în trei locuri care nu se vorbeau:
    -- un rând în RAMAS-DE-FACUT.md (scris de mână), un ordin în build_jobs
    -- (fără legătură cu cerința) și, uneori, doar în chat — de unde se pierdea.
    -- Rezultatul: „ți-am cerut de zeci de ori" era ADEVĂRAT și nedemonstrabil.
    -- Aici cerința are un singur loc, cu drumul ei întreg: ce s-a cerut, cum se
    -- dovedește că e făcută, ce VARIANTE s-au evaluat și cu ce scoruri, care a
    -- fost aleasă și de ce, ce ordin a dus-o, și ce s-a MĂSURAT la final.
    CREATE TABLE IF NOT EXISTS cerinte (
      id BIGSERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      sursa TEXT NOT NULL DEFAULT 'owner',
      -- noua → analizata (are variante evaluate) → in_lucru → livrata →
      -- verificata (cu dovadă măsurată) | respinsa (cu motiv)
      stare TEXT NOT NULL DEFAULT 'noua',
      -- Cum se DOVEDEȘTE că e făcută. Scris la început, nu la sfârșit, ca să nu
      -- se mute ținta după ce s-a livrat ceva.
      criteriu TEXT,
      optiuni TEXT,      -- JSON: variantele evaluate, cu scoruri și riscuri
      aleasa TEXT,       -- varianta aleasă + DE CE
      dovada TEXT,       -- ce s-a măsurat la final (nu ce s-a declarat)
      job_id BIGINT,
      pr_url TEXT,
      -- CÂT DE URGENTĂ E, pentru OWNER (1 = arde, 9 = poate aștepta). Fără ea,
      -- lucrează în ordinea în care s-au scris lucrurile — și îți repară un
      -- buton în timp ce plățile stau. Nu e o frână: schimbă ORDINEA, nu ce
      -- are voie să facă.
      prioritate INT NOT NULL DEFAULT 5,
      -- CÂT DE GREA e (1..5), pusă de el la evaluare. Din ea se alege MÂNA care
      -- lucrează: model mare pe sarcină grea, gratuit pe o redenumire. Fără ea,
      -- o sarcină grea pornea pe un model mic, ardea turele povestind, și pica.
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
    -- TRIAJUL AUTONOM al lui Kelion (Adrian, 24 iul): decizia lui pe fiecare
    -- cerere neacoperită — „DE IMPLEMENTAT: ..." sau „ÎNCHIS AUTONOM: ...".
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS triage TEXT;
    ALTER TABLE capability_gaps ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_gaps_open ON capability_gaps (resolved, last_seen DESC);
    -- AUTO-EXTINDEREA LUI KELION (Adrian, 25 iul: „Kelion să-și poată instala
    -- singur unelte, independent, până la deploy — cu aprobarea mea"). Kelion
    -- PROPUNE o unealtă nouă (un apel HTTP, ca dată, nu cod arbitrar): nume, ce
    -- face, parametri, metodă+URL. Owner-ul o APROBĂ cu un click în admin → devine
    -- ACTIVĂ instant, fără redeploy. Siguranță: doar HTTPS, fără IP-uri interne,
    -- fără cod executabil — Kelion nu poate rula decât unelte aprobate de admin.
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
    -- CONSTRUCTORUL (Adrian, 27 iul: „Kelion trebuie să poată crea orice soft
    -- îi cere admin"). Coada ordinelor de construcție: Kelion (sau adminul din
    -- panou) pune ordinul aici; lucrătorul de pe VPS (cron, job-uri scurte, NU
    -- demoni) îl ia, construiește în atelier (clonă separată), rulează build +
    -- teste și deschide PR-ul. Merge-ul rămâne la Adrian (regula lui, 27 iul).
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
    -- PROGRES LIVE (Etapa 4 autonomie, 29 iul): pasul curent al constructorului
    -- (clonat → editez X → build → deschid PR...) ca să apară pe monitor și ca
    -- Kelion să-l poată NARA. Actualizat pe parcurs de POST /api/constructor/progress.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS progress TEXT;
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ;
    -- VERDICTUL VERIFICĂRII INDEPENDENTE (Etapa 6 autonomie, 29 iul): „Gata" nu
    -- mai e pe cuvântul lucrătorului — după PR, lucrătorul așteaptă CI-ul (verify)
    -- pe o mașină curată și scrie aici 'verde' / 'roșu' / 'în curs'. Kelion îl
    -- poate NARA („Gata, verificat de CI") și ownerul îl vede în raport.
    ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS ci TEXT;
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
    -- CONTURI LOCALE (Adrian, 26 iul: „alte soluții de logare non-Gmail... da,
    -- pornește, inclusiv să poată crea"). Identitatea = emailul, exact ca la
    -- Google — portofel/istoric/memorie/amprentă sunt deja legate de email,
    -- deci un cont local are AUTOMAT toate funcțiile (mai puțin skill-urile pe
    -- datele Google personale, imposibile fără cont Google). Parola: scrypt
    -- (node:crypto), formatul "sare:hash" hex — zero dependențe noi.
    CREATE TABLE IF NOT EXISTS local_accounts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Linkuri de unică folosință (link magic + resetare parolă): păstrăm DOAR
    -- hash-ul tokenului (un dump de DB nu poate loga pe nimeni), cu expirare.
    CREATE TABLE IF NOT EXISTS login_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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

export interface ClientErrorGroup {
  created_at: string
  user_email: string | null
  message: string
  n: string
}

/** Erorile de client GRUPATE pe mesaj, pentru panoul de admin.
 *
 *  Interogarea asta trăia scrisă de mână ÎN RUTĂ (admin.ts), în timp ce aici
 *  zăcea o `listClientErrors` pe care n-o chema nimeni: două locuri pentru
 *  aceeași treabă, unul mort. jscpd nu putea s-o prindă (textul diferea), dar e
 *  exact încălcarea principiului „unic, fără duplicate" — plus o rută care
 *  atingea direct baza, ocolind stratul ăsta. Acum: o singură sursă, aici. */
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

// AUTO-VINDECAREA (Adrian, 27 iul: „Kelion trebuie să poată culege err apărute
// sub fiecare user automat și să le remedieze, dând versiunea reparată pentru
// toți userii ulterior"). Grupăm erorile de client pe mesaj (primele 200 de
// caractere) și întoarcem DOAR pe cele RECURENTE — apărute de multe ori, la mai
// mulți utilizatori (ip-uri distincte) în fereastra dată. Astfel constructorul
// nu se apucă de un incident izolat/ambiental, ci de un bug real, repetat.
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
          -- excludem zgomotul ne-reparabil din cod: erori cross-origin opace,
          -- pene de rețea, extensii de browser.
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
    // URMĂ CONTABILĂ (audit 24 iul, P2-2): cadoul adminului era invizibil — nici
    // billing_events, nici transactions → gaură în pista de audit + userul rămânea
    // pe „prima alimentare £20" deși avea sold. Acum ambele registre îl văd.
    await getPool().query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES ($1, 'grant', $2, $3, 'credit admin (fără Stripe)')`,
      [e, amount, `grant:${e}:${Date.now()}`],
    )
    await getPool().query(
      `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'admin_grant', NULL)`,
      [e, amount, Math.floor(amount / config.stripe.creditValue)],
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
    // GDPR complet (audit 24 iul): pe lângă datele de conversație, se șterg și
    // datele biometrice (amprente vocale/faciale), notițele și conturile Google
    // legate. NIMIC personal nu rămâne. (Coloanele diferă pe tabele — atenție:
    // o eroare într-o tranzacție Postgres o otrăvește pe TOATĂ, deci lista
    // conține DOAR tabele+coloane verificate în schema de mai sus.)
    const targets: [string, string][] = [
      ['messages', 'user_email'], ['user_prefs', 'user_email'], ['memories', 'user_email'],
      ['wallets', 'user_email'], ['visits', 'user_email'], ['blocked_users', 'email'],
      ['voiceprints', 'user_email'], ['faceprints', 'user_email'], ['notes', 'user_email'],
      ['google_accounts', 'email'], ['cost_events', 'user_email'],
    ]
    for (const [t, col] of targets) {
      await client.query(`DELETE FROM ${t} WHERE ${col} = $1`, [e])
    }
    // EVIDENȚA FINANCIARĂ (transactions, billing_events) NU se șterge — legea
    // cere păstrarea plăților — dar se ANONIMIZEAZĂ: emailul devine un marcaj
    // ireversibil, deci nu mai e dată personală, iar contabilitatea rămâne întreagă.
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

// ── CONTURI LOCALE (email + parolă / link magic) ─────────────────────────────
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
/** Consumă tokenul (o singură folosire, neexpirat) → emailul lui, altfel null. */
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

// ── Prepaid wallet (Stripe credit) ──

// ── EMAILUL UNUI OM, O SINGURĂ FORMĂ, ÎN TOT SOFTUL ─────────────────────────
//
// Găsit întâi la portofel (teste, 30 iul): alimentările scriau de mult `lower($1)`
// (auditul P2-3), dar CITIREA soldului, TAXAREA și clientul Stripe foloseau
// emailul EXACT cum vine din sesiune. Logarea locală îl coboară la litere mici;
// logarea Google NU. Pentru un email cu majuscule („Ion@Firma.ro") userul plătea,
// creditul intra pe un rând, aplicația citea altul → îi arăta 0 credite și îl
// oprea în paywall, iar consumul lui deschidea un AL DOILEA portofel, pe minus.
//
// Aceeași fisură era deschisă și la PREFERINȚE (limbă, meserie), la
// AUTO-REÎNCĂRCARE (bani: setarea nu se mai citea → userul rămânea fără credit
// deși o pornise), la ALEGEREA MODELULUI și la aranjarea avatarului. Toate se
// scriu și se citesc de-acum prin cheia asta — una singură, exportată.
export const userKey = (email: string): string => String(email ?? '').trim().toLowerCase()
const walletKey = userKey

export async function getBalance(email: string): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_email = $1',
      [walletKey(email)],
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
      [walletKey(email), amount],
    )
    await pool.query(
      `INSERT INTO billing_events (user_email, kind, amount, meta) VALUES ($1, 'usage', $2, $3)`,
      [walletKey(email), -amount, meta],
    )
  } catch (e) {
    // Nu rupem chatul dacă taxarea pică — dar NICIODATĂ în tăcere (audit 27
    // iul: exact catch-ul ăsta gol a mai ascuns o dată „userii consumă fără să
    // fie taxați"). Eroarea intră în jurnal → server_logs → auditul din admin.
    console.error(`[bani] debitWallet EȘUAT pentru ${email}, suma ${amount}: ${String(e).slice(0, 200)}`)
  }
}

export async function getStripeCustomer(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM wallets WHERE user_email = $1',
      [walletKey(email)],
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
      [walletKey(email), id],
    )
  } catch {
    // Non-fatal.
  }
}

// Garda de idempotență a plăților: un stripe_ref deja înregistrat NU se creditează
// a doua oară. Apelată în interiorul unei tranzacții deschise (apelantul face
// ROLLBACK dacă e true). Era copiată în cele 3 credite (top-up, vânzare, refund) —
// o singură sursă aici (principiul permanent: unic, fără duplicate).
async function billingRefSeen(client: pg.PoolClient, ref: string): Promise<boolean> {
  const seen = await client.query('SELECT 1 FROM billing_events WHERE stripe_ref = $1', [ref])
  return (seen.rowCount ?? 0) > 0
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
    if (await billingRefSeen(client, stripeRef)) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'topup', $2, $3, 'user 75%')`,
      [email, userCredit, stripeRef],
    )
    // Email NORMALIZAT (audit P2-3: un email cu alt caz creditat aici nu mai era
    // citit NICIODATĂ de endpoint-ul de sold) + topup_ref = NOUL SOLD complet
    // (audit P1-3: doar ultima alimentare falsifica procentul de alertă).
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES (lower($1), $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = wallets.balance + $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'profit', $2, $3, 'margin 25%')`,
      [email, profit, `${stripeRef}:profit`],
    )
    // CONTABILITATE VIZIBILĂ (Adrian, 24 iul: „să văd REAL în baza de date cine
    // a alimentat, cât, și repartizarea banilor"). Până acum, alimentările prin
    // topUpUser (webhook + reconciliere) nu scriau NIMIC în `transactions` →
    // tabul admin „Tranzacții" rămânea gol deși banii intrau. Acum fiecare
    // alimentare lasă rândul contabil complet, în ACEEAȘI tranzacție SQL:
    // suma brută plătită, creditele primite (75%), userul și referința Stripe.
    await client.query(
      `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
       VALUES ($1, $2, $3, 'paid', $4)
       ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET status = 'paid'`,
      [email.toLowerCase(), gross, Math.floor(userCredit / config.stripe.creditValue), stripeRef],
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

/** Actualizează statusul unei tranzacții după ID-ul Stripe PaymentIntent. */
export async function updateTransactionStatus(
  stripePaymentIntentId: string,
  status: string,
): Promise<void> {
  if (!dbEnabled() || !stripePaymentIntentId) return
  try {
    // ORDINEA WEBHOOK-URILOR NU E GARANTATĂ (audit 27 iul): un
    // `payment_failed` livrat DUPĂ `succeeded` marca pe veci o plată REUȘITĂ
    // ca „failed" în istoricul userului și în tabul de tranzacții. O stare
    // finală bună nu mai poate fi retrogradată.
    await getPool().query(
      `UPDATE transactions SET status = $2, created_at = COALESCE(created_at, now())
       WHERE stripe_payment_intent_id = $1 AND status NOT IN ('succeeded', 'paid', 'refunded')`,
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
    const seen = await client.query<{ status: string }>(
      'SELECT status FROM transactions WHERE stripe_payment_intent_id = $1',
      [stripePaymentIntentId],
    )
    // CAPCANA „pending" DEZAMORSATĂ (audit 24 iul, P0-3): înainte, ORICE rând
    // existent (inclusiv `pending` de la plasarea intenției) era tratat ca „deja
    // creditat" → status devenea `succeeded` FĂRĂ niciun ban în portofel: user
    // plătit, credit zero, tabelă „verde". Acum sărim peste creditare DOAR dacă
    // statusul anterior era chiar `succeeded`; pentru pending/failed continuăm cu
    // creditarea completă (dublarea rămâne blocată de uniq_billing_ref → ROLLBACK).
    const priorStatus = seen.rows[0]?.status ?? null
    if (priorStatus === 'succeeded' || priorStatus === 'paid') {
      await client.query('COMMIT')
      return true
    }
    if (priorStatus !== null) {
      await client.query(
        `UPDATE transactions SET status = 'succeeded' WHERE stripe_payment_intent_id = $1`,
        [stripePaymentIntentId],
      )
    } else {
      // Creditele în UNITĂȚI de credit (1 credit = £0.10), consecvent cu
      // topUpUser și cu afișarea din admin — nu în lire (era de 10× mai mic).
      await client.query(
        `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
         VALUES ($1, $2, $3, 'succeeded', $4)`,
        [email.toLowerCase(), gross, Math.floor(userCredit / config.stripe.creditValue), stripePaymentIntentId],
      )
    }
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'topup', $2, $3, 'user 75%')`,
      [email, userCredit, stripePaymentIntentId],
    )
    // Email NORMALIZAT (P2-3) + topup_ref = NOUL SOLD complet (P1-3), nu doar
    // ultima alimentare — altfel procentul de alertă avea referință falsă.
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES (lower($1), $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = wallets.balance + $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'profit', $2, $3, 'margin 25%')`,
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

/** VÂNZARE ADMIN: creditează EXACT `credits` credite (nu formula 75%, ca să nu
 *  apară erori de rotunjire — userul primește fix ce i s-a vândut). Idempotent
 *  pe stripe_ref. Diferența dintre brut și valoarea creditelor = marja, în
 *  registru ca de obicei. */
export async function creditSaleExact(
  email: string,
  gross: number,
  currency: string,
  stripeRef: string,
  credits: number,
): Promise<boolean> {
  if (!dbEnabled() || !(gross > 0) || !stripeRef || !(credits > 0)) return false
  const userCredit = Math.round(credits * config.stripe.creditValue * 100) / 100
  const profit = Math.max(0, Math.round((gross - userCredit) * 100) / 100)
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    if (await billingRefSeen(client, stripeRef)) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'topup', $2, $3, 'vânzare admin — credite exacte')`,
      [email, userCredit, stripeRef],
    )
    await client.query(
      `INSERT INTO wallets (user_email, balance, currency, topup_ref) VALUES (lower($1), $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance = wallets.balance + $2, topup_ref = wallets.balance + $2, updated_at = now()`,
      [email, userCredit, currency],
    )
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'profit', $2, $3, 'marjă vânzare admin')`,
      [email, profit, `${stripeRef}:profit`],
    )
    await client.query(
      `INSERT INTO transactions (user_id, amount, credits, status, stripe_payment_intent_id)
       VALUES (lower($1), $2, $3, 'paid', $4)
       ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET status = 'paid'`,
      [email, gross, Math.floor(credits), stripeRef],
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

/** RETRAGEREA creditelor la REFUND (incident real 24 iul: plată rambursată pe
 *  card dar creditată în portofel = credite pentru bani inexistenți). Găsește
 *  alimentarea după stripe_ref, scade creditul userului din portofel, marchează
 *  tranzacția `refunded` și lasă urma `refund` în registru. Idempotent pe
 *  `<ref>:refund` — un refund retras o dată nu se mai retrage a doua oară. */
export async function revokeTopUpForRefund(stripeRef: string): Promise<boolean> {
  if (!dbEnabled() || !stripeRef) return false
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const t = await client.query<{ user_email: string; amount: string }>(
      `SELECT user_email, amount FROM billing_events WHERE stripe_ref = $1 AND kind = 'topup'`,
      [stripeRef],
    )
    if (!t.rows[0]) {
      await client.query('ROLLBACK')
      return false
    }
    if (await billingRefSeen(client, `${stripeRef}:refund`)) {
      await client.query('ROLLBACK')
      return false
    }
    const email = t.rows[0].user_email
    const userCredit = Number(t.rows[0].amount)
    await client.query(
      `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
       VALUES (lower($1), 'refund', $2, $3, 'plată rambursată pe card — credit retras')`,
      [email, userCredit, `${stripeRef}:refund`],
    )
    await client.query(
      `UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE user_email = lower($1)`,
      [email, userCredit],
    )
    // ȘI PROFITUL SE REVERSEAZĂ (audit 27 iul): la alimentare, 25% intra ca
    // rând 'profit' — la refund rămânea pe veci în cărți, umflând profitul
    // raportat în Admin→Bani la fiecare rambursare. Rând compensator negativ,
    // idempotent pe cheia :profit-refund.
    const p = await client.query<{ user_email: string; amount: string }>(
      `SELECT user_email, amount FROM billing_events WHERE stripe_ref = $1 AND kind = 'profit'`,
      [`${stripeRef}:profit`],
    )
    if (p.rows[0]) {
      await client.query(
        `INSERT INTO billing_events (user_email, kind, amount, stripe_ref, meta)
         VALUES (lower($1), 'profit', $2, $3, 'reversare profit — plată rambursată')
         ON CONFLICT DO NOTHING`,
        [p.rows[0].user_email, -Number(p.rows[0].amount), `${stripeRef}:profit-refund`],
      )
    }
    await client.query(`UPDATE transactions SET status = 'refunded' WHERE stripe_payment_intent_id = $1`, [
      stripeRef,
    ])
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
      'SELECT balance, topup_ref FROM wallets WHERE user_email = lower($1)',
      [email],
    )
    return { balance: Number(r.rows[0]?.balance ?? 0), topupRef: Number(r.rows[0]?.topup_ref ?? 0) }
  } catch {
    return { balance: 0, topupRef: 0 }
  }
}

/** Reîncărcare automată per user (ca să nu rămână fără credit — cerința Adrian).
 *  `threshold` = sub câte CREDITE se declanșează; `topupAmount` = suma de taxat
 *  (aceeași unitate ca top-up-ul manual). Stocat în KV, ca preferințele. */
export interface AutoRecharge {
  enabled: boolean
  threshold: number
  topupAmount: number
}
const AUTO_RECHARGE_DEFAULT: AutoRecharge = { enabled: false, threshold: 20, topupAmount: 10 }

export async function getAutoRecharge(email: string): Promise<AutoRecharge> {
  try {
    const raw = await loadKv(`autorecharge:${userKey(email)}`)
    if (!raw) return { ...AUTO_RECHARGE_DEFAULT }
    const p = JSON.parse(raw) as Partial<AutoRecharge>
    return {
      enabled: Boolean(p.enabled),
      threshold: Number.isFinite(p.threshold) ? Math.max(0, Number(p.threshold)) : AUTO_RECHARGE_DEFAULT.threshold,
      topupAmount: Number.isFinite(p.topupAmount)
        ? Math.max(1, Math.min(500, Number(p.topupAmount)))
        : AUTO_RECHARGE_DEFAULT.topupAmount,
    }
  } catch {
    return { ...AUTO_RECHARGE_DEFAULT }
  }
}

export async function setAutoRecharge(email: string, v: AutoRecharge): Promise<void> {
  await saveKv(`autorecharge:${userKey(email)}`, JSON.stringify(v))
}

// Aici au stat `loadAdminPool` și `withdrawAdminPool` — butoanele „+ Adaugă
// bani" / „− Scoate bani" care SCRIAU de mână cât credea omul că are în pungă.
// Șterse (Adrian, 30 iul: „o singură pungă... nu rămâne decât real, fără
// hardcode"). Câți bani ai se citește de la Stripe și de la OpenRouter, care
// chiar îi țin; nu se mai declară nicăieri.

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



// The owner's visitor analytics (admin only): EVERY site visit — totals, a
// breakdown by country, and the latest arrivals with their full profile.
// Jumătatea „probe demo" e MOARTĂ (nimic nu mai scrie demo_uses), deci nu mai
// interogăm tabela; câmpurile de demo rămân 0/goale ca FORMA tipului DemoStats
// să nu se schimbe (frontend-ul nu crapă).
export async function getDemoStats(): Promise<DemoStats> {
  const empty: DemoStats = {
    total: 0, today: 0, bots: 0, visitsTotal: 0, visitsToday: 0, byCountry: [], recent: [],
  }
  if (!dbEnabled()) return empty
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
        `SELECT 'visit'::text AS kind, ip, country, country_code, city, region, isp,
                browser, os, device, lang, referrer, is_bot, started_at, '' AS session_email, '' AS topic
         FROM visits ORDER BY started_at DESC LIMIT 60`,
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
      total: 0,
      today: 0,
      bots: Number(vCounts?.bots ?? 0),
      visitsTotal: Number(vCounts?.total ?? 0),
      visitsToday: Number(vCounts?.today ?? 0),
      byCountry,
      recent,
    }
  } catch {
    return empty
  }
}

// ── CONTABILITATEA REALĂ A OWNERULUI — NIMIC DECLARAT DE MÂNĂ ───────────────
//
// Adrian, 30 iul: „o singură pungă, scoate minciunile de pe platformă; nu rămâne
// decât REAL, fără hardcode."
//
// Ce era înainte: `loaded` — o cifră TASTATĂ din panou („+ Adaugă bani" /
// „− Scoate bani") — și `remaining = loaded − spent`. Nimic nu o verifica
// vreodată cu Stripe sau cu OpenRouter. Adică panoul putea să arate „mai ai £50"
// în timp ce contul de la furnizor era pe zero. O cifră pe care o scrie omul nu
// e o măsurătoare, e o părere — iar la bani, o părere afișată ca fapt e o
// minciună. ȘTEARSĂ, împreună cu butoanele care o scriau.
//
// Ce rămâne aici sunt DOAR măsurători:
//   • `spent`  — suma costurilor REALE raportate de furnizori la fiecare apel
//                (cost_events, scris de recordCost din răspunsul lor);
//   • `profit` — suma marjelor din registrul de plăți (billing_events), care
//                vine din plăți Stripe verificate, nu din estimări.
// Punga propriu-zisă (cât mai ai) NU se mai ține aici: se citește LIVE de la
// Stripe și OpenRouter — vezi services/stripe.ts getMoneyCircuit +
// services/openrouter.ts getOpenRouterBalance. Sursa adevărului e la ei.
export async function getAdminAccount(): Promise<{ spent: number; profit: number }> {
  const empty = { spent: 0, profit: 0 }
  if (!dbEnabled()) return empty
  try {
    const pool = getPool()
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
    return { spent, profit }
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
  /** Cât din `total` vine dintr-o MĂSURĂTOARE a furnizorului (OpenRouter
   *  `usage.cost` — banii pe care i-a spus el că i-a luat). */
  masurat: number
  /** Cât e ESTIMAREA NOASTRĂ, cu tarife fixe scrise în `cost.ts` (minute de
   *  voce × $0.35, caractere TTS, apeluri Serper…). Nu e ce a costat — e ce
   *  credem noi că a costat. Adrian, 31 iul: „de unde a reieșit valoarea $504?"
   *  — de aici, și trebuia scris de la început. */
  estimat: number
  /** Ce fel de cifră e fiecare rând, ca panoul să n-o mai poată prezenta greșit. */
  felul: Record<string, 'masurat' | 'estimat'>
}

// Singurul fel de cost care vine MĂSURAT de la furnizor: apelurile de creier,
// unde OpenRouter întoarce `usage.cost` cu banii lui reali. Tot restul sunt
// tarife fixe scrise de mine — utile ca ordin de mărime, false ca „real".
const COSTURI_MASURATE = new Set(['chat'])

/** ── RESETAREA CONTOARELOR DE CONSUM ────────────────────────────────────────
 *
 *  Adrian, 30 iul: „resetează pe 0 toate contoarele; doar banii de la AI lasă-i
 *  să reflecte ce credite sunt acum; în rest, ce s-a consumat pune pe 0."
 *  Și, imediat: „trebuie pus în locul corect, că creditele dacă s-au consumat
 *  NU se face refund."
 *
 *  De-aia ștergem EXACT un singur lucru: `cost_events` — jurnalul costurilor
 *  noastre la furnizori, adică „cât ne-a costat pe noi". Contorul ăsta e doar
 *  istoric; nu-l citește nimeni ca să decidă ceva.
 *
 *  NU SE ATINGE, cu intenție:
 *    • `wallets`       — creditele userilor. Consumate = consumate; a le pune la
 *                        loc ar însemna un refund pe care nimeni nu l-a cerut.
 *    • `billing_events`— registrul plăților reale (alimentări, marje, refunduri).
 *                        E contabilitate; se șterge doar la ștergerea contului.
 *    • `transactions`  — istoricul de cumpărare al fiecărui om.
 *
 *  Banii de la AI (punga) nu au ce reseta: se citesc LIVE de la Stripe și de la
 *  furnizorul creierului, deci reflectă întotdeauna ce e acum. */
export async function resetCostCounters(): Promise<{ ok: boolean; sterse: number }> {
  if (!dbEnabled()) return { ok: false, sterse: 0 }
  try {
    const r = await getPool().query('DELETE FROM cost_events')
    return { ok: true, sterse: r.rowCount ?? 0 }
  } catch {
    return { ok: false, sterse: 0 }
  }
}

export async function getCostSummary(): Promise<CostSummary> {
  const empty: CostSummary = { total: 0, today: 0, byKind: {}, masurat: 0, estimat: 0, felul: {} }
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

/** Vocea aleasă de user (null = cea implicită a aplicației). */
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
    // Nu rupem vocea dacă salvarea preferinței pică.
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

/** Câți oameni au cont cu portofel (folosit la rezerva din Stripe). Numărăm
 *  portofelele, nu conversațiile: un cont fără portofel n-are credit de apărat. */
export async function countWalletUsers(): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ n: string }>('SELECT COUNT(*)::text AS n FROM wallets')
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return 0
  }
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
  // Decizia autonomă a lui Kelion („DE IMPLEMENTAT: ..." / „ÎNCHIS AUTONOM: ...").
  triage?: string | null
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
// ── CERINȚELE: un singur loc, cu drumul întreg ───────────────────────────────
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

/** Scrie o cerință. Dublurile nu se adaugă: aceeași cerere, același rând —
 *  altfel lista s-ar umple cu variații ale aceluiași lucru și n-ar mai fi
 *  gestiune, ci zgomot. */
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
    const dej = await getPool().query<{ id: string | number }>(
      `SELECT id FROM cerinte WHERE lower(text) = lower($1) AND stare <> 'respinsa' LIMIT 1`,
      [t],
    )
    if (dej.rows[0]) return Number(dej.rows[0].id)
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

/** Mută cerința pe drumul ei. Doar câmpurile date se ating — restul rămân. */
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
    /* niciodată nu rupem tura pentru o scriere de evidență */
  }
}

export async function getCapabilityGaps(includeResolved = false, limit = 200): Promise<CapabilityGap[]> {
  if (!dbEnabled()) return []
  try {
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

/** Decizia de triaj a lui Kelion pe un gap (+ eventuala închidere automată). */
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

// ── AUTO-EXTINDEREA LUI KELION — unelte propuse de el, aprobate de owner ──────
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

/** Kelion propune o unealtă nouă (rămâne 'pending' până aprobă owner-ul). */
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
  if (!name || !/^https:\/\//i.test(t.httpUrl)) return null // doar HTTPS
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

/** Uneltele lui Kelion după status ('pending' | 'approved' | 'rejected'). */
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

/** Owner-ul aprobă/respinge o unealtă propusă (un click în admin). */
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

// Care dintre aceste UID-uri sunt DEJA în inbound_emails. Pre-filtrul
// pollerului (26 iul): îi permite să descarce corpul DOAR pentru mesajele noi,
// nu pentru toate ultimele 100 — descărcarea în masă era cauza timeout-urilor
// care au ținut cutia moartă. La orice eroare întoarcem mulțimea goală:
// pollerul descarcă atunci cel mult lotul plafonat și dedupe-ul din
// saveInboundEmail (ON CONFLICT) tot împiedică orice răspuns dublu.
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

// Nucleul comun al celor două distanțe (voce normalizată + față brută): suma
// pătratelor diferențelor pe componente + lungimea comparată. Sursă unică — cele
// două funcții diferă DOAR prin normalizarea finală (unic, fără duplicate).
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

// Aici a stat `identifyVoiceprint` — căuta printre TOATE amprentele „cine
// vorbește" (1:N). N-a chemat-o niciodată nimeni. Regula produsului e O SINGURĂ
// persoană pe cont (Adrian, 29 iul), deci recunoașterea corectă e cea care chiar
// rulează: VERIFICARE 1:1 — „e titularul contului sau altcineva?" (chat.ts și
// realtime.ts, prin vectorDistance). Ștearsă: cod abandonat, nu capabilitate.

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

// ── CONSTRUCTORUL — coada ordinelor de construcție (Adrian, 27 iul) ─────────
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

// Lucrătorul ia UN ordin: cel mai vechi „queued", sau un „running" înțepenit
// (>40 min — agentul a fost omorât de timeout). Peste 2 încercări → failed,
// ca un ordin imposibil să nu blocheze coada la nesfârșit.
export async function claimNextBuildJob(): Promise<BuildJob | null> {
  if (!dbEnabled()) return null
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE build_jobs SET status='failed', log = COALESCE(log,'') || E'\\n[abandonat: 3 încercări epuizate]', updated_at = now()
       WHERE status='running' AND updated_at < now() - interval '40 minutes' AND attempts >= 3`,
    )
    const r = await client.query<BuildJobDbRow>(
      `UPDATE build_jobs SET status='running', attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM build_jobs
         WHERE status='queued' OR (status='running' AND updated_at < now() - interval '40 minutes')
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
  fields: { status: 'done' | 'failed'; branch?: string; prUrl?: string; tokens?: number; log?: string; ci?: string },
): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(
    `UPDATE build_jobs SET status=$2, branch=COALESCE($3, branch), pr_url=COALESCE($4, pr_url),
       tokens = tokens + $5, log = $6, ci = COALESCE($7, ci), updated_at = now() WHERE id = $1`,
    [id, fields.status, fields.branch ?? null, fields.prUrl ?? null, fields.tokens ?? 0, (fields.log ?? '').slice(-20000) || null, fields.ci ?? null],
  )
}

export async function listBuildJobs(limit = 40): Promise<BuildJob[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<BuildJobDbRow>('SELECT * FROM build_jobs ORDER BY created_at DESC LIMIT $1', [limit])
    return r.rows.map(rowToBuildJob)
  } catch {
    return []
  }
}

// PROGRES LIVE (Etapa 4): scrie pasul curent al constructorului. DOAR pe joburi
// active (`running`) — nu suprascrie starea terminală a unui job gata/eșuat.
export async function updateBuildJobProgress(id: number, progress: string): Promise<void> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return
  try {
    await getPool().query(
      `UPDATE build_jobs SET progress=$2, progress_at=now(), updated_at=now() WHERE id=$1 AND status='running'`,
      [id, progress.slice(0, 500)],
    )
  } catch {
    /* progresul e best-effort — nu oprește nimic dacă pică */
  }
}

// Joburile pentru AFIȘAJUL LIVE pe monitor (Etapa 4b): cele active (în coadă /
// în lucru) PLUS cele terminate RECENT (ultimele 10 min). Fără „recent
// terminate", panoul ar șterge jobul chiar în clipa în care devine „Gata"/
// „Eșuat" — exact starea pe care Adrian vrea s-o VADĂ. Active primele, apoi
// după cât de proaspăt s-au mișcat; câteva, cât încap pe ecran.
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

// VINDECARE AUTOMATĂ A ORDINELOR CĂZUTE PE BANI (Adrian, 27 iul: „de ce nu vede
// sistemul de vindecare, repară? — automat?"): un ordin eșuat pentru că creierul
// n-avea credit (402/credits) nu e un ordin imposibil — e un ordin PICAT PE
// SĂRĂCIE. Când punga redevine pozitivă, îl repunem SINGURI în coadă, o singură
// dată (marcaj în log ca să nu ciclăm), cu contorul de încercări resetat.
export async function requeueMoneyFailedBuildJobs(): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ id: string | number }>(
      `UPDATE build_jobs
         SET status='queued', attempts=0,
             log = COALESCE(log,'') || E'\\n[vindecător: repus în coadă — eșuase pe lipsă de credit, punga e iar plină]',
             updated_at = now()
       WHERE status='failed'
         AND updated_at > now() - interval '72 hours'
         AND log ~* '(402|requires more credits|insufficient credits)'
         AND log NOT LIKE '%[vindecător: repus în coadă%'
       RETURNING id`,
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}

// ── OCHII LUI KELION PE STOCAREA PERMANENTĂ (Adrian, 27 iul: „acces la orice
// bază de date a aplicației") — schema completă + SQL direct, pentru uneltele
// de admin db_tables/db_query din chat. Plafoane: 200 rânduri la ieșire și
// statement_timeout 10s, ca o interogare grea să nu sugrume aplicația vie.
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
    return JSON.stringify({ database: 'postgres (aplicația)', tables })
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

// ── PLATA CU COD UNIC (Adrian, 30 iul: „fiecare plată trebuie să fie însoțită
// de un cod unic") ──────────────────────────────────────────────────────────
//
// Fluxul, cap-coadă:
//   1. userul apasă „adaugă credit"  → `creeazaCodPlata` îi dă un cod
//   2. plătește în Revolut, cu codul în referință
//   3. cititorul de tranzacții găsește codul → `crediteazaDupaCod` îi dă creditele
//
// Codul nu e un secret — e doar o etichetă care leagă plata de om. De-aia poate
// fi scurt și ușor de tastat. Ce contează e să nu se repete cât e în așteptare.

/** Alfabet FĂRĂ caracterele care se confundă la citit/tastat: 0/O, 1/I/L.
 *  Omul îl copiază de pe ecran în aplicația de bancă — fiecare caracter ambiguu
 *  e o plată care ajunge „neatribuită" și muncă manuală pentru admin. */
const COD_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function codNou(): string {
  const b = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += COD_ALFABET[b[i] % COD_ALFABET.length]
  // Grupat 4+4: se citește și se tastează mai ușor decât un șir lung.
  return `KLN-${s.slice(0, 4)}-${s.slice(4)}`
}

export interface CodPlata {
  code: string
  amount: number
  currency: string
}

/** Dă userului un cod nou pentru plata pe care o începe ACUM. */
export async function creeazaCodPlata(email: string, amount: number, currency = 'gbp'): Promise<CodPlata | null> {
  if (!dbEnabled() || !email || !(amount > 0)) return null
  const e = email.toLowerCase().trim()
  // Coliziunea e practic imposibilă (31^8), dar „practic imposibil" nu e
  // „imposibil", iar aici s-ar amesteca banii a doi oameni: reîncercăm.
  for (let i = 0; i < 5; i++) {
    const code = codNou()
    try {
      await getPool().query(
        `INSERT INTO payment_codes (code, user_email, amount, currency) VALUES ($1, $2, $3, $4)`,
        [code, e, amount, currency],
      )
      return { code, amount, currency }
    } catch {
      /* cod deja existent → mai încercăm */
    }
  }
  return null
}

/** Caută codul într-un text de referință bancară și creditează, o SINGURĂ dată.
 *
 *  `bankRef` e identificatorul tranzacției din bancă: e ce face creditarea
 *  idempotentă. Aceeași tranzacție citită de zece ori creditează o dată —
 *  garantat de indexul unic, nu de grija apelantului.
 *
 *  Întoarce emailul creditat, sau null dacă n-a găsit cod, sau dacă plata
 *  fusese deja creditată. */
export async function crediteazaDupaCod(
  referinta: string,
  suma: number,
  moneda: string,
  bankRef: string,
): Promise<string | null> {
  if (!dbEnabled() || !referinta || !(suma > 0) || !bankRef) return null
  // Codul poate veni lipit de alt text („plata KLN-AB12-CD34 credite"), cu
  // litere mici, sau cu spații în loc de cratime — le acceptăm pe toate.
  const m = referinta.toUpperCase().replace(/\s+/g, '-').match(/KLN-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  if (!m) return null
  const code = m[0]
  const client = await getPool().connect()
  let email = ''
  try {
    await client.query('BEGIN')
    // `FOR UPDATE` + condiția pe status: două citiri simultane nu pot lua
    // amândouă acelasi cod.
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
    await client.query('ROLLBACK') // eliberăm lacătul: creditarea își face propria tranzacție
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return null
  } finally {
    client.release()
  }
  // ORDINEA CONTEAZĂ, și e aleasă dinadins: CREDITĂM ÎNTÂI, închidem codul după.
  //
  // `topUpUser` e idempotent pe referință (indexul unic pe `stripe_ref`), deci o
  // a doua citire a aceleiași tranzacții nu poate credita de două ori. Dacă am
  // închide codul întâi și creditarea ar pica, omul ar rămâne cu plata „închisă"
  // și fără credite — adică exact plătit-dar-nelivrat. Invers, dacă creditarea
  // reușește și închiderea codului pică, următoarea citire reia: creditarea nu
  // se repetă (idempotentă), iar codul se închide atunci.
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

/** Plățile intrate pe care NU le-am putut lega de nimeni — plasa de siguranță.
 *  Nicio plată nu se pierde: ce nu se potrivește automat ajunge aici, iar
 *  adminul o atribuie dintr-un click. Mai bine să întrebe decât să crediteze
 *  pe cine nu trebuie. */
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
  return row?.code ? { code: row.code, amount: Number(row.amount ?? 0), currency: row.currency ?? 'gbp' } : null
}
