import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getSessionUser } from '../session.js'
import { gasesteAgent, cheamaAgent } from '../services/agentiKelion.js'

// ── PANOUL DE TRANZACȚIONARE (Adrian, 4 aug: „buton separat în admin,
// interfață super avansată, pe care Kelion să o managerieze ca un trader
// avansat performant") ───────────────────────────────────────────────────────
//
// CE E, cinstit: date de piață REALE (Binance public — fără cheie, gratuit:
// preț, variație 24h, lumânări 1h) + ANALIZA agentului „tranzactii" (doar
// admin, gândire 'high') pe cifrele măsurate, cu riscul întâi.
// CE NU E, la fel de cinstit: EXECUȚIE. Niciun broker nu e legat — pagina nu
// poate plasa ordine și o spune. Când ownerul alege un broker cu API, execuția
// devine pasul următor; până atunci orice „am cumpărat" ar fi minciună.
//
// Contract de eșec: Binance necitibil → eroarea verbatim, nu cifre inventate.

const B_BINANCE = 'https://api.binance.com/api/v3'

function adminul(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  const user = getSessionUser(req)
  if (user && user.role === 'admin') return user
  reply.code(403)
  return null
}

interface Lumanare {
  t: number
  deschis: number
  maxim: number
  minim: number
  inchis: number
  volum: number
}

/** Datele REALE ale unui simbol: preț acum, variație 24h, ultimele lumânări 1h. */
async function dateSimbol(simbol: string): Promise<
  { simbol: string; pret: number; variatie24h: number; lumanari: Lumanare[] } | { error: string }
