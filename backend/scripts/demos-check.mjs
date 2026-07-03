import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const d=await fetch('https://kelionai.app/api/admin/demos',{headers:{Cookie:c}}).then(r=>r.json())
console.log('total:',d.total,'today:',d.today)
console.log('byCountry:',JSON.stringify(d.byCountry))
console.log('recent[0]:',JSON.stringify(d.recent[0]))
