import fs from 'node:fs'
const {email,cookie}=JSON.parse(fs.readFileSync('C:/Users/adria/AppData/Local/Temp/claude/C--Users-adria--bob/32f3cf2d-34ac-4618-a578-464fbd8d21ae/scratchpad/sim.json','utf8'))
const B='https://kelionai.app'
const b0=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('before:',JSON.stringify(b0))
const c=await fetch(`${B}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',content:'Reply with one short sentence about rivers.'}],now:new Date().toISOString(),tz:'Europe/London'})})
let t=''; const rd=c.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
console.log('chat 200:',c.status===200,'| said:',JSON.stringify(t.replace(/\x1f[^\x1f]*\x1f/g,'').slice(0,60)))
await new Promise(r=>setTimeout(r,3000))
const b1=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('after:',JSON.stringify(b1))
console.log('CONSUM DEBITAT (percent scazut):',b1.percent<b0.percent)
