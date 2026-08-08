import pg from 'pg'
import fs from 'node:fs'
const {email,cookie}=JSON.parse(fs.readFileSync('C:/Users/adria/AppData/Local/Temp/claude/C--Users-adria--bob/32f3cf2d-34ac-4618-a578-464fbd8d21ae/scratchpad/sim.json','utf8'))
const B='https://kelionai.app'
const pool=new pg.Pool({connectionString:process.env.DATABASE_PUBLIC_URL,ssl:{rejectUnauthorized:false}})

// THRESHOLD SWEEP: simulate consumption down to each alert threshold and check
// the API reports the exact percent the interface alerts run on.
for (const pct of [29,19,9,4]) {
  await pool.query('UPDATE wallets SET balance = topup_ref*$2/100.0 WHERE user_email=$1',[email,pct])
  const b=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
  const zone=pct<=5?'ROSU PILPIIND':pct<=10?'alerta deasa':pct<=20?'alerta medie':'alerta rara'
  console.log(`PRAG ${pct}% -> API percent=${b.percent.toFixed(1)} credits=${b.credits} | zona: ${zone} | corect:`,Math.abs(b.percent-pct)<0.5)
}

// ZERO: total clean stop + top-up prompt + paywall frame (opens the buy menu).
await pool.query('UPDATE wallets SET balance = 0 WHERE user_email=$1',[email])
const c=await fetch(`${B}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',content:'Hello, are you there?'}]})})
let t=''; const rd=c.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
console.log('LA ZERO: mesaj:',JSON.stringify(t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()))
console.log('LA ZERO: frame paywall (deschide alimentarea):',t.includes('"paywall":true'))
console.log('LA ZERO: NU a consumat AI (stop curat):',!/rivers|mountains/i.test(t))

// CLEANUP: remove the SYNTHETIC financial rows so the owner's real profit
// stats stay clean. The cost_events stay — that Claude usage really happened.
const d1=await pool.query("DELETE FROM billing_events WHERE user_email=$1",[email])
const d2=await pool.query("DELETE FROM wallets WHERE user_email=$1",[email])
console.log('CLEANUP: billing rows',d1.rowCount,'| wallet rows',d2.rowCount)
await pool.end()
