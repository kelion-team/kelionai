// Sondă AUTONOMIE — starea măsurată a buclei + constructorului.
// Rulare (pe VPS, fără base64): docker cp .../autonomie.mjs kelionai-app:/tmp/s.mjs
//   && docker exec -w /app/backend kelionai-app node /tmp/s.mjs
// Citește DATABASE_URL din env-ul containerului. Zero secrete în fișier.
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const q = async (l, s) => {
  try { console.log(l, JSON.stringify((await c.query(s)).rows)) }
  catch (e) { console.log(l + '_ERR', String(e).slice(0, 130)) }
}
// Pașii misiunii (M0–M6), ultima trecere a buclei, pașii parcați (cu cauza).
await q('PAS', "SELECT key, value FROM kv_state WHERE key LIKE 'autonomie:pas:%' ORDER BY key")
await q('ULTIMA', "SELECT left(value,240) v, updated_at::text FROM kv_state WHERE key='autonomie:ultima'")
await q('PARCAT', "SELECT key, left(value,220) v FROM kv_state WHERE key LIKE 'autonomie:parcat:%' ORDER BY key")
// Joburile pornite de buclă (kelion%) + totalul pe status.
await q('JOBS_KELION', "SELECT id, status, attempts, (pr_url IS NOT NULL) has_pr, left(order_text,40) ord, extract(epoch from (now()-updated_at))::int sec FROM build_jobs WHERE lower(ordered_by) LIKE 'kelion%' ORDER BY id DESC LIMIT 8")
await q('JOBS_TOT', "SELECT status, count(*)::int n FROM build_jobs GROUP BY status")
// Enterprise (bonus): jurnalul cotei + măsurătorile.
await q('ENT_JURNAL', "SELECT right(value,500) v FROM kv_state WHERE key='enterprise:jurnal-cote'")
await q('ENT_MASUR', "SELECT value FROM kv_state WHERE key='enterprise:masuratori-creare'")
await c.end()
