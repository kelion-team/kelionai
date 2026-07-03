import pg from 'pg'
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})
const r=await pool.query(`SELECT id, agent, content, created_at::date AS d FROM memories
  WHERE content ~* 'birou|office|abingdon|adres|locuie|address|witney|barnet|oxford|londra|london|acasă|home'
  ORDER BY created_at DESC LIMIT 40`)
for(const x of r.rows) console.log(`#${x.id} [${x.agent}] (${x.d}) ${x.content}`)
console.log('TOTAL:', r.rows.length)
await pool.end()
