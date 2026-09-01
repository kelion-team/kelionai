import pg from 'pg'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto'
// THE HTTP CONTRACT, a single declaration (Batch A) — see src/shared/api-types.ts.
import type { DemoRecent, DemoStats, UserActivityRow } from './shared/api-types.js'
export type { DemoRecent, DemoStats, UserActivityRow }
import { config } from './config.js'
import { splitTopupMinor } from './services/billingPolicy.js'
import { esteAdminKelion } from './services/adminIdentity.js'
import { embedText, embeddingsEnabled, cosine } from './services/embeddings.js'
import { normalizeazaTip, clampImportanta, rangheazaMemorii } from './services/memoryRank.js'
import { esteDuplicat } from './services/cerinteDedup.js'
import {
  curataTextJurnal,
  esteStareSarcinaOperationala,
  metadateJurnalSigure,
  tranzitieOperationalaPermisa,
  type StareEvenimentOperational,
  type StareSarcinaOperationala,
} from './services/jurnalOperational.js'
import {
  classifyConstructorFailure,
  type ConstructorCauseCode,
  type ConstructorIncident,
  type ConstructorIncidentState,
} from './services/constructorIncident.js'
import {
  parseConstructorStrategy,
  type ConstructorStrategy,
} from './services/constructorStrategist.js'
import {
  CONSTRUCTOR_LOCAL_ACTOR,
  constructorActorLabel,
} from './services/constructorIdentity.js'
import {
  constructorWorkerTechnicalFailureRecord,
  constructorWorkerUnresolvedRecord,
  type ConstructorExecutionProfile,
  type ConstructorExecutionUnresolvedReason,
} from './services/constructorContinuity.js'
import { getPool, conexiuneDb, starePool, inchidePool } from './dbPool.js'
import {
  mediaByteLimit,
  mediaIdValid,
  mediaMimeAllowed,
  normalizeMediaOwner,
  type GeneratedMediaKind,
} from './services/mediaPolicy.js'
export type { GeneratedMediaKind } from './services/mediaPolicy.js'
import { redactDiagnostic, sanitizeDiagnosticUrl } from './shared/diagnosticRedaction.js'

export function dbEnabled(): boolean {
  return Boolean(config.databaseUrl)
}

// Viața conexiunilor (pool + erorile de socket) stă în `dbPool.ts` — un singur
// modul responsabil. `getPool` rămâne exportat de aici pentru verificarea live
// „PostgreSQL" din tokenChecks (SELECT 1) și pentru restul apelanților.
export { getPool, conexiuneDb, starePool, inchidePool }

export async function initDb(): Promise<void> {
  if (!dbEnabled()) return
  // Schema changes are applied only by `npm run migrate`. Boot verifies the
  // registry instead of recreating or altering tables behind the migrator.
  const result = await getPool().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM schema_migrations',
  )
  if (Number(result.rows[0]?.count ?? 0) <= 0) throw new Error('database_schema_not_migrated')
}
export interface SarcinaOperationalaNoua {
  id: string
  userEmail: string
  turnId: string
  objective: string
  metadata?: Record<string, unknown>
}

export interface EvenimentOperationalNou {
  taskId: string
  kind: string
  capability?: string
  outcomeState?: StareEvenimentOperational
  code?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export interface TranzitieSarcinaOperationala {
  taskId: string
  stare: StareSarcinaOperationala
  capability?: string
  code?: string
  reason?: string
  metadata?: Record<string, unknown>
}

interface RandSarcinaOperationala {
  state: string
}

function textJurnal(value: unknown, max: number): string {
  return curataTextJurnal(value, max)
}

function uuidJurnal(value: unknown): string {
  const id = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

function metadateJurnal(value: unknown): string {
  return JSON.stringify(metadateJurnalSigure(value))
}

/** Creates the durable task before the model starts. The initial event is
 * inserted in the same transaction as the task, so an event never exists
 * without its objective and turn correlation. */
export async function inregistreazaSarcinaOperationala(input: SarcinaOperationalaNoua): Promise<boolean> {
  if (!dbEnabled()) return false
  const id = uuidJurnal(input.id)
  const turnId = uuidJurnal(input.turnId)
  const email = textJurnal(input.userEmail, 320).toLowerCase()
  const objective = textJurnal(input.objective, 1_000)
  if (!id || !turnId || !email || !objective) return false
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    const task = await client.query<{ id: string }>(
      `INSERT INTO operational_tasks (id, user_email, turn_id, objective, state, metadata)
       VALUES ($1,$2,$3,$4,'observing',$5::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, email, turnId, objective, metadateJurnal(input.metadata)],
    )
    if (!task.rows[0]) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO operational_events (task_id, kind, outcome_state, code, metadata)
       VALUES ($1,'request_received','observed','request_received',$2::jsonb)`,
      [id, metadateJurnal({ source: 'chat', ...input.metadata })],
    )
    await client.query('COMMIT')
    return true
  } catch (e) {
    try { await client?.query('ROLLBACK') } catch {}
    console.error('[jurnal operațional] nu s-a putut crea sarcina:', String(e).slice(0, 160))
    return false
  } finally {
    client?.release()
  }
}

/** Adds a normalized observation without changing task state. Raw executor
 * payloads are deliberately unavailable to this API. */
export async function noteazaEvenimentOperational(input: EvenimentOperationalNou): Promise<boolean> {
  if (!dbEnabled()) return false
  const taskId = uuidJurnal(input.taskId)
  const kind = textJurnal(input.kind, 80)
  if (!taskId || !kind) return false
  try {
    const rezultat = await getPool().query<{ id: string }>(
      `WITH task AS (
         UPDATE operational_tasks SET updated_at=now() WHERE id=$1 RETURNING id
       )
       INSERT INTO operational_events (task_id, kind, capability, outcome_state, code, reason, metadata)
       SELECT id,$2,$3,$4,$5,$6,$7::jsonb FROM task
       RETURNING id`,
      [
        taskId,
        kind,
        textJurnal(input.capability, 120) || null,
        textJurnal(input.outcomeState, 40) || null,
        textJurnal(input.code, 160) || null,
        textJurnal(input.reason, 500) || null,
        metadateJurnal(input.metadata),
      ],
    )
    return Boolean(rezultat.rows[0])
  } catch (e) {
    console.error('[jurnal operațional] nu s-a putut nota evenimentul:', String(e).slice(0, 160))
    return false
  }
}

/** Validates every transition under a row lock, then persists its state event
 * atomically. No caller can mark a task completed from an impossible state. */
export async function tranzitioneazaSarcinaOperationala(
  input: TranzitieSarcinaOperationala,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!dbEnabled()) return { ok: false, error: 'journal_disabled' }
  const taskId = uuidJurnal(input.taskId)
  if (!taskId || !esteStareSarcinaOperationala(input.stare)) {
    return { ok: false, error: 'journal_transition_invalid' }
  }
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    const task = await client.query<RandSarcinaOperationala>(
      'SELECT state FROM operational_tasks WHERE id=$1 FOR UPDATE',
      [taskId],
    )
    const from = task.rows[0]?.state
    if (!esteStareSarcinaOperationala(from)) {
      await client.query('ROLLBACK')
      // Respingerea se ÎNTOARCE ca valoare, nu ca excepție — fără log aici,
      // apelantul care ignoră {ok:false} o pierdea complet fără urmă.
      console.error(`[jurnal operațional] tranziție pe sarcină inexistentă: ${taskId} → ${input.stare}`)
      return { ok: false, error: 'journal_task_not_found' }
    }
    if (!tranzitieOperationalaPermisa(from, input.stare)) {
      await client.query('ROLLBACK')
      console.error(`[jurnal operațional] tranziție respinsă: ${taskId} ${from} → ${input.stare}`)
      return { ok: false, error: `journal_transition_rejected:${from}:${input.stare}` }
    }
    const terminal = ['completed', 'failed', 'blocked', 'expired', 'unverified'].includes(input.stare)
    await client.query(
      `UPDATE operational_tasks
       SET state=$2, updated_at=now(), finished_at=CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id=$1`,
      [taskId, input.stare, terminal],
    )
    await client.query(
      `INSERT INTO operational_events (task_id, kind, capability, outcome_state, code, reason, metadata)
       VALUES ($1,'state_transition',$2,$3,$4,$5,$6::jsonb)`,
      [
        taskId,
        textJurnal(input.capability, 120) || null,
        input.stare,
        textJurnal(input.code, 160) || null,
        textJurnal(input.reason, 500) || null,
        metadateJurnal({ from, ...input.metadata }),
      ],
    )
    await client.query('COMMIT')
    return { ok: true }
  } catch (e) {
    try { await client?.query('ROLLBACK') } catch {}
    console.error('[jurnal operațional] tranziția nu s-a putut scrie:', String(e).slice(0, 160))
    return { ok: false, error: 'journal_write_failed' }
  } finally {
    client?.release()
  }
}

// ── DOVADA FAPTELOR — cititorul jurnalului operațional (JARVIS pasul 4, §7:
// „salvarea = dovada, asul din mânecă"). Până aici jurnalul era write-only:
// chat.ts scria stări+evenimente pentru fiecare tură, dar nimeni nu le putea
// SCOATE la provocare. Citirea e per-utilizator (user_email), întoarce doar
// ce e deja normalizat/igienizat la scriere — niciodată output brut de unealtă.
export interface DovadaFaptaRand {
  obiectiv: string
  stare: string
  inceput: string
  incheiat: string | null
  sursa: string
  usaCreierului: boolean
  evenimente: Array<{
    fel: string
    unealta: string | null
    stare: string | null
    cod: string | null
    motiv: string | null
    la: string
  }>
}

/** Legea #1: o citire picată se SPUNE (citit:false + motiv), nu se maschează
 *  într-o listă goală — „nicio dovadă" de la o bază căzută nu înseamnă
 *  „nicio faptă". */
export async function dovezileFaptelor(
  userEmail: string,
  cate = 10,
  cauta?: string,
): Promise<{ citit: true; sarcini: DovadaFaptaRand[] } | { citit: false; motiv: string }> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e pornită' }
  const email = String(userEmail ?? '').trim().toLowerCase()
  if (!email) return { citit: false, motiv: 'utilizator necunoscut' }
  const limita = Math.min(Math.max(Math.floor(cate) || 10, 1), 30)
  try {
    const filtru = String(cauta ?? '').trim()
    const sarcini = await getPool().query<{
      id: string
      objective: string
      state: string
      metadata: Record<string, unknown> | null
      created_at: string
      finished_at: string | null
    }>(
      filtru
        ? `SELECT id, objective, state, metadata, created_at, finished_at
           FROM operational_tasks
           WHERE user_email=$1 AND objective ILIKE '%' || $3 || '%'
           ORDER BY created_at DESC LIMIT $2`
        : `SELECT id, objective, state, metadata, created_at, finished_at
           FROM operational_tasks
           WHERE user_email=$1
           ORDER BY created_at DESC LIMIT $2`,
      filtru ? [email, limita, filtru.slice(0, 160)] : [email, limita],
    )
    const ids = sarcini.rows.map((r) => r.id)
    const evenimente = ids.length
      ? await getPool().query<{
          task_id: string
          kind: string
          capability: string | null
          outcome_state: string | null
          code: string | null
          reason: string | null
          created_at: string
        }>(
          `SELECT task_id, kind, capability, outcome_state, code, reason, created_at
           FROM operational_events
           WHERE task_id = ANY($1::uuid[])
           ORDER BY created_at ASC, id ASC`,
          [ids],
        )
      : { rows: [] as Array<{ task_id: string; kind: string; capability: string | null; outcome_state: string | null; code: string | null; reason: string | null; created_at: string }> }
    const peSarcina = new Map<string, DovadaFaptaRand['evenimente']>()
    for (const e of evenimente.rows) {
      const lista = peSarcina.get(e.task_id) ?? []
      lista.push({
        fel: e.kind,
        unealta: e.capability,
        stare: e.outcome_state,
        cod: e.code,
        motiv: e.reason,
        la: String(e.created_at),
      })
      peSarcina.set(e.task_id, lista)
    }
    return {
      citit: true,
      sarcini: sarcini.rows.map((r) => ({
        obiectiv: r.objective,
        stare: r.state,
        inceput: String(r.created_at),
        incheiat: r.finished_at ? String(r.finished_at) : null,
        sursa: String((r.metadata as Record<string, unknown> | null)?.source ?? 'chat'),
        usaCreierului: (r.metadata as Record<string, unknown> | null)?.usaCreierului === true,
        evenimente: peSarcina.get(r.id) ?? [],
      })),
    }
  } catch (e) {
    return { citit: false, motiv: String(e).slice(0, 200) }
  }
}
/** ── URMA DE AUDIT (P26, 15 aug — „cu dovezi cine a modificat") ──────────────
 *  Fire-and-forget prin construcție: o urmă care nu se poate scrie NU blochează
 *  operația (datele omului > registrul), dar se STRIGĂ în jurnal — un audit
 *  care tace despre propriile găuri nu e trasabilitate. Valorile se tund la
 *  400 de caractere: registrul ține DOVADA schimbării, nu arhiva conținutului. */
function etichetaAudit(value: unknown, max: number): string {
  return curataTextJurnal(value, max).replace(/[^\p{L}\p{N}@._:/*() -]/gu, '')
}

function valoareAudit(value: unknown, max: number): string {
  return curataTextJurnal(value, max)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => {
      const digest = createHmac('sha256', config.sessionSecret || 'audit-test-domain')
        .update(email.toLowerCase())
        .digest('hex')
        .slice(0, 16)
      return `[email:${digest}]`
    })
    .replace(/\b(?:\+?\d[ .()-]*){7,15}\b/g, '[redacted-phone]')
}

function valoriAudit(
  actor: string,
  actiune: string,
  tabel: string,
  cheie: string,
  vechi: string,
  nou: string,
): [string, string, string, string, string, string] {
  return [
    etichetaAudit(actor, 120),
    etichetaAudit(actiune, 80),
    etichetaAudit(tabel, 60),
    valoareAudit(cheie, 200),
    valoareAudit(vechi, 400),
    valoareAudit(nou, 400),
  ]
}

/** Operațiile privilegiate care nu pot exista fără urmă așteaptă confirmarea
 * registrului înainte să atingă control-plane-ul. Restul apelanților păstrează
 * semantica best-effort a lui `noteazaAudit`. */
export async function noteazaAuditStrict(
  actor: string,
  actiune: string,
  tabel: string,
  cheie: string,
  vechi = '',
  nou = '',
): Promise<void> {
  if (!dbEnabled()) throw new Error('audit_store_unavailable')
  await getPool().query(
    `INSERT INTO audit_log (actor, actiune, tabel, cheie, vechi, nou) VALUES ($1,$2,$3,$4,$5,$6)`,
    valoriAudit(actor, actiune, tabel, cheie, vechi, nou),
  )
}

export function noteazaAudit(actor: string, actiune: string, tabel: string, cheie: string, vechi = '', nou = ''): void {
  if (!dbEnabled()) return
  void noteazaAuditStrict(actor, actiune, tabel, cheie, vechi, nou)
    .catch((e) => console.error('[audit] urma NU s-a putut scrie:', String(e).slice(0, 160)))
}

/** Registrul de audit pentru panou (admin): ultimele intrări, cele noi primele. */
export async function citesteAudit(limita = 200): Promise<Array<{ la: string; actor: string; actiune: string; tabel: string; cheie: string; vechi: string; nou: string }> | null> {
  if (!dbEnabled()) return null
  try {
    return (
      await getPool().query<{ la: string; actor: string; actiune: string; tabel: string; cheie: string; vechi: string; nou: string }>(
        `SELECT la::text, actor, actiune, tabel, cheie, vechi, nou FROM audit_log ORDER BY la DESC LIMIT $1`,
        [Math.min(500, Math.max(1, limita))],
      )
    ).rows
  } catch (e) {
    console.error('[audit] registrul nu s-a putut citi:', String(e).slice(0, 160))
    return null
  }
}

/** P30a: un clip văzut intră în videotecă — cu urmă de audit (LEGEA P26). */
export async function salveazaVideoInvatat(cerutDe: string, url: string, titlu: string, fisa: string, tokeni: number, costUsd: number): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO video_invatat (cerut_de, url, titlu, fisa, tokeni, cost_usd) VALUES ($1,$2,$3,$4,$5,$6)`,
      [cerutDe.slice(0, 120), url.slice(0, 500), titlu.slice(0, 200), fisa.slice(0, 8000), tokeni, costUsd],
    )
    noteazaAudit(cerutDe, 'video-vazut (catalogat)', 'video_invatat', url.slice(0, 200), '', titlu.slice(0, 120))
  } catch (e) {
    console.error('[videoteca] clipul nu s-a putut cataloga:', String(e).slice(0, 160))
  }
}

/** Căutare în videotecă („din ce clipuri știi X?") — pe titlu + fișă. */
export async function cautaVideoInvatat(text: string, limita = 5): Promise<Array<{ la: string; url: string; titlu: string; fisa: string }> | null> {
  if (!dbEnabled()) return null
  try {
    return (
      await getPool().query<{ la: string; url: string; titlu: string; fisa: string }>(
        `SELECT la::text, url, titlu, fisa FROM video_invatat
          WHERE $1 = '' OR titlu ILIKE '%' || $1 || '%' OR fisa ILIKE '%' || $1 || '%'
          ORDER BY la DESC LIMIT $2`,
        [String(text ?? '').slice(0, 120), Math.min(20, Math.max(1, limita))],
      )
    ).rows
  } catch {
    return null
  }
}

export async function saveClientError(e: {
  type?: string
  message?: string
  stack?: string
  url?: string
  accountId?: string | null
}): Promise<void> {
  if (!dbEnabled()) return
  try {
    await getPool().query(
      `INSERT INTO client_errors (type, message, stack, url, account_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        String(e.type ?? '').slice(0, 40),
        redactDiagnostic(e.message, 800),
        e.stack ? redactDiagnostic(e.stack, 2000) : null,
        sanitizeDiagnosticUrl(String(e.url ?? '')),
        e.accountId && /^[0-9a-f-]{36}$/i.test(e.accountId) ? e.accountId : null,
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
  account_ref: string | null
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
export async function listClientErrorGroupsStrict(hours = 48, limit = 30): Promise<ClientErrorGroup[]> {
  if (!dbEnabled()) throw new Error('client_errors_store_unavailable')
  const r = await getPool().query<ClientErrorGroup>(
    `SELECT max(created_at)::text AS created_at, account_id::text AS account_ref, left(message, 200) AS message, count(*)::text AS n
     FROM client_errors WHERE created_at > now() - ($1 || ' hours')::interval
     GROUP BY account_id, left(message, 200)
     ORDER BY max(created_at) DESC LIMIT $2`,
    [Math.max(1, Math.min(720, hours)), Math.max(1, Math.min(200, limit))],
  )
  return r.rows
}

// SELF-HEALING (Adrian, 27 Jul: "Kelion must be able to collect errors that
// appear under each user automatically and fix them, shipping the repaired
// version to all users afterwards"). We group client errors by message (first
// 200 chars) and return ONLY the RECURRING ones — seen many times, by several
// accounts (opaque ids) in the given window. That way the builder doesn't take
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
              count(DISTINCT account_id) AS users,
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
       HAVING count(*) >= $2 AND count(DISTINCT account_id) >= $3
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
// silent și monitorizarea admin le poate grupa. The bar is LOWER than
// recurringClientErrors on purpose: a mute chat is severe even at one user (the
// owner himself) — so there is NO "2 distinct users" requirement here.
export async function recordSimptomLive(
  fel: string,
  detaliu: string,
  extra?: { url?: string },
): Promise<void> {
  // Reuses the visible, admin-watched store; the `live:` prefix is what the
  // reader and the recurring-errors exclusion key on.
  await saveClientError({
    type: `live:${String(fel).replace(/[^a-z0-9-]/gi, '').slice(0, 32)}`,
    message: detaliu,
    url: extra?.url,
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

// ── Opaque, revocable browser sessions ─────────────────────────────────────

export interface AuthSessionRecord {
  email: string
  name: string
  picture: string
  authProvider: 'google' | 'local'
  locale: string
  authenticatedAt: number
  sessionKind: 'browser' | 'native'
  deviceId: string | null
}

export interface CreateAuthSessionInput extends Omit<AuthSessionRecord, 'authenticatedAt'> {
  tokenHash: string
  absoluteTtlSeconds: number
}

type MemorySession = AuthSessionRecord & { expiresAt: number; lastSeenAt: number; revoked: boolean }
const devSessions = new Map<string, MemorySession>()
const devClientStorageIds = new Map<string, string>()

export async function createAuthSession(input: CreateAuthSessionInput): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(input.tokenHash)) throw new Error('session_hash_invalid')
  if (!Number.isSafeInteger(input.absoluteTtlSeconds) || input.absoluteTtlSeconds <= 0) {
    throw new Error('session_ttl_invalid')
  }
  if (!dbEnabled()) {
    if (config.isProd) throw new Error('session_store_unavailable')
    devSessions.set(input.tokenHash, {
      email: input.email.toLowerCase(),
      name: input.name,
      picture: input.picture,
      authProvider: input.authProvider,
      locale: input.locale,
      authenticatedAt: Date.now(),
      sessionKind: input.sessionKind,
      deviceId: input.deviceId,
      expiresAt: Date.now() + input.absoluteTtlSeconds * 1000,
      lastSeenAt: Date.now(),
      revoked: false,
    })
    const active = [...devSessions.entries()]
      .filter(([, row]) => row.email === input.email.toLowerCase() && !row.revoked)
      .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
    for (const [, row] of active.slice(config.session.maxActivePerAccount)) row.revoked = true
    return
  }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.email.toLowerCase()])
    await client.query(
      `INSERT INTO auth_sessions
         (token_hash, email, name, picture, auth_provider, locale, expires_at, session_kind, device_id)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7), $8, $9)`,
      [
        input.tokenHash,
        input.email.toLowerCase(),
        input.name.slice(0, 200),
        input.picture.slice(0, 2_000),
        input.authProvider,
        input.locale.slice(0, 32),
        input.absoluteTtlSeconds,
        input.sessionKind,
        input.deviceId,
      ],
    )
    await client.query(
      `UPDATE auth_sessions SET revoked_at = now()
        WHERE token_hash IN (
          SELECT token_hash FROM auth_sessions
           WHERE email = $1 AND revoked_at IS NULL AND expires_at > now()
           ORDER BY created_at DESC, token_hash DESC
           OFFSET $2
        )`,
      [input.email.toLowerCase(), config.session.maxActivePerAccount],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function readAndTouchAuthSession(
  tokenHash: string,
  idleTtlSeconds: number,
  touchIntervalSeconds: number,
): Promise<AuthSessionRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null
  if (!Number.isSafeInteger(idleTtlSeconds) || idleTtlSeconds <= 0) return null
  if (!Number.isSafeInteger(touchIntervalSeconds) || touchIntervalSeconds <= 0) return null
  if (!dbEnabled()) {
    if (config.isProd) throw new Error('session_store_unavailable')
    const row = devSessions.get(tokenHash)
    const now = Date.now()
    if (!row || row.revoked || row.expiresAt <= now || row.lastSeenAt + idleTtlSeconds * 1000 <= now) {
      devSessions.delete(tokenHash)
      return null
    }
    if (row.lastSeenAt + touchIntervalSeconds * 1000 <= now) row.lastSeenAt = now
    return {
      email: row.email,
      name: row.name,
      picture: row.picture,
      authProvider: row.authProvider,
      locale: row.locale,
      authenticatedAt: row.authenticatedAt,
      sessionKind: row.sessionKind,
      deviceId: row.deviceId,
    }
  }
  const result = await getPool().query<{
    email: string
    name: string
    picture: string
    auth_provider: 'google' | 'local'
    locale: string
    authenticated_at_ms: string
    session_kind: 'browser' | 'native'
    device_id: string | null
  }>(
    `WITH valid AS (
       SELECT token_hash, email, name, picture, auth_provider, locale, created_at, last_seen_at, session_kind, device_id
         FROM auth_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
          AND last_seen_at > now() - make_interval(secs => $2)
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b WHERE lower(b.email) = lower(auth_sessions.email)
          )
     ), touched AS (
       UPDATE auth_sessions s
          SET last_seen_at = now()
         FROM valid v
        WHERE s.token_hash = v.token_hash
          AND v.last_seen_at <= now() - make_interval(secs => $3)
       RETURNING s.email, s.name, s.picture, s.auth_provider, s.locale, s.created_at, s.session_kind, s.device_id
     )
     SELECT email, name, picture, auth_provider, locale, session_kind, device_id,
            (extract(epoch FROM created_at) * 1000)::bigint::text AS authenticated_at_ms
       FROM touched
     UNION ALL
     SELECT email, name, picture, auth_provider, locale, session_kind, device_id,
            (extract(epoch FROM created_at) * 1000)::bigint::text AS authenticated_at_ms
       FROM valid
      WHERE NOT EXISTS (SELECT 1 FROM touched)
      LIMIT 1`,
    [tokenHash, idleTtlSeconds, touchIntervalSeconds],
  )
  const row = result.rows[0]
  return row
    ? {
        email: row.email,
        name: row.name,
        picture: row.picture,
        authProvider: row.auth_provider,
        locale: row.locale,
        authenticatedAt: Number(row.authenticated_at_ms),
        sessionKind: row.session_kind,
        deviceId: row.device_id,
      }
    : null
}

export async function revokeAuthSession(tokenHash: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) return
  if (!dbEnabled()) {
    const row = devSessions.get(tokenHash)
    if (row) row.revoked = true
    return
  }
  await getPool().query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash],
  )
}

export async function revokeAllAuthSessions(email: string): Promise<void> {
  const key = email.trim().toLowerCase()
  if (!key) return
  if (!dbEnabled()) {
    for (const row of devSessions.values()) if (row.email === key) row.revoked = true
    return
  }
  await getPool().query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE email = $1 AND revoked_at IS NULL',
    [key],
  )
}

