import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const c=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'A',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'15m'})}`
async function ask(messages){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({messages,now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  const frames=[...t.matchAll(/\x1f([^\x1f]*)\x1f/g)].map(m=>{try{return JSON.parse(m[1])}catch{return null}}).filter(Boolean)
  return {reply:t.replace(/\x1f[^\x1f]*\x1f/g,'').trim(), frames}
}
const q='Fă un clip promo de 15 secunde despre Kelionai, cu o scenă avatar la început, harta Parisului la mijloc și vremea din Londra la final.'
const a=await ask([{role:'user',content:q}])
console.log('STEP1 asks authorization:', /autoriz|da\b|yes|modific/i.test(a.reply),'|',JSON.stringify(a.reply.slice(0,90)))
const a2=await ask([{role:'user',content:q},{role:'assistant',content:a.reply},{role:'user',content:'da, autorizez'}])
const promo=a2.frames.find(f=>f.promo)?.promo
console.log('STEP2 promo frame present:', !!promo)
if(promo){
  console.log('  subject:',promo.subject,'| duration:',promo.duration,'| scriptLen:',promo.script.length)
  console.log('  scenes:',JSON.stringify((promo.scenes||[]).map(s=>({at:s.at,title:s.title,close:s.close||false,url:s.url?s.url.slice(0,48):null}))))
  const real=(promo.scenes||[]).filter(s=>s.close||/openstreetmap|windy|\/api\/image\//.test(s.url||''))
  console.log('  scenes with REAL surface (avatar/map/weather/image):',real.length,'/',(promo.scenes||[]).length)
}
