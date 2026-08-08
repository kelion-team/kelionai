import pg from 'pg'
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})
const miau=await pool.query("SELECT agent,content,last_seen FROM memories WHERE content ILIKE '%miau%' ORDER BY last_seen DESC LIMIT 3")
console.log('MIAU rows:',JSON.stringify(miau.rows))
const recent=await pool.query("SELECT agent,content,last_seen FROM memories WHERE user_email='adrianenc11@gmail.com' ORDER BY last_seen DESC LIMIT 5")
console.log('RECENT memories:',JSON.stringify(recent.rows.map(r=>({a:r.agent,c:r.content.slice(0,60),t:r.last_seen}))))
await pool.end()
