import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getSessionUser } from '../session.js'
import { gasesteAgent, cheamaAgent } from '../services/agentiKelion.js'
import { addMemory, searchMemories } from '../db.js'
import { dateSimbol, rezumatPentruAgent } from '../services/piete.js'
import { config } from '../config.js'

// ── CENTRUL DE TRANZACȚIONARE (Adrian, 4 aug: „să fie reală, cu tot ce există
// pe piață, cu grafice cu tot, învățarea lui Kelion reală, nu povești — ca un
// centru din Londra/America") ────────────────────────────────────────────────
//
// CE E, cinstit:
//  • CRYPTO intraday REAL (Binance public, fără cheie): preț viu, lumânări pe
//    1m/15m/1h/4h/1d — desenate în grafic adevărat pe pagină.
//  • PREȚUL LA MILISECUNDĂ (9 aug, ownerul: „datele trebuie reale total la
//    miime de secundă… real ca în live"): pe crypto, pagina se abonează DIRECT
//    la fluxul public de tranzacții Binance (WebSocket @trade) — prețul se
//    mișcă la FIECARE tranzacție executată pe bursă, cu timestamp-ul în ms al
//    bursei afișat. Dacă fluxul pică, pagina o SPUNE și rămâne pe împrospătarea
//    la 10s (nu tace, nu minte).
//  • ACȚIUNI + INDICI pe date ZILNICE reale (Stooq, fără cheie): AAPL.US,
//    TSLA.US, ^SPX, ^DJI, ^DAX... — tot cu grafic.
//  • ÎNVĂȚAREA REALĂ a lui Kelion: fiecare analiză se salvează în memoria lui
//    cu prețul din clipa aia; la următoarea analiză pe același simbol primește
//    CE A ZIS ATUNCI + PREȚUL DE-ACUM și e obligat să-și judece apelurile.
// CE NU E, la fel de cinstit:
//  • EXECUȚIE — niciun broker legat; pagina nu plasează ordine și o spune.
//  • Intraday pe bursele clasice (Londra/NY tick-cu-tick) — aia se vinde doar
//    cu abonament de date (cheie); când ownerul alege furnizorul, se leagă.
//
// Contract de eșec: sursa necitibilă → eroarea verbatim, nu cifre inventate.

function adminul(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  const user = getSessionUser(req)
  if (user && user.role === 'admin') return user
  reply.code(403)
  return null
}

