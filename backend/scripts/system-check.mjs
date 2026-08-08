import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const B='https://kelionai.app'
const keys=await fetch(`${B}/api/admin/keys`,{headers:{Cookie:c}}).then(r=>r.json())
console.log('KEYS:',JSON.stringify({primary:keys.primary,reserve:keys.reserve}))
const fin=await fetch(`${B}/api/admin/finance`,{headers:{Cookie:c}}).then(r=>r.json())
console.log('FINANCE: stripe',fin.stripe?`£${fin.stripe.available}`:'null','| spent £'+fin.spent.toFixed(2),'| profit £'+fin.profit.toFixed(2))
const tts=await fetch(`${B}/api/tts`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({text:'Test.',lang:'ro-RO'})})
console.log('TTS:',tts.status,tts.headers.get('content-type'))
const demos=await fetch(`${B}/api/admin/demos`,{headers:{Cookie:c}}).then(r=>r.json())
console.log('DEMOS today:',demos.today,'total:',demos.total)
