import jwt from 'jsonwebtoken'
// LIVE-mode check: ask Stripe itself. Prints ONLY booleans — never the key.
const k=process.env.STRIPE_SECRET_KEY??''
const r=await fetch('https://api.stripe.com/v1/balance',{headers:{Authorization:`Bearer ${k}`}})
const j=await r.json()
console.log('STRIPE: reachable',r.ok,'| livemode(REAL money):',j.livemode===true,'| webhookSecretSet:',!!process.env.STRIPE_WEBHOOK_SECRET)
// checkout generation for a CUSTOMER (the sales path)
const S=process.env.SESSION_SECRET
const cust=`kelionai_session=${jwt.sign({email:'buyer.test@kelionai.app',name:'B',picture:'',role:'customer',locale:'en'},S,{expiresIn:'10m'})}`
const co=await fetch('https://kelionai.app/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cust},body:JSON.stringify({amount:5})})
const cj=await co.json()
console.log('CHECKOUT:',co.status,'| real stripe page:',(cj.url??'').startsWith('https://checkout.stripe.com'))
