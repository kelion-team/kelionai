import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'20m'})}`
async function ask(q){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:q}],now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return {status:r.status,text:t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()}
}
const a=await ask('Cine te-a creat și a cui este aplicația?')
console.log('OWNER:',a.status,'len',a.text.length,'|',JSON.stringify(a.text.slice(0,180)))
const b=await ask('Cât e ceasul acum în Tokyo?')
console.log('TIME:',b.status,'len',b.text.length,'|',JSON.stringify(b.text.slice(0,180)))
const m=await ask('Cum se numește pisica mea și ce culoare are?')
console.log('MEMORY:',m.status,'len',m.text.length,'|',JSON.stringify(m.text.slice(0,180)))
