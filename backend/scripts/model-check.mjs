import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'10m'})}`
const m=await fetch('https://kelionai.app/api/admin/models',{headers:{Cookie:c}}).then(r=>r.json())
console.log('MODELS:',JSON.stringify(m))
// live brain smoke — whatever happens with Fable, the brain MUST answer
const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:'Spune un singur cuvant.'}],now:new Date().toISOString(),tz:'Europe/London'})})
let t=''; const rd=r.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
console.log('BRAIN:',r.status,JSON.stringify(t.replace(/\x1f[^\x1f]*\x1f/g,'').trim().slice(0,60)))
