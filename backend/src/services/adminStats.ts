import { config } from '../config.js'
import { conexiuneDb,getPool } from '../dbPool.js'

export interface AdminStatsBaseline { id:string; statsSince:string | null }
interface BaselineRow { id:string; statsSince:unknown }

/** Wire timestamps are UTC ISO; SQL consumers use id, never this millisecond
 * display value, so PostgreSQL's exact microsecond boundary stays unchanged. */
function baselineDto(row:BaselineRow | undefined):AdminStatsBaseline {
  if (!row) throw new Error('admin_stats_baseline_missing')
  if (row.statsSince === null) return {id:row.id,statsSince:null}
  if (!(row.statsSince instanceof Date) || !Number.isFinite(row.statsSince.getTime())
    || row.statsSince.getUTCFullYear()<0 || row.statsSince.getUTCFullYear()>9999) {
    throw new Error('admin_stats_baseline_invalid')
  }
  return {id:row.id,statsSince:row.statsSince.toISOString()}
}

export async function readAdminStatsBaseline(): Promise<AdminStatsBaseline> {
  if (!config.databaseUrl) throw new Error('admin_stats_unavailable')
  const result = await getPool().query<BaselineRow>(
    'SELECT id::text,stats_since AS "statsSince" FROM admin_stats_baselines ORDER BY id DESC LIMIT 1')
  return baselineDto(result.rows[0])
}

/** Serialize all reporting writers before taking the registration boundary.
 * The event's created_at may be an offline time or an older transaction's now();
 * message/cost readers therefore use their server-assigned stats_recorded_at.
 * No conversation, ledger, wallet, error, audit or raw counter is reset/deleted. */
export async function resetAdminStatsBaseline(): Promise<AdminStatsBaseline> {
  if (!config.databaseUrl) throw new Error('admin_stats_unavailable')
  const sql = await conexiuneDb()
  try {
    await sql.query('BEGIN')
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('admin:statistics-reset'))")
    await sql.query('LOCK TABLE messages,cost_events,user_presence_daily,visit_daily IN SHARE MODE')
    const result = await sql.query<BaselineRow>(
      'INSERT INTO admin_stats_baselines(stats_since) VALUES(clock_timestamp()) RETURNING id::text,stats_since AS "statsSince"')
    const baseline = baselineDto(result.rows[0])
    if (!baseline.statsSince) throw new Error('admin_stats_reset_unconfirmed')
    await sql.query(`INSERT INTO admin_stats_presence_baseline(baseline_id,user_email,day,actions)
      SELECT $1,user_email,day,actions FROM user_presence_daily
      WHERE day >= (SELECT stats_since::date FROM admin_stats_baselines WHERE id=$1)`,[baseline.id])
    await sql.query(`INSERT INTO admin_stats_visits_baseline(baseline_id,day,path,country_code,views)
      SELECT $1,day,path,country_code,views FROM visit_daily
      WHERE day >= (SELECT stats_since::date FROM admin_stats_baselines WHERE id=$1)`,[baseline.id])
    await sql.query(`INSERT INTO audit_log(actor,actiune,tabel,cheie,vechi,nou)
      SELECT 'admin','statistics-baseline','admin_stats_baselines',id::text,'historical evidence retained',stats_since::text
      FROM admin_stats_baselines WHERE id=$1`,[baseline.id])
    await sql.query('COMMIT')
    return baseline
  } catch (error) {
    await sql.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { sql.release() }
}
