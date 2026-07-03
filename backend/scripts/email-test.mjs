import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:'Scrie-mi textul unui email catre un client, domnul Popescu, prin care confirm intalnirea de maine la ora 15 la biroul nostru. Doar textul emailului.'}],now:new Date().toISOString(),tz:'Europe/London'})})
let t=''; const rd=r.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
console.log(t.replace(/\x1f[^\x1f]*\x1f/g,'').trim())