function paginaTranzactii(): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kelion — Centrul de Tranzacționare</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:980px;margin:1.5rem auto;padding:0 1rem;background:#0b1020;color:#e8ecf6}
 h1{font-size:1.3rem} p{line-height:1.5;color:#b9c2da}
 input,button{padding:.55rem .9rem;border-radius:.6rem;border:1px solid #2a3550;font-size:.95rem}
 input{background:#111830;color:#e8ecf6} button{background:#3b82f6;color:#fff;border:0;cursor:pointer;margin:.15rem}
 button.gri{background:#2a3550} button.activ{outline:2px solid #4ade80}
 button:disabled{opacity:.5;cursor:default}
 pre{background:#111830;padding:1rem;border-radius:.6rem;white-space:pre-wrap;word-break:break-word}
 .ok{color:#4ade80}.rau{color:#f87171}
 .pret{font-size:1.9rem;font-weight:700;margin:.3rem 0;display:inline-block}
 .sus{color:#4ade80}.jos{color:#f87171}
 .nota{font-size:.85rem;color:#8b93ad;border-left:3px solid #2a3550;padding-left:.7rem}
 canvas{width:100%;background:#0e1428;border-radius:.6rem;border:1px solid #1c2440}
</style></head><body>
<h1>📈 Centrul de Tranzacționare — Kelion, analistul tău</h1>
<p class="nota">Date REALE: crypto intraday (Binance) · acțiuni și indici pe zile (Stooq: AAPL.US, TSLA.US, ^SPX, ^DJI, ^DAX). Kelion ÎNVAȚĂ real: fiecare analiză se salvează cu prețul ei, iar la următoarea își judecă apelurile pe ce s-a întâmplat de fapt. Cinstit: NU plasează ordine (niciun broker legat) și nu promite câștiguri; intraday pe bursele clasice cere abonament de date — se leagă când alegi furnizorul.</p>
<div>
 <input id="s" value="BTCUSDT" placeholder="BTCUSDT · ETHUSDT · AAPL.US · ^SPX">
 <button id="v" title="Pornește urmărirea simbolului din câmp: pe crypto prețul curge LIVE, tranzacție cu tranzacție (flux Binance, milisecunda bursei); lumânările graficului se împrospătează la 10s. Pe bursă (Stooq) datele sunt zilnice.">👁 Urmărește</button>
 <button id="an">🧠 Analiza lui Kelion (cu memoria apelurilor)</button>
</div>
<div id="chips">
 <button class="gri chip">BTCUSDT</button><button class="gri chip">ETHUSDT</button><button class="gri chip">SOLUSDT</button>
 <button class="gri chip">AAPL.US</button><button class="gri chip">TSLA.US</button><button class="gri chip">NVDA.US</button>
 <button class="gri chip">^SPX</button><button class="gri chip">^DJI</button><button class="gri chip">^DAX</button>
</div>
<div id="iv">
 <button class="gri int">1m</button><button class="gri int">15m</button><button class="gri int activ">1h</button><button class="gri int">4h</button><button class="gri int">1d</button>
</div>
<div><span class="pret" id="p">—</span> <span id="var">—</span></div>
<div id="viu" class="nota">—</div>
<canvas id="graf" width="960" height="380"></canvas>
<pre id="out">Alege simbolul (crypto sau bursă) și apasă „Analiza lui Kelion" — regimul pieței, niveluri, scenarii cu invalidare, riscul întâi, plus judecata propriilor apeluri anterioare.</pre>
<h2 style="font-size:1.05rem;margin:.8rem 0 .3rem">💬 Chat cu Kelion — mentorul de tranzacționare (DOAR pe date reale)</h2>
<p class="nota">Întreabă orice: cum funcționează tranzacționarea, când/cum să intri sau să ieși pe simbolul de pe ecran (niveluri concrete cu invalidare, riscul întâi), sau cere-i să CAUTE PE NET algoritmul complet al unei strategii — vine cu sursa și data. Fiecare răspuns e ancorat în prețul REAL din clipa întrebării; discuția se salvează în memoria lui separată, doar a ta.</p>
<div id="jurnal" style="background:#111830;border-radius:.6rem;padding:.8rem;max-height:320px;overflow-y:auto;display:none"></div>
<div style="display:flex;gap:.4rem;margin:.4rem 0">
 <input id="ci" style="flex:1" placeholder="ex: cum și când intru pe BTCUSDT acum? · caută algoritmul complet de mean-reversion">
 <button id="ct">Trimite</button>
 <button id="cv" class="gri" title="Vocea lui Kelion pe răspunsurile din chatul ăsta (Chirp). Apasă ca să o stingi/aprinzi.">🔊</button>
</div>
<script>
 const s=document.getElementById('s'), p=document.getElementById('p'), va=document.getElementById('var'), out=document.getElementById('out');
 const an=document.getElementById('an'), v=document.getElementById('v'), graf=document.getElementById('graf'), viu=document.getElementById('viu');
 let ceas=null, interval='1h', ws=null, pretVechi=0;
 // crypto = simbol Binance simplu (BTCUSDT); punct/caret = bursă (Stooq, zilnic)
 function eCripto(sim){ return /^[A-Z0-9]{5,}$/.test(sim) && sim.indexOf('.')<0 && sim.indexOf('^')<0; }
 function oraMs(t){ const d=new Date(t); function z(n,l){ return String(n).padStart(l||2,'0'); }
   return z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds())+'.'+z(d.getMilliseconds(),3); }
 function deseneaza(lum){
   const x=graf.getContext('2d'); const W=graf.width, H=graf.height;
   x.clearRect(0,0,W,H);
   if(!lum||lum.length<2) return;
   const min=Math.min.apply(null,lum.map(function(c){return c.minim;}));
   const max=Math.max.apply(null,lum.map(function(c){return c.maxim;}));
   const marja=(max-min)||1, sus=14, jos=22, util=H-sus-jos;
   const pas=W/lum.length, corp=Math.max(1,Math.floor(pas*0.6));
   function Y(v){ return sus + (max-v)/marja*util; }
   for(let i=0;i<lum.length;i++){
     const c=lum[i], cx=Math.floor(i*pas+pas/2);
     const urca=c.inchis>=c.deschis;
     x.strokeStyle=x.fillStyle=urca?'#4ade80':'#f87171';
     x.beginPath(); x.moveTo(cx,Y(c.maxim)); x.lineTo(cx,Y(c.minim)); x.stroke();
     const y1=Y(Math.max(c.deschis,c.inchis)), y2=Y(Math.min(c.deschis,c.inchis));
     x.fillRect(cx-Math.floor(corp/2), y1, corp, Math.max(1,y2-y1));
   }
   x.fillStyle='#8b93ad'; x.font='12px system-ui';
   x.fillText(String(max), 6, sus+10);
   // minimul URCĂ deasupra benzii de date (9 aug: la H-jos+14 se suprapunea cu
   // data de start din colț — textul ieșea ilizibil, „6478008…2026-08-08")
   x.fillText(String(min), 6, H-jos-4);
   const t0=new Date(lum[0].t), t1=new Date(lum[lum.length-1].t);
   x.fillText(t0.toISOString().slice(0,16).replace('T',' '), 6, H-6);
   const et=t1.toISOString().slice(0,16).replace('T',' ');
   x.fillText(et, W-x.measureText(et).width-6, H-6);
 }
 async function pret(){
   try{
     const r=await fetch('/api/tranzactii/date?simbol='+encodeURIComponent(s.value)+'&interval='+interval);
     const j=await r.json();
     if(j.error){ p.textContent='—'; va.innerHTML='<span class=rau>'+j.error+'</span>'; return; }
     if(!ws){ p.textContent=j.pret; }
     va.innerHTML='24h: <span class="'+(j.variatie24h>=0?'sus':'jos')+'">'+j.variatie24h+'%</span> · '+j.simbol+' · '+j.sursa+' · lumânări '+j.interval;
     // ONESTITATE PE TIMP (9 aug, „selecția pe timp nu merge"): bursele Stooq au
     // DOAR lumânări zilnice — butoanele intraday se sting pe ele, nu mint.
     const zilnic=String(j.sursa||'').indexOf('Stooq')>=0;
     document.querySelectorAll('.int').forEach(function(b){ b.disabled=zilnic&&b.textContent!=='1d'; });
     if(zilnic&&!ws){ viu.textContent='bursă clasică: lumânări ZILNICE reale (intraday tick-cu-tick cere abonament de date — se leagă când alegi furnizorul)'; }
     deseneaza(j.lumanari);
   }catch(e){ va.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
 }
 // PREȚUL LA MILISECUNDĂ (9 aug, „real ca în live"): pe crypto ne abonăm DIRECT
 // la fluxul public de tranzacții al bursei — prețul se mișcă la FIECARE
 // tranzacție executată, cu ms-ul bursei pe ecran. Căderea fluxului SE SPUNE.
 function opresteViu(){ if(ws){ try{ws.close();}catch(e){} ws=null; } }
 function pornesteViu(sim){
   opresteViu();
   if(!eCripto(sim)) return;
   try{
     const w=new WebSocket('wss://stream.binance.com:9443/ws/'+sim.toLowerCase()+'@trade');
     ws=w;
     w.onmessage=function(ev){ try{
       const j=JSON.parse(ev.data); const nou=Number(j.p);
       if(!(nou>0)) return;
       p.textContent=nou; p.className='pret '+(nou>=pretVechi?'sus':'jos'); pretVechi=nou;
       viu.textContent='● LIVE (flux Binance, tranzacție cu tranzacție) · ultima: '+oraMs(j.T)+' — milisecunda bursei';
     }catch(e){} };
     w.onerror=function(){ if(ws===w){ viu.textContent='fluxul live a picat — rămân pe împrospătarea la 10s (rețeaua/blocantul browserului?)'; } };
     w.onclose=function(){ if(ws===w){ ws=null; } };
   }catch(e){ viu.textContent='fluxul live nu a pornit ('+e+') — împrospătare la 10s'; }
 }
 function urmareste(){ if(ceas)clearInterval(ceas); void pret(); ceas=setInterval(pret,10000); pornesteViu(s.value.toUpperCase().trim()); }
 v.onclick=urmareste;
 document.querySelectorAll('.chip').forEach(function(b){ b.onclick=function(){ s.value=b.textContent; urmareste(); }; });
 document.querySelectorAll('.int').forEach(function(b){ b.onclick=function(){ interval=b.textContent;
   document.querySelectorAll('.int').forEach(function(o){o.classList.remove('activ');}); b.classList.add('activ'); urmareste(); }; });
 an.onclick=async()=>{
   an.disabled=true; out.textContent='Kelion citește piața, își recitește apelurile din memorie și gândește (poate dura ~30-60s)…';
   try{
     const r=await fetch('/api/tranzactii/analiza',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({simbol:s.value,interval:interval})});
     const j=await r.json();
     out.innerHTML=j.error?'<span class=rau>'+j.error+'</span>':j.analiza.replace(/</g,'&lt;');
   }catch(e){ out.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
   an.disabled=false;
 };
 // CHATUL DIN CENTRU (9 aug): fiecare întrebare pleacă ancorată în simbolul +
 // intervalul de pe ecran; istoricul conversației merge cu ea (continuitate).
 const jurnal=document.getElementById('jurnal'), ci=document.getElementById('ci'), ct=document.getElementById('ct'), cv=document.getElementById('cv');
 const fir=[];
 // GURA LUI KELION ÎN TAB (9 aug, ownerul: „nu-l aud"): răspunsurile din chatul
 // ăsta se și SPUN, cu aceeași voce Chirp ca în aplicație (POST /api/tts).
 // Butonul 🔊 o stinge/aprinde; eșecul sintezei nu rupe chatul (textul rămâne).
 let cuVoce=true, gura=null;
 cv.onclick=function(){ cuVoce=!cuVoce; cv.textContent=cuVoce?'🔊':'🔇'; if(!cuVoce&&gura){ try{gura.pause();}catch(e){} gura=null; } };
 async function spune(text){
   if(!cuVoce||!text) return;
   try{
     const r=await fetch('/api/tts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text.slice(0,1200)})});
     if(!r.ok) return;
     const b=await r.blob();
     if(gura){ try{gura.pause();}catch(e){} }
     gura=new Audio(URL.createObjectURL(b));
     void gura.play().catch(function(){});
   }catch(e){}
 }
 function scrieRand(cine,text){
   jurnal.style.display='block';
   const r=document.createElement('div');
   r.style.margin='.35rem 0'; r.style.whiteSpace='pre-wrap'; r.style.wordBreak='break-word';
   r.style.color = cine==='kelion' ? '#e8ecf6' : '#8fb7ff';
   r.textContent=(cine==='kelion'?'Kelion: ':'Tu: ')+text;
   jurnal.appendChild(r); jurnal.scrollTop=jurnal.scrollHeight;
   return r;
 }
 async function trimiteChat(){
   const q=ci.value.trim(); if(!q) return;
   ci.value=''; ct.disabled=true; ci.disabled=true;
   scrieRand('eu',q); fir.push({cine:'eu',text:q});
   const asteapta=scrieRand('kelion','… (citește piața reală, memoria și, dacă e nevoie, caută pe net — poate dura ~30-60s)');
   try{
     const r=await fetch('/api/tranzactii/chat',{method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({intrebare:q,simbol:s.value,interval:interval,istoric:fir.slice(-8)})});
     const j=await r.json();
     asteapta.textContent='Kelion: '+(j.error?('eroare: '+j.error):j.raspuns);
     if(!j.error){ fir.push({cine:'kelion',text:j.raspuns}); void spune(j.raspuns); }
   }catch(e){ asteapta.textContent='Kelion: rețea picată: '+e; }
   ct.disabled=false; ci.disabled=false; ci.focus();
 }
 ct.onclick=trimiteChat;
 ci.addEventListener('keydown',function(ev){ if(ev.key==='Enter') trimiteChat(); });
 urmareste();
</script></body></html>`
}

export async function tranzactiiRoutes(app: FastifyInstance): Promise<void> {
  // Pagina — DOAR admin (agentul e doar-admin, panoul la fel).
  app.get('/api/tranzactii', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return paginaTranzactii()
  })

  // Datele reale ale unui simbol (graficul + prețul viu). DOAR admin.
  app.get('/api/tranzactii/date', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const q = req.query as { simbol?: string; interval?: string }
    return dateSimbol(String(q.simbol ?? 'BTCUSDT'), String(q.interval ?? '1h'))
  })

  // CHAT CU KELION ÎN CENTRU (9 aug, ownerul: „trebuie să am chat aici cu
  // Kelion, care îmi spune detalii despre cum funcționează tranzacționarea,
  // cum și când să intru sau să ies, caută pe net algoritmul complet de
  // tranzacționare"). Fiecare întrebare pleacă ANCORATĂ în datele REALE ale
  // simbolului de pe ecran (preț/lumânări din clipa aia) + memoria separată
  // 'tranzactii'; agentul are căutarea pe net + cititul paginilor (blindajul
  // din 5 aug), deci poate aduce algoritmi/strategii cu sursa și data.
  // Schimbul se salvează în ACEEAȘI memorie separată, doar-admin.
  app.post('/api/tranzactii/chat', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const b = req.body as {
      intrebare?: string
      simbol?: string
      interval?: string
      istoric?: { cine?: string; text?: string }[]
    } | null
    const intrebare = String(b?.intrebare ?? '').trim().slice(0, 2000)
    if (!intrebare) return reply.code(400).send({ error: 'întrebarea e goală' })
    const agent = gasesteAgent('tranzactii')
    if (!agent) return reply.code(503).send({ error: 'agentul tranzactii lipsește din roster' })
    // Datele reale din clipa întrebării — dacă piața nu se poate citi, chatul
    // MERGE mai departe și o spune (întrebările teoretice nu depind de preț).
    const d = await dateSimbol(String(b?.simbol ?? 'BTCUSDT'), String(b?.interval ?? '1h'))
    const ancora = 'error' in d
      ? `(piața nu s-a putut citi acum: ${d.error} — răspunde totuși la ce se poate fără preț viu)`
      : rezumatPentruAgent(d)
    const vechi = await searchMemories(config.adminEmail, 'tranzactii', [String(b?.simbol ?? '')], 2)
    const memoria = vechi.length
      ? `\nDIN MEMORIA TA pe simbol (analize/discuții vechi):\n` + vechi.map((m) => m.content.slice(0, 400)).join('\n---\n')
      : ''
    const istoric = (Array.isArray(b?.istoric) ? b.istoric : [])
      .slice(-8)
      .map((r) => `${r?.cine === 'kelion' ? 'Kelion' : 'Adrian'}: ${String(r?.text ?? '').slice(0, 400)}`)
      .join('\n')
    try {
      const r = await cheamaAgent(
        agent,
        `Ești în CHATUL Centrului de Tranzacționare cu ownerul. Răspunde DIRECT la întrebarea lui, ` +
          `ca un mentor de trading cu riscul întâi: explică pe înțeles cum funcționează ce întreabă; ` +
          `când cere intrare/ieșire, dă niveluri CONCRETE din datele reale de mai jos (intrare, stop, ` +
          `țintă, invalidare — „dacă… atunci…"), cu mărimea poziției ca % din capital; NU promite ` +
          `câștiguri, NU spune „sigur". Dacă cere algoritmi/strategii/boți sau ceva ce nu știi din ` +
          `date, CAUTĂ PE NET cu uneltele tale și adu structura completă cu SURSA și DATA fiecărei ` +
          `afirmații. REGULA DE FIER — DOAR PE REAL: fiecare cifră pe care o spui vine ori din datele ` +
          `reale de mai jos, ori dintr-o sursă de pe net cu link și dată; NICIO cifră inventată, NICIO ` +
          `„estimare" nespusă — ce nu ai măsurat spui că nu ai de unde să știi. Scurt și aplicat, nu eseu.` +
          `\n\nDATELE REALE de pe ecran acum:\n${ancora}${memoria}` +
          (istoric ? `\n\nCONVERSAȚIA de până acum:\n${istoric}` : '') +
          `\n\nÎNTREBAREA lui: ${intrebare}`,
        true,
      )
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const simbolLog = 'error' in d ? String(b?.simbol ?? '?') : d.simbol
      await addMemory(
        config.adminEmail,
        `[tranzactii-chat ${zi}] ${simbolLog} Î: ${intrebare.slice(0, 300)} | R: ${r.text.slice(0, 600)}`,
        'tranzactii',
      )
      return { raspuns: r.text }
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `agentul n-a răspuns: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` })
    }
  })

  // Analiza cu ÎNVĂȚARE REALĂ: agentul primește analizele lui anterioare pe
  // simbol + prețul de-acum (își judecă apelurile), iar verdictul nou se
  // salvează în memorie cu prețul lui — bucla de învățare e închisă. DOAR admin.
  app.post('/api/tranzactii/analiza', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const b = req.body as { simbol?: string; interval?: string } | null
    const d = await dateSimbol(String(b?.simbol ?? 'BTCUSDT'), String(b?.interval ?? '1h'))
    // STATUS PE MĂSURA ADEVĂRULUI (măsurat 8 aug): cele trei ieșiri de mai jos
    // răspundeau 200 cu `{error:…}` — un apelant care se uită la `res.ok`
    // primea „a mers" pentru o analiză care nu există. Al cincilea caz din
    // aceeași familie; acum eșecul se vede și din status, nu doar din corp.
    if ('error' in d) return reply.code(502).send(d)
    const agent = gasesteAgent('tranzactii')
    if (!agent) return reply.code(503).send({ error: 'agentul tranzactii lipsește din roster' })
    const vechi = await searchMemories(config.adminEmail, 'tranzactii', [d.simbol], 3)
    const istoria = vechi.length
      ? `\nANALIZELE TALE ANTERIOARE pe ${d.simbol} (cu prețul de atunci în paranteza [pret ...]) — judecă-le scurt față de prețul de ACUM (${d.pret}): ce ai nimerit, ce ai ratat, ce înveți:\n` +
        vechi.map((m) => `---\n${m.content.slice(0, 700)}`).join('\n')
      : ''
    try {
      const r = await cheamaAgent(
        agent,
        `Analizează piața pe datele de mai jos, ca un trader avansat, cu riscul întâi.\n` +
          `Structura cerută: 1) Regimul pieței (trend/range, pe ce dovezi din cifre); 2) Niveluri importante ` +
          `(suport/rezistență din minime/maxime reale); 3) Scenarii (dacă… atunci…, cu invalidare clară); ` +
          `4) Riscul (mărimea poziției ca % din capital, unde stă stopul, raport risc/câștig); 5) Ce NU se vede în date; ` +
          `6) JUDECATA apelurilor tale vechi (dacă există mai jos).\n` +
          `Fără promisiuni, fără „sigur". Datele:\n${rezumatPentruAgent(d)}${istoria}`,
        true,
      )
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await addMemory(config.adminEmail, `[tranzactii ${zi}] ${d.simbol} [pret ${d.pret}, ${d.interval}]: ${r.text.slice(0, 900)}`, 'tranzactii')
      return { analiza: r.text, simbol: d.simbol, pret: d.pret, sursa: d.sursa }
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `agentul n-a răspuns: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` })
    }
  })
}
