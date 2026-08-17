import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { rosterViu } from '../services/agentiKelion.js'
import { adaugaAgentCustom, memoriePune } from '../db.js'
import { temeIscoada } from '../services/iscoada.js'
import { cerAdmin } from '../session.js'

// ── AGENȚII LUI KELION: DOAR ADĂUGAREA MANUALĂ (ordinul ownerului, 8 aug) ────
//
// „daca agenti autonomi sunt pe platforma si functionali, garantat de tine,
// scoate partea asta si sa ramina manual adaugarea dar functionala."
//
// Garanția a fost MĂSURATĂ pe live înainte de tăiere (8 aug): GET /api/a2a →
// 92 de agenți; POST /api/a2a/adevar „cât face 17×23?" → „391". Agenții
// lucrează în aplicație; consola Google Enterprise era doar vitrina, cu o
// cotă de creare măsurată la ~2/zi care a mâncat zile și a umplut jurnalul
// de 429. TOT lanțul de creare în consolă (services/enterpriseCreate.ts:
// OAuth cloud-platform, alocare licență, veghe pe cotă, jurnal 429) a fost
// SCOS — istoria completă rămâne în AI-HANDOFF §14/§3(B) și în git.
//
// Ce rămâne AICI: pagina de admin cu „agent nou" — salvat în DB, viu PE LOC
// la /api/a2a/<id> — și temele iscoadelor. Adresa paginii rămâne cea veche
// (/api/enterprise/creeaza) ca butonul din AdminPanel și linkurile salvate
// să meargă neatinse.

