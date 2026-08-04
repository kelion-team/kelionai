import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ROSTER, rosterViu, carteAgent } from '../services/agentiKelion.js'
import { pornesteCrearea, stareCreare } from '../services/enterpriseCreate.js'
import { adaugaAgentCustom } from '../db.js'
import { getSessionUser } from '../session.js'

// ── SCRIPTUL DE CREARE A AGENȚILOR ENTERPRISE, servit ca text ───────────────
//
// De ce există (Adrian, 4 aug): crearea agenților în CONSOLA Gemini Enterprise
// cere un cont cu LICENȚĂ ACTIVĂ, iar contul de serviciu al aplicației nu o are
// (măsurat de trei ori: FAILED_PRECONDITION „license not available", 403 pe
// billingAccountLicenseConfigs.list, activare doar la primul login de om). Deci
// ACEST script rulează cu contul OWNERULUI, din Cloud Shell-ul lui — care ARE
// licența (măsurat 4 aug: contul lui trece de zid și citește API-ul).
//
// Al doilea zid, deja rezolvat aici: agenții stau sub un ASSISTANT sub ENGINE.
// Motorul kelion-agenti există, dar îi lipsea „default_assistant" (404
// ASSISTANT_NOT_FOUND). Lanțul corect, citit din documentul de discovery al
// Google: assistants.create → assistants.agents.create (vezi scriptul jos).
//
// IMPORTANT: chiar și fără acest pas, agenții TRĂIESC ȘI LUCREAZĂ deja — sunt
// serviți viu la /api/a2a/<id> (services/agentiKelion.ts, routes/a2a.ts). Zidul
// licenței îl OCOLIM acolo; scriptul de aici doar îi mai LISTEAZĂ și în consola
// Google, cosmetic, când ownerul se loghează.
//
// Problema mecanică a fost că paste-ul scriptului lung rupea terminalul. Soluția:
// aplicația SERVEȘTE scriptul la un link, iar ownerul rulează O SINGURĂ linie
// scurtă, care nu se rupe:
//
//     curl -s https://kelionai.app/api/enterprise/agenti.py | python3
//
// Scriptul NU conține niciun secret: tokenul vine din `gcloud auth
// print-access-token` (rulează în shell-ul ownerului, nu aici), deci e sigur să
// fie public. Rosterul ȘI cărțile A2A vin din SURSA UNICĂ (agentiKelion.ts), ca
// listarea din consolă să fie identică cu endpointul viu. La final afișează
// LISTA agenților citită din API — dovada.

const PROIECT = 'gen-lang-client-0460348646'

