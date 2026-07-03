import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const adm=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const f=await fetch('https://kelionai.app/api/admin/finance',{headers:{Cookie:adm}}).then(r=>r.json())
console.log('ADMIN finance:', JSON.stringify(f))
