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

/** ── NIVELURILE SE VĂD PE GRAFIC (9 aug, ownerul: „ce spune trebuie să arate
 *  clar pe grafic") ──────────────────────────────────────────────────────────
 *  Agentul e pus să-și încheie răspunsul cu un rând mașină-citibil:
 *      NIVELURI: intrare=65100; stop=64300; tinta=66800
 *  Funcția asta îl extrage tolerant (`;` sau `,`, spații, majuscule) și
 *  întoarce perechile nume→valoare pe care pagina le DESENEAZĂ ca linii pe
 *  lumânări. Fără rând sau „NIVELURI: -" → listă goală (nu se inventează).
 *  PURĂ și exportată — se probează pe texte reale, fără agent. */
export function extrageNiveluri(text: string): { nume: string; valoare: number }[] {
  // Revizia (9 aug): virgula era luată drept separator de perechi → „intrare=65,100"
  // ieșea 65 (linie GREȘITĂ pe grafic); prima apariție a „NIVELURI" în proză
  // îngropa rândul real; boldul markdown și monedele stricau potrivirea.
  const curat = String(text ?? '').replace(/[*_`]/g, '')
  const aparitii = [...curat.matchAll(/NIVELURI\s*:?\s*([^\n]*)/gi)]
  for (let a = aparitii.length - 1; a >= 0; a--) {
    const rand = aparitii[a][1] ?? ''
    const out: { nume: string; valoare: number }[] = []
    for (const p of rand.matchAll(/([a-zăâîșțşţ_ -]+?)\s*=\s*[~≈$€£]?\s*([0-9][0-9.,\s]*)/gi)) {
      const valoare = normalizeazaNumar(p[2])
      if (valoare === null) continue
      out.push({ nume: p[1].trim().toLowerCase().normalize('NFC'), valoare })
      if (out.length >= 8) break
    }
    if (out.length) return out // rândul cerut e „LA FINAL" — ultima apariție validă câștigă
  }
  return []
}

/** „65,100" / „65.100,50" / „65 100" → numărul REAL: grupele de 3 sunt mii,
 *  ultima grupă scurtă e zecimale. PURĂ — probată pe formate reale de agent. */
export function normalizeazaNumar(brut: string): number | null {
  const t = String(brut ?? '').trim().replace(/\s+/g, '')
  if (!t) return null
  let s = t
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) {
    // separatori de mii cu (poate) zecimale la coadă
    const m = t.match(/^(.*?)([.,](\d{1,2}))?$/)
    const intreg = (m?.[1] ?? t).replace(/[.,]/g, '')
    s = m?.[3] ? `${intreg}.${m[3]}` : intreg
  } else {
    s = t.replace(',', '.')
  }
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Instrucțiunea comună prin care agentul își face nivelurile DESENABILE. */
const CERE_NIVELURI =
  `\nLA FINAL, OBLIGATORIU, pe un rând separat, scrie nivelurile tale numerice în formatul exact: ` +
  `"NIVELURI: intrare=...; stop=...; tinta=...; suport=...; rezistenta=..." — DOAR cele care există ` +
  `în analiza ta, cu cifre REALE din date (fără altele). Dacă nu ai niciun nivel, scrie "NIVELURI: -". ` +
  `Rândul ăsta se DESENEAZĂ pe graficul omului — de-aia trebuie exact formatul.`

function adminul(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  const user = getSessionUser(req)
  if (user && user.role === 'admin') return user
  reply.code(403)
  return null
}

function paginaTranzactii(): string {
  // GRAFIC PROFESIONAL (9 aug, ownerul: „rudimentară aplicația… ieși în net și
  // construiește soluția real funcțională"): motorul open-source al graficelor
  // TradingView (lightweight-charts v5, Apache-2.0), VENDORED pe domeniul
  // nostru (/lwc/ — aceeași lecție ca Leaflet: nimic de pe CDN-uri străine).
  // Lumânarea CURENTĂ se mișcă LIVE din fluxul kline al bursei; prețul bate la
  // fiecare tranzacție (@trade, milisecunda bursei); nivelurile lui Kelion din
  // chat/analiză se desenează ca LINII DE PREȚ cu etichetă pe axă
  // (createPriceLine) — „ce spune trebuie să arate clar pe grafic".
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kelion — Centrul de Tranzacționare</title>
<script src="/lwc/lightweight-charts.standalone.production.js"><\/script>
<style>
 *{box-sizing:border-box}
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#0b1020;color:#e8ecf6}
 .bara{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem 1rem;border-bottom:1px solid #1c2440;position:sticky;top:0;background:#0b1020cc;backdrop-filter:blur(6px);z-index:5}
 .bara h1{font-size:1.05rem;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .continut{max-width:1100px;margin:0 auto;padding:.8rem 1rem 2rem}
 input,button{padding:.5rem .8rem;border-radius:.6rem;border:1px solid #2a3550;font-size:.92rem}
 input{background:#111830;color:#e8ecf6} button{background:#3b82f6;color:#fff;border:0;cursor:pointer;margin:.12rem}
 button.gri{background:#2a3550} button.activ{outline:2px solid #4ade80}
 button:disabled{opacity:.45;cursor:default}
 pre{background:#111830;padding:1rem;border-radius:.6rem;white-space:pre-wrap;word-break:break-word}
 .ok{color:#4ade80}.rau{color:#f87171}
 .pret{font-size:1.8rem;font-weight:700;margin:.2rem 0;display:inline-block}
 .sus{color:#4ade80}.jos{color:#f87171}
 .nota{font-size:.83rem;color:#8b93ad;border-left:3px solid #2a3550;padding-left:.7rem;line-height:1.45}
 html,body{height:100%}
 .continut{display:flex;flex-direction:column;min-height:calc(100dvh - 52px);max-width:1400px}
 #graf{position:relative;flex:1 1 auto;min-height:320px;width:100%;border:1px solid #1c2440;border-radius:.6rem;overflow:hidden}
 #leg{position:absolute;top:.4rem;left:.6rem;z-index:3;font:.78rem ui-monospace,monospace;color:#8b93ad;pointer-events:none;white-space:pre}
</style></head><body>
<div class="bara">
 <h1>📈 Centrul de Tranzacționare — Kelion, analistul tău</h1>
 <button id="iesire" class="gri" title="Închide Centrul și întoarce-te la Kelion (Esc)">✕ Ieșire</button>
</div>
<div class="continut">
<p class="nota">Date REALE: crypto LIVE tranzacție-cu-tranzacție (Binance) · acțiuni/indici pe zile (Stooq). Kelion învață real: fiecare analiză se salvează cu prețul ei și își judecă apelurile. NU plasează ordine și nu promite câștiguri. Nivelurile lui (intrare/stop/țintă) se desenează PE grafic.</p>
<div>
 <input id="s" value="BTCUSDT" placeholder="BTCUSDT · ETHUSDT · AAPL.US · ^SPX">
 <button id="v" title="Pornește urmărirea simbolului din câmp: preț live tranzacție-cu-tranzacție + lumânarea curentă mișcându-se în timp real (crypto); bursa clasică pe zile.">👁 Urmărește</button>
 <button id="an">🧠 Analiza lui Kelion</button>
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
<div id="graf"><div id="leg"></div></div>
<h2 style="font-size:1rem;margin:.8rem 0 .3rem">💬 Chat cu Kelion — mentorul de tranzacționare (DOAR pe date reale)</h2>
<p class="nota">Întreabă cum funcționează, când/cum intri sau ieși (niveluri concrete, desenate pe grafic), sau cere-i să caute pe net algoritmul complet al unei strategii — vine cu sursa și data. Răspunsuri SCURTE; discuția se salvează în memoria lui separată, doar a ta.</p>
<div id="jurnal" style="background:#111830;border-radius:.6rem;padding:.8rem;max-height:300px;overflow-y:auto;display:none"></div>
<div style="display:flex;gap:.4rem;margin:.4rem 0">
 <input id="ci" style="flex:1" placeholder="ex: cum și când intru pe BTCUSDT acum? · caută algoritmul complet de mean-reversion">
 <button id="ct">Trimite</button>
 <button id="cv" class="gri" title="Vocea lui Kelion pe răspunsuri. Apasă ca să o stingi/aprinzi.">🔊</button>
</div>
<pre id="out">Apasă „Analiza lui Kelion" pentru analiza completă (regim, niveluri, scenarii cu invalidare, riscul întâi) — nivelurile apar PE grafic.</pre>
</div>
<script>
 var s=document.getElementById('s'), p=document.getElementById('p'), va=document.getElementById('var'), out=document.getElementById('out'), viu=document.getElementById('viu');
 var an=document.getElementById('an'), v=document.getElementById('v');
 var jurnal=document.getElementById('jurnal'), ci=document.getElementById('ci'), ct=document.getElementById('ct'), cv=document.getElementById('cv');
 var interval='1h', ws=null, ceas=null, pretVechi=0, simbolCurent='', primaIncarcare=true, reconectDelay=1000, primaTranzactie=false;
 var fir=[], liniile=[], cuVoce=true, gura=null;

 // IEȘIREA (9 aug, ownerul: „nu are buton ieșire"): pe pagina de sine
 // stătătoare te întoarce la Kelion; în tabul din aplicație butonul dispare —
 // tabul are deja ×-ul lui.
 var iesire=document.getElementById('iesire');
 if(window.top!==window.self){ iesire.style.display='none'; }
 iesire.onclick=function(){ if(history.length>1){ history.back(); } else { location.href='/'; } };
 document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'&&window.top===window.self){ iesire.onclick(); } });

 // GRAFICUL PROFESIONAL — lightweight-charts v5 (motorul TradingView, local).
 var chart=LightweightCharts.createChart(document.getElementById('graf'),{
   layout:{background:{color:'#0e1428'},textColor:'#8b93ad'},
   grid:{vertLines:{color:'#141b33'},horzLines:{color:'#141b33'}},
   timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#1c2440'},
   rightPriceScale:{borderColor:'#1c2440'},
   crosshair:{mode:0},
   autoSize:true
 });
 var serie=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#4ade80',downColor:'#f87171',wickUpColor:'#4ade80',wickDownColor:'#f87171',borderVisible:false});
 // VOLUMUL sub lumanari (revizia: exista in date, nu era desenat) + medii
 var vol=chart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false});
 vol.priceScale().applyOptions({scaleMargins:{top:0.8,bottom:0}});
 chart.priceScale('right').applyOptions({scaleMargins:{top:0.08,bottom:0.22}});
 var ma20=chart.addSeries(LightweightCharts.LineSeries,{color:'#eab308',lineWidth:1,lastValueVisible:false,priceLineVisible:false});
 var ema50=chart.addSeries(LightweightCharts.LineSeries,{color:'#60a5fa',lineWidth:1,lastValueVisible:false,priceLineVisible:false});
 function sma(l,n){var out=[],s2=0;for(var i=0;i<l.length;i++){s2+=l[i].inchis;if(i>=n)s2-=l[i-n].inchis;if(i>=n-1)out.push({time:Math.floor(l[i].t/1000),value:s2/n});}return out;}
 function ema(l,n){var out=[],k=2/(n+1),e=null;for(var i=0;i<l.length;i++){e=e===null?l[i].inchis:l[i].inchis*k+e*(1-k);if(i>=n-1)out.push({time:Math.floor(l[i].t/1000),value:e});}return out;}
 // LEGENDA OHLC la crosshair (revizia: graficul era mut la hover)
 var leg=document.getElementById('leg');
 chart.subscribeCrosshairMove(function(par){
   var d=par&&par.seriesData?par.seriesData.get(serie):null;
   if(!d||d.open===undefined){ leg.textContent=''; return; }
   var v=par.seriesData.get(vol);
   var pct=d.open?((d.close-d.open)/d.open*100):0;
   leg.textContent='O '+d.open+'  H '+d.high+'  L '+d.low+'  C '+d.close+'  ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)'+(v&&v.value?('  V '+Math.round(v.value)):'');
 });
 function zecimale(x){var s2=String(x);var i=s2.indexOf('.');return i<0?2:Math.min(8,s2.length-i-1);}

 function eCripto(sim){ return /^[A-Z0-9]{5,}$/.test(sim) && sim.indexOf('.')<0 && sim.indexOf('^')<0; }
 function oraMs(t){ var d=new Date(t); function z(n,l){ return String(n).padStart(l||2,'0'); }
   return z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds())+'.'+z(d.getMilliseconds(),3); }

 // NIVELURILE LUI KELION PE GRAFIC (9 aug: „ce spune trebuie să arate clar pe
 // grafic") — linii de preț cu etichetă pe axă; se șterg la schimbarea
 // simbolului (nivelurile vechi ar minți pe alt simbol).
 function culoareNivel(nume){
   if(nume.indexOf('intrare')>=0||nume.indexOf('cumpar')>=0) return '#4ade80';
   if(nume.indexOf('stop')>=0) return '#f87171';
   if(nume.indexOf('tint')>=0||nume.indexOf('țint')>=0||nume.indexOf('iesire')>=0||nume.indexOf('ieșire')>=0) return '#60a5fa';
   if(nume.indexOf('suport')>=0) return '#eab308';
   if(nume.indexOf('rezist')>=0) return '#c084fc';
   return '#b9c2da';
 }
 function aratNiveluri(niveluri){
   for(var i=0;i<liniile.length;i++){ try{serie.removePriceLine(liniile[i]);}catch(e){} }
   liniile=[];
   if(!niveluri||!niveluri.length) return;
   for(var j=0;j<niveluri.length;j++){
     var n=niveluri[j];
     liniile.push(serie.createPriceLine({price:n.valoare,color:culoareNivel(n.nume),lineWidth:2,lineStyle:2,axisLabelVisible:true,title:n.nume}));
   }
 }

 async function pret(){
   try{
     var r=await fetch('/api/tranzactii/date?simbol='+encodeURIComponent(s.value)+'&interval='+interval);
     var j=await r.json();
     if(j.error){ p.textContent='—'; va.innerHTML='<span class=rau>'+j.error+'</span>'; return; }
     if(!ws||!primaTranzactie){ p.textContent=j.pret; }
     va.innerHTML='24h: <span class="'+(j.variatie24h>=0?'sus':'jos')+'">'+j.variatie24h+'%</span> · '+j.simbol+' · '+j.sursa+' · lumânări '+j.interval;
     var zilnic=String(j.sursa||'').indexOf('Stooq')>=0;
     document.querySelectorAll('.int').forEach(function(b){ b.disabled=zilnic&&b.textContent!=='1d'; });
     if(zilnic&&!ws){ viu.textContent='bursă clasică: lumânări ZILNICE reale (intraday tick-cu-tick cere abonament de date — se leagă când alegi furnizorul)'; }
     // Cu fluxul live pe lumânări deschis, NU rescriem seria la fiecare poll —
     // ți-ar reseta zoomul; fluxul kline ține lumânarea curentă vie.
     if(primaIncarcare||zilnic||!ws){
       serie.setData(j.lumanari.map(function(c){ return {time:Math.floor(c.t/1000),open:c.deschis,high:c.maxim,low:c.minim,close:c.inchis}; }));
       vol.setData(j.lumanari.map(function(c){ return {time:Math.floor(c.t/1000),value:c.volum,color:c.inchis>=c.deschis?'#4ade8055':'#f8717155'}; }));
       ma20.setData(sma(j.lumanari,20)); ema50.setData(ema(j.lumanari,50));
       if(primaIncarcare){
         var p0=zecimale(j.pret);
         serie.applyOptions({priceFormat:{type:'price',precision:p0,minMove:Math.pow(10,-p0)}});
         chart.timeScale().fitContent(); primaIncarcare=false;
       }
     }
   }catch(e){ va.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
 }

 // LIVE (9 aug: „real ca în live… la miime de secundă"): un singur socket cu
 // DOUĂ fluxuri — @trade (prețul la fiecare tranzacție, ms-ul bursei) și
 // @kline (lumânarea CURENTĂ, mișcându-se în timp real pe grafic).
 function opresteViu(){ if(ws){ try{ws.close();}catch(e){} ws=null; } }
 function pornesteViu(sim){
   opresteViu();
   if(!eCripto(sim)) return;
   try{
     var st=sim.toLowerCase();
     var w=new WebSocket('wss://stream.binance.com:9443/stream?streams='+st+'@trade/'+st+'@kline_'+interval);
     ws=w; primaTranzactie=false; pretVechi=0;
     w.onopen=function(){ reconectDelay=1000; };
     w.onmessage=function(ev){ try{
       var m=JSON.parse(ev.data); var d=(m&&m.data)||{};
       if(d.e==='trade'){
         var nou=Number(d.p);
         if(nou>0){ primaTranzactie=true; p.textContent=nou; p.className='pret '+(pretVechi&&nou>=pretVechi?'sus':pretVechi?'jos':'sus'); pretVechi=nou;
           viu.textContent='● LIVE (flux Binance, tranzacție cu tranzacție) · ultima: '+oraMs(d.T)+' — milisecunda bursei'; }
       } else if(d.e==='kline'&&d.k){
         var k=d.k;
         serie.update({time:Math.floor(k.t/1000),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c)});
       }
     }catch(e){} };
     w.onerror=function(){ if(ws===w){ viu.textContent='fluxul live a picat — rămân pe împrospătarea la 10s (rețeaua/blocantul browserului?)'; } };
     // Revizia: fluxul murea tacut si eticheta ramanea „● LIVE" — stare
     // afisata nemasurata. Acum: eticheta onesta + reconectare cu backoff.
     w.onclose=function(){ if(ws===w){ ws=null;
       if(simbolCurent&&eCripto(simbolCurent)){
         viu.textContent='fluxul live s-a inchis — reconectez in '+Math.round(reconectDelay/1000)+'s…';
         setTimeout(function(){ if(!ws&&simbolCurent&&eCripto(simbolCurent)){ void pret(); pornesteViu(simbolCurent); } }, reconectDelay);
         reconectDelay=Math.min(reconectDelay*2,30000);
       }
     } };
   }catch(e){ viu.textContent='fluxul live nu a pornit ('+e+') — împrospătare la 10s'; }
 }

 function urmareste(){
   var sim=s.value.toUpperCase().trim();
   if(sim!==simbolCurent){ simbolCurent=sim; primaIncarcare=true; aratNiveluri([]); }
   if(ceas)clearInterval(ceas);
   void pret(); ceas=setInterval(pret,10000);
   pornesteViu(sim);
 }
 v.onclick=urmareste;
 document.querySelectorAll('.chip').forEach(function(b){ b.onclick=function(){ s.value=b.textContent; urmareste(); }; });
 document.querySelectorAll('.int').forEach(function(b){ b.onclick=function(){ if(b.disabled)return; interval=b.textContent;
   document.querySelectorAll('.int').forEach(function(o){o.classList.remove('activ');}); b.classList.add('activ'); primaIncarcare=true; urmareste(); }; });

 an.onclick=async function(){
   an.disabled=true; out.textContent='Kelion citește piața, memoria apelurilor și gândește (~30-60s)…';
   try{
     var r=await fetch('/api/tranzactii/analiza',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({simbol:s.value,interval:interval})});
     var j=await r.json();
     out.innerHTML=j.error?'<span class=rau>'+j.error+'</span>':String(j.analiza).replace(/</g,'&lt;');
     if(!j.error){ aratNiveluri(j.niveluri); }
   }catch(e){ out.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
   an.disabled=false;
 };

 // CHATUL (9 aug): ancorat în simbolul+intervalul de pe ecran; nivelurile din
 // răspuns se desenează pe grafic; răspunsul se și SPUNE (gura Chirp).
 cv.onclick=function(){ cuVoce=!cuVoce; cv.textContent=cuVoce?'🔊':'🔇'; if(!cuVoce){ coadaAudio=[]; if(gura){ try{gura.pause();}catch(e){} } curataGura(false); } };
 // VOCEA VINE DIN CREIERUL UNIC (9 aug, ownerul: „modelul de chat cerut peste
 // tot" + „în chat audio nu merge"): chatul de aici NU mai are alt motor — e
 // ACELAȘI /api/chat ca peste tot (aceeași persona, același model, aceleași
 // unelte, aceeași gură Chirp). Framele {audio} din flux se redau la coadă.
 var coadaAudio=[], urlCurent=null;
 function curataGura(maiDeparte){
   if(urlCurent){ try{URL.revokeObjectURL(urlCurent);}catch(e){} urlCurent=null; }
   gura=null;
   if(maiDeparte) redaUrmatorul();
 }
 function redaUrmatorul(){
   if(!cuVoce||gura||!coadaAudio.length) return;
   var b64=coadaAudio.shift();
   try{
     var oct=atob(b64), buf=new Uint8Array(oct.length);
     for(var i=0;i<oct.length;i++){ buf[i]=oct.charCodeAt(i); }
     urlCurent=URL.createObjectURL(new Blob([buf],{type:'audio/mpeg'}));
     gura=new Audio(urlCurent);
     gura.onended=function(){ curataGura(true); };
     gura.onerror=function(){ curataGura(true); }; // un frame stricat nu omoara vocea
     void gura.play().catch(function(){ coadaAudio=[]; curataGura(false); cv.title='Vocea e blocată de browser — apasă 🔊 și trimite iar.'; });
   }catch(e){ curataGura(true); }
 }
 function scrieRand(cine,text){
   jurnal.style.display='block';
   var r=document.createElement('div');
   r.style.margin='.35rem 0'; r.style.whiteSpace='pre-wrap'; r.style.wordBreak='break-word';
   r.style.color = cine==='kelion' ? '#e8ecf6' : '#8fb7ff';
   r.textContent=(cine==='kelion'?'Kelion: ':'Tu: ')+text;
   jurnal.appendChild(r); jurnal.scrollTop=jurnal.scrollHeight;
   return r;
 }
 // NIVELURI: aceeași extragere ca pe server (rândul NIVELURI: nume=valoare; …)
 function normalizeazaNumarText(brut){
   var t=String(brut||'').trim().replace(/\s+/g,'');
   if(!t) return null;
   var s2=t;
   if(/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)){
     var m=t.match(/^(.*?)([.,](\d{1,2}))?$/);
     var intreg=(m&&m[1]?m[1]:t).replace(/[.,]/g,'');
     s2=(m&&m[3])?(intreg+'.'+m[3]):intreg;
   } else { s2=t.replace(',','.'); }
   var v=Number(s2);
   return (isFinite(v)&&v>0)?v:null;
 }
 function extrageNiveluriText(text){
   var curat=String(text||'').replace(/[*_\u0060]/g,'');
   var aparitii=curat.match(/NIVELURI\s*:?\s*[^\n]*/gi)||[];
   for(var a=aparitii.length-1;a>=0;a--){
     var out=[], re=/([a-zăâîșțşţ_ -]+?)\s*=\s*[~≈$€£]?\s*([0-9][0-9.,\s]*)/gi, pm;
     while((pm=re.exec(aparitii[a]))&&out.length<8){
       var val=normalizeazaNumarText(pm[2]);
       if(val!==null) out.push({nume:pm[1].trim().toLowerCase(),valoare:val});
     }
     if(out.length) return out;
   }
   return [];
 }
 async function trimiteChat(){
   var q=ci.value.trim(); if(!q) return;
   ci.value=''; ct.disabled=true; ci.disabled=true;
   scrieRand('eu',q); fir.push({cine:'eu',text:q});
   var asteapta=scrieRand('kelion','…');
   // ANCORA DE PIAȚĂ pe CREIERUL UNIC: întrebarea pleacă cu datele reale de pe
   // ecran în față — Kelion (același de peste tot) răspunde pe ele, scurt, cu
   // rândul NIVELURI: la final (se desenează pe grafic).
   var ancora='[CENTRUL DE TRANZACȚIONARE — pe ecran acum: '+simbolCurent+' preț '+p.textContent+', interval '+interval+
     '. Răspunde ca mentor de trading cu riscul întâi, SCURT (max 10 rânduri), DOAR pe cifre reale (de pe ecran sau din surse de pe net cu link și dată). '+
     'La final, pe rând separat, scrie exact: NIVELURI: intrare=…; stop=…; tinta=…; suport=…; rezistenta=… — doar cele care există; altfel NIVELURI: -] ';
   var mesaje=[];
   var coada=fir.slice(-8);
   for(var k=0;k<coada.length;k++){ mesaje.push({role:coada[k].cine==='kelion'?'assistant':'user',content:coada[k].text}); }
   mesaje[mesaje.length-1]={role:'user',content:ancora+q};
   try{
     var res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({messages:mesaje,serverVoiceOff:!cuVoce})});
     if(!res.ok||!res.body){ asteapta.textContent='Kelion: eroare HTTP '+res.status; }
     else{
       // FLUXUL /api/chat E SSE (revizia, constatarea 1): linii "id:"/"data:"
       // despartite de rand gol; textul REAL e in liniile data: (minus UN
       // spatiu), iar cadrele de control JSON stau intre doi U+001F. Un parser
       // care citea fluxul brut ar fi afisat "id:"/"data:" ca text (bug prins
       // de revizie inainte sa-l vada ownerul).
       var reader=res.body.getReader(), dec=new TextDecoder(), sseBuf='', text='';
       var CTRL=String.fromCharCode(31);
       function inghiteBucata(bucata){
         var b=bucata;
         for(;;){
           var i0=b.indexOf(CTRL);
           if(i0===-1){ text+=b; return; }
           text+=b.slice(0,i0);
           var i1=b.indexOf(CTRL,i0+1);
           if(i1===-1){ return; } // frame rupt la granita de eveniment — se ignora
           try{
             var frame=JSON.parse(b.slice(i0+1,i1));
             if(frame&&typeof frame.audio==='string'){ coadaAudio.push(frame.audio); redaUrmatorul(); }
           }catch(e){}
           b=b.slice(i1+1);
         }
       }
       for(;;){
         var pas=await reader.read();
         if(pas.done) break;
         sseBuf+=dec.decode(pas.value,{stream:true});
         for(;;){
           var taie=sseBuf.indexOf('\n\n');
           if(taie===-1) break;
           var ev=sseBuf.slice(0,taie); sseBuf=sseBuf.slice(taie+2);
           var linii=ev.split('\n'), bucati=[];
           for(var li=0;li<linii.length;li++){
             if(linii[li].indexOf('data:')===0){
               var v=linii[li].slice(5);
               if(v.charAt(0)===' ') v=v.slice(1);
               bucati.push(v);
             }
           }
           if(bucati.length) inghiteBucata(bucati.join('\n'));
         }
         asteapta.textContent='Kelion: '+text;
         jurnal.scrollTop=jurnal.scrollHeight;
       }
       if(text.trim()){
         asteapta.textContent='Kelion: '+text;
         fir.push({cine:'kelion',text:text});
         aratNiveluri(extrageNiveluriText(text));
       } else { asteapta.textContent='Kelion: (fără răspuns — vezi aplicația)'; }
     }
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
          `afirmații. RĂSPUNS SCURT, OBLIGATORIU: cel mult 10 rânduri — esența, nu eseu; detaliile vin ` +
          `DOAR dacă omul le cere explicit. REGULA DE FIER — DOAR PE REAL: fiecare cifră pe care o spui vine ori din datele ` +
          `reale de mai jos, ori dintr-o sursă de pe net cu link și dată; NICIO cifră inventată, NICIO ` +
          `„estimare" nespusă — ce nu ai măsurat spui că nu ai de unde să știi.` +
          `\n\nDATELE REALE de pe ecran acum:\n${ancora}${memoria}` +
          (istoric ? `\n\nCONVERSAȚIA de până acum:\n${istoric}` : '') +
          `\n\nÎNTREBAREA lui: ${intrebare}${CERE_NIVELURI}`,
        true,
      )
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const simbolLog = 'error' in d ? String(b?.simbol ?? '?') : d.simbol
      await addMemory(
        config.adminEmail,
        `[tranzactii-chat ${zi}] ${simbolLog} Î: ${intrebare.slice(0, 300)} | R: ${r.text.slice(0, 600)}`,
        'tranzactii',
      )
      return { raspuns: r.text, niveluri: extrageNiveluri(r.text) }
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
          `Fără promisiuni, fără „sigur". Datele:\n${rezumatPentruAgent(d)}${istoria}${CERE_NIVELURI}`,
        true,
      )
      const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await addMemory(config.adminEmail, `[tranzactii ${zi}] ${d.simbol} [pret ${d.pret}, ${d.interval}]: ${r.text.slice(0, 900)}`, 'tranzactii')
      return { analiza: r.text, simbol: d.simbol, pret: d.pret, sursa: d.sursa, niveluri: extrageNiveluri(r.text) }
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `agentul n-a răspuns: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` })
    }
  })
}