function pythonScript(): string {
  // Sursa unică: fiecare agent cu cartea lui A2A construită în TS (agentiKelion),
  // ca Python doar s-o POST-eze — o singură formă de carte în toată casa.
  // ATENȚIE (bug 4 aug, „NameError: false" la Adrian în Cloud Shell): datele NU
  // se lipesc ca literal Python — cartea conține `false` (din JSON), pe care
  // Python nu-l cunoaște (el scrie `False`). Le trecem ca ȘIR JSON parsat cu
  // `json.loads`, care înțelege nativ false/true/null. `JSON.stringify(data)`
  // produce un literal-șir valid și în Python (aceleași escape-uri: \\", \\\\,
  // \\n, \\uXXXX) — deci `json.loads("...")` e sintaxă corectă în ambele limbi.
  const agenti = ROSTER.map((a) => ({ nume: a.nume, rol: a.rol, card: carteAgent(a) }))
  const data = JSON.stringify(agenti)
  return `#!/usr/bin/env python3
# Creeaza agentii lui Kelion in Gemini Enterprise, cu contul TAU (Cloud Shell).
# Tokenul vine din gcloud (contul tau logat, licentiat). Zero secrete aici.
#
# Lantul CORECT (citit din documentul de discovery al Google, 4 aug): agentii
# stau sub un ASSISTANT, care sta sub ENGINE. Motorul kelion-agenti exista, dar
# ii lipsea assistantul 'default_assistant' (de aici 404 ASSISTANT_NOT_FOUND la
# contul tau). Deci: intai cream assistantul (assistants.create), apoi agentii
# (assistants.agents.create). Ambele metode confirmate in API-ul v1alpha.
import json, subprocess, urllib.request, urllib.error
P = ${JSON.stringify(PROIECT)}
AGENTI = json.loads(${JSON.stringify(data)})
B = 'https://discoveryengine.googleapis.com/v1alpha'
ENG = f'projects/{P}/locations/global/collections/default_collection/engines/kelion-agenti'
ASST = ENG + '/assistants/default_assistant'
try:
    T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
except Exception as e:
    print('Nu pot lua tokenul din gcloud:', e); raise SystemExit(1)

def api(m, path, body=None):
    r = urllib.request.Request(B + '/' + path, method=m,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    try:
        return 200, json.loads(urllib.request.urlopen(r).read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

def err(j):
    return str(j.get('error', {}).get('message', json.dumps(j)))[:300]

print('== Agentii lui Kelion in Gemini Enterprise ==')

# 1. Asigura ASSISTANTUL (cutia in care stau agentii).
st, j = api('GET', ASST)
if st == 404:
    print('default_assistant lipseste -> il creez...')
    st, j = api('POST', ENG + '/assistants?assistantId=default_assistant', {'displayName': 'Kelion'})
    if st == 200:
        print('  assistant creat.')
    elif st == 409:
        print('  assistant exista deja (ok).')
    else:
        print('  NU pot crea assistantul: HTTP', st, err(j)); raise SystemExit(1)
elif st != 200:
    print('Nu pot verifica assistantul: HTTP', st, err(j)); raise SystemExit(1)
else:
    print('default_assistant exista deja.')

# 2. Citeste agentii existenti (idempotenta pe displayName).
st, j = api('GET', ASST + '/agents?pageSize=200')
if st != 200:
    print('Nu pot citi agentii: HTTP', st, err(j)); raise SystemExit(1)
ex = {a.get('displayName') for a in j.get('agents', [])}

# 3. Creeaza cei 33.
c = s = f = 0
for a in AGENTI:
    nume = a['nume']; rol = a['rol']; card = a['card']
    if nume in ex:
        s += 1; continue
    st, res = api('POST', ASST + '/agents',
        {'displayName': nume, 'description': rol,
         'a2aAgentDefinition': {'jsonAgentCard': json.dumps(card, ensure_ascii=False)}})
    if st == 200:
        c += 1; print('  OK', nume)
    else:
        f += 1
        print('  X', nume, 'HTTP', st, err(res))
        if f == 1 and 'license' in err(res).lower():
            print('\\n>>> Contul tau nu are licenta Gemini Enterprise activa pe', P)
            print('>>> Aloca-ti o licenta pe ACEST proiect, apoi ruleaza din nou.')
            raise SystemExit(1)
print(f'bilant: creati {c}, existau {s}, esuati {f} (din {len(AGENTI)})')

# 4. Dovada: lista finala citita din API.
st, j = api('GET', ASST + '/agents?pageSize=200')
L = [a.get('displayName') for a in j.get('agents', [])]
print('LISTA DIN API (' + str(len(L)) + '):')
for n in L:
    print('  -', n)
`
}