export async function getOrCreateClientStorageId(email: string): Promise<string> {
  const key = email.trim().toLowerCase()
  if (!key) throw new Error('identity_invalid')
  if (!dbEnabled()) {
    if (config.isProd) throw new Error('identity_store_unavailable')
    const existing = devClientStorageIds.get(key)
    if (existing) return existing
    const created = randomUUID()
    devClientStorageIds.set(key, created)
    return created
  }
  const id = randomUUID()
  const r = await getPool().query<{ storage_id: string }>(
    `INSERT INTO account_client_storage_ids (user_email, storage_id)
     VALUES ($1,$2)
     ON CONFLICT (user_email) DO UPDATE SET user_email=EXCLUDED.user_email
     RETURNING storage_id`,
    [key, id],
  )
  if (!r.rows[0]?.storage_id) throw new Error('identity_store_unavailable')
  return r.rows[0].storage_id
}

export type NativePlatform = 'ios' | 'desktop' | 'constructor-desktop'

export interface NativeAuthRequestRecord {
  id: string
  platform: NativePlatform
  installId: string
  clientState: string
  clientCodeChallenge: string
  googlePkceCipher: string
}

export async function createNativeAuthRequest(input: {
  id: string
  handleHash: string
  oauthStateHash: string
  clientState: string
  platform: NativePlatform
  installId: string
  clientCodeChallenge: string
  googlePkceCipher: string
  ttlSeconds: number
}): Promise<void> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  await getPool().query(
    `INSERT INTO native_auth_requests
       (id, handle_hash, oauth_state_hash, client_state, platform, install_id,
        client_code_challenge, google_pkce_cipher, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + make_interval(secs => $9))`,
    [
      input.id, input.handleHash, input.oauthStateHash, input.clientState,
      input.platform, input.installId, input.clientCodeChallenge,
      input.googlePkceCipher, input.ttlSeconds,
    ],
  )
}

function nativeAuthRecord(row: Record<string, unknown> | undefined): NativeAuthRequestRecord | null {
  if (!row) return null
  const platform = row.platform === 'ios'
    ? 'ios'
    : row.platform === 'constructor-desktop'
      ? 'constructor-desktop'
      : 'desktop'
  return {
    id: String(row.id),
    platform,
    installId: String(row.install_id),
    clientState: String(row.client_state),
    clientCodeChallenge: String(row.client_code_challenge),
    googlePkceCipher: String(row.google_pkce_cipher),
  }
}

export async function getNativeAuthByHandle(handleHash: string): Promise<NativeAuthRequestRecord | null> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query(
    `SELECT id, platform, install_id, client_state, client_code_challenge, google_pkce_cipher
       FROM native_auth_requests
      WHERE handle_hash=$1 AND status='pending' AND expires_at > now()`,
    [handleHash],
  )
  return nativeAuthRecord(r.rows[0] as Record<string, unknown> | undefined)
}

export async function getNativeAuthByOauthState(oauthStateHash: string): Promise<NativeAuthRequestRecord | null> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query(
    `SELECT id, platform, install_id, client_state, client_code_challenge, google_pkce_cipher
       FROM native_auth_requests
      WHERE oauth_state_hash=$1 AND status='pending' AND expires_at > now()`,
    [oauthStateHash],
  )
  return nativeAuthRecord(r.rows[0] as Record<string, unknown> | undefined)
}

export async function completeNativeAuthRequest(input: {
  id: string
  email: string
  name: string
  picture: string
  locale: string
  exchangeCodeHash: string
  exchangeTtlSeconds: number
}): Promise<boolean> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query(
    `UPDATE native_auth_requests
        SET status='ready', email=$2, name=$3, picture=$4, locale=$5,
            exchange_code_hash=$6,
            ready_expires_at=now() + make_interval(secs => $7)
      WHERE id=$1 AND status='pending' AND expires_at > now()`,
    [
      input.id, input.email.toLowerCase(), input.name.slice(0, 200),
      input.picture.slice(0, 2_000), input.locale.slice(0, 32),
      input.exchangeCodeHash, input.exchangeTtlSeconds,
    ],
  )
  return (r.rowCount ?? 0) === 1
}

export async function consumeNativeAuthCode(input: {
  exchangeCodeHash: string
  clientState: string
  platform: NativePlatform
  installId: string
  clientCodeChallenge: string
}): Promise<{ email: string; name: string; picture: string; locale: string } | null> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query<{ email: string; name: string; picture: string; locale: string }>(
    `UPDATE native_auth_requests
        SET status='consumed', consumed_at=now()
      WHERE exchange_code_hash=$1
        AND client_state=$2
        AND platform=$3
        AND install_id=$4
        AND client_code_challenge=$5
        AND status='ready'
        AND ready_expires_at > now()
      RETURNING email, name, picture, locale`,
    [
      input.exchangeCodeHash, input.clientState, input.platform,
      input.installId, input.clientCodeChallenge,
    ],
  )
  return r.rows[0] ?? null
}

export async function createNativeChannelTicket(input: {
  ticketHash: string
  sessionTokenHash: string
  audience: 'vocal-live' | 'apel' | 'deploy-status'
  ttlSeconds: number
}): Promise<void> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query(
    `INSERT INTO native_channel_tickets
       (ticket_hash, session_token_hash, audience, expires_at)
     SELECT $1, token_hash, $3, now() + make_interval(secs => $4)
       FROM auth_sessions
      WHERE token_hash=$2 AND session_kind='native' AND revoked_at IS NULL AND expires_at > now()`,
    [input.ticketHash, input.sessionTokenHash, input.audience, input.ttlSeconds],
  )
  if ((r.rowCount ?? 0) !== 1) throw new Error('native_session_required')
}

export async function consumeNativeChannelTicket(
  ticketHash: string,
  audience: 'vocal-live' | 'apel' | 'deploy-status',
): Promise<AuthSessionRecord | null> {
  if (!dbEnabled()) throw new Error('native_auth_store_unavailable')
  const r = await getPool().query<{
    email: string
    name: string
    picture: string
    auth_provider: 'google' | 'local'
    locale: string
    authenticated_at_ms: string
    device_id: string | null
  }>(
    `WITH claimed AS (
       UPDATE native_channel_tickets
          SET consumed_at=now()
        WHERE ticket_hash=$1 AND audience=$2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING session_token_hash
     )
     SELECT s.email, s.name, s.picture, s.auth_provider, s.locale,
            (extract(epoch FROM s.created_at) * 1000)::bigint::text AS authenticated_at_ms,
            s.device_id
       FROM claimed c
       JOIN auth_sessions s ON s.token_hash=c.session_token_hash
      WHERE s.session_kind='native' AND s.revoked_at IS NULL AND s.expires_at > now()
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b WHERE lower(b.email)=lower(s.email)
        )`,
    [ticketHash, audience],
  )
  const row = r.rows[0]
  return row ? {
    email: row.email,
    name: row.name,
    picture: row.picture,
    authProvider: row.auth_provider,
    locale: row.locale,
    authenticatedAt: Number(row.authenticated_at_ms),
    sessionKind: 'native',
    deviceId: row.device_id,
  } : null
}

export async function cleanupExpiredAuthState(): Promise<void> {
  if (!dbEnabled()) return
  await getPool().query(`DELETE FROM native_channel_tickets WHERE expires_at < now() - interval '1 day'`)
  await getPool().query(`DELETE FROM native_auth_requests WHERE expires_at < now() - interval '1 day'`)
  await getPool().query(`DELETE FROM auth_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`)
}

// ── Persistent Google connection (refresh token per account) ────────────────

function googleTokenKey(secret: string, kid: string): Buffer {
  if (secret.length < 32) throw new Error('google_token_encryption_key_missing')
  return createHash('sha256').update(`kelionai:google-token:v2:${kid}:${secret}`).digest()
}

