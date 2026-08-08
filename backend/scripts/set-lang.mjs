import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET; if(!S){console.log('NO_SECRET');process.exit(1)}
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const B=process.env.AUDIT_BASE||'https://kelionai.app'
const put=await fetch(`${B}/api/prefs`,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({speechLang:'ro-RO'})})
console.log('PUT', put.status)
const get=await fetch(`${B}/api/prefs`,{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('now:', JSON.stringify(get))
