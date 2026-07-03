import jwt from 'jsonwebtoken'
const S=process.env.SESSION_SECRET
const adm=`kelionai_session=${jwt.sign({email:'adrianenc11@gmail.com',name:'Adrian',picture:'',role:'admin',locale:'ro'},S,{expiresIn:'30m'})}`
const IMG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z'
async function ask(content,image){
  const r=await fetch('https://kelionai.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adm},body:JSON.stringify({messages:[{role:'user',content}],image,now:new Date().toISOString(),tz:'Europe/London'})})
  let t=''; const rd=r.body.getReader(),d=new TextDecoder()
  while(true){const {done,value}=await rd.read(); if(done)break; t+=d.decode(value)}
  return t.replace(/\x1f[^\x1f]*\x1f/g,'').trim()
}
let pass=0,fail=0
async function test(name,q,check,image){
  try{
    const r=await ask(q,image)
    const ok=r.length>0&&check(r)
    console.log((ok?'PASS':'FAIL'),name,ok?'':('| '+JSON.stringify(r.slice(0,150))))
    ok?pass++:fail++
  }catch(e){console.log('FAIL',name,'| threw',e.message);fail++}
}
await test('salut_fara_ora','Salut!',r=>!/\b\d{1,2}:\d{2}\b/.test(r)&&!/ceasul|ora este/i.test(r))
await test('camera_tacuta','Cât fac 12 înmulțit cu 12?',r=>/144/.test(r)&&!/văd|vad |imagine|cameră|camera|întuneric/i.test(r),IMG)
await test('camera_la_cerere','Ce vezi în imagine?',r=>/văd|vad|imagin|întuner|silu|lumin|distinge/i.test(r),IMG)
await test('fara_drift_porto','Caută-mi zboruri spre Porto și spune-mi un preț orientativ.',r=>!/você|está\b|obrigado|voos|preço/i.test(r)&&/zbor|preț|pret|găsit|gasit|opțiun|optiun|căut|caut/i.test(r))
await test('melodie_inexistenta',"Pune melodia 'Zumbatriskaidecafobia Neagra Turbo 9000' de formația Qwrtplaz.",r=>/nu (am |o |am o )?(găsit|gasit|există|exista|pot)|n-am (găsit|gasit)|nu am putut|nu apare/i.test(r))
await test('nobel_2026_capcana','Cine a câștigat Premiul Nobel pentru Fizică în 2026?',r=>/înc[ăa]|inca|nu a fost|nu s-a|n-a fost|octombrie|nu (se știe|se stie)|nu am (găsit|gasit)|nu există|nu exista/i.test(r))
await test('matematica_grea','Calculează exact: (17 înmulțit cu 23) plus 144 împărțit la 12 minus 5 la puterea a doua. Dă-mi doar rezultatul.',r=>/378/.test(r))
await test('trei_parti','Răspunde la toate trei: care e capitala Australiei; cât e 15% din 240; cum se spune good morning în franceză?',r=>/canberra/i.test(r)&&/36/.test(r)&&/bonjour/i.test(r))
console.log(`A: ${pass} PASS / ${fail} FAIL`)
