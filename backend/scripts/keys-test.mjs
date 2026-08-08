import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET; if(!S){console.log('NO_SECRET');process.exit(1)}
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const B='https://kelionai.app'
for(let i=0;i<40;i++){
  const r=await fetch(`${B}/api/admin/keys`,{headers:{Cookie:cookie}})
  if(r.status===200){ console.log('keys:', JSON.stringify(await r.json())); process.exit(0) }
  if(r.status===404){ process.stdout.write('.'); await new Promise(z=>setTimeout(z,6000)); continue }
  console.log('unexpected', r.status); process.exit(1)
}
console.log('\nTIMEOUT waiting for new deploy')
