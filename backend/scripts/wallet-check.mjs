import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
// customer (non-admin) session
const cust=`kelionai_session=${jwt.sign({email:'client.test@kelionai.app',name:'Client',picture:'',role:'customer',locale:'ro'},S,{expiresIn:'1h'})}`
// admin session for contrast
const adm=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const B='https://kelionai.app'
const bal=await fetch(`${B}/api/billing/balance`,{headers:{Cookie:cust}}).then(r=>({s:r.status,j:r.ok?r.json():null})).then(async x=>({s:x.s,j:x.j?await x.j:null}))
console.log('USER /api/billing/balance ->', bal.s, JSON.stringify(bal.j))
const pool=await fetch(`${B}/api/admin/pool`,{headers:{Cookie:cust}})
console.log('USER /api/admin/pool (should be 403) ->', pool.status)
const poolA=await fetch(`${B}/api/admin/pool`,{headers:{Cookie:adm}}).then(r=>r.json())
console.log('ADMIN /api/admin/pool ->', JSON.stringify(poolA))