function encryptGoogleToken(email: string, token: string): string {
  const iv = randomBytes(12)
  const kid = config.googleTokenEncryptionKeyId
  const cipher = createCipheriv('aes-256-gcm', googleTokenKey(config.googleTokenEncryptionKey, kid), iv)
  cipher.setAAD(Buffer.from(email.toLowerCase(), 'utf8'))
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v2:${kid}:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`
}

function decryptWithKey(email: string, value: string, key: Buffer, offset: number): string {
  try {
    const parts = value.split(':')
    const iv = parts[offset]
    const encrypted = parts[offset + 1]
    const tag = parts[offset + 2]
    if (!iv || !encrypted || !tag) return ''
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(email.toLowerCase(), 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}

function decryptGoogleToken(email: string, value: string): { token: string; rotate: boolean } {
  // Plaintext legacy values are deliberately invalidated.
  if (value.startsWith('v2:')) {
    const kid = value.split(':', 3)[1]
    const candidates = [
      { kid: config.googleTokenEncryptionKeyId, secret: config.googleTokenEncryptionKey },
      { kid: config.googleTokenEncryptionPreviousKeyId, secret: config.googleTokenEncryptionPreviousKey },
    ]
    const selected = candidates.find((candidate) => candidate.kid === kid && candidate.secret.length >= 32)
    if (!selected) return { token: '', rotate: false }
    const token = decryptWithKey(email, value, googleTokenKey(selected.secret, selected.kid), 2)
    return { token, rotate: Boolean(token) && selected.kid !== config.googleTokenEncryptionKeyId }
  }
  if (value.startsWith('v1:')) {
    // One-time migration path for ciphertext created before key ids existed.
    // Try the current and previous secret with the historical derivation and
    // immediately rewrite a successful read into the current v2 envelope.
    for (const secret of [config.googleTokenEncryptionKey, config.googleTokenEncryptionPreviousKey]) {
      if (secret.length < 32) continue
      const legacyKey = createHash('sha256').update(`kelionai:google-token:v1:${secret}`).digest()
      const token = decryptWithKey(email, value, legacyKey, 1)
      if (token) return { token, rotate: true }
    }
  }
  return { token: '', rotate: false }
}

export async function saveGoogleRefreshToken(email: string, token: string, scopes = ''): Promise<void> {
  const key = email.trim().toLowerCase()
  if (!key || !token) throw new Error('google_token_invalid')
  if (!dbEnabled()) throw new Error('google_token_store_unavailable')
  const encrypted = encryptGoogleToken(key, token)
  const granted = [...new Set(scopes.split(/\s+/).filter(Boolean))].sort()
  await getPool().query(
    `INSERT INTO google_accounts (email, refresh_token, granted_scopes) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET refresh_token = $2,
           granted_scopes = $3,
           updated_at = now()`,
    [key, encrypted, granted],
  )
}

export async function getGoogleRefreshToken(email: string, requiredScopes: readonly string[] = []): Promise<string> {
  if (!dbEnabled() || !email) return ''
  const key = email.toLowerCase()
  const r = await getPool().query<{ refresh_token: string; granted_scopes: string[] }>(
    'SELECT refresh_token, granted_scopes FROM google_accounts WHERE email = $1',
    [key],
  )
  const row = r.rows[0]
  if (!row) return ''
  const granted = new Set(row.granted_scopes ?? [])
  if (requiredScopes.some((scope) => !granted.has(scope))) return ''
  const decrypted = decryptGoogleToken(key, row.refresh_token)
  if (decrypted.token && decrypted.rotate) {
    await getPool().query(
      'UPDATE google_accounts SET refresh_token=$2, updated_at=now() WHERE email=$1 AND refresh_token=$3',
      [key, encryptGoogleToken(key, decrypted.token), row.refresh_token],
    )
  }
  return decrypted.token
}

export async function getGoogleGrantedScopes(email: string): Promise<string[]> {
  if (!dbEnabled() || !email) return []
  const r = await getPool().query<{ granted_scopes: string[] }>(
    'SELECT granted_scopes FROM google_accounts WHERE email=$1',
    [email.toLowerCase()],
  )
  return r.rows[0]?.granted_scopes ?? []
}

export async function disconnectGoogleAccount(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  await getPool().query('DELETE FROM google_accounts WHERE email = $1', [email.toLowerCase()])
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

export async function addLead(email: string, note: string, submissionSession: string): Promise<boolean> {
  if (
    !dbEnabled()
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionSession)
  ) return false
  try {
    await getPool().query(
      'INSERT INTO leads (email, note, submission_session) VALUES ($1, $2, $3::uuid)',
      [email.trim().toLowerCase().slice(0, 254), note.slice(0, 1_000), submissionSession],
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
  submissionId: string
  name: string
  email: string
  subject: string
  message: string
  department: string
  lang: string
  emailed: boolean
}): Promise<{ id: number; emailed: boolean } | null> {
  if (!dbEnabled() || !m.email || !m.message || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.submissionId)) return null
  try {
    const r = await getPool().query<{ id: number; emailed: boolean }>(
      `INSERT INTO contact_messages (submission_id, name, email, subject, message, department, lang, emailed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (submission_id) WHERE submission_id IS NOT NULL
       DO UPDATE SET submission_id=EXCLUDED.submission_id
       RETURNING id, emailed`,
      [
        m.submissionId,
        m.name.slice(0, 120),
        m.email.slice(0, 200),
        m.subject.slice(0, 200),
        m.message.slice(0, 8000),
        m.department.slice(0, 80),
        m.lang.slice(0, 5),
        m.emailed,
      ],
    )
    const row = r.rows[0]
    const id = Number(row?.id ?? 0)
    return id > 0 ? { id, emailed: row?.emailed === true } : null
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

export async function listContactMessages(n = 100): Promise<ContactMessage[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<ContactMessage>(
      `SELECT id, name, email, subject, message, department, lang, emailed, created_at::text
       FROM contact_messages ORDER BY created_at DESC LIMIT $1`,
      [n],
    )
    return r.rows
  } catch {
    return null
  }
}

// ── User management (admin) ─────────────────────────────────────────────────
// The owner blocks/unblocks a user, grants credit, or wipes a user's data.
// The ADMIN is protected at the route layer (can never be blocked/deleted).

export type AccountBlockStatus =
  | { available: true; blocked: boolean }
  | { available: false }

export async function accountBlockStatus(email: string): Promise<AccountBlockStatus> {
  if (!dbEnabled() || !email) return { available: false }
  try {
    const r = await getPool().query('SELECT 1 FROM blocked_users WHERE email = $1', [email.toLowerCase()])
    return { available: true, blocked: (r.rowCount ?? 0) > 0 }
  } catch {
    return { available: false }
  }
}

export async function blockUser(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  try {
    await getPool().query(
      'INSERT INTO blocked_users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email.toLowerCase()],
    )
    noteazaAudit('admin', 'blocare-user', 'blocked_users', email.toLowerCase(), 'liber', 'blocat')
  } catch {
    /* non-fatal */
  }
}

export async function unblockUser(email: string): Promise<void> {
  if (!dbEnabled() || !email) return
  try {
    await getPool().query('DELETE FROM blocked_users WHERE email = $1', [email.toLowerCase()])
    noteazaAudit('admin', 'deblocare-user', 'blocked_users', email.toLowerCase(), 'blocat', 'liber')
  } catch {
    /* non-fatal */
  }
}

/** Add product credit in integer minor units. The caller supplies an
 * idempotency reference; success is never reported if any ledger write fails. */
export async function grantCreditMinor(email: string, amountMinor: number, ref: string): Promise<boolean> {
  const e = userKey(email)
  if (!dbEnabled() || !e || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !ref || ref.length > 160) return false
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    if (await billingRefSeen(client, ref)) {
      await client.query('ROLLBACK')
      return true
    }
    const wallet = await client.query(
      `INSERT INTO wallets (user_email, balance_minor, currency, topup_ref_minor)
       VALUES ($1, $2, $3, $2)
       ON CONFLICT (user_email) DO UPDATE
         SET balance_minor = wallets.balance_minor + $2,
             topup_ref_minor = greatest(wallets.balance_minor + $2, wallets.topup_ref_minor),
             updated_at = now()
         WHERE wallets.currency = EXCLUDED.currency
       RETURNING user_email`,
      [e, amountMinor, config.billing.currency],
    )
    if ((wallet.rowCount ?? 0) !== 1) throw new Error('wallet_currency_mismatch')
    await client.query(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'grant', $2, $3, $4, $5, 'product credit grant')`,
      [e, amountMinor, config.billing.currency, config.billing.policyVersion, ref],
    )
    await client.query(
      `INSERT INTO transactions
         (user_id, gross_minor, user_credit_minor, credits, currency, policy_version, status, payment_ref)
       VALUES ($1, $2, $2, $3, $4, $5, 'admin_grant', $6)`,
      [e, amountMinor, Math.floor(amountMinor / config.billing.creditMinor), config.billing.currency, config.billing.policyVersion, ref],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] grantCreditMinor failed: ${String(error).slice(0, 160)}`)
    return false
  } finally {
    client.release()
  }
}

export type ProcessorRevocationStatus = 'completed' | 'manual_required' | 'not_applicable'

export interface ErasureReceipt {
  requestId: string
  completedAt: string
  deleted: string[]
  retained: Array<{ category: string; reason: string; until: string }>
  backups: { beyondUse: true; purgeAfter: string }
  googleRevocation: ProcessorRevocationStatus
}

/** Erase consent-based/account data and pseudonymise only records retained for
 * accounting or legal claims. Every statement is in one transaction; a
 * partial "success" cannot escape to the caller. */
export async function eraseUserAccount(
  email: string,
  googleRevocation: ProcessorRevocationStatus,
): Promise<ErasureReceipt> {
  const key = userKey(email)
  if (!dbEnabled() || !key) throw new Error('erasure_store_unavailable')
  const requestId = randomUUID()
  const erasureId = randomUUID()
  const pseudonym = `erased:${erasureId}`
  const backupPurgeAfter = new Date(Date.now() + config.privacy.backupRetentionDays * 86_400_000)
  const financialUntil = new Date()
  financialUntil.setUTCFullYear(financialUntil.getUTCFullYear() + config.privacy.financialRetentionYears)
  const deleted = [
    'profile_and_sessions',
    'google_credentials',
    'messages_and_memories',
    'biometric_profiles',
    'sensor_and_presence_history',
    'preferences_and_notifications',
    'pending_work_cancelled_and_user_content_removed',
  ]
  const retained = [
    {
      category: 'financial_and_security_records',
      reason: 'legal_obligation_and_legal_claims',
      until: financialUntil.toISOString(),
    },
    {
      category: 'minimal_operational_job_evidence',
      reason: 'legal_claims',
      until: financialUntil.toISOString(),
    },
  ]
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`constructor-account:${key}`])
    await client.query(
      `INSERT INTO erasure_requests
         (id, erasure_id, status, backup_purge_after, retention_until, deleted_categories, retained_records, provider_revocation)
       VALUES ($1, $2, 'processing', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        requestId,
        erasureId,
        backupPurgeAfter.toISOString(),
        financialUntil.toISOString(),
        JSON.stringify(deleted),
        JSON.stringify(retained),
        JSON.stringify({ google: googleRevocation, openai: 'not_applicable_store_false' }),
      ],
    )

    // Serialize against recordWorkerHandoff(), which locks the same build row
    // before inserting constructor_pipeline.  The cancellation UPDATE then runs
    // in a fresh READ COMMITTED statement snapshot: either erasure owns the row
    // first and handoff observes the cancelled job, or a committed handoff is
    // visible to the NOT EXISTS predicate below.
    await client.query(
      `SELECT id FROM build_jobs
        WHERE lower(ordered_by)=$1
        ORDER BY id
        FOR UPDATE`,
      [key],
    )

    // O execuție poate fi anulată numai înainte de handoff. Din momentul în
    // care există ledgerul Constructor, publisherul/release-ul trebuie să-și
    // poată termina reconcilierea chiar dacă identitatea contului este ștearsă.
    await client.query(
      `UPDATE build_jobs b
          SET status='cancelled', constructor_stage='cancelled', codex_task_id=NULL,
              progress='cancelled_by_account_erasure', progress_at=now(), updated_at=now()
        WHERE lower(b.ordered_by)=$1
          AND (b.status='queued' OR (b.status='running' AND b.constructor_stage IN ('claimed','accepted','working')))
          AND NOT EXISTS (SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id)`,
      [key],
    )
    await client.query(
      `DELETE FROM constructor_incidents ci
        WHERE ci.job_id IN (
          SELECT b.id FROM build_jobs b
           WHERE lower(b.ordered_by)=$1
             AND NOT EXISTS (SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id)
        )`,
      [key],
    )
    await client.query(
      `UPDATE constructor_incidents ci
          SET cause_summary='[erased operational incident]', evidence='[erased]',
              next_action='Continue the durable Constructor reconciliation.',
              verification=NULL, lesson=NULL, strategy=NULL, strategy_action_fingerprint=NULL,
              strategy_evidence_fingerprint=NULL, updated_at=now()
        WHERE ci.job_id IN (
          SELECT b.id FROM build_jobs b
          JOIN constructor_pipeline p ON p.job_id=b.id
          WHERE lower(b.ordered_by)=$1
        )`,
      [key],
    )
    await client.query(
      `UPDATE build_jobs
          SET ordered_by = $2,
              order_text = '[erased]',
              log = NULL,
              progress = NULL,
              legal_basis = 'legal_claims',
              retention_until = $3,
              erasure_request_id = $4,
              updated_at = now()
        WHERE lower(ordered_by) = $1`,
      [key, pseudonym, financialUntil.toISOString(), requestId],
    )
    await client.query(`DELETE FROM operational_tasks WHERE lower(user_email) = $1`, [key])

    const deleteStatements = [
      'DELETE FROM messages WHERE lower(user_email) = $1',
      'DELETE FROM user_prefs WHERE lower(user_email) = $1',
      'DELETE FROM task_timings WHERE lower(user_email) = $1',
      'DELETE FROM voiceprints WHERE lower(user_email) = $1',
      'DELETE FROM faceprints WHERE lower(user_email) = $1',
      'DELETE FROM voice_guests WHERE lower(account_email) = $1',
      'DELETE FROM memories WHERE lower(user_email) = $1',
      'DELETE FROM user_presence_daily WHERE lower(user_email) = $1',
      'DELETE FROM capability_gaps WHERE lower(user_email) = $1',
      'DELETE FROM notes WHERE lower(user_email) = $1',
      'DELETE FROM push_subscriptions WHERE lower(email) = $1',
      'DELETE FROM local_accounts WHERE lower(email) = $1',
      'DELETE FROM login_tokens WHERE lower(email) = $1',
      'DELETE FROM google_accounts WHERE lower(email) = $1',
      'DELETE FROM native_auth_requests WHERE lower(coalesce(email,\'\')) = $1',
      `DELETE FROM client_errors
        WHERE account_id IN (
          SELECT storage_id FROM account_client_storage_ids WHERE lower(user_email) = $1
        )`,
      'DELETE FROM account_client_storage_ids WHERE lower(user_email) = $1',
      'DELETE FROM blocked_users WHERE lower(email) = $1',
      'DELETE FROM leads WHERE lower(email) = $1',
      'DELETE FROM contact_messages WHERE lower(email) = $1',
      'DELETE FROM video_invatat WHERE lower(cerut_de) = $1',
      'DELETE FROM generated_media WHERE lower(owner_email) = $1',
      'DELETE FROM chat_turn_replays WHERE lower(user_email) = $1',
      `DELETE FROM payment_codes WHERE lower(user_email) = $1 AND status <> 'paid'`,
      `DELETE FROM merchant_checkout_orders WHERE lower(user_email) = $1 AND status <> 'paid'`,
    ]
    for (const sql of deleteStatements) await client.query(sql, [key])
    await client.query(
      `DELETE FROM kv_state WHERE key = ANY($1::text[])`,
      [[`model_choice:${key}`, `avatar_box:${key}`, `voce_sample_${key}`, `promo_episoade:${key}`, `cv_implicit:${key}`]],
    )

    const legalBasis = 'legal_obligation_and_legal_claims'
    const retainedUntil = financialUntil.toISOString()
    for (const sql of [
      `UPDATE wallets SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
      `UPDATE billing_events SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
      `UPDATE transactions SET user_id=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_id)=$1`,
      `UPDATE payment_codes SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
      `UPDATE merchant_checkout_orders SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
      `UPDATE cost_events SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
      `UPDATE provider_usage_events SET user_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5 WHERE lower(user_email)=$1`,
    ]) await client.query(sql, [key, pseudonym, legalBasis, retainedUntil, requestId])
    await client.query(
      `UPDATE plati_neatribuite
          SET resolved_email=$2, legal_basis=$3, retention_until=$4, erasure_request_id=$5
        WHERE lower(coalesce(resolved_email,''))=$1`,
      [key, pseudonym, legalBasis, retainedUntil, requestId],
    )

    const emailPattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await client.query(
      `UPDATE audit_log
          SET actor=regexp_replace(actor,$1,$2,'gi'),
              cheie=regexp_replace(cheie,$1,$2,'gi'),
              vechi=regexp_replace(vechi,$1,$2,'gi'),
              nou=regexp_replace(nou,$1,$2,'gi'),
              legal_basis=$3,
              retention_until=$4,
              erasure_request_id=$5
        WHERE actor ~* $1 OR cheie ~* $1 OR vechi ~* $1 OR nou ~* $1`,
      [emailPattern, pseudonym, legalBasis, retainedUntil, requestId],
    )

    await client.query('DELETE FROM auth_sessions WHERE lower(email)=$1', [key])
    await client.query(
      `INSERT INTO processor_privacy_actions (request_id, processor, action, status, detail_code)
       VALUES ($1,'google','revoke_oauth',$2,$3),
              ($1,'openai','delete_remote_state','not_applicable','store_false')`,
      [requestId, googleRevocation, googleRevocation === 'completed' ? 'revoked' : 'provider_unavailable_or_not_connected'],
    )
    await client.query(
      `UPDATE erasure_requests SET status='completed', completed_at=now() WHERE id=$1`,
      [requestId],
    )
    await client.query('COMMIT')
    return {
      requestId,
      completedAt: new Date().toISOString(),
      deleted,
      retained,
      backups: { beyondUse: true, purgeAfter: backupPurgeAfter.toISOString() },
      googleRevocation,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function updateErasureGoogleRevocation(
  requestId: string,
  status: ProcessorRevocationStatus,
): Promise<boolean> {
  if (!dbEnabled() || !/^[0-9a-f-]{36}$/.test(requestId)) return false
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE erasure_requests
          SET provider_revocation = jsonb_set(provider_revocation, '{google}', to_jsonb($2::text), true)
        WHERE id=$1 AND status='completed'`,
      [requestId, status],
    )
    await client.query(
      `UPDATE processor_privacy_actions
          SET status=$2,
              detail_code=CASE WHEN $2='completed' THEN 'revoked' ELSE 'provider_unavailable_or_not_connected' END,
              attempted_at=now()
        WHERE request_id=$1 AND processor='google' AND action='revoke_oauth'`,
      [requestId, status],
    )
    await client.query('COMMIT')
    return (updated.rowCount ?? 0) === 1
  } catch {
    await client.query('ROLLBACK').catch(() => undefined)
    return false
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
export async function createLocalAccount(email: string, name: string, passHash: string): Promise<boolean> {
  if (!dbEnabled()) throw new Error('db_unavailable')
  const result = await getPool().query(
    `INSERT INTO local_accounts (email, name, pass_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO NOTHING`,
    [email.toLowerCase().trim(), name.slice(0, 120), passHash],
  )
  return (result.rowCount ?? 0) === 1
}

export async function updateLocalPassword(email: string, passHash: string): Promise<boolean> {
  if (!dbEnabled()) throw new Error('db_unavailable')
  const result = await getPool().query(
    'UPDATE local_accounts SET pass_hash=$2 WHERE email=$1',
    [email.toLowerCase().trim(), passHash],
  )
  return (result.rowCount ?? 0) === 1
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
  await saveKvStrict(key, value)
}

/** Variantă fail-closed pentru heartbeaturi și alte ACK-uri de control. */
export async function saveKvStrict(key: string, value: string): Promise<void> {
  if (!dbEnabled()) throw new Error('db_unavailable')
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

/** Read and delete a KV value in one database statement.
 *
 * This is intentionally different from `loadKv` followed by `deleteKv`: two
 * concurrent OAuth callbacks must not both be able to consume the same state.
 */
export async function consumeKv(key: string): Promise<string | null> {
  if (!dbEnabled()) return null
  const r = await getPool().query<{ value: string }>(
    'DELETE FROM kv_state WHERE key=$1 RETURNING value',
    [key],
  )
  return r.rows[0]?.value ?? null
}

// ── GESTURES: which gestures Kelion is allowed to use CONTEXTUALLY (Adrian,
// 13 Jul: admin panel with a checkbox per gesture). We store ONLY the disabled
// list (default: all active). The brain reads the list and avoids the gestures
// checked OFF.
export function canonicalDisabledGestures(list: readonly string[]): string[] {
  return [...new Set(list.map((x) => x.slice(0, 40)))].slice(0, 200)
}

export async function getDisabledGestures(): Promise<string[]> {
  // An absent key is the only valid representation of the default (all active).
  // A missing database, failed query or corrupt row must never be projected as [].
  if (!dbEnabled()) throw new Error('gesture_store_unavailable')
  const raw = await loadKv('gesture_disabled')
  if (raw === null) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('gesture_state_invalid')
  }
  if (!Array.isArray(parsed) || !parsed.every((x): x is string => typeof x === 'string')) {
    throw new Error('gesture_state_invalid')
  }
  const canonical = canonicalDisabledGestures(parsed)
  if (canonical.length !== parsed.length || canonical.some((value, index) => value !== parsed[index])) {
    throw new Error('gesture_state_invalid')
  }
  return canonical
}

export async function setDisabledGestures(list: string[]): Promise<string[]> {
  const canonical = canonicalDisabledGestures(list)
  await saveKvStrict('gesture_disabled', JSON.stringify(canonical))
  return canonical
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
export type CitireSold = { citit: true; soldMinor: number } | { citit: false; motiv: string }

export async function citesteSold(email: string): Promise<CitireSold> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    const r = await getPool().query<{ balance_minor: string; debt_minor: string; frozen_reason: string | null }>(
      'SELECT balance_minor, debt_minor, frozen_reason FROM wallets WHERE user_email = $1',
      [walletKey(email)],
    )
    // Fără rând = portofel inexistent = zero REAL, citit. Nu e același lucru
    // cu „n-am ajuns la bază".
    const balanceMinor = Number(r.rows[0]?.balance_minor ?? 0)
    const debtMinor = Number(r.rows[0]?.debt_minor ?? 0)
    if (!Number.isSafeInteger(balanceMinor) || balanceMinor < 0 || !Number.isSafeInteger(debtMinor) || debtMinor < 0) {
      return { citit: false, motiv: 'ledger_invalid' }
    }
    return { citit: true, soldMinor: debtMinor > 0 || Boolean(r.rows[0]?.frozen_reason) ? 0 : balanceMinor }
  } catch (e) {
    return { citit: false, motiv: `citirea portofelului a picat: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
  }
}

/** Product credits actually consumed, derived from the versioned GBP-minor
 * ledger. Provider USD usage is deliberately not mixed into this number. */
export async function citesteCrediteFolosite(email: string): Promise<Citire<number>> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    const r = await getPool().query<{ used_minor: string }>(
      `SELECT coalesce(sum(
                CASE
                  WHEN event.kind='usage' AND event.amount_minor < 0 THEN -event.amount_minor
                  WHEN operation.refund_event_id=event.id
                    AND event.kind='grant' AND event.amount_minor > 0 THEN -event.amount_minor
                  ELSE 0
                END
              ), 0)::text AS used_minor
         FROM billing_events AS event
         LEFT JOIN voice_billing_operations AS operation
           ON operation.refund_event_id=event.id
        WHERE event.user_email = $1 AND event.currency = $2`,
      [walletKey(email), config.billing.currency],
    )
    const usedMinor = Number(r.rows[0]?.used_minor ?? 0)
    if (!Number.isSafeInteger(usedMinor) || usedMinor < 0) return { citit: false, motiv: 'ledger_invalid' }
    return { citit: true, valoare: Math.floor(usedMinor / config.billing.creditMinor) }
  } catch {
    return { citit: false, motiv: 'ledger_unavailable' }
  }
}

export type DebitWalletResult =
  | { ok: true; debitedMinor: number; duplicate: boolean }
  | { ok: false; code: 'invalid' | 'unavailable' | 'insufficient'; motiv: string }

const VOICE_DEBIT_REF = /^voice-debit:v1:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]{0,8})$/

function voiceDebitIdentity(ref: string): { sessionId: string; tick: number } | null {
  const match = VOICE_DEBIT_REF.exec(ref)
  if (!match) return null
  const tick = Number(match[2])
  return Number.isSafeInteger(tick) ? { sessionId: match[1], tick } : null
}

function voiceRefundRef(ref: string): string {
  return ref.replace(/^voice-debit:/, 'voice-refund:')
}

async function limiteazaTranzactieFacturareVocala(client: pg.PoolClient): Promise<void> {
  await client.query("SET LOCAL statement_timeout = '4500ms'")
  await client.query("SET LOCAL lock_timeout = '4000ms'")
}

export type VoiceDebitTransitionResult =
  | 'ok'
  | 'duplicate'
  | 'expired'
  | 'conflict'
  | 'not_found'
  | 'unavailable'

/** Debit + coordination row commit together. A late transaction therefore
 * remains discoverable as `charged` after the caller or process disappears. */
export async function debiteazaVocalLiveAtomar(
  email: string,
  amountMinor: number,
  ref: string,
  consumeDeadlineEpochMs: number,
): Promise<DebitWalletResult> {
  const identity = voiceDebitIdentity(ref)
  if (
    !identity
    || !Number.isSafeInteger(amountMinor)
    || amountMinor <= 0
    || !Number.isSafeInteger(consumeDeadlineEpochMs)
    || consumeDeadlineEpochMs <= 0
  ) return { ok: false, code: 'invalid', motiv: 'debit vocal invalid' }
  if (esteAdminKelion(email)) return { ok: true, debitedMinor: 0, duplicate: false }
  if (!dbEnabled()) return { ok: false, code: 'unavailable', motiv: 'baza de date nu e configurată' }
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await limiteazaTranzactieFacturareVocala(client)
    await client.query(
      `INSERT INTO wallets (user_email, balance_minor, currency)
       VALUES ($1, 0, $2) ON CONFLICT (user_email) DO NOTHING`,
      [walletKey(email), config.billing.currency],
    )
    const wallet = await client.query<{ balance_minor: string; debt_minor: string; frozen_reason: string | null }>(
      `SELECT balance_minor, debt_minor, frozen_reason
         FROM wallets WHERE user_email=$1 FOR UPDATE`,
      [walletKey(email)],
    )
    if (await billingRefSeen(client, ref)) {
      const replay = await client.query<{
        user_email: string
        amount_minor: string
        currency: string
        kind: string
        session_id: string | null
        tick: string | null
      }>(
        `SELECT event.user_email, event.amount_minor::text AS amount_minor,
                event.currency, event.kind, operation.session_id::text AS session_id,
                operation.tick::text AS tick
           FROM billing_events AS event
           LEFT JOIN voice_billing_operations AS operation
             ON operation.debit_event_id=event.id AND operation.debit_ref=event.ref
          WHERE event.ref=$1`,
        [ref],
      )
      const row = replay.rows[0]
      const exactReplay = row?.user_email === walletKey(email)
        && Number(row.amount_minor) === -amountMinor
        && row.currency === config.billing.currency
        && row.kind === 'usage'
        && row.session_id === identity.sessionId
        && Number(row.tick) === identity.tick
      await client.query(exactReplay ? 'COMMIT' : 'ROLLBACK')
      return exactReplay
        ? { ok: true, debitedMinor: 0, duplicate: true }
        : { ok: false, code: 'invalid', motiv: 'referință vocală refolosită cu alt debit' }
    }
    const balanceMinor = Number(wallet.rows[0]?.balance_minor ?? 0)
    const debtMinor = Number(wallet.rows[0]?.debt_minor ?? 0)
    if (
      !Number.isSafeInteger(balanceMinor)
      || !Number.isSafeInteger(debtMinor)
      || debtMinor > 0
      || Boolean(wallet.rows[0]?.frozen_reason)
      || balanceMinor < amountMinor
    ) {
      await client.query('ROLLBACK')
      return { ok: false, code: 'insufficient', motiv: 'sold insuficient' }
    }
    await client.query(
      `UPDATE wallets SET balance_minor=balance_minor-$2, updated_at=now()
        WHERE user_email=$1`,
      [walletKey(email), amountMinor],
    )
    const debit = await client.query<{ id: string }>(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'usage', $2, $3, $4, $5, 'voice minute v2')
       RETURNING id::text AS id`,
      [walletKey(email), -amountMinor, config.billing.currency, config.billing.policyVersion, ref],
    )
    await client.query(
      `INSERT INTO voice_billing_operations
         (debit_ref, debit_event_id, session_id, tick, state, consume_deadline)
       VALUES ($1, $2::bigint, $3::uuid, $4, 'pending', $5::timestamptz)`,
      [ref, debit.rows[0]?.id, identity.sessionId, identity.tick, new Date(consumeDeadlineEpochMs).toISOString()],
    )
    await client.query('COMMIT')
    return { ok: true, debitedMinor: amountMinor, duplicate: false }
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] debiteazaVocalLiveAtomar failed: ${String(error).slice(0, 160)}`)
    return { ok: false, code: 'unavailable', motiv: 'debitarea vocală nu a putut fi verificată' }
  } finally {
    client?.release()
  }
}

export async function confirmaDebitVocalLive(ref: string, handoffToken: string): Promise<VoiceDebitTransitionResult> {
  if (!dbEnabled() || !voiceDebitIdentity(ref) || !uuidJurnal(handoffToken)) return 'unavailable'
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await limiteazaTranzactieFacturareVocala(client)
    const acknowledged = await client.query(
      `UPDATE voice_billing_operations
          SET state='acknowledged', acknowledged_at=clock_timestamp(), updated_at=clock_timestamp()
        WHERE debit_ref=$1 AND state='handed_off' AND handoff_token=$2::uuid
          AND ack_deadline >= clock_timestamp()
      RETURNING debit_ref`,
      [ref, handoffToken],
    )
    if ((acknowledged.rowCount ?? 0) === 1) {
      await client.query('COMMIT')
      return 'ok'
    }
    const operation = await client.query<{ state: string; handoff_token: string | null; before_deadline: boolean }>(
      `SELECT state, handoff_token::text AS handoff_token,
              coalesce(clock_timestamp() <= ack_deadline, false) AS before_deadline
         FROM voice_billing_operations WHERE debit_ref=$1 FOR UPDATE`,
      [ref],
    )
    const row = operation.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return 'not_found'
    }
    if (row.state === 'acknowledged') {
      await client.query(row.handoff_token === handoffToken ? 'COMMIT' : 'ROLLBACK')
      return row.handoff_token === handoffToken ? 'duplicate' : 'conflict'
    }
    if (row.state !== 'handed_off' || row.handoff_token !== handoffToken) {
      await client.query('ROLLBACK')
      return 'conflict'
    }
    if (!row.before_deadline) {
      await client.query('ROLLBACK')
      return 'expired'
    }
    await client.query('ROLLBACK')
    return 'unavailable'
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] confirmaDebitVocalLive failed: ${String(error).slice(0, 160)}`)
    return 'unavailable'
  } finally {
    client?.release()
  }
}

/** Durable handoff immediately before the first provider-bound input. */
export async function consumaDebitVocalLive(
  ref: string,
  handoffToken: string,
  ackDeadlineEpochMs: number,
): Promise<VoiceDebitTransitionResult> {
  if (
    !dbEnabled()
    || !voiceDebitIdentity(ref)
    || !uuidJurnal(handoffToken)
    || !Number.isSafeInteger(ackDeadlineEpochMs)
    || ackDeadlineEpochMs <= 0
  ) return 'unavailable'
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await limiteazaTranzactieFacturareVocala(client)
    const operation = await client.query<{
      state: string
      handoff_token: string | null
      before_deadline: boolean
      ack_before_deadline: boolean
    }>(
      `SELECT state, handoff_token::text AS handoff_token,
              clock_timestamp() <= consume_deadline AS before_deadline,
              coalesce(clock_timestamp() <= ack_deadline, false) AS ack_before_deadline
         FROM voice_billing_operations WHERE debit_ref=$1 FOR UPDATE`,
      [ref],
    )
    const row = operation.rows[0]
    const state = row?.state
    if (!state) {
      await client.query('ROLLBACK')
      return 'not_found'
    }
    if (state === 'handed_off' || state === 'acknowledged') {
      const sameToken = row.handoff_token === handoffToken
      const validReplay = state === 'acknowledged' || row.ack_before_deadline
      await client.query(sameToken && validReplay ? 'COMMIT' : 'ROLLBACK')
      return sameToken ? (validReplay ? 'duplicate' : 'expired') : 'conflict'
    }
    if (state !== 'pending') {
      await client.query('ROLLBACK')
      return 'conflict'
    }
    const ackDeadline = new Date(ackDeadlineEpochMs).toISOString()
    const ackDeadlineValid = await client.query<{ valid: boolean }>(
      'SELECT clock_timestamp() < $1::timestamptz AS valid',
      [ackDeadline],
    )
    if (!row.before_deadline || !ackDeadlineValid.rows[0]?.valid) {
      await client.query('ROLLBACK')
      return 'expired'
    }
    await client.query(
      `UPDATE voice_billing_operations
          SET state='handed_off', handoff_token=$2::uuid, handed_off_at=now(),
              ack_deadline=$3::timestamptz, updated_at=now()
        WHERE debit_ref=$1`,
      [ref, handoffToken, ackDeadline],
    )
    await client.query('COMMIT')
    return 'ok'
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] consumaDebitVocalLive failed: ${String(error).slice(0, 160)}`)
    return 'unavailable'
  } finally {
    client?.release()
  }
}

export type VoiceDebitRefundResult = 'refunded' | 'duplicate' | 'acknowledged' | 'not_found' | 'unavailable'

/** Refund intent is committed first. The money transaction then derives every
 * value from the locked original debit and deliberately leaves topup_ref_minor
 * unchanged. Any failure remains `refund_pending` for the restart reconciler. */
export async function ramburseazaDebitVocalLive(ref: string): Promise<VoiceDebitRefundResult> {
  if (!dbEnabled() || !voiceDebitIdentity(ref)) return 'unavailable'
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await limiteazaTranzactieFacturareVocala(client)
    const operation = await client.query<{ state: string }>(
      `SELECT state FROM voice_billing_operations WHERE debit_ref=$1 FOR UPDATE`,
      [ref],
    )
    const state = operation.rows[0]?.state
    if (!state) {
      await client.query('ROLLBACK')
      return 'not_found'
    }
    if (state === 'refunded') {
      await client.query('COMMIT')
      return 'duplicate'
    }
    if (state === 'acknowledged') {
      await client.query('ROLLBACK')
      return 'acknowledged'
    }
    if (state !== 'refund_pending') {
      await client.query(
        `UPDATE voice_billing_operations
            SET state='refund_pending', updated_at=now()
          WHERE debit_ref=$1`,
        [ref],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] voice refund intent failed: ${String(error).slice(0, 160)}`)
    return 'unavailable'
  } finally {
    client?.release()
  }

  client = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await limiteazaTranzactieFacturareVocala(client)
    const operation = await client.query<{ state: string; refund_event_id: string | null }>(
      `SELECT state, refund_event_id::text AS refund_event_id
         FROM voice_billing_operations WHERE debit_ref=$1 FOR UPDATE`,
      [ref],
    )
    const state = operation.rows[0]?.state
    if (state === 'refunded') {
      await client.query('COMMIT')
      return 'duplicate'
    }
    if (state !== 'refund_pending') {
      await client.query('ROLLBACK')
      return state === 'acknowledged' ? 'acknowledged' : 'unavailable'
    }
    const debit = await client.query<{
      user_email: string
      amount_minor: string
      currency: string
      policy_version: string
      legal_basis: string | null
      retention_until: Date | null
      erasure_request_id: string | null
    }>(
      `SELECT event.user_email, event.amount_minor::text AS amount_minor,
              event.currency, event.policy_version, event.legal_basis,
              event.retention_until, event.erasure_request_id::text AS erasure_request_id
         FROM voice_billing_operations AS operation
         JOIN billing_events AS event ON event.id=operation.debit_event_id
        WHERE operation.debit_ref=$1
        FOR UPDATE OF event`,
      [ref],
    )
    const row = debit.rows[0]
    const amountMinor = -Number(row?.amount_minor)
    if (!row || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('voice_debit_ledger_invalid')
    const wallet = await client.query(
      `UPDATE wallets
          SET balance_minor=balance_minor+$2, updated_at=now()
        WHERE user_email=$1 AND currency=$3
      RETURNING user_email`,
      [row.user_email, amountMinor, row.currency],
    )
    if ((wallet.rowCount ?? 0) !== 1) throw new Error('voice_refund_wallet_mismatch')
    const refund = await client.query<{ id: string }>(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta,
          legal_basis, retention_until, erasure_request_id)
       VALUES ($1, 'grant', $2, $3, $4, $5, 'voice timeout compensation', $6, $7, $8::uuid)
       RETURNING id::text AS id`,
      [row.user_email, amountMinor, row.currency, row.policy_version, voiceRefundRef(ref), row.legal_basis, row.retention_until, row.erasure_request_id],
    )
    await client.query(
      `UPDATE voice_billing_operations
          SET state='refunded', refund_event_id=$2::bigint,
              refunded_at=now(), updated_at=now()
        WHERE debit_ref=$1`,
      [ref, refund.rows[0]?.id],
    )
    await client.query('COMMIT')
    return 'refunded'
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[money] ramburseazaDebitVocalLive failed: ${String(error).slice(0, 160)}`)
    return 'unavailable'
  } finally {
    client?.release()
  }
}

export interface VoiceDebitReconciliationResult {
  claimed: number
  refunded: number
  pending: number
}

export async function reconciliazaDebitariVocale(options: {
  ref?: string
  staleBefore?: Date
  limit?: number
} = {}): Promise<VoiceDebitReconciliationResult> {
  const specificRef = options.ref?.trim() ?? ''
  const limit = options.limit ?? 50
  const staleBefore = options.staleBefore ?? new Date(Date.now() - 60_000)
  if (
    !dbEnabled()
    || (specificRef !== '' && !voiceDebitIdentity(specificRef))
    || !Number.isSafeInteger(limit)
    || limit <= 0
    || limit > 200
    || !Number.isFinite(staleBefore.getTime())
  ) return { claimed: 0, refunded: 0, pending: 0 }
  try {
    let selectionClient: pg.PoolClient | null = null
    let selectedRows: Array<{ debit_ref: string }> = []
    try {
      selectionClient = await conexiuneDb()
      await selectionClient.query('BEGIN')
      await limiteazaTranzactieFacturareVocala(selectionClient)
      const rows = await selectionClient.query<{ debit_ref: string }>(
        `SELECT debit_ref
           FROM voice_billing_operations
          WHERE state IN ('pending', 'handed_off', 'refund_pending')
            AND (
              state='refund_pending'
              OR (state='pending' AND consume_deadline <= clock_timestamp())
              OR (state='handed_off' AND ack_deadline <= clock_timestamp())
              OR ($1::timestamptz IS NOT NULL AND updated_at <= $1)
            )
            AND ($2='' OR debit_ref=$2)
          ORDER BY updated_at, debit_ref
          LIMIT $3`,
        [specificRef ? new Date(Date.now() + 60_000).toISOString() : staleBefore.toISOString(), specificRef, limit],
      )
      selectedRows = rows.rows
      await selectionClient.query('COMMIT')
    } catch (error) {
      await selectionClient?.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      selectionClient?.release()
    }
    let refunded = 0
    for (const row of selectedRows) {
      const result = await ramburseazaDebitVocalLive(row.debit_ref)
      if (result === 'refunded' || result === 'duplicate') refunded++
    }
    return { claimed: selectedRows.length, refunded, pending: selectedRows.length - refunded }
  } catch (error) {
    console.error(`[money] reconciliazaDebitariVocale failed: ${String(error).slice(0, 160)}`)
    return { claimed: 0, refunded: 0, pending: 1 }
  }
}

