import pg from 'pg'
import fs from 'node:fs'
const {email}=JSON.parse(fs.readFileSync('C:/Users/adria/AppData/Local/Temp/claude/C--Users-adria--bob/32f3cf2d-34ac-4618-a578-464fbd8d21ae/scratchpad/sim.json','utf8'))
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})
const w=await pool.query('SELECT balance,topup_ref FROM wallets WHERE user_email=$1',[email])
console.log('wallet:',JSON.stringify(w.rows[0]))
const be=await pool.query("SELECT kind,amount,meta FROM billing_events WHERE user_email=$1 ORDER BY id",[email])
console.log('billing_events:',JSON.stringify(be.rows))
const ce=await pool.query("SELECT kind,cost_usd FROM cost_events WHERE user_email=$1",[email])
console.log('cost_events:',JSON.stringify(ce.rows))
await pool.end()
