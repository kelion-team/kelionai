import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET; if(!S){console.log('NO_SECRET');process.exit(1)}
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const B=process.env.AUDIT_BASE||'https://kelionai.app'
const H={'Content-Type':'application/json',Cookie:cookie}
// Load £50 into the provider pool
const load=await fetch(`${B}/api/admin/pool`,{method:'POST',headers:H,body:JSON.stringify({amount:50})}).then(r=>r.json())
console.log('after load £50:', JSON.stringify(load))
// Get pool
const pool=await fetch(`${B}/api/admin/pool`,{headers:H}).then(r=>r.json())
console.log('pool:', JSON.stringify(pool))
// Balance endpoint (credits/percent format)
const bal=await fetch(`${B}/api/billing/balance`,{headers:H}).then(r=>r.json())
console.log('balance (credits fmt):', JSON.stringify(bal))
