import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const cust=`kelionai_session=${jwt.sign({email:'client.test@kelionai.app',name:'Client',picture:'',role:'customer',locale:'ro'},S,{expiresIn:'1h'})}`
const r=await fetch('https://kelionai.app/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cust},body:JSON.stringify({amount:10})})
const j=await r.json()
const url=j.url||''
console.log('checkout status', r.status, '| url starts:', url.slice(0,34), '| valid stripe url:', url.startsWith('https://checkout.stripe.com'))
