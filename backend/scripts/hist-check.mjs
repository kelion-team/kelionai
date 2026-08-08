import jwt from 'jsonwebtoken'
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},process.env.SESSION_SECRET,{expiresIn:'10m'})}`
const u=await fetch('https://kelionai.app/api/admin/users',{headers:{Cookie:c}}).then(r=>r.json())
console.log('users with history:',(u.users??[]).length)
