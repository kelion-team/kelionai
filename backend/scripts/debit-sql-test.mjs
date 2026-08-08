import pg from 'pg'
import fs from 'node:fs'
const {email}=JSON.parse(fs.readFileSync('C:/Users/adria/AppData/Local/Temp/claude/C--Users-adria--bob/32f3cf2d-34ac-4618-a578-464fbd8d21ae/scratchpad/sim.json','utf8'))
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})
try{
  const r=await pool.query(
    `INSERT INTO wallets (user_email, balance) VALUES ($1, -$2)
     ON CONFLICT (user_email) DO UPDATE SET balance = wallets.balance - $2, updated_at = now()`,
    [email, 0.029],
  )
  console.log('debit SQL OK, rows:',r.rowCount)
}catch(e){console.log('debit SQL ERROR:',e.message)}
const w=await pool.query('SELECT balance FROM wallets WHERE user_email=$1',[email])
console.log('balance now:',w.rows[0]?.balance)
await pool.end()
