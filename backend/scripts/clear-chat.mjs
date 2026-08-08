import pg from 'pg'
const url=process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
console.log('using public url:', !!process.env.DATABASE_PUBLIC_URL)
const pool=new pg.Pool({connectionString:url,ssl:{rejectUnauthorized:false}})
const before=await pool.query('SELECT COUNT(*) AS n FROM messages')
const del=await pool.query('DELETE FROM messages')
console.log('chat history cleared:',del.rowCount,'messages deleted (was',before.rows[0].n+')')
await pool.end()
