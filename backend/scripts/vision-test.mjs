import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const IMG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z'
async function ask(q){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:q}],image:IMG,now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
console.log('NONVIZUAL (6x7, img atasat) ->', (await ask('Cat fac 6 ori 7?')).slice(0,130))
console.log('VIZUAL (ce vezi?) ->', (await ask('Ce vezi in imagine?')).slice(0,130))
