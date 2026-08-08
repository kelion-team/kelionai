import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
// Fresh identity, NO saved speech pref, locale en → the ADAPTIVE language branch
// (exactly what a demo visitor gets).
const email=`lang-test-${Date.now().toString(36)}@test.kelionai.app`
const c=`kelionai_session=${jwt.sign({email,name:'T',picture:'',role:'demo',locale:'en',demoUntil:Date.now()+180000},S,{expiresIn:'10m'})}`
async function ask(messages){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages,now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
console.log('HELLO ->', (await ask([{role:'user',content:'Hello!'}])).slice(0,100))
console.log('RO SWITCH ->', (await ask([
  {role:'user',content:'Hello!'},
  {role:'assistant',content:'Good evening. How may I help?'},
  {role:'user',content:'Poti sa-mi spui te rog cum te numesti si ce stii sa faci?'}
])).slice(0,160))
