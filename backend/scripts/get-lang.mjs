import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const get=await fetch('https://kelionai.app/api/prefs',{headers:{Cookie:cookie}}).then(r=>r.json())
console.log('stored prefs:', JSON.stringify(get))
