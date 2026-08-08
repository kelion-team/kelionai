import pg from 'pg'
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})
const n=await pool.query("SELECT COUNT(*) AS n FROM memories WHERE user_email='adrianenc11@gmail.com' AND agent='kelion'")
const newer=await pool.query("SELECT COUNT(*) AS n FROM memories WHERE user_email='adrianenc11@gmail.com' AND agent='kelion' AND last_seen > (SELECT last_seen FROM memories WHERE content='Has a black cat named Miau' LIMIT 1)")
console.log('kelion memories total:',n.rows[0].n,'| newer than Miau:',newer.rows[0].n)
await pool.end()
