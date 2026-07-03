import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import fs from 'node:fs'
const S=process.env.SESSION_SECRET, W=process.env.STRIPE_WEBHOOK_SECRET
const B='https://kelionai.app'
const OUT='C:/Users/adria/AppData/Local/Temp/claude/C--Users-adria--bob/32f3cf2d-34ac-4618-a578-464fbd8d21ae/scratchpad/sim.json'

// 1) GOOGLE LOGIN for new users: the door must redirect correctly to Google.
const lg=await fetch(`${B}/auth/google/login`,{redirect:'manual'})
const loc=lg.headers.get('location')??''
console.log('LOGIN redirect:',lg.status,'| to Google:',loc.includes('accounts.google.com'),'| has client_id:',loc.includes('client_id='),'| callback ok:',decodeURIComponent(loc).includes('kelionai.app/auth/google/callback'))
const st=await fetch(`${B}/auth/signup-status`).then(r=>r.json())
console.log('GATE open for new users:',st.open===true)

// 2) NEW CUSTOMER after Google login (fresh identity, no credit yet)
const email=`buyer-sim-${Date.now().toString(36)}@test.kelionai.app`
const cookie=`kelionai_session=${jwt.sign({email,name:'Buyer',picture:'',role:'customer',locale:'en'},S,{expiresIn:'2h'})}`
const bal0=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('BALANCE before purchase:',JSON.stringify(bal0),'| zero:',bal0.credits===0)

// 3) PURCHASE £10: a checkout.session.completed webhook SIGNED with the real
// Stripe signing secret — byte-for-byte what Stripe sends after a card payment.
const sid='cs_sim_'+crypto.randomBytes(8).toString('hex')
const raw=JSON.stringify({type:'checkout.session.completed',data:{object:{id:sid,amount_total:1000,currency:'gbp',metadata:{email},customer_details:{email}}}})
const t=Math.floor(Date.now()/1000)
const v1=crypto.createHmac('sha256',W).update(`${t}.${raw}`).digest('hex')
const wh=await fetch(`${B}/api/credits/webhook`,{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${t},v1=${v1}`},body:raw})
console.log('WEBHOOK accepted:',wh.status===200)

// 4) CREDIT VALIDATED + DISPLAYED: £10 → 75% = £7.50 = 75 credits, 100%
const bal1=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('BALANCE after purchase:',JSON.stringify(bal1),'| 75 credits:',bal1.credits===75,'| 100%:',bal1.percent===100)

// 5) IDEMPOTENCY: Stripe retries the SAME event — must NOT double-credit.
const v1b=crypto.createHmac('sha256',W).update(`${Math.floor(Date.now()/1000)}.${raw}`).digest('hex')
await fetch(`${B}/api/credits/webhook`,{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${Math.floor(Date.now()/1000)},v1=${v1b}`},body:raw})
const bal2=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('IDEMPOTENT (still 75):',bal2.credits===75)

// 6) REAL CONSUMPTION: one real chat turn as the customer → wallet debited.
const c=await fetch(`${B}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',content:'Reply with exactly one short sentence about mountains.'}],now:new Date().toISOString(),tz:'Europe/London'})})
let txt=''; const rd=c.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; txt+=d.decode(value)}
console.log('CHAT as customer:',c.status===200&&txt.length>0)
await new Promise(r=>setTimeout(r,2500)) // debit is async fire-and-forget
const bal3=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('CONSUMED (percent<100):',bal3.percent<100,'| now:',JSON.stringify(bal3))

fs.writeFileSync(OUT,JSON.stringify({email,cookie}))
console.log('sim state saved')
