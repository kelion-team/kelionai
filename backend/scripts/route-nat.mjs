import jwt from 'jsonwebtoken'
const cookie=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},process.env.SESSION_SECRET,{expiresIn:'1h'})}`
const CTRL=String.fromCharCode(31)
const res=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',content:'Arata-mi pe harta cum ajung cu masina de la Oxford la Cambridge'}],coords:{lat:51.752,lon:-1.257}})})
const t=await res.text();const frames=[];let buf=t
for(;;){const i=buf.indexOf(CTRL);if(i<0)break;const j=buf.indexOf(CTRL,i+1);if(j<0)break;try{frames.push(JSON.parse(buf.slice(i+1,j)))}catch{};buf=buf.slice(j+1)}
console.log('reply:',t.split(CTRL).filter((_,i)=>i%2===0).join('').replace(/\s+/g,' ').slice(0,130))
const m=frames.map(f=>f.monitor?.url).filter(Boolean).join(' | ')
console.log('map frame:',m||'(NONE - nu a apelat tool-ul)')
