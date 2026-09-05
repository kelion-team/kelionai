import { config } from '../config.js'
import { conexiuneDb,getPool } from '../dbPool.js'

export interface AdminStatsBaseline { id:string; statsSince:string | null }
export async function readAdminStatsBaseline(): Promise<AdminStatsBaseline> {
  if (!config.databaseUrl) throw new Error('admin_stats_unavailable')
  const result = await getPool().query<{ id:string; statsSince:string | null }>(
    'SELECT id::text,stats_since::text AS "statsSince" FROM admin_stats_baselines ORDER BY id DESC LIMIT 1')
  const row = result.rows[0]
  if (!row) throw new Error('admin_stats_baseline_missing')
  return row
}

/** Serialize aggregate snapshots with their writers. No conversation, ledger,
 * wallet, error, audit, provider usage or raw counter is reset/deleted. */
export async function resetAdminStatsBaseline(): Promise<AdminStatsBaseline> {
  if (!config.databaseUrl) throw new Error('admin_stats_unavailable')
  const sql = await conexiuneDb()
  try {
    await sql.query('BEGIN')
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('admin:statistics-reset'))")
    await sql.query('LOCK TABLE user_presence_daily,visit_daily IN SHARE MODE')
    const result = await sql.query<AdminStatsBaseline>(
      'INSERT INTO admin_stats_baselines(stats_since) VALUES(clock_timestamp()) RETURNING id::text,stats_since::text AS "statsSince"')
    const baseline = result.rows[0]
    if (!baseline?.statsSince) throw new Error('admin_stats_reset_unconfirmed')
    await sql.query(`INSERT INTO admin_stats_presence_baseline(baseline_id,user_email,day,actions)
      SELECT $1,user_email,day,actions FROM user_presence_daily WHERE day >= $2::timestamptz::date`,[baseline.id,baseline.statsSince])
    await sql.query(`INSERT INTO admin_stats_visits_baseline(baseline_id,day,path,country_code,views)
      SELECT $1,day,path,country_code,views FROM visit_daily WHERE day >= $2::timestamptz::date`,[baseline.id,baseline.statsSince])
    await sql.query(`INSERT INTO audit_log(actor,actiune,tabel,cheie,vechi,nou)
      VALUES('admin','statistics-baseline','admin_stats_baselines',$1,'historical evidence retained',$2)`,[baseline.id,baseline.statsSince])
    await sql.query('COMMIT')
    return baseline
  } catch (error) {
    await sql.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { sql.release() }
}