// Pagina de admin: DOUĂ butoane. „Conectează Google (Enterprise)" trece prin
// fluxul OAuth existent (acum cu scope cloud-platform, auth.ts) ca serverul să
// primească permisiunea pe contul ownerului; „Creează cei 33" cheamă serverul,
// care-i creează în consolă cu tokenul lui. Fără Cloud Shell, fără secrete.
function paginaAdmin(total: number): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agenții Kelion → Google Enterprise</title>
<style>
 body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#0b1020;color:#e8ecf6}
 h1{font-size:1.3rem} p{line-height:1.5;color:#b9c2da}
 a.btn,button{display:inline-block;margin:.4rem .4rem .4rem 0;padding:.7rem 1.1rem;border-radius:.6rem;border:0;font-size:1rem;cursor:pointer;text-decoration:none}
 a.btn{background:#2a3550;color:#fff} button{background:#3b82f6;color:#fff}
 button:disabled{opacity:.5;cursor:default}
 pre{background:#111830;padding:1rem;border-radius:.6rem;white-space:pre-wrap;word-break:break-word}
 .ok{color:#4ade80}.rau{color:#f87171}
</style></head><body>
<h1>Agenții lui Kelion → consola Google Enterprise</h1>
<p>Pas 1: apasă <b>Conectează Google (Enterprise)</b> și loghează-te — dai permisiunea o singură dată (rămâne salvată).<br>
Pas 2: apasă <b>Creează cei ${total}</b> O SINGURĂ DATĂ. Serverul lucrează în fundal cu ritm (quota Google) și <b>continuă singur</b> — reîncearcă la 15 minute și reia și după un restart de server; cine e confirmat iese din listă. Pagina arată viu „instalați X | rămași Y"; poți s-o și închizi.</p>
<a class="btn" href="/auth/google/connect">🔗 Conectează Google (Enterprise)</a>
<button id="b">🚀 Creează cei ${total} în Enterprise</button>
<pre id="out">—</pre>
<h1 style="font-size:1.05rem;margin-top:2rem">➕ Pune un agent nou (creat automat)</h1>
<p>Scrii numele și meseria — serverul îl salvează, îl servește pe loc la /api/a2a și îl bagă automat și în consola Google (la ocolul următor de creare).</p>
<input id="an" placeholder="Numele agentului (ex: Agent Gradinar)" style="width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #2a3550;background:#111830;color:#e8ecf6;margin:.2rem 0">
<textarea id="ar" placeholder="Meseria lui, pe scurt (ex: Gradina: ce plantezi, cand uzi, boli ale plantelor...)" rows="3" style="width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #2a3550;background:#111830;color:#e8ecf6;margin:.2rem 0"></textarea>
<label style="display:block;margin:.2rem 0"><input type="checkbox" id="ah"> gândire profundă (mai scump, pentru meserii grele)</label>
<label style="display:block;margin:.2rem 0"><input type="checkbox" id="aa"> doar eu îl pot folosi (doar admin)</label>
<button id="ab">➕ Pune agentul</button>
<pre id="aout">—</pre>
<script>
 const b=document.getElementById('b'), out=document.getElementById('out');
 let ceas=null;
 function opreste(){ if(ceas){clearInterval(ceas); ceas=null;} b.disabled=false; }
 function final(j){
   let s=(j.licenta?'Licență: '+j.licenta+'\\n\\n':'')+(j.motiv?'Motiv: '+j.motiv+'\\n\\n':'')+'Creați: '+j.creati+' | existau: '+j.existau+' | eșuați: '+j.esuati+'\\nLISTA în consolă ('+j.lista.length+'):\\n'+j.lista.map(n=>'  - '+n).join('\\n');
   if(j.primaEroare) s+='\\n\\nPrima eroare (verbatim): '+j.primaEroare;
   out.innerHTML=(j.ok?'<span class=ok>✅ GATA — toți cei ${total} sunt în Google Enterprise.</span>\\n':'<span class=rau>Nu toți au intrat încă — serverul continuă SINGUR (reîncearcă la 15 min, cei intrați ies din listă). Poți închide pagina.</span>\\n')+s;
 }
 function arata(st, prima){
   if(st.error){ if(!prima) out.innerHTML='<span class=rau>Refuz: '+st.error+'</span>'; opreste(); return; }
   if(st.raport){ final(st.raport); opreste(); return; }
   if(st.ruleaza){ b.disabled=true; out.textContent='⏳ '+st.pas; if(!ceas) ceas=setInterval(stare,3000); return; }
   if(prima) return; /* nepornit la deschiderea paginii — nimic de arătat */
   out.innerHTML='<span class=rau>Crearea nu (mai) rulează în clipa asta — serverul o reia singur (la 15 min sau după restart). Poți și apăsa din nou, nu strică: cei intrați se sar.</span>'; opreste();
 }
 async function stare(prima){
   try{ const r=await fetch('/api/enterprise/creeaza/stare'); arata(await r.json(), prima===true); }
   catch(e){ out.textContent='Rețea (reîncerc): '+e; }
 }
 b.onclick=async()=>{
   b.disabled=true; out.textContent='Pornesc crearea în fundal…';
   try{
     const r=await fetch('/api/enterprise/creeaza',{method:'POST'});
     const txt=await r.text();
     let st; try{ st=JSON.parse(txt); }catch(_){ out.innerHTML='<span class=rau>Serverul a răspuns non-JSON (HTTP '+r.status+') — probabil repornea. Reîncearcă în câteva secunde.</span>'; b.disabled=false; return; }
     arata(st, false);
   }catch(e){ out.innerHTML='<span class=rau>Eroare rețea: '+e+'</span>'; b.disabled=false; }
 };
 /* Pagină (re)deschisă în timp ce fundalul lucrează → arată-l din prima. */
 void stare(true);
 const ab=document.getElementById('ab'), aout=document.getElementById('aout');
 ab.onclick=async()=>{
   ab.disabled=true; aout.textContent='Îl pun…';
   try{
     const r=await fetch('/api/enterprise/agent-nou',{method:'POST',headers:{'content-type':'application/json'},
       body:JSON.stringify({nume:document.getElementById('an').value,rol:document.getElementById('ar').value,
         efort:document.getElementById('ah').checked?'high':undefined,doarAdmin:document.getElementById('aa').checked||undefined})});
     const j=await r.json();
     if(j.error){aout.innerHTML='<span class=rau>Refuz: '+j.error+'</span>';}
     else{aout.innerHTML='<span class=ok>✅ Pus: '+j.id+' — e viu la /api/a2a/'+j.id+' și intră automat în consolă (crearea a pornit).</span>';
       document.getElementById('an').value='';document.getElementById('ar').value='';
       if(!ceas) ceas=setInterval(stare,3000);}
   }catch(e){aout.innerHTML='<span class=rau>Eroare rețea: '+e+'</span>';}
   ab.disabled=false;
 };
</script></body></html>`
}

/** Gardul comun al rutelor de admin: întoarce userul sau null (după 403). */
function adminSau403(req: FastifyRequest, reply: FastifyReply): { email: string } | null {
  const user = getSessionUser(req)
  if (user && user.role === 'admin') return user
  reply.code(403)
  return null
}

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  // Public, fără secrete — doar sursa scriptului (tokenul e al ownerului, la runtime).
  app.get('/api/enterprise/agenti.py', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return pythonScript()
  })

  // Pagina de admin (butonul cerut de owner: „pui în admin buton, eu loghez și
  // continui"). DOAR admin — folosește tokenul Google al ownerului.
  app.get('/api/enterprise/creeaza', async (req, reply) => {
    if (!adminSau403(req, reply)) return { error: 'forbidden' }
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return paginaAdmin((await rosterViu()).length)
  })

  // Execuția: PORNEȘTE crearea în FUNDAL cu tokenul Google al ownerului și
  // întoarce imediat starea; pagina citește /stare până la raportul final.
  // De ce fundal (măsurat 4 aug): quota Google (429) cere pauze de zeci de
  // secunde, iar gateway-ul taie cererile la ~60s (504) — nu încape într-o
  // singură cerere HTTP. DOAR admin.
  app.post('/api/enterprise/creeaza', async (req, reply) => {
    const user = adminSau403(req, reply)
    if (!user) return { error: 'forbidden' }
    reply.code(202)
    return pornesteCrearea(user.email)
  })

  // Starea creării din fundal (pagina o întreabă la câteva secunde). DOAR admin.
  app.get('/api/enterprise/creeaza/stare', async (req, reply) => {
    if (!adminSau403(req, reply)) return { error: 'forbidden' }
    return stareCreare()
  })

  // AGENT NOU pus de owner (4 aug: „când mai vreau un model de agent să pot
  // pune și să fie creat automat"): salvează în DB → intră PE LOC în rosterul
  // viu (/api/a2a) → pornește crearea în fundal ca să apară și în consolă,
  // cu ritmul și reluarea știute. DOAR admin.
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
    pornesteCrearea(user.email)
    return { ok: true, id }
  })
}
