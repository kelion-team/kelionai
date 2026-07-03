import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'10m'})}`
const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages:[{role:'user',content:'Roaga studioul sa creeze o imagine cu un munte la rasarit.'}],now:new Date().toISOString(),tz:'Europe/London'})})
let t=''; const rd=r.body.getReader(),d=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
const frames=[...t.matchAll(/\x1f([^\x1f]*)\x1f/g)].map(m=>m[1])
console.log('reply:', t.replace(/\x1f[^\x1f]*\x1f/g,'').trim().slice(0,220))
console.log('frames:', JSON.stringify(frames).slice(0,300))
