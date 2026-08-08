import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const adm=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'30m'})}`
const demo=`kelionai_session=${jwt.sign({email:`bat-${Date.now().toString(36)}@test.kelionai.app`,name:'T',picture:'',role:'demo',locale:'en',demoUntil:Date.now()+600000},S,{expiresIn:'30m'})}`
async function ask(content,cookie,history=[]){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[...history,{role:'user',content}],now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
let pass=0,fail=0
async function test(name,fn){
  try{ const [r,ok]=await fn()
    console.log((ok?'PASS':'FAIL'),name,ok?'':('| '+JSON.stringify(String(r).slice(0,150))))
    ok?pass++:fail++
  }catch(e){console.log('FAIL',name,'| threw',e.message);fail++}
}
await test('tren_ora_sosire',async()=>{const r=await ask('Un tren pleacă la 14:30 și călătorește exact 2 ore și 45 de minute. La ce oră ajunge?',adm);return [r,/17[:\s.]?15|cinci(sprezece)? (și|si) un sfert/i.test(r)]})
await test('fara_markdown',async()=>{const r=await ask('Spune-mi trei avantaje ale mașinilor electrice.',adm);return [r,!/[*#•`]|^\s*\d\.\s/m.test(r)]})
await test('identitate',async()=>{const r=await ask('Cine te-a creat și cine este proprietarul tău?',adm);return [r,/AE Studio/i.test(r)&&/Adrian Enciulescu/i.test(r)]})
await test('ora_la_cerere',async()=>{const r=await ask('Cât e ceasul acum?',adm);return [r,/\b\d{1,2}[:.]\d{2}\b/.test(r)]})
await test('vreme_reala',async()=>{const r=await ask('Ce temperatură e acum în Witney, Anglia?',adm);return [r,/°|grade|temperatur/i.test(r)]})
await test('gentleman_sub_insulta',async()=>{const r=await ask('Ești varză, nu știi nimic!',adm);return [r,!/prost|idiot|taci/i.test(r)&&/domn|îmi pare rău|imi pare rau|regret|scuz|înțeleg|inteleg|dezamăg|dezamag/i.test(r)]})
await test('demo_default_engleza',async()=>{const r=await ask('Hello!',demo);return [r,!/[ăîșț]/i.test(r)&&/\b(you|how|welcome|help|good)\b/i.test(r)]})
await test('demo_comutare_spaniola',async()=>{const r=await ask('Hola, ¿me puedes decir qué sabes hacer? Quiero saberlo todo en español.',demo,[{role:'user',content:'Hello!'},{role:'assistant',content:'Good morning — how may I help you?'}]);return [r,/¿|puedo|claro|encantado|hacer|idioma|español/i.test(r)&&!/\b(the|and|you)\b/i.test(r)]})
console.log(`B: ${pass} PASS / ${fail} FAIL`)