/** Atomic, idempotent product charge in integer minor units. */
export async function debitWalletMinorAtomar(
  email: string,
  amountMinor: number,
  eventKey: string,
  meta = '',
): Promise<DebitWalletResult> {
  if (esteAdminKelion(email)) return { ok: true, debitedMinor: 0, duplicate: false }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !eventKey || eventKey.length > 160) {
    return { ok: false, code: 'invalid', motiv: 'sumă sau idempotency key invalidă' }
  }
  if (!dbEnabled()) return { ok: false, code: 'unavailable', motiv: 'baza de date nu e configurată' }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO wallets (user_email, balance_minor, currency)
       VALUES ($1, 0, $2) ON CONFLICT (user_email) DO NOTHING`,
      [walletKey(email), config.billing.currency],
    )
    const r = await client.query<{ balance_minor: string; debt_minor: string; frozen_reason: string | null }>(
      `SELECT balance_minor, debt_minor, frozen_reason FROM wallets WHERE user_email = $1 FOR UPDATE`,
      [walletKey(email)],
    )
    if (await billingRefSeen(client, eventKey)) {
      await client.query('COMMIT')
      return { ok: true, debitedMinor: 0, duplicate: true }
    }
    const soldMinor = Number(r.rows[0]?.balance_minor ?? 0)
    const debtMinor = Number(r.rows[0]?.debt_minor ?? 0)
    if (
      !Number.isSafeInteger(soldMinor) || !Number.isSafeInteger(debtMinor) || debtMinor > 0 ||
      Boolean(r.rows[0]?.frozen_reason) ||
      soldMinor < amountMinor
    ) {
      await client.query('ROLLBACK')
      return { ok: false, code: 'insufficient', motiv: 'sold insuficient' }
    }
    await client.query(
      `UPDATE wallets SET balance_minor = balance_minor - $2, updated_at = now() WHERE user_email = $1`,
      [walletKey(email), amountMinor],
    )
    await client.query(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'usage', $2, $3, $4, $5, $6)`,
      [walletKey(email), -amountMinor, config.billing.currency, config.billing.policyVersion, eventKey, meta.slice(0, 200)],
    )
    await client.query('COMMIT')
    return { ok: true, debitedMinor: amountMinor, duplicate: false }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`[money] debitWalletMinorAtomar failed: ${String(e).slice(0, 200)}`)
    return { ok: false, code: 'unavailable', motiv: 'debitarea nu a putut fi verificată' }
  } finally {
    client.release()
  }
}

// The payment idempotency guard: an already-recorded reference is NOT credited
// a second time. Called inside an open transaction (the caller ROLLBACKs if
// true). A single source here (the permanent principle: single, no duplicates).
async function billingRefSeen(client: pg.PoolClient, ref: string): Promise<boolean> {
  const seen = await client.query('SELECT 1 FROM billing_events WHERE ref = $1', [ref])
  return (seen.rowCount ?? 0) > 0
}

async function aplicaTopUpInTransaction(
  client: pg.PoolClient,
  email: string,
  grossMinor: number,
  moneda: string,
  ref: string,
): Promise<boolean> {
  const split = splitTopupMinor(grossMinor)
  if (
    !email || !split || !ref || ref.length > 160 ||
    moneda !== config.billing.currency ||
    grossMinor % config.billing.topupStepMinor !== 0 ||
    await billingRefSeen(client, ref)
  ) return false
  const { userCreditMinor, marginMinor } = split
  await client.query(
    `INSERT INTO billing_events
       (user_email, kind, amount_minor, currency, policy_version, ref, meta)
     VALUES (lower($1), 'topup', $2, $3, $4, $5, $6)`,
    [email, userCreditMinor, moneda, config.billing.policyVersion, ref, JSON.stringify({ shareBasisPoints: config.billing.userShareBps })],
  )
  const wallet = await client.query(
    `INSERT INTO wallets (user_email, balance_minor, currency, topup_ref_minor, debt_minor, frozen_reason)
     VALUES (lower($1), $2, $3, $2, 0, NULL)
     ON CONFLICT (user_email) DO UPDATE
       SET balance_minor = wallets.balance_minor + greatest($2 - wallets.debt_minor, 0),
           topup_ref_minor = wallets.balance_minor + greatest($2 - wallets.debt_minor, 0),
           debt_minor = greatest(wallets.debt_minor - $2, 0),
           frozen_reason = CASE
             WHEN wallets.frozen_reason = 'merchant_dispute' THEN wallets.frozen_reason
             WHEN wallets.debt_minor > $2 THEN wallets.frozen_reason
             ELSE NULL
           END,
           updated_at = now()
       WHERE wallets.currency = EXCLUDED.currency
     RETURNING user_email`,
    [email, userCreditMinor, moneda],
  )
  if ((wallet.rowCount ?? 0) !== 1) throw new Error('wallet_currency_mismatch')
  await client.query(
    `INSERT INTO billing_events
       (user_email, kind, amount_minor, currency, policy_version, ref, meta)
     VALUES (lower($1), 'margin', $2, $3, $4, $5, $6)`,
    [email, marginMinor, moneda, config.billing.policyVersion, `${ref}:margin`, JSON.stringify({ shareBasisPoints: config.billing.marginShareBps })],
  )
  await client.query(
    `INSERT INTO transactions
       (user_id, gross_minor, user_credit_minor, credits, currency, policy_version, status, payment_ref)
     VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7)`,
    [email.toLowerCase(), grossMinor, userCreditMinor, Math.floor(userCreditMinor / config.billing.creditMinor), moneda, config.billing.policyVersion, ref],
  )
  return true
}

export interface MerchantCheckoutSnapshot {
  id: string
  grossMinor: number
  userCreditMinor: number
  marginMinor: number
  refundedGrossMinor: number
  refundedUserCreditMinor: number
  refundedMarginMinor: number
  currency: string
  status: 'creating' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'indeterminate'
  providerOrderId: string | null
  checkoutUrl: string | null
}

export type MerchantCheckoutClaim =
  | { kind: 'claimed'; checkout: MerchantCheckoutSnapshot }
  | { kind: 'replay'; checkout: MerchantCheckoutSnapshot }
  | { kind: 'recover'; checkout: MerchantCheckoutSnapshot }
  | { kind: 'rejected'; code: 'first_topup_minimum' | 'wallet_currency_mismatch' }
  | { kind: 'conflict' }
  | { kind: 'terminal' }
  | { kind: 'unavailable' }

interface MerchantCheckoutRow {
  id: string
  gross_minor: string
  user_credit_minor: string
  margin_minor: string
  currency: string
  policy_version: string
  status: MerchantCheckoutSnapshot['status']
  provider_order_id: string | null
  checkout_url: string | null
  refunded_gross_minor?: string
  refunded_user_credit_minor?: string
  refunded_margin_minor?: string
}

function merchantCheckoutSnapshot(row: MerchantCheckoutRow): MerchantCheckoutSnapshot | null {
  const grossMinor = Number(row.gross_minor)
  const userCreditMinor = Number(row.user_credit_minor)
  const marginMinor = Number(row.margin_minor)
  const refundedGrossMinor = Number(row.refunded_gross_minor ?? 0)
  const refundedUserCreditMinor = Number(row.refunded_user_credit_minor ?? 0)
  const refundedMarginMinor = Number(row.refunded_margin_minor ?? 0)
  if (
    !uuidJurnal(row.id) ||
    !Number.isSafeInteger(grossMinor) || grossMinor <= 0 ||
    !Number.isSafeInteger(userCreditMinor) || userCreditMinor < 0 ||
    !Number.isSafeInteger(marginMinor) || marginMinor < 0 ||
    userCreditMinor + marginMinor !== grossMinor ||
    !Number.isSafeInteger(refundedGrossMinor) || refundedGrossMinor < 0 ||
    !Number.isSafeInteger(refundedUserCreditMinor) || refundedUserCreditMinor < 0 ||
    !Number.isSafeInteger(refundedMarginMinor) || refundedMarginMinor < 0 ||
    refundedUserCreditMinor + refundedMarginMinor !== refundedGrossMinor ||
    refundedGrossMinor > grossMinor ||
    !['creating', 'pending', 'paid', 'failed', 'cancelled', 'indeterminate'].includes(row.status)
  ) return null
  return {
    id: row.id,
    grossMinor,
    userCreditMinor,
    marginMinor,
    refundedGrossMinor,
    refundedUserCreditMinor,
    refundedMarginMinor,
    currency: row.currency,
    status: row.status,
    providerOrderId: row.provider_order_id,
    checkoutUrl: row.checkout_url,
  }
}

const MERCHANT_CHECKOUT_COLUMNS = `
  id, gross_minor::text, user_credit_minor::text, margin_minor::text,
  refunded_gross_minor::text, refunded_user_credit_minor::text,
  refunded_margin_minor::text, currency, policy_version, status,
  provider_order_id::text, checkout_url`

/** Creates exactly one local purchase intent for a browser idempotency key.
 * Only the request that inserted the row may create a provider order. Every
 * concurrent/repeated request either replays a stored URL or performs
 * read-only provider reconciliation. */
export async function claimMerchantCheckout(
  email: string,
  idempotencyKey: string,
  grossMinor: number,
): Promise<MerchantCheckoutClaim> {
  const userEmail = walletKey(email)
  const key = uuidJurnal(idempotencyKey)
  const split = splitTopupMinor(grossMinor)
  if (
    !dbEnabled() || !userEmail || !key || !split ||
    grossMinor % config.billing.topupStepMinor !== 0 ||
    grossMinor < config.billing.topupMinMinor || grossMinor > config.billing.topupMaxMinor
  ) return { kind: 'unavailable' }
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO wallets (user_email, balance_minor, currency, topup_ref_minor)
       VALUES ($1, 0, $2, 0)
       ON CONFLICT (user_email) DO NOTHING`,
      [userEmail, config.billing.currency],
    )
    const wallet = await client.query<{ topup_ref_minor: string; currency: string }>(
      `SELECT topup_ref_minor::text, currency
         FROM wallets
        WHERE user_email = $1
        FOR UPDATE`,
      [userEmail],
    )
    const topupRefMinor = Number(wallet.rows[0]?.topup_ref_minor)
    if (!Number.isSafeInteger(topupRefMinor) || topupRefMinor < 0) {
      await client.query('ROLLBACK')
      return { kind: 'unavailable' }
    }
    if (wallet.rows[0]?.currency !== config.billing.currency) {
      await client.query('ROLLBACK')
      return { kind: 'rejected', code: 'wallet_currency_mismatch' }
    }
    if (topupRefMinor === 0 && grossMinor < config.billing.firstTopupMinMinor) {
      await client.query('ROLLBACK')
      return { kind: 'rejected', code: 'first_topup_minimum' }
    }

    const inserted = await client.query<MerchantCheckoutRow>(
      `INSERT INTO merchant_checkout_orders
         (id, user_email, idempotency_key, gross_minor, user_credit_minor,
          margin_minor, currency, policy_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_email, idempotency_key) DO NOTHING
       RETURNING ${MERCHANT_CHECKOUT_COLUMNS}`,
      [
        randomUUID(), userEmail, key, split.grossMinor, split.userCreditMinor,
        split.marginMinor, config.billing.currency, config.billing.policyVersion,
      ],
    )
    const fresh = inserted.rows[0] ? merchantCheckoutSnapshot(inserted.rows[0]) : null
    if (fresh) {
      await client.query('COMMIT')
      return { kind: 'claimed', checkout: fresh }
    }

    const existingResult = await client.query<MerchantCheckoutRow>(
      `SELECT ${MERCHANT_CHECKOUT_COLUMNS}
         FROM merchant_checkout_orders
        WHERE user_email = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [userEmail, key],
    )
    const existingRow = existingResult.rows[0]
    const existing = existingRow ? merchantCheckoutSnapshot(existingRow) : null
    let claim: MerchantCheckoutClaim
    if (!existing || existingRow.policy_version !== config.billing.policyVersion) claim = { kind: 'unavailable' }
    else if (
      existing.grossMinor !== split.grossMinor ||
      existing.userCreditMinor !== split.userCreditMinor ||
      existing.marginMinor !== split.marginMinor ||
      existing.currency !== config.billing.currency
    ) claim = { kind: 'conflict' }
    else if (existing.providerOrderId && existing.checkoutUrl) claim = { kind: 'replay', checkout: existing }
    else if (existing.status === 'failed' || existing.status === 'cancelled') claim = { kind: 'terminal' }
    else claim = { kind: 'recover', checkout: existing }
    await client.query('COMMIT')
    return claim
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    console.error(`[billing] checkout claim failed: ${String(error).slice(0, 160)}`)
    return { kind: 'unavailable' }
  } finally {
    client?.release()
  }
}

export async function attachMerchantOrder(
  checkoutId: string,
  providerOrderId: string,
  checkoutUrl: string,
  providerState: string,
  grossMinor: number,
  currency: string,
  lastEvent = 'ORDER_CREATED',
): Promise<MerchantCheckoutSnapshot | null> {
  const id = uuidJurnal(checkoutId)
  const orderId = uuidJurnal(providerOrderId)
  const url = String(checkoutUrl ?? '').trim()
  const state = String(providerState ?? '').trim().toLowerCase().slice(0, 32)
  const moneda = String(currency ?? '').trim().toUpperCase()
  const event = String(lastEvent ?? '').trim().toUpperCase().slice(0, 64)
  if (
    !dbEnabled() || !id || !orderId || !url || url.length > 2_048 || !state || !event ||
    !Number.isSafeInteger(grossMinor) || grossMinor <= 0 || moneda !== config.billing.currency
  ) return null
  try {
    const result = await getPool().query<MerchantCheckoutRow>(
      `UPDATE merchant_checkout_orders
          SET provider_order_id = $2,
              checkout_url = $3,
              provider_state = $4,
              last_event = $5,
              status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'pending' END,
              failure_code = NULL,
              updated_at = now()
        WHERE id = $1
          AND (provider_order_id IS NULL OR provider_order_id = $2)
          AND status IN ('creating', 'pending', 'indeterminate', 'paid')
          AND gross_minor = $6
          AND currency = $7
        RETURNING ${MERCHANT_CHECKOUT_COLUMNS}`,
      [id, orderId, url, state, event, grossMinor, moneda],
    )
    return result.rows[0] ? merchantCheckoutSnapshot(result.rows[0]) : null
  } catch (error) {
    console.error(`[billing] checkout provider attach failed: ${String(error).slice(0, 160)}`)
    return null
  }
}

export async function markMerchantCheckoutCreationFailure(
  checkoutId: string,
  kind: 'failed' | 'indeterminate',
  code: string,
): Promise<boolean> {
  const id = uuidJurnal(checkoutId)
  const failureCode = String(code ?? '').trim().replace(/[^a-z0-9_:-]/gi, '_').slice(0, 96)
  if (!dbEnabled() || !id || !failureCode) return false
  try {
    const result = await getPool().query(
      `UPDATE merchant_checkout_orders
          SET status = $2, failure_code = $3, updated_at = now()
        WHERE id = $1 AND provider_order_id IS NULL AND status IN ('creating', 'indeterminate')`,
      [id, kind, failureCode],
    )
    return (result.rowCount ?? 0) === 1
  } catch {
    return false
  }
}

export type MerchantObservationResult = 'recorded' | 'not_found' | 'mismatch' | 'unavailable'

/** Records the current provider truth without allowing an old failure event to
 * downgrade an already-paid order. */
export async function recordMerchantOrderObservation(
  providerOrderId: string,
  checkoutId: string,
  providerState: string,
  event: string,
): Promise<MerchantObservationResult> {
  const orderId = uuidJurnal(providerOrderId)
  const id = uuidJurnal(checkoutId)
  const state = String(providerState ?? '').trim().toLowerCase().slice(0, 32)
  const eventName = String(event ?? '').trim().toUpperCase().slice(0, 64)
  if (!dbEnabled() || !orderId || !id || !state || !eventName) return 'mismatch'
  try {
    const result = await getPool().query(
      `UPDATE merchant_checkout_orders
          SET provider_state = $3,
              last_event = $4,
              status = CASE
                WHEN status = 'paid' THEN 'paid'
                WHEN $3 = 'cancelled' THEN 'cancelled'
                WHEN $3 = 'failed' THEN 'failed'
                ELSE status
              END,
              failure_code = CASE
                WHEN status = 'paid' THEN failure_code
                WHEN $3 IN ('cancelled', 'failed') THEN $4
                ELSE failure_code
              END,
              updated_at = now()
        WHERE provider_order_id = $1 AND id = $2`,
      [orderId, id, state, eventName],
    )
    if ((result.rowCount ?? 0) === 1) return 'recorded'
    const known = await getPool().query('SELECT 1 FROM merchant_checkout_orders WHERE provider_order_id = $1', [orderId])
    return (known.rowCount ?? 0) > 0 ? 'mismatch' : 'not_found'
  } catch {
    return 'unavailable'
  }
}

export type MerchantSettlementResult =
  | { kind: 'paid' | 'duplicate'; userCreditMinor: number; marginMinor: number }
  | { kind: 'not_found' | 'mismatch' | 'unavailable' }

/** The only Revolut settlement path. It locks the local order, verifies the
 * immutable receipt snapshot, credits 75%, records 25% margin, and marks the
 * provider order paid in one database transaction. */
export async function settleMerchantCheckout(
  providerOrderId: string,
  checkoutId: string,
  grossMinor: number,
  currency: string,
  event: string,
): Promise<MerchantSettlementResult> {
  const orderId = uuidJurnal(providerOrderId)
  const id = uuidJurnal(checkoutId)
  const moneda = String(currency ?? '').trim().toUpperCase()
  const eventName = String(event ?? '').trim().toUpperCase().slice(0, 64)
  if (!dbEnabled() || !orderId || !id || !Number.isSafeInteger(grossMinor) || grossMinor <= 0 || !eventName) {
    return { kind: 'mismatch' }
  }
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    const result = await client.query<MerchantCheckoutRow & { user_email: string }>(
      `SELECT ${MERCHANT_CHECKOUT_COLUMNS}, user_email
         FROM merchant_checkout_orders
        WHERE provider_order_id = $1
        FOR UPDATE`,
      [orderId],
    )
    const row = result.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { kind: 'not_found' }
    }
    const snapshot = merchantCheckoutSnapshot(row)
    const split = splitTopupMinor(grossMinor)
    if (
      !snapshot || row.id !== id || row.policy_version !== config.billing.policyVersion ||
      moneda !== config.billing.currency || snapshot.currency !== moneda ||
      snapshot.grossMinor !== grossMinor || !split ||
      snapshot.userCreditMinor !== split.userCreditMinor || snapshot.marginMinor !== split.marginMinor
    ) {
      await client.query('ROLLBACK')
      return { kind: 'mismatch' }
    }
    if (snapshot.status === 'paid') {
      await client.query('ROLLBACK')
      return { kind: 'duplicate', userCreditMinor: split.userCreditMinor, marginMinor: split.marginMinor }
    }
    const ref = `revolut:${orderId}`
    if (!await aplicaTopUpInTransaction(client, row.user_email, grossMinor, moneda, ref)) {
      await client.query('ROLLBACK')
      return { kind: 'mismatch' }
    }
    const closed = await client.query(
      `UPDATE merchant_checkout_orders
          SET status = 'paid', provider_state = 'completed', last_event = $2,
              failure_code = NULL, paid_at = now(), updated_at = now()
        WHERE id = $1 AND status <> 'paid'`,
      [id, eventName],
    )
    if ((closed.rowCount ?? 0) !== 1) throw new Error('merchant_checkout_close_failed')
    await client.query('COMMIT')
    return { kind: 'paid', userCreditMinor: split.userCreditMinor, marginMinor: split.marginMinor }
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    console.error(`[billing] merchant settlement failed: ${String(error).slice(0, 160)}`)
    return { kind: 'unavailable' }
  } finally {
    client?.release()
  }
}

export type MerchantRefundSettlementResult =
  | {
      kind: 'applied' | 'duplicate'
      userCreditMinor: number
      marginMinor: number
      debtCreatedMinor: number
    }
  | { kind: 'not_found' | 'not_ready' | 'mismatch' | 'unavailable' }

interface MerchantRefundRow {
  original_provider_order_id: string
  checkout_id: string
  gross_minor: string
  user_credit_minor: string
  margin_minor: string
  currency: string
  policy_version: string
  debt_created_minor: string
}

/** Applies a completed Revolut refund once. The original payment row is the
 * serialization lock for all partial refunds. Available product credit never
 * becomes negative: already-consumed credit becomes an explicit frozen debt
 * which future top-ups repay before they become spendable. */