> {
  const s = simbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  if (!s) return { error: 'simbol gol' }
  try {
    const [t24r, klr] = await Promise.all([
      fetch(`${B_BINANCE}/ticker/24hr?symbol=${s}`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${B_BINANCE}/klines?symbol=${s}&interval=1h&limit=72`, { signal: AbortSignal.timeout(8000) }),
    ])
    if (!t24r.ok || !klr.ok) {
      return { error: `Binance a refuzat simbolul „${s}" (HTTP ${t24r.ok ? klr.status : t24r.status}) — verifică scrierea (ex: BTCUSDT, ETHUSDT)` }
    }
    const t24 = (await t24r.json()) as { lastPrice?: string; priceChangePercent?: string }
    const kl = (await klr.json()) as [number, string, string, string, string, string][]
    return {
      simbol: s,
      pret: Number(t24.lastPrice ?? 0),
      variatie24h: Number(t24.priceChangePercent ?? 0),
      lumanari: kl.map((k) => ({
        t: k[0],
        deschis: Number(k[1]),
        maxim: Number(k[2]),
        minim: Number(k[3]),
        inchis: Number(k[4]),
        volum: Number(k[5]),
      })),
    }
  } catch (e) {
    return { error: `piața necitibilă acum: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
  }
}

/** Rezumatul numeric pe care îl primește agentul — FAPTE, nu impresii. */
function rezumatPentruAgent(d: { simbol: string; pret: number; variatie24h: number; lumanari: Lumanare[] }): string {
  const l = d.lumanari
  const inchideri = l.map((x) => x.inchis)
  const min72 = Math.min(...l.map((x) => x.minim))
  const max72 = Math.max(...l.map((x) => x.maxim))
  const medie = inchideri.reduce((a, b) => a + b, 0) / (inchideri.length || 1)
  const ultimele12 = l.slice(-12).map((x) => `${new Date(x.t).toISOString().slice(5, 16)} O:${x.deschis} H:${x.maxim} L:${x.minim} C:${x.inchis} V:${Math.round(x.volum)}`)
  return (
    `Simbol: ${d.simbol} (sursa: Binance, acum). Preț: ${d.pret}. Variație 24h: ${d.variatie24h}%.\n` +
    `Pe ultimele 72 ore (lumânări 1h): minim ${min72}, maxim ${max72}, medie închideri ${medie.toFixed(2)}.\n` +
    `Ultimele 12 lumânări (1h):\n${ultimele12.join('\n')}`
  )
}

function paginaTranzactii(): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kelion — Tranzacționare</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:840px;margin:2rem auto;padding:0 1rem;background:#0b1020;color:#e8ecf6}
 h1{font-size:1.3rem} p{line-height:1.5;color:#b9c2da}
 input,button{padding:.6rem 1rem;border-radius:.6rem;border:1px solid #2a3550;font-size:1rem}
 input{background:#111830;color:#e8ecf6} button{background:#3b82f6;color:#fff;border:0;cursor:pointer;margin-left:.4rem}
 button:disabled{opacity:.5;cursor:default}
 pre{background:#111830;padding:1rem;border-radius:.6rem;white-space:pre-wrap;word-break:break-word}
 .ok{color:#4ade80}.rau{color:#f87171}
 .pret{font-size:2rem;font-weight:700;margin:.4rem 0}
 .sus{color:#4ade80}.jos{color:#f87171}
 .nota{font-size:.85rem;color:#8b93ad;border-left:3px solid #2a3550;padding-left:.7rem}
</style></head><body>
<h1>📈 Tranzacționare — Kelion, traderul tău analist</h1>
<p>Date REALE de piață (Binance, fără cheie) + analiza agentului „Tranzacții" (gândire profundă, doar tu). </p>
<p class="nota">Cinstit: pagina NU plasează ordine — niciun broker nu e legat încă. Kelion analizează cu riscul întâi și nu promite câștiguri. Când alegi un broker cu API, execuția devine pasul următor.</p>
<div>
 <input id="s" value="BTCUSDT" placeholder="simbol (ex: BTCUSDT, ETHUSDT, SOLUSDT)">
 <button id="v">👁 Urmărește</button>
 <button id="an">🧠 Analiza lui Kelion</button>
</div>
<div class="pret" id="p">—</div>
<div id="var">—</div>
<pre id="out">Alege simbolul și apasă „Analiza lui Kelion" — primești regimul pieței, nivelurile importante și planul cu risc, pe cifrele de acum.</pre>
<script>
 const s=document.getElementById('s'), p=document.getElementById('p'), va=document.getElementById('var'), out=document.getElementById('out');
 const an=document.getElementById('an'), v=document.getElementById('v');
 let ceas=null;
 async function pret(){
   try{
     const r=await fetch('/api/tranzactii/date?simbol='+encodeURIComponent(s.value));
     const j=await r.json();
     if(j.error){ p.textContent='—'; va.innerHTML='<span class=rau>'+j.error+'</span>'; return; }
     p.textContent=j.pret;
     va.innerHTML='24h: <span class="'+(j.variatie24h>=0?'sus':'jos')+'">'+j.variatie24h+'%</span> · '+j.simbol+' · Binance, viu (10s)';
   }catch(e){ va.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
 }
 function urmareste(){ if(ceas)clearInterval(ceas); void pret(); ceas=setInterval(pret,10000); }
 v.onclick=urmareste;
 an.onclick=async()=>{
   an.disabled=true; out.textContent='Kelion citește piața și gândește (gândire profundă — poate dura ~30-60s)…';
   try{
     const r=await fetch('/api/tranzactii/analiza',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({simbol:s.value})});
     const j=await r.json();
     out.innerHTML=j.error?'<span class=rau>'+j.error+'</span>':j.analiza.replace(/</g,'&lt;');
   }catch(e){ out.innerHTML='<span class=rau>rețea: '+e+'</span>'; }
   an.disabled=false;
 };
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

  // Datele reale ale unui simbol (preț viu pe pagină). DOAR admin.
  app.get('/api/tranzactii/date', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    return dateSimbol(String((req.query as { simbol?: string }).simbol ?? 'BTCUSDT'))
  })

  // Analiza: datele măsurate → agentul „tranzactii" (gândire high). DOAR admin.
  app.post('/api/tranzactii/analiza', async (req, reply) => {
    if (!adminul(req, reply)) return { error: 'forbidden' }
    const d = await dateSimbol(String((req.body as { simbol?: string } | null)?.simbol ?? 'BTCUSDT'))
    if ('error' in d) return d
    const agent = gasesteAgent('tranzactii')
    if (!agent) return { error: 'agentul tranzactii lipsește din roster' }
    try {
      const r = await cheamaAgent(
        agent,
        `Analizează piața pe datele de mai jos, ca un trader avansat, cu riscul întâi.\n` +
          `Structura cerută: 1) Regimul pieței (trend/range, pe ce dovezi din cifre); 2) Niveluri importante ` +
          `(suport/rezistență din minime/maxime reale); 3) Scenarii (dacă… atunci…, cu invalidare clară); ` +
          `4) Riscul (mărimea poziției ca % din capital, unde stă stopul, raport risc/câștig); 5) Ce NU se vede în date. ` +
          `Fără promisiuni, fără „sigur". Datele:\n${rezumatPentruAgent(d)}`,
      )
      return { analiza: r.text, simbol: d.simbol, pret: d.pret, sursa: 'Binance (public), lumânări 1h × 72' }
    } catch (e) {
      return { error: `agentul n-a răspuns: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}` }
    }
  })
}
