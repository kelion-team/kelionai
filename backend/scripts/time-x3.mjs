import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'15m'})}`
async function ask(q){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:q}],now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
for(let i=1;i<=3;i++){
  const r=await ask('Cât e ceasul acum în Tokyo?')
  console.log(`RUN${i}:`,/\d/.test(r)?'digits':'NO-DIGITS','|',JSON.stringify(r.slice(0,110)))
}
