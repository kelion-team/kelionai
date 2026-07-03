import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'1h'})}`
const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',content:'Spune un singur cuvant, orice.'}]})})
let txt=''
const rd=r.body.getReader(); const dec=new TextDecoder()
while(true){const {done,value}=await rd.read(); if(done)break; txt+=dec.decode(value)}
// strip control frames
const clean=txt.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
console.log('status',r.status,'| brain replied:', JSON.stringify(clean.slice(0,80)))
