import pg from 'pg'
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}})
// ONLY my synthetic test rows (fp-... prefixes from the curl tests). Real
// visitors have 32-char hex fingerprints and are never touched.
const del=await pool.query("DELETE FROM demo_uses WHERE fingerprint LIKE 'fp-%'")
console.log('synthetic test rows removed:',del.rowCount)
const left=await pool.query('SELECT COUNT(*) AS n FROM demo_uses')
console.log('real rows remaining:',left.rows[0].n)
await pool.end()