export async function settleMerchantRefund(
  providerRefundOrderId: string,
  originalProviderOrderId: string,
  grossMinor: number,
  currency: string,
  event: string,
): Promise<MerchantRefundSettlementResult> {
  const refundOrderId = uuidJurnal(providerRefundOrderId)
  const originalOrderId = uuidJurnal(originalProviderOrderId)
  const moneda = String(currency ?? '').trim().toUpperCase()
  const eventName = String(event ?? '').trim().toUpperCase().slice(0, 64)
  const split = splitTopupMinor(grossMinor)
  if (
    !dbEnabled() || !refundOrderId || !originalOrderId || !split || !eventName ||
    moneda !== config.billing.currency
  ) return { kind: 'mismatch' }

  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    const originalResult = await client.query<MerchantCheckoutRow & { user_email: string }>(
      `SELECT ${MERCHANT_CHECKOUT_COLUMNS}, user_email
         FROM merchant_checkout_orders
        WHERE provider_order_id = $1
        FOR UPDATE`,
      [originalOrderId],
    )
    const originalRow = originalResult.rows[0]
    if (!originalRow) {
      await client.query('ROLLBACK')
      return { kind: 'not_found' }
    }
    const original = merchantCheckoutSnapshot(originalRow)
    if (!original || original.status !== 'paid') {
      await client.query('ROLLBACK')
      return original ? { kind: 'not_ready' } : { kind: 'mismatch' }
    }
    if (original.currency !== moneda) {
      await client.query('ROLLBACK')
      return { kind: 'mismatch' }
    }

    const existingResult = await client.query<MerchantRefundRow>(
      `SELECT original_provider_order_id::text, checkout_id::text,
              gross_minor::text, user_credit_minor::text, margin_minor::text,
              currency, policy_version, debt_created_minor::text
         FROM merchant_refund_events
        WHERE provider_refund_order_id = $1`,
      [refundOrderId],
    )
    const existing = existingResult.rows[0]
    if (existing) {
      const same =
        existing.original_provider_order_id === originalOrderId &&
        existing.checkout_id === original.id &&
        Number(existing.gross_minor) === split.grossMinor &&
        Number(existing.user_credit_minor) === split.userCreditMinor &&
        Number(existing.margin_minor) === split.marginMinor &&
        existing.currency === moneda &&
        existing.policy_version === originalRow.policy_version
      await client.query('ROLLBACK')
      return same
        ? {
            kind: 'duplicate',
            userCreditMinor: split.userCreditMinor,
            marginMinor: split.marginMinor,
            debtCreatedMinor: Number(existing.debt_created_minor),
          }
        : { kind: 'mismatch' }
    }

    if (
      original.refundedGrossMinor + split.grossMinor > original.grossMinor ||
      original.refundedUserCreditMinor + split.userCreditMinor > original.userCreditMinor ||
      original.refundedMarginMinor + split.marginMinor > original.marginMinor
    ) {
      await client.query('ROLLBACK')
      return { kind: 'mismatch' }
    }

    const walletResult = await client.query<{
      balance_minor: string
      debt_minor: string
      currency: string
    }>(
      `SELECT balance_minor::text, debt_minor::text, currency
         FROM wallets
        WHERE user_email = $1
        FOR UPDATE`,
      [originalRow.user_email],
    )
    const wallet = walletResult.rows[0]
    const balanceMinor = Number(wallet?.balance_minor)
    const debtMinor = Number(wallet?.debt_minor)
    if (
      !wallet || wallet.currency !== moneda ||
      !Number.isSafeInteger(balanceMinor) || balanceMinor < 0 ||
      !Number.isSafeInteger(debtMinor) || debtMinor < 0
    ) {
      await client.query('ROLLBACK')
      return { kind: 'mismatch' }
    }
    const removedFromBalance = Math.min(balanceMinor, split.userCreditMinor)
    const debtCreatedMinor = split.userCreditMinor - removedFromBalance
    const newBalanceMinor = balanceMinor - removedFromBalance
    const newDebtMinor = debtMinor + debtCreatedMinor

    const walletUpdate = await client.query(
      `UPDATE wallets
          SET balance_minor = $2,
              topup_ref_minor = least(topup_ref_minor, $2),
              debt_minor = $3,
              frozen_reason = CASE
                WHEN frozen_reason = 'merchant_dispute' THEN frozen_reason
                WHEN $3 > 0 THEN 'merchant_refund'
                ELSE NULL
              END,
              updated_at = now()
        WHERE user_email = $1 AND currency = $4`,
      [originalRow.user_email, newBalanceMinor, newDebtMinor, moneda],
    )
    if ((walletUpdate.rowCount ?? 0) !== 1) throw new Error('refund_wallet_update_failed')

    const refundRef = `revolut-refund:${refundOrderId}`
    await client.query(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6)`,
      [
        originalRow.user_email,
        -split.userCreditMinor,
        moneda,
        originalRow.policy_version,
        refundRef,
        JSON.stringify({ originalProviderOrderId: originalOrderId }),
      ],
    )
    await client.query(
      `INSERT INTO billing_events
         (user_email, kind, amount_minor, currency, policy_version, ref, meta)
       VALUES ($1, 'margin_refund', $2, $3, $4, $5, $6)`,
      [
        originalRow.user_email,
        -split.marginMinor,
        moneda,
        originalRow.policy_version,
        `${refundRef}:margin`,
        JSON.stringify({ originalProviderOrderId: originalOrderId }),
      ],
    )
    await client.query(
      `INSERT INTO transactions
         (user_id, gross_minor, user_credit_minor, credits, currency, policy_version, status, payment_ref)
       VALUES ($1, $2, $3, $4, $5, $6, 'refunded', $7)`,
      [
        originalRow.user_email,
        split.grossMinor,
        split.userCreditMinor,
        Math.floor(split.userCreditMinor / config.billing.creditMinor),
        moneda,
        originalRow.policy_version,
        refundRef,
      ],
    )
    await client.query(
      `INSERT INTO merchant_refund_events
         (provider_refund_order_id, original_provider_order_id, checkout_id,
          gross_minor, user_credit_minor, margin_minor, currency, policy_version,
          provider_state, last_event, debt_created_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10)`,
      [
        refundOrderId,
        originalOrderId,
        original.id,
        split.grossMinor,
        split.userCreditMinor,
        split.marginMinor,
        moneda,
        originalRow.policy_version,
        eventName,
        debtCreatedMinor,
      ],
    )
    const totals = await client.query(
      `UPDATE merchant_checkout_orders
          SET refunded_gross_minor = refunded_gross_minor + $2,
              refunded_user_credit_minor = refunded_user_credit_minor + $3,
              refunded_margin_minor = refunded_margin_minor + $4,
              last_event = $5,
              updated_at = now()
        WHERE id = $1
          AND refunded_gross_minor + $2 <= gross_minor`,
      [original.id, split.grossMinor, split.userCreditMinor, split.marginMinor, eventName],
    )
    if ((totals.rowCount ?? 0) !== 1) throw new Error('refund_total_update_failed')
    await client.query('COMMIT')
    return {
      kind: 'applied',
      userCreditMinor: split.userCreditMinor,
      marginMinor: split.marginMinor,
      debtCreatedMinor,
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    console.error(`[billing] merchant refund settlement failed: ${String(error).slice(0, 160)}`)
    return { kind: 'unavailable' }
  } finally {
    client?.release()
  }
}

export type MerchantReconciliationResult = 'recorded' | 'unavailable' | 'invalid'

/** Persists an event which cannot safely mutate the product ledger without a
 * separate reconciliation decision. The raw webhook body is deliberately not
 * retained. */
export async function recordMerchantReconciliationEvent(input: {
  providerObjectId: string
  event: string
  objectKind: 'refund'
  relatedProviderOrderId?: string | null
  amountMinor?: number | null
  currency?: string | null
  providerState?: string | null
  resolution?: 'pending' | 'manual_review'
}): Promise<MerchantReconciliationResult> {
  const providerObjectId = uuidJurnal(input.providerObjectId)
  const relatedProviderOrderId = input.relatedProviderOrderId
    ? uuidJurnal(input.relatedProviderOrderId)
    : null
  const event = String(input.event ?? '').trim().toUpperCase()
  const amountMinor = input.amountMinor == null ? null : Number(input.amountMinor)
  const currency = input.currency == null ? null : String(input.currency).trim().toUpperCase()
  const providerState = input.providerState == null
    ? null
    : String(input.providerState).trim().toLowerCase().slice(0, 32)
  if (
    !dbEnabled() || !providerObjectId ||
    (input.relatedProviderOrderId && !relatedProviderOrderId) ||
    !/^[A-Z_]{3,64}$/.test(event) ||
    (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) ||
    (currency !== null && !/^[A-Z]{3}$/.test(currency)) ||
    (providerState !== null && !providerState)
  ) return 'invalid'
  try {
    await getPool().query(
      `INSERT INTO merchant_reconciliation_events
         (provider_object_id, event, object_kind, related_provider_order_id,
          amount_minor, currency, provider_state, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider_object_id, event) DO UPDATE
         SET occurrences = merchant_reconciliation_events.occurrences + 1,
             last_seen_at = now(),
             related_provider_order_id = COALESCE(
               merchant_reconciliation_events.related_provider_order_id,
               EXCLUDED.related_provider_order_id
             ),
             amount_minor = COALESCE(merchant_reconciliation_events.amount_minor, EXCLUDED.amount_minor),
             currency = COALESCE(merchant_reconciliation_events.currency, EXCLUDED.currency),
             provider_state = COALESCE(EXCLUDED.provider_state, merchant_reconciliation_events.provider_state)`,
      [
        providerObjectId,
        event,
        input.objectKind,
        relatedProviderOrderId,
        amountMinor,
        currency,
        providerState,
        input.resolution ?? 'manual_review',
      ],
    )
    return 'recorded'
  } catch {
    return 'unavailable'
  }
}

/** Stores an authoritative dispute observation and freezes the mapped wallet
 * in the same transaction. The freeze only prevents new product debits; a
 * human/reconciler must decide the final chargeback amount before money moves. */
export async function recordVerifiedMerchantDispute(input: {
  providerObjectId: string
  event: string
  relatedProviderOrderId: string
  amountMinor: number
  currency: string
  providerState: string
}): Promise<MerchantReconciliationResult> {
  const providerObjectId = uuidJurnal(input.providerObjectId)
  const relatedProviderOrderId = uuidJurnal(input.relatedProviderOrderId)
  const event = String(input.event ?? '').trim().toUpperCase()
  const amountMinor = Number(input.amountMinor)
  const currency = String(input.currency ?? '').trim().toUpperCase()
  const providerState = String(input.providerState ?? '').trim().toLowerCase()
  if (
    !dbEnabled() || !providerObjectId || !relatedProviderOrderId ||
    !/^DISPUTE_(?:ACTION_REQUIRED|UNDER_REVIEW|WON|LOST)$/.test(event) ||
    !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
    !/^[A-Z]{3}$/.test(currency) || !/^[a-z_]{2,32}$/.test(providerState)
  ) return 'invalid'

  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    const checkout = await client.query<{
      user_email: string
      gross_minor: string
      currency: string
      status: string
    }>(
      `SELECT user_email, gross_minor::text, currency, status
         FROM merchant_checkout_orders
        WHERE provider_order_id = $1
        FOR UPDATE`,
      [relatedProviderOrderId],
    )
    const order = checkout.rows[0]
    const grossMinor = Number(order?.gross_minor)
    const canFreeze = Boolean(
      order && order.status === 'paid' && order.currency === currency &&
      Number.isSafeInteger(grossMinor) && grossMinor > 0 && amountMinor <= grossMinor,
    )

    const recorded = await client.query(
      `INSERT INTO merchant_reconciliation_events
         (provider_object_id, event, object_kind, related_provider_order_id,
          amount_minor, currency, provider_state, resolution)
       VALUES ($1, $2, 'dispute', $3, $4, $5, $6, 'manual_review')
       ON CONFLICT (provider_object_id, event) DO UPDATE
         SET occurrences = merchant_reconciliation_events.occurrences + 1,
             last_seen_at = now(),
             provider_state = EXCLUDED.provider_state
       WHERE merchant_reconciliation_events.object_kind = 'dispute'
         AND merchant_reconciliation_events.related_provider_order_id = EXCLUDED.related_provider_order_id
         AND merchant_reconciliation_events.amount_minor = EXCLUDED.amount_minor
         AND merchant_reconciliation_events.currency = EXCLUDED.currency
       RETURNING provider_object_id`,
      [providerObjectId, event, relatedProviderOrderId, amountMinor, currency, providerState],
    )
    if ((recorded.rowCount ?? 0) !== 1) {
      await client.query('ROLLBACK')
      return 'invalid'
    }

    // A won dispute is still retained as an authoritative observation, but it
    // must not introduce a new wallet freeze. Existing freezes are deliberately
    // left for the reconciler because another unresolved dispute may own them.
    if (canFreeze && event !== 'DISPUTE_WON') {
      const frozen = await client.query(
        `UPDATE wallets
            SET frozen_reason = 'merchant_dispute', updated_at = now()
          WHERE user_email = $1 AND currency = $2`,
        [order.user_email, currency],
      )
      if ((frozen.rowCount ?? 0) !== 1) throw new Error('dispute_wallet_freeze_failed')
    }
    await client.query('COMMIT')
    return 'recorded'
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return 'unavailable'
  } finally {
    client?.release()
  }
}

/** Records in the `transactions` table (ORDER #6G). */

export interface Transaction {
  id: number
  user_id: string
  amountMinor: number
  amount: number
  credits: number
  currency: string
  policyVersion: string
  status: string
  payment_ref: string | null
  created_at: string
}

export type PurchaseStatus = 'pending' | 'paid' | 'refunded' | 'chargeback' | 'failed' | 'admin_grant'
export interface PurchaseTransaction {
  id: number
  amountMinor: number
  credits: number
  currency: string
  status: PurchaseStatus
  createdAt: string
}

const PURCHASE_STATUSES = new Set<PurchaseStatus>([
  'pending', 'paid', 'refunded', 'chargeback', 'failed', 'admin_grant',
])

/** A user's purchase history. An unavailable or structurally invalid ledger
 * is not an empty ledger and is never normalised into a successful status. */
export async function listTransactionsForUser(email: string, limit = 50): Promise<Citire<PurchaseTransaction[]>> {
  if (!email) return { citit: false, motiv: 'email_invalid' }
  return citireDb('citirea istoricului de plăți', async () => {
    const r = await getPool().query<{
      id: number
      amountMinor: string
      credits: string
      currency: string
      status: string
      createdAt: string
    }>(
      `SELECT id, gross_minor::text AS "amountMinor", credits::text, currency,
              status, created_at::text AS "createdAt"
       FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [email.toLowerCase(), Math.max(1, Math.min(500, limit))],
    )
    return r.rows.map((row) => {
      if (!PURCHASE_STATUSES.has(row.status as PurchaseStatus)) throw new Error('ledger_status_invalid')
      const amountMinor = Number(row.amountMinor)
      const credits = Number(row.credits)
      if (!Number.isSafeInteger(amountMinor) || !Number.isSafeInteger(credits)) throw new Error('ledger_amount_invalid')
      return {
        id: Number(row.id),
        amountMinor,
        credits,
        currency: row.currency,
        status: row.status as PurchaseStatus,
        createdAt: row.createdAt,
      }
    })
  })
}

