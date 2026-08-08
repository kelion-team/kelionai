import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const adm=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'10m'})}`
async function ask(q){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adm},body:JSON.stringify({messages:[{role:'user',content:q}],now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
const a=await ask('Ce temperatură e acum în Witney, Anglia?')
console.log((/°|grade|temperatur/i.test(a)?'PASS':'FAIL'),'witney_anglia |',JSON.stringify(a.slice(0,120)))
const b=await ask('Ce vreme e la Cluj-Napoca, România?')
console.log((/°|grade|temperatur|soare|nor|ploaie|senin/i.test(b)?'PASS':'FAIL'),'cluj_romania |',JSON.stringify(b.slice(0,120)))