function paginaAdmin(total: number): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agenții lui Kelion — adaugă manual</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#0b1020;color:#e8ecf6}
 h1{font-size:1.3rem} p{line-height:1.5;color:#b9c2da}
 button{display:inline-block;margin:.4rem .4rem .4rem 0;padding:.7rem 1.1rem;border-radius:.6rem;border:0;font-size:1rem;cursor:pointer;background:#3b82f6;color:#fff}
 button:disabled{opacity:.5;cursor:default}
 pre{background:#111830;padding:1rem;border-radius:.6rem;white-space:pre-wrap;word-break:break-word}
 .ok{color:#4ade80}.rau{color:#f87171}
</style></head><body>
<h1>Agenții lui Kelion (${total} în lucru, vii la /api/a2a)</h1>
<p>Toți agenții lucrează DIRECT în aplicație: chat, piețe, /api/a2a/&lt;id&gt;. Crearea în consola Google Enterprise a fost scoasă (ordinul ownerului, 8 aug) — cota ei de ~2 agenți/zi, măsurată, nu aducea nimic: consola era doar vitrină. Aici doar ADAUGI agenți noi; intră în lucru pe loc.</p>
<h1 style="font-size:1.05rem;margin-top:2rem">➕ Pune un agent nou</h1>
<p>Scrii numele și meseria — serverul îl salvează și îl servește PE LOC la /api/a2a.</p>
<input id="an" placeholder="Numele agentului (ex: Agent Gradinar)" style="width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #2a3550;background:#111830;color:#e8ecf6;margin:.2rem 0">
<textarea id="ar" placeholder="Meseria lui, pe scurt (ex: Gradina: ce plantezi, cand uzi, boli ale plantelor...)" rows="3" style="width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #2a3550;background:#111830;color:#e8ecf6;margin:.2rem 0"></textarea>
<label style="display:block;margin:.2rem 0"><input type="checkbox" id="ah"> gândire profundă (mai scump, pentru meserii grele)</label>
<label style="display:block;margin:.2rem 0"><input type="checkbox" id="aa"> doar eu îl pot folosi (doar admin)</label>
<button id="ab">➕ Pune agentul</button>
<pre id="aout">—</pre>
<h1 style="font-size:1.05rem;margin-top:2rem">🔭 Temele iscoadelor (patrula 24/24)</h1>
<p>Ce caută iscoadele pe net, despărțite prin virgulă — noutățile intră singure în memoria lui Kelion. Gol = temele casei.</p>
<input id="ti" placeholder="ex: preturi componente PCB, noutati tranzactionare, stiri AI" style="width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #2a3550;background:#111830;color:#e8ecf6;margin:.2rem 0">
<button id="tb">🔭 Salvează temele</button>
<pre id="tout">—</pre>
<script>
 const ab=document.getElementById('ab'), aout=document.getElementById('aout');
 ab.onclick=async()=>{
   ab.disabled=true; aout.textContent='Îl pun…';
   try{
     const r=await fetch('/api/enterprise/agent-nou',{method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({nume:document.getElementById('an').value,rol:document.getElementById('ar').value,
         efort:document.getElementById('ah').checked?'high':undefined,doarAdmin:document.getElementById('aa').checked||undefined})});
     const j=await r.json();
     if(j.error){aout.innerHTML='<span class=rau>Refuz: '+j.error+'</span>';}
     else{aout.innerHTML='<span class=ok>✅ Pus: '+j.id+' — e viu la /api/a2a/'+j.id+' și intră imediat în lucru.</span>';
       document.getElementById('an').value='';document.getElementById('ar').value='';}
   }catch(e){aout.innerHTML='<span class=rau>Eroare rețea: '+e+'</span>';}
   ab.disabled=false;
 };
 const tb=document.getElementById('tb'), ti=document.getElementById('ti'), tout=document.getElementById('tout');
 void fetch('/api/enterprise/teme-iscoade').then(r=>r.json()).then(j=>{ if(j.teme){ ti.value=j.teme.join(', '); tout.textContent='Active: '+j.teme.join(' · '); } }).catch(()=>{});
 tb.onclick=async()=>{
   tb.disabled=true;
   try{
     const r=await fetch('/api/enterprise/teme-iscoade',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({teme:ti.value})});
     const j=await r.json();
     tout.innerHTML=j.error?'<span class=rau>Refuz: '+j.error+'</span>':'<span class=ok>✅ Salvate. Active: '+j.teme.join(' · ')+'</span>';
   }catch(e){tout.innerHTML='<span class=rau>Eroare rețea: '+e+'</span>';}
   tb.disabled=false;
 };
</script></body></html>`
}

/** Gardul comun al rutelor de admin — o singură sursă (cerAdmin, session.ts):
 *  401 pe sesiune moartă, 403 DOAR pe rol. */
function adminSau403(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  return cerAdmin(req, reply)
}

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  // Pagina de admin — adresa veche, păstrată ca butonul din AdminPanel să
  // meargă neatins. DOAR admin.
  app.get('/api/enterprise/creeaza', async (req, reply) => {
    if (!adminSau403(req, reply)) return { error: 'forbidden' }
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return paginaAdmin((await rosterViu()).length)
  })

  // AGENT NOU pus de owner (4 aug: „când mai vreau un model de agent să pot
  // pune și să fie creat automat"): salvează în DB → intră PE LOC în rosterul
  // viu (/api/a2a). DOAR admin.
  app.post('/api/enterprise/agent-nou', async (req, reply) => {
    const user = adminSau403(req, reply)
    if (!user) return { error: 'forbidden' }
    const b = (req.body ?? {}) as { nume?: string; rol?: string; efort?: string; doarAdmin?: boolean }
    const nume = (b.nume ?? '').trim().slice(0, 80)
    const rol = (b.rol ?? '').trim()
    if (nume.length < 3 || rol.length < 10) {
      reply.code(400)
      return { error: 'numele (min 3 caractere) și meseria (min 10 caractere) sunt obligatorii' }
    }
    const id = nume
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/^agent\s+/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    if (!id) {
      reply.code(400)
      return { error: 'din numele ăsta nu iese un id valid (folosește litere/cifre)' }
    }
    const err = await adaugaAgentCustom({ id, nume, rol, efort: b.efort === 'high' ? 'high' : undefined, doarAdmin: b.doarAdmin === true })
    if (err) {
      reply.code(409)
      return { error: err }
    }
    return { ok: true, id }
  })

  // TEMELE ISCOADELOR (4 aug: „iscoadele pe temele tale"): ownerul le scrie
  // aici, patrula le citește la fiecare ocol. GET = cele active; POST = salvează
  // (gol = înapoi la temele casei). DOAR admin.
  app.get('/api/enterprise/teme-iscoade', async (req, reply) => {
    if (!adminSau403(req, reply)) return { error: 'forbidden' }
    return { teme: await temeIscoada() }
  })
  app.post('/api/enterprise/teme-iscoade', async (req, reply) => {
    if (!adminSau403(req, reply)) return { error: 'forbidden' }
    const teme = String((req.body as { teme?: string } | null)?.teme ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10)
    await memoriePune('iscoada-teme', teme.join(', '))
    return { ok: true, teme: teme.length > 0 ? teme : await temeIscoada() }
  })
}