/** All transactions (admin panel). */
export async function citesteTranzactii(limit = 200): Promise<Citire<Transaction[]>> {
  return citireDb('citirea tranzacțiilor', async () => {
    const r = await getPool().query<Transaction>(
      `SELECT id, user_id, gross_minor::float / $2::float AS amount,
              gross_minor::float AS "amountMinor", credits, currency,
              policy_version AS "policyVersion", status, payment_ref, created_at::text
       FROM transactions ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(500, limit)), 10 ** config.billing.minorUnit],
    )
    return r.rows
  })
}

/** Wallet balance + the last-top-up reference, for the low-credit % alerts. */
/** Ca `citesteSold`, dar cu referința ultimei alimentări (procentul rămas).
 *  Aceeași regulă: o citire imposibilă NU se scrie ca „0 credite". */
export type CitirePortofel = { citit: true; balanceMinor: number; topupRefMinor: number } | { citit: false; motiv: string }

export async function citestePortofel(email: string): Promise<CitirePortofel> {
  if (!dbEnabled()) return { citit: false, motiv: 'baza de date nu e configurată' }
  try {
    const r = await getPool().query<{
      balance_minor: string
      topup_ref_minor: string
      debt_minor: string
      currency: string
      frozen_reason: string | null
    }>(
      'SELECT balance_minor, topup_ref_minor, debt_minor, currency, frozen_reason FROM wallets WHERE user_email = lower($1)',
      [email],
    )
    if (!r.rows[0]) return { citit: true, balanceMinor: 0, topupRefMinor: 0 }
    const balanceMinor = Number(r.rows[0].balance_minor)
    const topupRefMinor = Number(r.rows[0].topup_ref_minor)
    const debtMinor = Number(r.rows[0].debt_minor ?? 0)
    if (
      !Number.isSafeInteger(balanceMinor) || balanceMinor < 0 ||
      !Number.isSafeInteger(topupRefMinor) || topupRefMinor < 0 ||
      !Number.isSafeInteger(debtMinor) || debtMinor < 0 ||
      r.rows[0].currency !== config.billing.currency
    ) return { citit: false, motiv: 'ledger_invalid' }
    return {
      citit: true,
      balanceMinor: debtMinor > 0 || Boolean(r.rows[0].frozen_reason) ? 0 : balanceMinor,
      topupRefMinor: debtMinor > 0 || Boolean(r.rows[0].frozen_reason) ? 0 : topupRefMinor,
    }
  } catch (e) {
    return { citit: false, motiv: `citirea portofelului a picat: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
  }
}

// Available product credit and provider expense come only from their verified
// ledgers; there is no administrator-entered balance.

/** Increment one anonymous aggregate. No per-person identifier enters SQL. */
export async function logVisit(countryCode: string, path: string): Promise<void> {
  if (!dbEnabled()) return
  const code = /^[A-Z]{2}$/.test(countryCode) && countryCode !== 'XX' && countryCode !== 'T1'
    ? countryCode
    : ''
  try {
    await getPool().query(
      `INSERT INTO visit_daily (day, path, country_code, views)
       VALUES (current_date, $1, $2, 1)
       ON CONFLICT (day, path, country_code) DO UPDATE
         SET views = visit_daily.views + 1, last_seen_at = now()`,
      [path.slice(0, 64), code],
    )
  } catch {
    /* analytics must never break the page */
  }
}

/** Upsert signed-in daily presence without persisting transport/device data. */
export async function touchVisit(email: string, path: string): Promise<boolean> {
  if (!dbEnabled()) return true
  try {
    await getPool().query(
      `INSERT INTO user_presence_daily (user_email, day, actions, pages)
       VALUES (lower($1), current_date, 1, ARRAY[$2]::text[])
       ON CONFLICT (user_email, day) DO UPDATE SET
         last_seen_at = now(),
         actions = user_presence_daily.actions + 1,
         pages = CASE
           WHEN $2 = ANY(user_presence_daily.pages) THEN user_presence_daily.pages
           ELSE array_append(user_presence_daily.pages, $2)
         END`,
      [email.trim().toLowerCase().slice(0, 254), path.slice(0, 64)],
    )
    return true
  } catch {
    return false
  }
}

/** Explicit admin purge affects only privacy-minimised aggregates. */
export async function purgeVisits(): Promise<number> {
  if (!dbEnabled()) return -1
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const publicRows = await client.query('DELETE FROM visit_daily')
    const presenceRows = await client.query('DELETE FROM user_presence_daily')
    await client.query('COMMIT')
    const deleted = (publicRows.rowCount ?? 0) + (presenceRows.rowCount ?? 0)
    noteazaAudit('admin', 'golire-statistici-vizitatori', 'visitor_aggregates', '*', `${deleted} agregate`, 'șters')
    return deleted
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ── CURĂȚAREA AUTOMATĂ A JURNALEROR (owner, 23 aug 2026: „tabelele sunt
// burdusite de err, cine le verifică și le monitorizează, mama?") ──────────
// Fără asta, tabelele de jurnal creșteau la nesfârșit: operational_events
// 25.415 rânduri, client_errors 1.359, audit_log 3.225, task_timings 7.364 —
// NICIUN cron nu le curăța. Acum: la 4 noaptea, ștergem tot ce e mai vechi de
// 30 de zile din tabelele de jurnal (NU din datele de oameni/bani/identitate).
// Retenția e în env (ZILE_RETENTIE_JURNAL), cu 30 de zile ca implicit rezonabil.
// Tabelele de JURNAL care se curăță automat — NU date de oameni, bani,
// identitate, biometrie (acelea sunt sub scutulDatelor, protejate de triggere).
const RETENTIE_JURNALE = [
  { tabela: 'operational_events', coloana: 'created_at' },
  { tabela: 'client_errors', coloana: 'created_at' },
  { tabela: 'task_timings', coloana: 'created_at' },
] as const

export async function curataJurnaleVechi(): Promise<{ tabela: string; sterse: number }[]> {
  if (!dbEnabled()) return []
  const rezultate: { tabela: string; sterse: number }[] = []
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('kelion.retention_job', '1', true)")
    for (const { tabela, coloana } of RETENTIE_JURNALE) {
      const r = await client.query(
        `DELETE FROM ${tabela} WHERE ${coloana} < now() - ($1::int * interval '1 day')`,
        [config.privacy.journalRetentionDays],
      )
      rezultate.push({ tabela, sterse: r.rowCount ?? 0 })
    }
    const audit = await client.query(
      `DELETE FROM audit_log
        WHERE (erasure_request_id IS NULL AND la < now() - ($1::int * interval '1 day'))
           OR retention_until <= now()`,
      [config.privacy.journalRetentionDays],
    )
    rezultate.push({ tabela: 'audit_log', sterse: audit.rowCount ?? 0 })

    // Pseudonymised legal records are removed when their row-level retention
    // expires. Delete child/detail tables before account summaries/receipts.
    for (const tabela of [
      'provider_usage_events',
      'cost_events',
      'payment_codes',
      'merchant_checkout_orders',
      'transactions',
      'billing_events',
      'plati_neatribuite',
      'wallets',
      'build_jobs',
    ] as const) {
      const r = await client.query(`DELETE FROM ${tabela} WHERE retention_until <= now()`)
      rezultate.push({ tabela, sterse: r.rowCount ?? 0 })
    }
    const receipts = await client.query('DELETE FROM erasure_requests WHERE retention_until <= now()')
    rezultate.push({ tabela: 'erasure_requests', sterse: receipts.rowCount ?? 0 })
    for (const { tabela, coloana } of [
      { tabela: 'visit_daily', coloana: 'day' },
      { tabela: 'user_presence_daily', coloana: 'day' },
    ] as const) {
      const r = await client.query(
        `DELETE FROM ${tabela} WHERE ${coloana} < current_date - $1::int`,
        [config.visitor.analyticsRetentionDays],
      )
      rezultate.push({ tabela, sterse: r.rowCount ?? 0 })
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(`[curataJurnale] tranzacția de retenție a picat: ${String((e as Error).message).slice(0, 120)}`)
    return []
  } finally {
    client.release()
  }
  if (rezultate.some((r) => r.sterse > 0)) {
    const total = rezultate.reduce((s, r) => s + r.sterse, 0)
    noteazaAudit('sistem', 'curățare automată jurnale', 'jurnale', '*', `${total} rânduri expirate conform politicii`, 'șters')
  }
  return rezultate
}


// Activitate per cont, agregată pe zi. Nu expune IP, device ori user-agent.
// AUDIT ADMIN (3 aug, tab Utilizatori): o eroare de DB întorcea {users:[],
// sessions:[]} cu 200 — panoul afișa „încă nu s-a strâns activitate", o
// afirmație nemăsurată (forma „Cardul: necreat"). Acum: null la eșec → ruta
// răspunde 500, panoul spune „nu pot citi", nu „nu există activitate".
export async function getUserActivity(): Promise<{
  users: UserActivityRow[]
} | null> {
  if (!dbEnabled()) return null
  try {
    const pool = getPool()
    const users = (
      await pool.query<UserActivityRow>(
        `SELECT lower(v.user_email) AS email,
                COUNT(*)::int AS sessions,
                COALESCE(SUM(EXTRACT(EPOCH FROM (v.last_seen_at - v.first_seen_at))), 0)::float AS seconds,
                COALESCE(SUM(v.actions), 0)::int AS actions,
                COALESCE(MAX(m.n), 0)::int AS messages,
                MAX(v.last_seen_at)::text AS last_seen,
                EXISTS(SELECT 1 FROM blocked_users b WHERE lower(b.email) = MIN(lower(v.user_email))) AS blocked,
                COALESCE((SELECT w.balance_minor FROM wallets w WHERE lower(w.user_email) = MIN(lower(v.user_email)) LIMIT 1), 0)::float / $2::float AS balance,
                COALESCE((SELECT SUM(c.cost_usd_micros) FROM cost_events c WHERE lower(c.user_email) = MIN(lower(v.user_email))), 0)::float / 1000000.0 AS "consumedUsd",
                (MIN(lower(v.user_email)) = lower($1)) AS scutit,
                EXISTS(SELECT 1 FROM voiceprints vp WHERE lower(vp.user_email) = MIN(lower(v.user_email))) AS voce,
                COALESCE((SELECT vp.audio_clip <> '' FROM voiceprints vp WHERE lower(vp.user_email) = MIN(lower(v.user_email)) LIMIT 1), false) AS "mostraAudio"
         FROM user_presence_daily v
         LEFT JOIN (SELECT lower(user_email) AS email_jos, COUNT(*)::int AS n
                    FROM messages GROUP BY lower(user_email)) m
           ON m.email_jos = lower(v.user_email)
         GROUP BY lower(v.user_email)
         ORDER BY MAX(v.last_seen_at) DESC
         LIMIT 200`,
        // P10: ownerul e scutit de taxare peste tot („e casa lui", tarife.ts) —
        // soldul lui negativ e datorie ISTORICĂ dinaintea scutirilor, fără
        // efect; rândul lui se marchează ca panoul să spună asta, nu să sperie.
        [config.adminEmail, 10 ** config.billing.minorUnit],
      )
    ).rows
    return { users }
  } catch (e) {
    // P26 (bugul viu din captura ownerului): panoul spunea cinstit „citirea a
    // eșuat", dar catch-ul MUT înghițea CAUZA — nimeni nu putea diagnostica.
    // Eroarea se strigă în jurnal (server_logs → admin), null rămâne null.
    console.error('[users] getUserActivity a picat:', String(e).slice(0, 300))
    return null
  }
}



// Statistici admin numai din contoare agregate, fără profil de vizitator.
// AUDIT ADMIN (3 aug, tab Vizitatori): o eroare de DB întorcea `empty`
// (visitsTotal:0, bots:0) cu 200 — cardurile arătau „Vizite 0/0" ca măsurătoare,
// fix tiparul „£0.00" din 30 iul. Acum: null la eșec (ruta răspunde 500, panoul
// scrie „nu pot citi"), zerourile rămân DOAR pentru o citire reușită.
export async function getDemoStats(): Promise<DemoStats | null> {
  if (!dbEnabled()) return null
  try {
    const pool = getPool()
    const vCounts = (
      await pool.query<{ total: string; today: string }>(
        `SELECT COALESCE(SUM(views), 0)::text AS total,
                COALESCE(SUM(views) FILTER (WHERE day = current_date), 0)::text AS today
         FROM visit_daily`,
      )
    ).rows[0]
    const byCountry = (
      await pool.query<{ code: string; count: number }>(
        `SELECT country_code AS code, SUM(views)::int AS count
           FROM visit_daily
          WHERE country_code <> ''
          GROUP BY country_code
          ORDER BY SUM(views) DESC`,
      )
    ).rows
    const recent = (
      await pool.query<DemoRecent>(
        `SELECT 'visit'::text AS kind, country_code, day::text AS started_at,
                path, views::int
           FROM visit_daily
          ORDER BY day DESC, last_seen_at DESC
          LIMIT 60`,
      )
    ).rows
    return {
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
// ever checked it against a provider statement. Meaning the panel could show
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
// from the verified payment ledger and reconciled provider accounting. The
// source of truth is never an administrator-entered estimate.
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
  const micros = Math.round(costUsd * 1_000_000)
  if (!Number.isSafeInteger(micros) || micros <= 0) return
  try {
    await getPool().query(
      'INSERT INTO cost_events (user_email, kind, cost_usd_micros) VALUES ($1, $2, $3)',
      [email, kind, micros],
    )
  } catch {
    // Never break a request because metering failed.
  }
}

export async function recordProviderUsage(input: {
  responseId: string
  userEmail: string
  surface: string
  sessionId?: string | null
  model: string
  serviceTier?: string | null
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningOutputTokens?: number
  inputAudioTokens?: number
  outputAudioTokens?: number
}): Promise<void> {
  const ints = [
    input.inputTokens,
    input.outputTokens,
    input.cachedInputTokens ?? 0,
    input.reasoningOutputTokens ?? 0,
    input.inputAudioTokens ?? 0,
    input.outputAudioTokens ?? 0,
  ]
  if (!dbEnabled()) throw new Error('provider_usage_db_unavailable')
  if (
    !/^[A-Za-z0-9._:-]{1,160}$/.test(input.responseId) ||
    !input.userEmail ||
    !/^[A-Za-z0-9._:-]{1,120}$/.test(input.surface) ||
    (input.sessionId != null && !/^[A-Za-z0-9._:-]{1,160}$/.test(input.sessionId)) ||
    !/^[A-Za-z0-9._:-]{1,160}$/.test(input.model) ||
    ints.some((n) => !Number.isSafeInteger(n) || n < 0)
  ) throw new Error('provider_usage_invalid')
  const serviceTier = input.serviceTier && /^[A-Za-z0-9._:-]{1,40}$/.test(input.serviceTier)
    ? input.serviceTier
    : null
  let client: pg.PoolClient | null = null
  try {
    client = await conexiuneDb()
    await client.query('BEGIN')
    // The caller also has a fail-closed wall-clock deadline. These server-side
    // guards ensure that timing out the caller cannot strand a query in the
    // pool and eventually starve unrelated application traffic.
    await client.query("SET LOCAL statement_timeout = '4500ms'")
    await client.query("SET LOCAL lock_timeout = '4000ms'")
    const result = await client.query(
      `INSERT INTO provider_usage_events
         (response_id, user_email, provider, surface, session_id, model, service_tier,
          input_tokens, output_tokens, cached_input_tokens, reasoning_output_tokens,
          input_audio_tokens, output_audio_tokens)
       VALUES ($1, $2, 'openai', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (response_id) DO UPDATE SET response_id = EXCLUDED.response_id
       WHERE provider_usage_events.user_email = EXCLUDED.user_email
         AND provider_usage_events.surface = EXCLUDED.surface
         AND provider_usage_events.session_id IS NOT DISTINCT FROM EXCLUDED.session_id
         AND provider_usage_events.model = EXCLUDED.model
         AND provider_usage_events.service_tier IS NOT DISTINCT FROM EXCLUDED.service_tier
         AND provider_usage_events.input_tokens = EXCLUDED.input_tokens
         AND provider_usage_events.output_tokens = EXCLUDED.output_tokens
         AND provider_usage_events.cached_input_tokens = EXCLUDED.cached_input_tokens
         AND provider_usage_events.reasoning_output_tokens = EXCLUDED.reasoning_output_tokens
         AND provider_usage_events.input_audio_tokens = EXCLUDED.input_audio_tokens
         AND provider_usage_events.output_audio_tokens = EXCLUDED.output_audio_tokens
       RETURNING response_id`,
      [input.responseId, userKey(input.userEmail), input.surface, input.sessionId ?? null, input.model, serviceTier, ...ints],
    )
    if ((result.rowCount ?? 0) !== 1) throw new Error('provider_usage_conflict')
    await client.query('COMMIT')
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined)
    console.error(`[provider-usage] durable write failed: ${String(error).slice(0, 120)}`)
    throw new Error('provider_usage_write_failed')
  } finally {
    client?.release()
  }
}

/** P22 (timerul de promovare): cât s-a cheltuit AZI pe un fel anume — plafonul
 *  zilnic al ownerului se judecă pe MĂSURĂTOARE, nu pe presupunere. null =
 *  citirea a picat (apelantul refuză rularea: pe necitit nu se cheltuie). */
export async function costAziPe(kind: string): Promise<number | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ s: string }>(
      `SELECT COALESCE(SUM(cost_usd_micros), 0)::float / 1000000.0 AS s FROM cost_events
       WHERE kind = $1 AND created_at >= date_trunc('day', now())`,
      [kind],
    )
    return Number(r.rows[0]?.s ?? 0)
  } catch {
    return null
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

export async function saveGeneratedMedia(input: {
  id: string
  ownerEmail: string
  kind: GeneratedMediaKind
  mime: string
  data: Buffer
}): Promise<void> {
  if (!dbEnabled()) throw new Error('media_store_unavailable')
  const owner = normalizeMediaOwner(input.ownerEmail)
  if (!owner || !mediaIdValid(input.id) || !mediaMimeAllowed(input.kind, input.mime)
    || input.data.length === 0 || input.data.length > mediaByteLimit(input.kind)) {
    throw new Error('generated_media_invalid')
  }
  await getPool().query(
    `INSERT INTO generated_media (id, owner_email, kind, mime, data, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 day'))`,
    [input.id, owner, input.kind, input.mime, input.data, config.privacy.mediaRetentionDays],
  )
  // Bounded opportunistic retention cleanup. It runs only after a successful
  // durable write and never changes the outcome of the requested media.
  await getPool().query(
    `DELETE FROM generated_media WHERE id IN (
       SELECT id FROM generated_media WHERE expires_at <= now() ORDER BY expires_at LIMIT 100
     )`,
  ).catch(() => undefined)
}

export async function loadGeneratedMedia(
  id: string,
  ownerEmail: string,
  kind: GeneratedMediaKind,
): Promise<{ mime: string; data: Buffer } | null> {
  if (!dbEnabled()) throw new Error('media_store_unavailable')
  const owner = userKey(ownerEmail)
  if (!owner) return null
  const r = await getPool().query<{ mime: string; data: Buffer }>(
    `SELECT mime, data
       FROM generated_media
      WHERE id=$1 AND lower(owner_email)=$2 AND kind=$3 AND expires_at > now()`,
    [id, owner, kind],
  )
  const row = r.rows[0]
  return row ? { mime: row.mime, data: row.data } : null
}

export interface CostSummary {
  total: number
  today: number
  byKind: Record<string, number>
  /** How much of `total` comes from a reconciled provider measurement. */
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

// Only reconciled provider data may be labelled measured. Local calculations
// remain estimates and must be presented as such.
const COSTURI_MASURATE = new Set(['chat', 'memory'])

/** ── CHELTUIALA LUNII PE CATEGORII ─────────────────────────────────────────
 *
 *  Suma se poate cere pe orice set de categorii. O categorie care se termină
 *  în `*` este tratată ca prefix.
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
      `SELECT COALESCE(SUM(cost_usd_micros), 0)::float / 1000000.0 AS s
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
         COALESCE(SUM(cost_usd_micros), 0)::float / 1000000.0 AS total,
         COALESCE(SUM(cost_usd_micros) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::float / 1000000.0 AS today
       FROM cost_events`,
    )
    const kinds = await pool.query<{ kind: string; sum: string }>(
      'SELECT kind, SUM(cost_usd_micros)::float / 1000000.0 AS sum FROM cost_events GROUP BY kind',
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
//
// IGIENIZARE LA SURSĂ (owner, 14 aug: „chatul la mine îl traduce în rusă").
// Gardul din lang.ts (24 iul) oprește COMMIT-ul unei limbi nesuportate — dar o
// preferință otrăvită de DINAINTE de gard (dovada vie din 24 iul: româna auzită
// ca RUSĂ) rămânea în bază și curgea în vocea live / persona. De-acum, o limbă
// din afara setului suportat NU mai iese de aici: se întoarce null (= detectare
// de la zero) și se șterge din bază, ca otrava să nu se mai întoarcă.
const LIMBI_SUPORTATE_PREF = new Set(['en', 'ro', 'fr', 'es', 'pt', 'it', 'de'])
export async function getSpeechLang(email: string): Promise<string | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<{ speech_lang: string | null }>(
      'SELECT speech_lang FROM user_prefs WHERE user_email = $1',
      [userKey(email)],
    )
    const brut = r.rows[0]?.speech_lang ?? null
    if (!brut) return null
    if (!LIMBI_SUPORTATE_PREF.has(brut.toLowerCase().split('-')[0])) {
      console.error(`[limbă] preferință otrăvită ștearsă pentru ${email}: „${brut}" (nesuportată)`)
      void getPool()
        .query('UPDATE user_prefs SET speech_lang = NULL WHERE user_email = $1', [userKey(email)])
        .catch(() => {})
      return null
    }
    return brut
  } catch {
    return null
  }
}

export async function setSpeechLangPref(email: string, lang: string): Promise<void> {
  if (!dbEnabled()) return
  try {
    const vechi = await getSpeechLang(email).catch(() => null)
    await getPool().query(
      `INSERT INTO user_prefs (user_email, speech_lang, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_email) DO UPDATE SET speech_lang = $2, updated_at = now()`,
      [userKey(email), lang],
    )
    if ((vechi ?? '') !== lang) noteazaAudit(email, 'limba-vorbirii', 'user_prefs', userKey(email), vechi ?? '', lang)
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

export interface LowCreditReminderPrefs {
  enabled: boolean
  thresholdMinor: number
  suggestedTopupMinor: number
}

export async function getLowCreditReminder(email: string): Promise<LowCreditReminderPrefs> {
  const def: LowCreditReminderPrefs = {
    enabled: false,
    thresholdMinor: config.billing.lowCreditThresholdMinor,
    suggestedTopupMinor: config.billing.suggestedTopupMinor,
  }
  if (!dbEnabled()) return def
  try {
    const r = await getPool().query<{
      low_credit_reminder_enabled: boolean
      low_credit_threshold_minor: string | null
      suggested_topup_minor: string | null
    }>(
      `SELECT low_credit_reminder_enabled, low_credit_threshold_minor, suggested_topup_minor
         FROM user_prefs WHERE user_email = $1`,
      [userKey(email)],
    )
    const row = r.rows[0]
    if (!row) return def
    return {
      enabled: !!row.low_credit_reminder_enabled,
      thresholdMinor: Number(row.low_credit_threshold_minor ?? def.thresholdMinor),
      suggestedTopupMinor: Number(row.suggested_topup_minor ?? def.suggestedTopupMinor),
    }
  } catch {
    return def
  }
}

export async function setLowCreditReminder(email: string, p: LowCreditReminderPrefs): Promise<boolean> {
  if (!dbEnabled()) return false
  try {
    await getPool().query(
      `INSERT INTO user_prefs
         (user_email, low_credit_reminder_enabled, low_credit_threshold_minor, suggested_topup_minor, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_email) DO UPDATE
         SET low_credit_reminder_enabled = $2,
             low_credit_threshold_minor = $3,
             suggested_topup_minor = $4,
             updated_at = now()`,
      [userKey(email), p.enabled, p.thresholdMinor, p.suggestedTopupMinor],
    )
    return true
  } catch {
    return false
  }
}

export async function saveMessage(
  email: string,
  role: 'user' | 'assistant',
  content: string,
  /** Timestamp (ms) of the original message, e.g. from an offline sync. */
  createdAt?: number,
): Promise<void> {
  if (!dbEnabled() || !content.trim()) return
  try {
    if (typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0) {
      await getPool().query(
        'INSERT INTO messages (user_email, role, content, created_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))',
        [email, role, content, createdAt],
      )
    } else {
      await getPool().query(
        'INSERT INTO messages (user_email, role, content) VALUES ($1, $2, $3)',
        [email, role, content],
      )
    }
  } catch {
    // Never break the chat because persistence failed.
  }
}

export interface OfflineMessageInput {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAtMs: number
}

export interface OfflineMessageRejection {
  id: string
  code: 'payload_conflict'
}

export interface OfflineSyncResult {
  ackedIds: string[]
  rejected: OfflineMessageRejection[]
}

/** Persist an already-validated offline batch exactly once per account/event.
 * The account storage scope is checked under the same transaction before any
 * message write. A reused UUID with different content is rejected per item so
 * it cannot block unrelated valid turns from the same batch. */
export async function syncOfflineMessages(
  email: string,
  clientStorageId: string,
  messages: OfflineMessageInput[],
): Promise<Citire<OfflineSyncResult>> {
  const key = userKey(email)
  if (!dbEnabled() || !key) return { citit: false, motiv: 'offline_store_unavailable' }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const scope = await client.query<{ storage_id: string }>(
      `SELECT storage_id::text
         FROM account_client_storage_ids
        WHERE lower(user_email)=$1
        FOR SHARE`,
      [key],
    )
    if (scope.rows[0]?.storage_id.toLowerCase() !== clientStorageId.toLowerCase()) {
      await client.query('ROLLBACK')
      return { citit: false, motiv: 'scope_mismatch' }
    }

    const ackedIds: string[] = []
    const rejected: OfflineMessageRejection[] = []
    for (const message of messages) {
      const inserted = await client.query(
        `INSERT INTO messages
           (user_email, role, content, created_at, client_event_id, client_created_at_ms)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5::uuid, $4)
         ON CONFLICT ((lower(user_email)), client_event_id)
           WHERE client_event_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [key, message.role, message.content, message.createdAtMs, message.id],
      )
      if ((inserted.rowCount ?? 0) === 0) {
        const existing = await client.query<{
          role: string
          content: string
          client_created_at_ms: string
        }>(
          `SELECT role, content, client_created_at_ms::text
             FROM messages
            WHERE lower(user_email)=$1 AND client_event_id=$2::uuid
            FOR UPDATE`,
          [key, message.id],
        )
        const row = existing.rows[0]
        if (!row
          || row.role !== message.role
          || row.content !== message.content
          || Number(row.client_created_at_ms) !== message.createdAtMs) {
          rejected.push({ id: message.id, code: 'payload_conflict' })
          continue
        }
      }
      ackedIds.push(message.id)
    }
    await client.query('COMMIT')
    return { citit: true, valoare: { ackedIds, rejected } }
  } catch {
    await client.query('ROLLBACK').catch(() => undefined)
    return {
      citit: false,
      motiv: 'offline_store_unavailable',
    }
  } finally {
    client.release()
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
       WHERE user_email = $1
       ORDER BY created_at ASC, id ASC
       LIMIT $2`,
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
         SELECT id, role, content, created_at FROM messages
         WHERE user_email = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       ) AS x
       ORDER BY created_at ASC, id ASC`,
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
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
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
  lastSeen?: string
}

/** Most recently relevant durable facts, for one agent's memory namespace. */
export async function getMemories(email: string, limit = 40, agent = 'kelion'): Promise<Memory[]> {
  if (!dbEnabled()) return []
  try {
    const r = await getPool().query<Memory>(
      `SELECT content, last_seen AS "lastSeen" FROM memories
       WHERE user_email = $1 AND agent = $2 AND (expires_at IS NULL OR expires_at > now())
       ORDER BY last_seen DESC LIMIT $3`,
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
         AND (expires_at IS NULL OR expires_at > now())
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
    // DEDUP FUZZY (K16): compara TOATE starile. Daca ignoram `respinsa`, o
    // propunere automata respinsa reaparea la fiecare ciclu si nastea din nou
    // acelasi job. Redeschiderea deliberata se face pe randul existent, nu prin
    // clonarea cerintei.
    const existente = await getPool().query<{ id: string | number; text: string }>(
      `SELECT id, text FROM cerinte ORDER BY created_at DESC LIMIT 200`,
    )
    for (const row of existente.rows) {
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

/** Metadatele SMART ale unei memorii (owner, 19 aug): tip, importanță, expirare.
 *  Toate opționale — un apelant vechi (fără meta) scrie exact ca înainte. */
export interface MemoryMeta {
  tip?: string | null // memory_type: identity/preference/relationship/project/episodic/fact
  importanta?: number | null // 0..1; absentă → implicita tipului (memoryRank)
  expiraInMs?: number | null // TTL de acum → expires_at; absentă → nu expiră
}

/** Save a learned fact (idempotent: re-learning just refreshes its recency).
 *  Cu meta (owner, 19 aug): scrie tipul, importanța și expirarea — recall-ul le
 *  cântărește (memoryRank). La re-învățare: prospețimea se reîmprospătează, tipul
 *  se completează dacă vine, importanța urcă la maximul dintre vechi și nou. */
export async function addMemory(
  email: string,
  content: string,
  agent = 'kelion',
  meta: MemoryMeta = {},
): Promise<void> {
  const c = content.trim()
  if (!dbEnabled() || !c) return
  const tip = normalizeazaTip(meta.tip)
  const imp = clampImportanta(meta.importanta, tip)
  const expira =
    typeof meta.expiraInMs === 'number' && Number.isFinite(meta.expiraInMs) && meta.expiraInMs > 0
      ? new Date(Date.now() + meta.expiraInMs)
      : null
  try {
    await getPool().query(
      `INSERT INTO memories (user_email, agent, content, memory_type, importance, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_email, agent, content) DO UPDATE SET
         last_seen = now(),
         memory_type = COALESCE(EXCLUDED.memory_type, memories.memory_type),
         importance = GREATEST(COALESCE(EXCLUDED.importance, 0), COALESCE(memories.importance, 0)),
         expires_at = COALESCE(EXCLUDED.expires_at, memories.expires_at)`,
      [email, agent, c, tip, imp, expira],
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
// whole past is searchable by meaning through the configured embedding service.
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
    const acum = Date.now()
    // SMART (owner, 19 aug): pe lângă vector aducem TIPUL, IMPORTANȚA și vârsta
    // (last_seen) + expirarea, iar rangarea nu mai e doar similaritate — e
    // similaritate × importanță × decădere-în-timp (memoryRank). Expiratele NU se
    // reamintesc. Pragul de similaritate rămâne (0.45) ca să nu injectăm zgomot.
    const r = await getPool().query<{
      content: string
      embedding: number[] | null
      memory_type: string | null
      importance: number | null
      age_ms: string | number
      expires_ms: string | number | null
    }>(
      `SELECT content, embedding, memory_type, importance,
              EXTRACT(EPOCH FROM (now() - last_seen)) * 1000 AS age_ms,
              CASE WHEN expires_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM expires_at) * 1000 END AS expires_ms
       FROM memories
       WHERE user_email = $1 AND agent = $2 AND embedding IS NOT NULL
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY last_seen DESC LIMIT 400`,
      [email, agent],
    )
    const candidate = r.rows
      .map((row) => {
        const semantic = Array.isArray(row.embedding) ? cosine(qv, row.embedding) : 0
        const tip = normalizeazaTip(row.memory_type)
        return {
          content: row.content,
          tip,
          importanta: clampImportanta(row.importance, tip),
          semantic,
          varstaMs: Number(row.age_ms) || 0,
          expiresAtMs: row.expires_ms == null ? null : Number(row.expires_ms),
        }
      })
      .filter((m) => m.semantic > 0.45) // hardcod-permis: prag de similaritate, ca la varianta veche
    return rangheazaMemorii(candidate, acum, limit).map((m) => ({ content: m.content }))
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
export async function listInboundEmails(limit = 50): Promise<InboundEmail[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<InboundEmail>(
      `SELECT id, uid, from_addr, from_name, subject, body, reply, replied, lang, received_at
       FROM inbound_emails ORDER BY received_at DESC LIMIT $1`,
      [limit],
    )
    return r.rows
  } catch {
    return null
  }
}

// ── User-scoped spectral voice personalisation ──────────────────────────────

export interface VoiceFeatureMeta {
  /** Spectral centroid measured by the enrolling client, in Hz. */
  centroid: number
}

export interface VoiceprintRow {
  email: string
  name: string
  features: number[]
  featureMeta: VoiceFeatureMeta
  hasAudio: boolean
  createdAt: string
  updatedAt: string
}

interface VoiceprintDbRow {
  user_email: string
  name: string
  features: number[]
  feature_meta: VoiceFeatureMeta
  has_audio: boolean
  created_at: string
  updated_at: string
}

function rowToVoiceprint(row: VoiceprintDbRow): VoiceprintRow {
  return {
    email: row.user_email,
    name: row.name,
    features: row.features || [],
    featureMeta: row.feature_meta || { centroid: 0 },
    hasAudio: row.has_audio,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function saveVoiceprint(v: {
  email: string
  name: string
  features: number[]
  featureMeta: VoiceFeatureMeta
  audioClip?: string
}): Promise<void> {
  if (!dbEnabled() || !v.email) throw new Error('voiceprint_store_unavailable')
  const vector = v.features.filter((value) => Number.isFinite(value) && value >= 0 && value <= 255).slice(0, 256)
  if (vector.length < 3 || !Number.isFinite(v.featureMeta.centroid)) throw new Error('voiceprint_invalid')
  const clip = typeof v.audioClip === 'string' && v.audioClip.length <= 600_000 ? v.audioClip : ''
  await getPool().query(
    `INSERT INTO voiceprints
       (user_email, name, features, feature_meta, audio_clip, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_email) DO UPDATE
       SET name = $2,
           features = $3,
           feature_meta = $4,
           audio_clip = CASE WHEN $5 <> '' THEN $5 ELSE voiceprints.audio_clip END,
           updated_at = now()`,
    [
      v.email.toLowerCase(),
      v.name.slice(0, 100),
      vector,
      JSON.stringify({ centroid: v.featureMeta.centroid }),
      clip,
    ],
  )
  noteazaAudit(v.email, 'profil vocal înscris', 'voiceprints', v.email.toLowerCase(), '', `vector=${vector.length}`)
}

export async function getVoiceprint(email: string): Promise<VoiceprintRow | null> {
  if (!dbEnabled() || !email) return null
  const result = await getPool().query<VoiceprintDbRow>(
    `SELECT user_email, name, features, feature_meta,
            audio_clip <> '' AS has_audio, created_at, updated_at
       FROM voiceprints WHERE user_email = $1`,
    [email.toLowerCase()],
  )
  return result.rows[0] ? rowToVoiceprint(result.rows[0]) : null
}

/** Idempotent, current-user revocation of vector, metadata and stored audio. */
export async function deleteVoiceprint(email: string): Promise<boolean> {
  if (!dbEnabled() || !email) return false
  const result = await getPool().query(
    'DELETE FROM voiceprints WHERE user_email = lower($1)',
    [email],
  )
  noteazaAudit(email, 'revocare profil vocal', 'voiceprints', email.toLowerCase(), 'înscris', 'șters')
  return (result.rowCount ?? 0) > 0
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

/** Revoke the current account's facial biometric reference. The email is a
 * bound parameter and the shield exception exists only for this transaction. */
export async function deleteFaceprint(email: string): Promise<boolean> {
  if (!dbEnabled() || !email) return false
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('kelion.revoca_biometrie', '1', true)")
    const r = await client.query('DELETE FROM faceprints WHERE user_email = lower($1)', [email])
    await client.query('COMMIT')
    noteazaAudit(email, 'revocare biometrică facială', 'faceprints', email.toLowerCase(), 'înscris', 'șters')
    return (r.rowCount ?? 0) > 0
  } catch {
    await client.query('ROLLBACK').catch(() => undefined)
    return false
  } finally {
    client.release()
  }
}

// ── THE BUILDER — the build-order queue (Adrian, 27 Jul) ────────────────────
export interface BuildJob {
  id: number
  orderedBy: string
  orderText: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  attempts: number
  branch: string | null
  prUrl: string | null
  tokens: number
  log: string | null
  progress: string | null
  ci: string | null
  // Worker execution tier and measured cost; null means unreported, not zero.
  brain: string | null
  costUsd: number | null
  /** Identificator opac emis de workerul Codex separat; nu este un token. */
  codexTaskId: string | null
  /** Profilul local selectat manual și persistat la claim pentru ciclul curent. */
  executionProfile: ConstructorExecutionProfile | null
  constructorStage: string
  commit: string | null
  liveVersion: string | null
  /** Momentul persistat înainte de care workerul nu reia automat jobul. */
  retryNotBefore: string | null
  /** Generația implementării curente. Evenimentele ciclurilor anterioare
   * rămân auditabile, dar nu contribuie la progresul curent. */
  executionCycle: number
  archived: boolean
  /** Server-authoritative destructive capability for the current snapshot. */
  deletable: boolean
  /** Static ledger guard; duplicate-active checks still run at mutation time. */
  retryable: boolean
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
  codex_task_id?: string | null
  execution_profile?: string | null
  constructor_stage?: string | null
  commit_sha?: string | null
  live_version?: string | null
  retry_not_before?: Date | string | null
  erasure_request_id?: string | null
  execution_cycle?: number
  arhivat: boolean
  deletable?: boolean
  retryable?: boolean
  created_at: Date
  updated_at: Date
}

function rowToBuildJob(r: BuildJobDbRow): BuildJob {
  return {
    id: Number(r.id),
    orderedBy: r.ordered_by,
    orderText: r.order_text,
    status: (['queued', 'running', 'done', 'failed', 'cancelled'].includes(r.status) ? r.status : 'failed') as BuildJob['status'],
    attempts: r.attempts,
    branch: r.branch,
    prUrl: r.pr_url,
    tokens: Number(r.tokens),
    log: r.log,
    progress: r.progress ?? null,
    ci: r.ci ?? null,
    brain: constructorActorLabel(r.brain),
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    codexTaskId: r.codex_task_id ?? null,
    executionProfile: r.execution_profile === 'fast' || r.execution_profile === 'powerful'
      ? r.execution_profile
      : null,
    constructorStage: r.constructor_stage ?? 'queued',
    commit: r.commit_sha ?? null,
    liveVersion: r.live_version ?? null,
    retryNotBefore: r.retry_not_before
      ? new Date(r.retry_not_before).toISOString()
      : null,
    executionCycle: Number(r.execution_cycle ?? 0),
    archived: r.arhivat === true,
    deletable: r.deletable === true,
    retryable: r.retryable === true,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

/** Amprenta unui ordin: textul fără părțile volatile (ore, date, sha-uri,
 *  contoare, numărul încercării) — două ordine cu aceeași amprentă sunt
 *  ACELAȘI ordin, indiferent cine și când le depune. */
export function amprentaOrdin(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.,+z-]*/gi, '')
    .replace(/\[?\d{1,2}:\d{2}(:\d{2})?\]?/g, '')
    .replace(/[0-9a-f]{8,}/gi, '')
    .replace(/count=\d+|prag=\d+|încercarea \d+|incercarea \d+/gi, '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

// ── ACELAȘI SUBIECT ÎN ALTE CUVINTE = TOT DUBLURĂ (owner, 16 aug, cu coada pe
// ecran: #334 „Perform full codebase audit for hardcoded values...", #335
// „Perform a comprehensive audit of the entire codebase...", #338 „Scan the
// entire codebase for remaining hardcoded values..." — TREI ordine VII pe
// ACELAȘI audit; „am cerut unicitate pe ordin, e normal sa ma ignori?").
// Amprenta exactă prinde doar copiile identice; asemănarea de subiect se
// judecă pe CUVINTELE DE CONȚINUT (fără umplutură), determinist: ≥4 cuvinte
// comune ȘI ≥50% din vocabularul ordinului mai mic. Fără AI, fără scor magic
// — un prag verificabil în teste. ─────────────────────────────────────────────
const CUVINTE_UMPLUTURA = new Set([
  'this', 'that', 'with', 'from', 'into', 'have', 'been', 'will', 'shall', 'should',
  'must', 'need', 'make', 'sure', 'please', 'also', 'orice', 'oricare', 'toate',
  'pentru', 'care', 'este', 'sunt', 'fara', 'fără', 'după', 'dupa', 'când', 'cind',
  'unde', 'cum', 'mai', 'foarte', 'doar', 'apoi', 'atunci', 'acum', 'aici',
])
export function cuvinteleOrdinului(text: string): Set<string> {
  return new Set(
    amprentaOrdin(text)
      .split(/[^a-zăâîșțé#]+/i)
      .filter((w) => w.length >= 4 && !CUVINTE_UMPLUTURA.has(w)),
  )
}
/** Două ordine pe ACELAȘI subiect, chiar formulate diferit? Pur, determinist. */
export function seamanaOrdinele(a: string, b: string): boolean {
  const A = cuvinteleOrdinului(a)
  const B = cuvinteleOrdinului(b)
  if (A.size < 4 || B.size < 4) return false
  let comune = 0
  for (const w of A) if (B.has(w)) comune++
  return comune >= 4 && comune / Math.min(A.size, B.size) >= 0.5
}

// ── ORDINELE NU SE DUBLEAZĂ NICIODATĂ (ordinul verbatim al ownerului, 15 aug:
// „ordinele de rezolvat nu au voie sa se dubleze nici o data") ────────────────
// Dovada din coada lui: cerințele #28 și #29 construite în PARALEL (2,5M tokeni
// pe aceeași lucrare, unirea lor pe jumătate a rupt build-ul master), #295
// deschis pe o eroare deja în lucru, auto-vindecări repetate pe aceeași
// semnătură. Ușa e UNA (aici) — orice depunător (chat, auto-vindecare,
// constructor) trece prin ea: un ordin VIU (queued/running) cu aceeași amprentă
// → NU se naște al doilea; se întoarce id-ul celui viu (depunerea e
// idempotentă, apelantul află că ordinul EXISTĂ). Un ordin încheiat (done/
// failed) NU blochează — „reia"-ul deliberat al ownerului rămâne posibil.
export interface CreateBuildJobResult {
  id: number
  created: boolean
  status: BuildJob['status']
}

export async function createBuildJob(orderedBy: string, orderText: string): Promise<CreateBuildJobResult> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  const accountKey = userKey(orderedBy)
  if (!accountKey) throw new Error('constructor_identity_invalid')
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    // Aceeași frontieră per cont este luată și de ștergerea GDPR. După lock,
    // sesiunea autentificată trebuie să existe încă: dacă erasure-ul a câștigat
    // cursa, DELETE-ul sesiunii este deja vizibil și niciun ordin cu PII nu mai
    // poate fi inserat după receiptul de ștergere.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`constructor-account:${accountKey}`])
    // Intake-ul Constructor are debit redus și cere unicitate, nu throughput de
    // mii de inserări. Lock-ul tranzacțional închide cursa SELECT -> INSERT între
    // două submituri simultane, inclusiv pentru reformulări cu amprente diferite.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('constructor:create-build-job'))")
    const identity = await client.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM auth_sessions
          WHERE lower(email)=$1 AND revoked_at IS NULL AND expires_at > now()
       ) AS active`,
      [accountKey],
    )
    if (identity.rows[0]?.active !== true) throw new Error('constructor_identity_erased_or_inactive')
    const vii = await client.query<{ id: string | number; order_text: string; status: BuildJob['status'] }>(
      `SELECT id, order_text, status FROM build_jobs
        WHERE status IN ('queued','running') ORDER BY id DESC`,
    )
    const amp = amprentaOrdin(orderText)
    const dublura = vii.rows.find((rand) => amprentaOrdin(rand.order_text) === amp)
    if (dublura) {
      console.error(`[ORDINE] dublură refuzată: ordinul #${dublura.id} e VIU cu aceeași amprentă — nu se naște al doilea (depus de ${orderedBy})`)
      await client.query('COMMIT')
      return { id: Number(dublura.id), created: false, status: dublura.status }
    }
    // Același SUBIECT în alte cuvinte (16 aug, tripleta #334/#335/#338):
    const geaman = vii.rows.find((rand) => seamanaOrdinele(rand.order_text, orderText))
    if (geaman) {
      console.error(`[ORDINE] același subiect refuzat: ordinul #${geaman.id} e VIU pe aceeași temă (cuvinte comune peste prag) — nu se naște al doilea (depus de ${orderedBy})`)
      await client.query('COMMIT')
      return { id: Number(geaman.id), created: false, status: geaman.status }
    }
    const r = await client.query<{ id: string | number }>(
      'INSERT INTO build_jobs (ordered_by, order_text, brain) VALUES ($1, $2, $3) RETURNING id',
      [accountKey, orderText, CONSTRUCTOR_LOCAL_ACTOR],
    )
    await client.query('COMMIT')
    const id = Number(r.rows[0]?.id ?? 0)
    if (!id) throw new Error('constructor_create_missing_id')
    return { id, created: true, status: 'queued' }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Câte ordine sunt ACTIVE (în coadă sau în lucru) de la un depunător anume.
 *  Zgarda „un doctor pe pacient" (owner, 14 aug: „setezi 1 singur ordin identic,
 *  că deschide ZECI"): auto-vindecarea nu mai depune un ordin nou pe o sursă cât
 *  timp cel dinainte încă lucrează — aceeași cauză născuse #235/#236/#237/#248,
 *  fiecare pe ~1M tokeni. */
export async function activeBuildJobsByScope(orderedBy: string): Promise<number> {
  if (!dbEnabled()) return 0
  try {
    const r = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM build_jobs
       WHERE ordered_by = $1 AND status IN ('queued','running')`,
      [orderedBy.toLowerCase()],
    )
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return 0
  }
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

interface ConstructorIncidentDbRow {
  id: string | number
  job_id: string | number
  fingerprint: string
  state: string
  stage: string
  cause_code: string
  cause_summary: string
  evidence: string
  responsible: string
  next_action: string
  verification: string | null
  lesson: string | null
  recurrence_count: number
  strategy: unknown | null
  strategy_action_fingerprint: string | null
  strategy_evidence_fingerprint: string | null
  strategy_decision_count: number
  strategy_pending: boolean
  opened_at: Date
  updated_at: Date
  closed_at: Date | null
}

function rowToConstructorIncident(row: ConstructorIncidentDbRow): ConstructorIncident {
  const parsedStrategy = row.strategy
    ? parseConstructorStrategy(JSON.stringify(row.strategy))
    : null
  const states: ConstructorIncidentState[] = ['open', 'diagnosing', 'repairing', 'blocked', 'verifying', 'closed']
  const causes: ConstructorCauseCode[] = [
    'semantic_non_code', 'provider_auth', 'provider_credit', 'ci_failure', 'test_failure',
    'build_failure', 'no_changes', 'timeout', 'brain_unavailable', 'unknown',
  ]
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
    fingerprint: row.fingerprint,
    state: states.includes(row.state as ConstructorIncidentState)
      ? row.state as ConstructorIncidentState
      : 'open',
    stage: row.stage,
    causeCode: causes.includes(row.cause_code as ConstructorCauseCode)
      ? row.cause_code as ConstructorCauseCode
      : 'unknown',
    causeSummary: row.cause_summary,
    evidence: row.evidence,
    responsible: row.responsible,
    nextAction: row.next_action,
    verification: row.verification,
    lesson: row.lesson,
    recurrenceCount: Number(row.recurrence_count),
    strategy: parsedStrategy?.ok ? parsedStrategy.strategy : null,
    strategyActionFingerprint: row.strategy_action_fingerprint,
    strategyEvidenceFingerprint: row.strategy_evidence_fingerprint,
    strategyDecisionCount: Number(row.strategy_decision_count ?? 0),
    strategyPending: Boolean(row.strategy_pending),
    openedAt: row.opened_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
  }
}

async function upsertConstructorIncident(
  client: pg.PoolClient,
  job: { id: number; orderText: string; log: string; progress: string; attempts: number },
): Promise<ConstructorIncident> {
  const analysis = classifyConstructorFailure(job.log, job.progress)
  const existingJobIncident = await client.query<{ fingerprint: string }>(
    'SELECT fingerprint FROM constructor_incidents WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 1',
    [job.id],
  )
  const fingerprint = existingJobIncident.rows[0]?.fingerprint ?? (amprentaOrdin(job.orderText) || `job:${job.id}`)
  const evidence = (job.log.trim() || '[failure report contained no log]').slice(-4000)
  const result = await client.query<ConstructorIncidentDbRow>(
    `INSERT INTO constructor_incidents
       (job_id, fingerprint, state, stage, cause_code, cause_summary, evidence, responsible, next_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (fingerprint) DO UPDATE SET
       job_id = EXCLUDED.job_id,
       state = EXCLUDED.state,
       stage = EXCLUDED.stage,
       cause_code = EXCLUDED.cause_code,
       cause_summary = EXCLUDED.cause_summary,
       evidence = EXCLUDED.evidence,
       responsible = EXCLUDED.responsible,
       next_action = EXCLUDED.next_action,
       strategy = CASE WHEN constructor_incidents.job_id <> EXCLUDED.job_id THEN NULL ELSE constructor_incidents.strategy END,
       strategy_action_fingerprint = CASE WHEN constructor_incidents.job_id <> EXCLUDED.job_id THEN NULL ELSE constructor_incidents.strategy_action_fingerprint END,
       strategy_evidence_fingerprint = CASE WHEN constructor_incidents.job_id <> EXCLUDED.job_id THEN NULL ELSE constructor_incidents.strategy_evidence_fingerprint END,
       strategy_pending = CASE WHEN constructor_incidents.job_id <> EXCLUDED.job_id THEN false ELSE constructor_incidents.strategy_pending END,
       verification = NULL,
       closed_at = NULL,
       opened_at = CASE WHEN constructor_incidents.state = 'closed' THEN now() ELSE constructor_incidents.opened_at END,
       recurrence_count = constructor_incidents.recurrence_count +
         CASE WHEN constructor_incidents.job_id <> EXCLUDED.job_id THEN 1 ELSE 0 END,
       updated_at = now()
     RETURNING *`,
    [
      job.id, fingerprint, analysis.state, analysis.stage, analysis.causeCode,
      analysis.causeSummary, evidence, analysis.responsible, analysis.nextAction,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`incident_upsert_failed:${job.id}`)
  return rowToConstructorIncident(row)
}

export interface ConstructorIncidentKnowledge {
  open: ConstructorIncident[]
  lessons: string[]
}

/** Knowledge base for the MAPE-K brain loop. `null` means unreadable, never
 * "zero incidents". Open cases and verified lessons are fetched together. */
export async function getConstructorIncidentKnowledge(
  limit = 8,
): Promise<ConstructorIncidentKnowledge | null> {
  if (!dbEnabled()) return null
  try {
    const [openRows, lessonRows] = await Promise.all([
      getPool().query<ConstructorIncidentDbRow>(
        `SELECT * FROM constructor_incidents
         WHERE state <> 'closed' ORDER BY updated_at ASC LIMIT $1`,
        [Math.max(1, Math.min(limit, 20))],
      ),
      getPool().query<{ lesson: string }>(
        `SELECT lesson FROM constructor_incidents
         WHERE state = 'closed' AND lesson IS NOT NULL AND lesson <> ''
         ORDER BY closed_at DESC NULLS LAST LIMIT 5`,
      ),
    ])
    return {
      open: openRows.rows.map(rowToConstructorIncident),
      lessons: lessonRows.rows.map((row) => row.lesson).filter(Boolean),
    }
  } catch {
    return null
  }
}

/** Read the durable escalation attached to one Constructor job. `null` is an
 * actual absence; callers must keep a DB read error distinct from no incident. */
export async function getConstructorIncidentForJob(jobId: number): Promise<ConstructorIncident | null> {
  if (!dbEnabled() || !Number.isSafeInteger(jobId) || jobId <= 0) return null
  try {
    const result = await getPool().query<ConstructorIncidentDbRow>(
      `SELECT * FROM constructor_incidents WHERE job_id=$1
       ORDER BY updated_at DESC LIMIT 1`,
      [jobId],
    )
    return result.rows[0] ? rowToConstructorIncident(result.rows[0]) : null
  } catch {
    return null
  }
}

/** Citește ultima escaladare pentru un lot de joburi într-o singură interogare.
 * `null` înseamnă registru necitibil; valorile `null` din Map înseamnă absență
 * măsurată și nu sunt confundate cu o eroare de DB. */
export async function getConstructorIncidentsForJobs(
  jobIds: readonly number[],
): Promise<Map<number, ConstructorIncident | null> | null> {
  if (!dbEnabled()) return null
  const ids = [...new Set(jobIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  const result = new Map<number, ConstructorIncident | null>(ids.map((id) => [id, null]))
  if (ids.length === 0) return result
  try {
    const rows = await getPool().query<ConstructorIncidentDbRow>(
      `SELECT DISTINCT ON (job_id) * FROM constructor_incidents
        WHERE job_id = ANY($1::bigint[])
        ORDER BY job_id, updated_at DESC, id DESC`,
      [ids],
    )
    for (const row of rows.rows) result.set(Number(row.job_id), rowToConstructorIncident(row))
    return result
  } catch {
    return null
  }
}

export async function updateConstructorIncident(
  id: number,
  fields: {
    state: 'diagnosing' | 'repairing' | 'blocked' | 'verifying'
    stage?: string
    causeCode?: ConstructorCauseCode
    causeSummary?: string
    evidence: string
    nextAction: string
    lesson?: string
    strategy?: ConstructorStrategy
    strategyActionFingerprint?: string
    strategyEvidenceFingerprint?: string
    strategyPending?: boolean
  },
): Promise<{ ok: true; incident: ConstructorIncident } | { ok: false; error: string }> {
  if (!dbEnabled()) return { ok: false, error: 'incident_register_unreadable' }
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'incident_id_invalid' }
  const evidence = String(fields.evidence ?? '').trim()
  const nextAction = String(fields.nextAction ?? '').trim()
  if (evidence.length < 10 || nextAction.length < 10) {
    return { ok: false, error: 'evidence_and_next_action_required' }
  }
  const allowedCauses: ConstructorCauseCode[] = [
    'semantic_non_code', 'provider_auth', 'provider_credit', 'ci_failure', 'test_failure',
    'build_failure', 'no_changes', 'timeout', 'brain_unavailable', 'unknown',
  ]
  const causeCode = fields.causeCode && allowedCauses.includes(fields.causeCode)
    ? fields.causeCode
    : undefined
  try {
    const result = await getPool().query<ConstructorIncidentDbRow>(
      `UPDATE constructor_incidents SET
         state=$2,
         stage=COALESCE(NULLIF($3,''), stage),
         cause_code=COALESCE($4, cause_code),
         cause_summary=COALESCE(NULLIF($5,''), cause_summary),
         evidence=$6,
         next_action=$7,
         lesson=COALESCE(NULLIF($8,''), lesson),
         strategy=COALESCE($9::jsonb, strategy),
         strategy_action_fingerprint=COALESCE(NULLIF($10,''), strategy_action_fingerprint),
         strategy_evidence_fingerprint=COALESCE(NULLIF($11,''), strategy_evidence_fingerprint),
         strategy_decision_count=strategy_decision_count + CASE WHEN $9::jsonb IS NULL THEN 0 ELSE 1 END,
         strategy_pending=COALESCE($12, strategy_pending),
         updated_at=now()
       WHERE id=$1 AND state <> 'closed'
       RETURNING *`,
      [
        id, fields.state, String(fields.stage ?? '').slice(0, 120), causeCode ?? null,
        String(fields.causeSummary ?? '').slice(0, 1000), evidence.slice(-4000),
        nextAction.slice(0, 1000), String(fields.lesson ?? '').slice(0, 4000),
        fields.strategy ? JSON.stringify(fields.strategy) : null,
        String(fields.strategyActionFingerprint ?? '').slice(0, 80),
        String(fields.strategyEvidenceFingerprint ?? '').slice(0, 80),
        fields.strategyPending ?? null,
      ],
    )
    const row = result.rows[0]
    return row
      ? { ok: true, incident: rowToConstructorIncident(row) }
      : { ok: false, error: 'incident_missing_or_closed' }
  } catch {
    return { ok: false, error: 'incident_register_unreadable' }
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

// Workerul ia un singur ordin, iar acel ordin rămâne unica execuție activă până
// la dovada live sau un rezultat terminal. Claim-ul persistă profilul ales
// manual înainte de execuție; watchdog-ul nu îl schimbă și nu îl reîncearcă.
export type ClaimNextBuildJobResult =
  | { state: 'claimed'; job: BuildJob }
  | { state: 'pipeline_active' | 'no_claimable_job'; job: null }

export async function claimNextBuildJob(
  codexTaskId: string,
  executionProfile: ConstructorExecutionProfile,
): Promise<ClaimNextBuildJobResult> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!codexTaskId || (executionProfile !== 'fast' && executionProfile !== 'powerful')) {
    throw new Error('constructor_claim_profile_invalid')
  }
  await deblocheazaJoburileClaimate()
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    // Serializarea este globală fiindcă ordinea următoare trebuie bazată pe
    // masterul produs de cea anterioară, nu pe un vârf devenit stale în paralel.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('constructor:claim-build-job'))")
    const r = await client.query<BuildJobDbRow>(
       `UPDATE build_jobs SET status='running', attempts = attempts + 1,
          codex_task_id=$1, constructor_stage='claimed', retry_not_before=NULL,
          execution_profile=$3,
          progress=CASE WHEN progress='external_action_required'
            THEN 'external_probe_started' ELSE 'worker_claimed' END,
          progress_at=now(), brain=$2, updated_at = now()
       WHERE id = (
         SELECT candidate.id FROM build_jobs candidate
         WHERE candidate.status='queued'
           AND candidate.arhivat=false
           AND (candidate.retry_not_before IS NULL OR candidate.retry_not_before <= now())
           AND NOT EXISTS (SELECT 1 FROM build_jobs active WHERE active.status='running')
         ORDER BY candidate.created_at LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED
       )
       RETURNING *`,
      [codexTaskId.slice(0, 200), CONSTRUCTOR_LOCAL_ACTOR, executionProfile],
    )
    if (r.rows[0]) {
      // Un probe programat după backoff nu mai este descris ca „așteaptă
      // extern” în timp ce workerul lucrează efectiv.
      await client.query(
        `UPDATE constructor_incidents
            SET state='repairing', stage='worker_probe',
                evidence=left(evidence || E'\\n[automatic_probe_started_after_backoff]', 4000),
                next_action='Workerul verifică din nou condiția externă; rezultatul probei va decide următorul backoff.',
                verification=NULL, closed_at=NULL, updated_at=now()
          WHERE job_id=$1 AND state='blocked'`,
        [r.rows[0].id],
      )
    }
    let result: ClaimNextBuildJobResult
    if (r.rows[0]) {
      result = { state: 'claimed', job: rowToBuildJob(r.rows[0]) }
    } else {
      // Un UPDATE fără rând poate însemna fie coadă goală/backoff, fie
      // faptul că un job este deja running. Contractul workerului nu le poate
      // comprima într-un 204: după un claim COMMIT al cărui răspuns s-a pierdut,
      // acel 204 ar suprascrie degraded cu un heartbeat ready fals. Măsurăm
      // motivul în aceeași tranzacție și sub același advisory lock.
      const active = await client.query<{ active: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM build_jobs WHERE status='running') AS active",
      )
      result = {
        state: active.rows[0]?.active === true ? 'pipeline_active' : 'no_claimable_job',
        job: null,
      }
    }
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

// ── WATCHDOG SERVER-SIDE, INDEPENDENT DE LUCRĂTOR ───────────────────────────
// Un worker tăcut nu este o invitație la o a doua execuție. După pragul măsurat
// jobul devine un eșec tehnic terminal pe ACELAȘI profil persistat la claim.
// execution_cycle, attempts și codex_task_id rămân dovezi ale acelei execuții;
// numai comanda explicită Reia poate crea ciclul următor.
export async function deblocheazaJoburileClaimate(): Promise<{ terminalizate: number }> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('constructor:claim-build-job'))")
    const stale = await client.query<BuildJobDbRow>(
      `SELECT * FROM build_jobs
        WHERE status='running'
          AND constructor_stage IN ('claimed','accepted','working')
          AND updated_at < now() - interval '${MIN_JOB_BLOCAT} minutes'
        ORDER BY id
        FOR UPDATE`,
    )
    let terminalizate = 0
    for (const row of stale.rows) {
      const profile = row.execution_profile === 'fast' || row.execution_profile === 'powerful'
        ? row.execution_profile
        : null
      const failure = profile
        ? constructorWorkerTechnicalFailureRecord('execution_timeout', profile)
        : {
            evidence: 'worker_failure:worker_internal_failure;profile=unrecorded',
            progress: 'technical_failure',
          }
      const updated = await client.query<BuildJobDbRow>(
        `UPDATE build_jobs SET
           status='failed', constructor_stage='failed', progress=$2,
           retry_not_before=NULL, log=$3, progress_at=now(), updated_at=now()
         WHERE id=$1 AND status='running'
         RETURNING *`,
        [row.id, failure.progress, failure.evidence],
      )
      const failedRow = updated.rows[0]
      if (!failedRow) continue
      await upsertConstructorIncident(client, {
        id: Number(failedRow.id),
        orderText: failedRow.order_text,
        log: failedRow.log ?? failure.evidence,
        progress: failedRow.progress ?? failure.progress,
        attempts: Number(failedRow.attempts),
      })
      terminalizate++
    }
    await client.query('COMMIT')
    return { terminalizate }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
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
      `SELECT b.*,
              (b.status IN ('done','failed','cancelled')
                AND b.constructor_stage <> 'deployed'
                AND NOT EXISTS (SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id)
              ) AS deletable,
              (b.status IN ('failed','cancelled')
                AND b.erasure_request_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id)
              ) AS retryable
         FROM build_jobs b WHERE b.arhivat = false
        ORDER BY CASE WHEN status='running' THEN 0 WHEN status='queued' THEN 1 ELSE 2 END,
                 CASE WHEN status IN ('done','failed','cancelled') THEN updated_at ELSE created_at END DESC,
                 id DESC
        LIMIT $1`,
      [limit],
    )
    return r.rows.map(rowToBuildJob)
  } catch {
    return null
  }
}

/** Arhiva este recuperabilă numai prin această listare explicită; nu este
 * amestecată cu munca activă și nu poate fi confundată cu o coadă goală. */
export interface ArchivedBuildJobsCursor {
  updatedAt: string
  id: number
}

export interface ArchivedBuildJobsPage {
  jobs: BuildJob[]
  nextCursor: ArchivedBuildJobsCursor | null
}

const ARCHIVE_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export function isArchivedBuildJobsCursorTimestamp(value: string): boolean {
  return ARCHIVE_CURSOR_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
}

export async function listArchivedBuildJobs(
  limit = 40,
  cursor?: ArchivedBuildJobsCursor,
): Promise<ArchivedBuildJobsPage> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
  const hasCursor = cursor !== undefined
  if (hasCursor && (
    !Number.isSafeInteger(cursor.id)
    || cursor.id <= 0
    || !isArchivedBuildJobsCursorTimestamp(cursor.updatedAt)
  )) throw new Error('constructor_archive_cursor_invalid')
  const result = await getPool().query<BuildJobDbRow & { updated_at_cursor: string }>(
    `SELECT b.*,
            to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_cursor
       FROM build_jobs b WHERE b.arhivat=true
      ${hasCursor ? 'AND (updated_at, id) < ($2::timestamptz, $3::bigint)' : ''}
      ORDER BY b.updated_at DESC, b.id DESC LIMIT $1`,
    hasCursor
      ? [safeLimit + 1, cursor.updatedAt, cursor.id]
      : [safeLimit + 1],
  )
  const hasMore = result.rows.length > safeLimit
  const visible = result.rows.slice(0, safeLimit)
  const last = visible.at(-1)
  return {
    jobs: visible.map(rowToBuildJob),
    nextCursor: hasMore && last
      ? { updatedAt: last.updated_at_cursor, id: Number(last.id) }
      : null,
  }
}

export type RestoreBuildJobResult =
  | { ok: true; job: BuildJob }
  | { ok: false; error: 'not_found' | 'stale_state' | 'not_restorable' }

export async function restoreArchivedBuildJob(
  id: number,
  expected: BuildJobMutationExpectation,
): Promise<RestoreBuildJobResult> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'not_found' }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const selected = await client.query<BuildJobDbRow>(
      'SELECT * FROM build_jobs WHERE id=$1 FOR UPDATE',
      [id],
    )
    const current = selected.rows[0]
    if (!current) {
      await client.query('COMMIT')
      return { ok: false, error: 'not_found' }
    }
    if (current.status !== expected.status || current.updated_at.toISOString() !== expected.updatedAt) {
      await client.query('COMMIT')
      return { ok: false, error: 'stale_state' }
    }
    if (!current.arhivat || !['done', 'failed', 'cancelled'].includes(current.status)) {
      await client.query('COMMIT')
      return { ok: false, error: 'not_restorable' }
    }
    const updated = await client.query<BuildJobDbRow>(
      'UPDATE build_jobs SET arhivat=false, updated_at=now() WHERE id=$1 RETURNING *',
      [id],
    )
    await client.query('COMMIT')
    return updated.rows[0]
      ? { ok: true, job: rowToBuildJob(updated.rows[0]) }
      : { ok: false, error: 'not_found' }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Lookup țintit pentru acțiuni Admin; absența este null, iar o citire DB
 * eșuată aruncă și nu poate fi prezentată drept „job inexistent”. */
export async function getBuildJobById(id: number): Promise<BuildJob | null> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const result = await getPool().query<BuildJobDbRow>(
    'SELECT * FROM build_jobs WHERE id=$1 AND arhivat=false',
    [id],
  )
  return result.rows[0] ? rowToBuildJob(result.rows[0]) : null
}

/** AUTO-ARHIVARE (K9 + K13): ordinele TERMINATE (done/failed) mai vechi de
 *  `zile` se marchează arhivate — ies din panou, rămân în DB. Nu atinge niciodată
 *  ordinele vii (queued/running). Întoarce câte a arhivat. Rulată de bucla de
 *  autonomie (curățenie automată, „când e gata"). */
/** Arhivează UN ordin (P7): mătura PR-urilor îmbinate îl scoate din listă în
 *  clipa în care merge-ul e CONFIRMAT pe GitHub — nu la timerul de o zi.
 *  `true` doar dacă rândul chiar s-a schimbat (măsurat, nu presupus). */
export async function arhiveazaBuildJob(id: number): Promise<boolean> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!Number.isInteger(id) || id <= 0) return false
  const r = await getPool().query(
    `UPDATE build_jobs SET arhivat=true, updated_at=now()
      WHERE id=$1 AND arhivat=false AND status IN ('done','failed','cancelled')`,
    [id],
  )
  return (r.rowCount ?? 0) > 0
}

export async function arhiveazaBuildJobsVechi(zile = 1): Promise<number> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  const z = Math.max(1, Math.min(90, Math.round(zile) || 1))
  const r = await getPool().query(
      `UPDATE build_jobs SET arhivat=true, updated_at=now()
        WHERE arhivat = false
          AND status IN ('done','failed','cancelled')
          AND updated_at < now() - ($1 || ' days')::interval`,
      [z],
  )
  return r.rowCount ?? 0
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

export type CodexBuildEvent =
  | { event: 'accepted'; progress?: string }
  | { event: 'progress'; progress: string }
  | { event: 'failed'; progress?: string; code: CodexWorkerFailureCode; profile: ConstructorExecutionProfile }
  | { event: 'unresolved'; progress?: string; reason: ConstructorExecutionUnresolvedReason; profile: ConstructorExecutionProfile }

export const CODEX_WORKER_FAILURE_CODES = [
  'execution_timeout',
  'brain_unavailable',
  'worker_internal_failure',
] as const
export type CodexWorkerFailureCode = typeof CODEX_WORKER_FAILURE_CODES[number]

export function isCodexWorkerFailureCode(value: string): value is CodexWorkerFailureCode {
  return (CODEX_WORKER_FAILURE_CODES as readonly string[]).includes(value)
}

const CODEx_STAGE_ORDER: Record<string, number> = {
  claimed: 1,
  accepted: 2,
  working: 3,
  unresolved: 99,
  failed: 99,
}

/**
 * Avansează exclusiv etapele de execuție ale workerului. Handoff-ul, PR-ul,
 * merge-ul și release-ul au tranzacții și identități HMAC separate.
 */
export async function advanceCodexBuildJob(id: number, taskId: string, input: CodexBuildEvent): Promise<BuildJob | null> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0 || !taskId) return null
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const current = await client.query<BuildJobDbRow>('SELECT * FROM build_jobs WHERE id=$1 AND arhivat=false FOR UPDATE', [id])
    const row = current.rows[0]
    if (!row || row.codex_task_id !== taskId || row.status !== 'running') {
      await client.query('ROLLBACK')
      return null
    }
    const previous = row.constructor_stage ?? 'claimed'
    if (
      (input.event === 'failed' || input.event === 'unresolved')
      && row.execution_profile !== null
      && row.execution_profile !== undefined
      && row.execution_profile !== input.profile
    ) {
      await client.query('ROLLBACK')
      return null
    }
    const target = input.event === 'progress' ? 'working' : input.event
    const prevRank = CODEx_STAGE_ORDER[previous] ?? 0
    const targetRank = CODEx_STAGE_ORDER[target] ?? 0
    const exactPredecessor: Partial<Record<CodexBuildEvent['event'], string[]>> = {
      accepted: ['claimed'],
      progress: ['accepted', 'working'],
      // Un rezultat `unresolved` dovedește o execuție reală numai după ACK-ul
      // claimului sau după heartbeatul de lucru. Din `claimed`, singura ieșire
      // terminală permisă rămâne eșecul tehnic/watchdog.
      unresolved: ['accepted', 'working'],
      failed: ['claimed', 'accepted', 'working'],
    }
    const allowedPrevious = exactPredecessor[input.event]
    const idempotent = previous === target
    if ((!idempotent && allowedPrevious && !allowedPrevious.includes(previous)) || (!idempotent && targetRank <= prevRank && input.event !== 'failed')) {
      await client.query('ROLLBACK')
      return null
    }
    const progress = (input.progress ?? target).trim().slice(0, 500)
    const terminal = input.event === 'failed' || input.event === 'unresolved'
    const failure = input.event === 'failed'
      ? constructorWorkerTechnicalFailureRecord(input.code, input.profile)
      : input.event === 'unresolved'
        ? constructorWorkerUnresolvedRecord(input.reason, input.profile)
        : null
    const updated = await client.query<BuildJobDbRow>(
      `UPDATE build_jobs SET
         status=CASE WHEN $3 THEN 'failed' ELSE status END,
         constructor_stage=$2,
         progress=$4,
         retry_not_before=CASE WHEN $3 THEN NULL ELSE retry_not_before END,
         progress_at=now(),
         log=CASE WHEN $3 THEN $5 ELSE log END,
         brain=$6,
         execution_profile=CASE WHEN $3 AND execution_profile IS NULL THEN $7 ELSE execution_profile END,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        id,
        target,
        terminal,
        failure?.progress ?? progress,
        failure?.evidence ?? null,
        CONSTRUCTOR_LOCAL_ACTOR,
        input.event === 'failed' || input.event === 'unresolved' ? input.profile : null,
      ],
    )
    const failedRow = updated.rows[0]
    if (terminal && failedRow) {
      await upsertConstructorIncident(client, {
        id: Number(failedRow.id),
        orderText: failedRow.order_text,
        log: failedRow.log ?? '[worker failure contained no log]',
        progress: failedRow.progress ?? '',
        attempts: Number(failedRow.attempts),
      })
    }
    await client.query('COMMIT')
    return updated.rows[0] ? rowToBuildJob(updated.rows[0]) : null
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// Leagă identificatorul opac al workerului separat de ordin. Valoarea nu este
// secret și nu poate fi folosită pentru autentificare.
export async function setCodexTaskId(id: number, taskId: string): Promise<void> {
  if (!dbEnabled() || !Number.isInteger(id) || id <= 0) return
  try {
    await getPool().query(
      `UPDATE build_jobs SET codex_task_id=$2, constructor_stage='accepted', updated_at=now()
       WHERE id=$1 AND status='running'`,
      [id, taskId.slice(0, 200)],
    )
  } catch (e) {
    console.error('[codex-worker] setCodexTaskId a picat:', String(e).slice(0, 160))
  }
}

// Cel mai vechi ordin ÎN LUCRU. Workerul separat este singurul care îl avansează.
export async function getOldestRunningBuildJob(): Promise<BuildJob | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<BuildJobDbRow>(
      `SELECT * FROM build_jobs WHERE status='running' AND arhivat=false ORDER BY created_at ASC LIMIT 1`,
    )
    return r.rows[0] ? rowToBuildJob(r.rows[0]) : null
  } catch {
    return null
  }
}

// The jobs for the LIVE DISPLAY on the monitor (Stage 4b): the active ones
// (queued / running) PLUS the RECENTLY finished (last 10 min). Without
// "recently finished", the panel would delete the job at the very moment it
// becomes "Done"/"Failed" — exactly the state Adrian wants to SEE. Active
// first, then by how recently they moved; a few, as many as fit on screen.
export async function listMonitorBuildJobs(): Promise<BuildJob[] | null> {
  if (!dbEnabled()) return null
  try {
    const r = await getPool().query<BuildJobDbRow>(
      `SELECT * FROM build_jobs
         WHERE arhivat=false
           AND (status IN ('queued','running')
             OR (status IN ('done','failed','cancelled') AND updated_at > now() - interval '10 minutes'))
       ORDER BY
         CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,
         COALESCE(progress_at, updated_at, created_at) DESC
       LIMIT 10`,
    )
    return r.rows.map(rowToBuildJob)
  } catch {
    return null
  }
}

// ── KELION POATE STĂPÂNI ORDINELE (Adrian, 3 aug: „kelion nu are instrument să
// modifice, să șteargă, sau să le șteargă în grup") ─────────────────────────
// Până acum putea DOAR să creeze (build_software) și să vadă (constructor_status).
// Acum poate și: să șteargă unul, să șteargă în GRUP (toate eșuate / toate
// terminate), să reia (opțional cu textul reformulat = „modifică"), și să
// anuleze unul în curs. Toate ADMIN-only, expuse prin unealta `constructor_manage`.

export interface BuildJobMutationExpectation {
  status: BuildJob['status']
  updatedAt: string
}

export type DeleteBuildJobResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_deletable' | 'stale_state' }

type BuildJobLookupFailure = { ok: false; error: 'not_found' | 'stale_state' }
type LockedBuildJobMutationRow = BuildJobDbRow & { has_pipeline_receipt: boolean }

async function withLockedBuildJobMutation<T>(
  id: number,
  expected: BuildJobMutationExpectation | undefined,
  operation: (client: pg.PoolClient, current: LockedBuildJobMutationRow) => Promise<T>,
): Promise<T | BuildJobLookupFailure> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'not_found' }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const selected = await client.query<LockedBuildJobMutationRow>(
      `SELECT b.*,
              EXISTS(SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id) AS has_pipeline_receipt
         FROM build_jobs b WHERE b.id=$1 AND b.arhivat=false FOR UPDATE OF b`,
      [id],
    )
    const current = selected.rows[0]
    let result: T | BuildJobLookupFailure
    if (!current) {
      result = { ok: false, error: 'not_found' }
    } else if (expected && (current.status !== expected.status || current.updated_at.toISOString() !== expected.updatedAt)) {
      result = { ok: false, error: 'stale_state' }
    } else {
      result = await operation(client, current)
    }
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Șterge DEFINITIV numai un rezultat terminal. Erorile DB sunt excepții și nu
 * pot fi prezentate drept conflict de stare. */
export async function deleteBuildJob(
  id: number,
  expected?: BuildJobMutationExpectation,
): Promise<DeleteBuildJobResult> {
  return withLockedBuildJobMutation<DeleteBuildJobResult>(id, expected, async (client, current) => {
    if (!['failed', 'done', 'cancelled'].includes(current.status)) {
      return { ok: false, error: 'not_deletable' }
    }
    // Ledgerul merge/CI/build/deploy este dovadă operațională, nu decor de UI.
    // Un rezultat cu receipts se poate ascunde numai prin arhivare recuperabilă.
    if (current.has_pipeline_receipt || current.constructor_stage === 'deployed') {
      return { ok: false, error: 'not_deletable' }
    }
    const removed = await client.query('DELETE FROM build_jobs WHERE id=$1', [id])
    return (removed.rowCount ?? 0) === 1
      ? { ok: true }
      : { ok: false, error: 'not_found' }
  })
}

/** Ștergere în GRUP după stare. `scope`: 'failed' (doar eșuate), 'done' (doar
 *  terminate), 'failed_done' (eșuate + terminate + anulate), 'all' (tot
 *  ISTORICUL). NICIUN scope nu atinge VREODATĂ ordinele VII ('queued'/'running')
 *  — un ordin la care ownerul așteaptă NU se șterge într-o curățare în grup.
 *  Întoarce câte a șters. */
// OWNER, 20 aug: „a avut multe ordine de lucru și au dispărut, le-a șters când a
// trecut forțat pe bani." Cauza: 'all' rula un `DELETE FROM build_jobs` GOL, care
// mătura și ordinele 'queued'/'running' (munca în așteptare), nu doar istoricul —
// exact regula #3 (nicio operație în masă pe ceva ce nu s-ai uitat). GARD PERMANENT:
// ștergerea în grup exclude MEREU ordinele vii (NOT IN queued/running). Un ordin viu
// se poate șterge DOAR țintit, pe id (deleteBuildJob) — o alegere explicită, un ordin.
// AUDIT ADMIN (3 aug): la eroare de DB întorcea 0 → panoul afișa „Curățat: 0
// ordine șterse." ca rezultat măsurat, deși ștergerea nu rulase deloc (zeroul
// fals interzis de regula #1). null = eșec (ruta răspunde 500); 0 rămâne
// posibil DOAR ca număr real de rânduri șterse.
export interface BuildJobDeletionSnapshot extends BuildJobMutationExpectation {
  id: number
}

export type ArchiveBuildJobsResult =
  | { ok: true; archived: number }
  | { ok: false; error: 'stale_state' }

export async function archiveBuildJobsByScope(
  scope: 'failed' | 'done' | 'failed_done' | 'all',
  expected: readonly BuildJobDeletionSnapshot[],
): Promise<ArchiveBuildJobsResult> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  // Stările de ISTORIC pe scope. Ordinele VII (queued/running) lipsesc din TOATE —
  // niciun grup nu le poate atinge, nici măcar 'all'.
  const stariCurente: Record<typeof scope, string[]> = {
    failed: ['failed'],
    done: ['done'],
    failed_done: ['failed', 'done', 'cancelled'],
    all: ['failed', 'done', 'cancelled'], // „tot" = tot ISTORICUL, nu munca vie
  }
  const ids = expected.map((item) => item.id)
  if (new Set(ids).size !== ids.length || expected.length > 40) return { ok: false, error: 'stale_state' }
  if (expected.length === 0) return { ok: true, archived: 0 }
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    const selected = await client.query<{
      id: string | number
      status: BuildJob['status']
      updated_at: Date
      arhivat: boolean
    }>(
      'SELECT id, status, updated_at, arhivat FROM build_jobs WHERE id = ANY($1::bigint[]) FOR UPDATE',
      [ids],
    )
    const current = new Map(selected.rows.map((row) => [Number(row.id), row]))
    const allowed = new Set(stariCurente[scope])
    const matches = expected.every((item) => {
      const row = current.get(item.id)
      return row
        && row.arhivat === false
        && row.status === item.status
        && allowed.has(row.status)
        && row.updated_at.toISOString() === item.updatedAt
    })
    if (!matches || current.size !== expected.length) {
      await client.query('COMMIT')
      return { ok: false, error: 'stale_state' }
    }
    const archived = await client.query(
      `UPDATE build_jobs SET arhivat=true, updated_at=now()
        WHERE id = ANY($1::bigint[]) AND arhivat=false AND status = ANY($2::text[])`,
      [ids, stariCurente[scope]],
    )
    if ((archived.rowCount ?? 0) !== expected.length) throw new Error('constructor_bulk_archive_count_mismatch')
    await client.query('COMMIT')
    return { ok: true, archived: archived.rowCount ?? 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Reia un ordin (îl repune în coadă). Opțional cu textul REFORMULAT — asta e
 *  „modificarea": schimbă comanda și o repornește curat (attempts=0). Întoarce
 *  jobul actualizat sau null.
 *
 *  Numai un rezultat terminal poate fi reluat explicit. Un job viu nu poate fi
 *  resetat concurent din Admin: dacă workerul tace, watchdogul îl închide mai
 *  întâi ca eșec tehnic terminal, fără retry; abia apoi ownerul poate folosi
 *  Reia. Astfel nu apar doi executori pe aceeași cerere și nu este mutat înapoi
 *  un job deja publicat. */
export type RetryBuildJobResult =
  | { ok: true; job: BuildJob }
  | { ok: false; error: 'not_retryable' | 'duplicate_active' | 'stale_state'; conflictJobId?: number }

export async function retryBuildJob(
  id: number,
  newOrderText?: string,
  expected?: BuildJobMutationExpectation,
): Promise<RetryBuildJobResult> {
  if (!dbEnabled()) throw new Error('constructor_db_unavailable')
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'not_retryable' }
  const text = (newOrderText ?? '').trim()
  const client = await conexiuneDb()
  try {
    await client.query('BEGIN')
    // Retry-ul trece prin aceeași ușă serializată ca un ordin nou; altfel două
    // clickuri sau o reformulare pot activa același subiect în paralel.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('constructor:create-build-job'))")
    const candidate = await client.query<BuildJobDbRow & { has_pipeline_receipt: boolean }>(
      `SELECT b.*,
              EXISTS(SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id) AS has_pipeline_receipt
         FROM build_jobs b WHERE b.id=$1 AND b.arhivat=false FOR UPDATE OF b`,
      [id],
    )
    const current = candidate.rows[0]
    if (!current) {
      await client.query('COMMIT')
      return { ok: false, error: 'not_retryable' }
    }
    if (expected && (current.status !== expected.status || current.updated_at.toISOString() !== expected.updatedAt)) {
      await client.query('COMMIT')
      return { ok: false, error: 'stale_state' }
    }
    if (!['failed', 'cancelled'].includes(current.status) || current.erasure_request_id != null) {
      await client.query('COMMIT')
      return { ok: false, error: 'not_retryable' }
    }
    // A pipeline row is an immutable publication/release ledger.  Retrying it
    // as a fresh implementation would erase receipts and may duplicate an
    // already-created PR, merge or deploy.  Such jobs need an explicit
    // retirement transition, never a generic Admin reset.
    if (current.has_pipeline_receipt) {
      await client.query('COMMIT')
      return { ok: false, error: 'not_retryable' }
    }
    const finalOrder = (text || current.order_text).slice(0, 12_000)
    const active = await client.query<{ id: string | number; order_text: string }>(
      `SELECT id, order_text FROM build_jobs
        WHERE id <> $1 AND status IN ('queued','running')
        ORDER BY id DESC`,
      [id],
    )
    const duplicate = active.rows.find((row) =>
      amprentaOrdin(row.order_text) === amprentaOrdin(finalOrder)
      || seamanaOrdinele(row.order_text, finalOrder),
    )
    if (duplicate) {
      await client.query('COMMIT')
      return { ok: false, error: 'duplicate_active', conflictJobId: Number(duplicate.id) }
    }
    const updated = await client.query<BuildJobDbRow>(
      `UPDATE build_jobs
          SET status='queued', attempts=0, execution_cycle=execution_cycle + 1, codex_task_id=NULL,
              execution_profile=NULL,
              constructor_stage='queued', ci=NULL, progress='owner_retry_scheduled',
              progress_at=now(), branch=NULL, pr_url=NULL, commit_sha=NULL,
              live_version=NULL, brain=NULL, retry_not_before=NULL,
              order_text=$2,
              log=COALESCE(log,'') || E'\\n[repus în coadă de owner${text ? ' cu ordin reformulat' : ''}]',
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [id, finalOrder],
    )
    await client.query(
      `UPDATE constructor_incidents
          SET state='repairing', stage='owner_retry',
              evidence=left(evidence || E'\\n[owner_retry_requested]', 4000),
              next_action='Workerul reia același ordin; verificarea trebuie să avanseze până la dovada live.',
              verification=NULL, closed_at=NULL, updated_at=now()
        WHERE job_id=$1`,
      [id],
    )
    await client.query('COMMIT')
    const row = updated.rows[0]
    if (!row) throw new Error('constructor_retry_update_missing')
    return { ok: true, job: rowToBuildJob(row) }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// (remediazaAutomatBuildJob — auto-remedierea la eșec HARD, pe calea /report a
// workerului local — a fost ȘTEARSĂ pe 22 aug: ruta /report + serviciul
// remediereEsec au fost eliminate. Un eșec este raportat factual, iar o reluare
// necesită o acțiune explicită; procesul web nu execută bucle locale de reparare.)

/** Anulează explicit un ordin în curs sau în coadă. `cancelled` este terminal,
 *  dar NU este eșec de execuție și nu deschide un incident fals. */
export type CancelBuildJobResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'past_boundary' | 'stale_state' }

export async function cancelBuildJob(
  id: number,
  expected?: BuildJobMutationExpectation,
): Promise<CancelBuildJobResult> {
  return withLockedBuildJobMutation<CancelBuildJobResult>(id, expected, async (client) => {
    const r = await client.query(
      `UPDATE build_jobs
         SET status='cancelled',
             constructor_stage='cancelled',
             codex_task_id=NULL,
             progress='cancelled_by_admin',
             retry_not_before=NULL,
             progress_at=now(),
             log = COALESCE(log,'') || E'\\n[anulat de owner]',
             updated_at = now()
       WHERE id=$1
         AND status IN ('queued','running')
         AND constructor_stage IN ('queued','claimed','accepted','working')`,
      [id],
    )
    if ((r.rowCount ?? 0) === 0) {
      return { ok: false, error: 'past_boundary' }
    }
    await client.query(
      `UPDATE constructor_incidents
          SET state='closed', stage='cancelled',
              verification='Ordin anulat explicit de administrator înainte de publicare.',
              lesson=NULL,
              next_action='Nicio acțiune automată; numai o reluare explicită poate redeschide ordinul.',
              closed_at=now(), updated_at=now()
        WHERE job_id=$1 AND state <> 'closed'`,
      [id],
    )
    return { ok: true }
  })
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
