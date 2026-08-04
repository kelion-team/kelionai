import type { FastifyInstance } from 'fastify'
import { ROSTER, carteAgent } from '../services/agentiKelion.js'
import { creeazaAgentiEnterprise, creeazaAgentiVertex } from '../services/enterpriseCreate.js'
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
function paginaAdmin(): string {
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
Pas 2: apasă <b>Creează cei 33</b>. Serverul îi creează în consolă cu contul tău licențiat.</p>
<a class="btn" href="/auth/google/connect">🔗 Conectează Google (Enterprise)</a>
<button id="b">🚀 Creează cei 33 în Enterprise</button>
<pre id="out">—</pre>
<script>
 const b=document.getElementById('b'), out=document.getElementById('out');
 b.onclick=async()=>{
   b.disabled=true; out.textContent='Creez agenții în consolă… (poate dura ~20s)';
   try{
     const r=await fetch('/api/enterprise/creeaza',{method:'POST',headers:{'content-type':'application/json'}});
     const txt=await r.text();
     let j; try{ j=JSON.parse(txt); }catch(_){ out.innerHTML='<span class=rau>Serverul a raspuns non-JSON (HTTP '+r.status+'). Reincearca peste cateva secunde. Inceput: '+txt.slice(0,120).replace(/</g,'&lt;')+'</span>'; b.disabled=false; return; }
     if(j.error){out.innerHTML='<span class=rau>Refuz: '+j.error+'</span>'; b.disabled=false; return;}
     let s=(j.licenta?'Licență: '+j.licenta+'\\n\\n':'')+'Creați: '+j.creati+' | existau: '+j.existau+' | eșuați: '+j.esuati+'\\nLISTA în consolă ('+j.lista.length+'):\\n'+j.lista.map(n=>'  - '+n).join('\\n');
     if(j.primaEroare) s+='\\n\\nPrima eroare (verbatim): '+j.primaEroare;
     out.innerHTML=(j.ok?'<span class=ok>✅ GATA — cei 33 sunt în Google Enterprise.</span>\\n':'<span class=rau>Nu toți au intrat — vezi mai jos.</span>\\n')+s;
   }catch(e){out.innerHTML='<span class=rau>Eroare rețea: '+e+'</span>';}
   b.disabled=false;
 };
</script></body></html>`
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
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') {
      reply.code(403)
      return { error: 'forbidden' }
    }
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return paginaAdmin()
  })

  // Execuția: creează cei 33 în consolă cu tokenul Google al ownerului. DOAR admin.
  app.post('/api/enterprise/creeaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') {
      reply.code(403)
      return { error: 'forbidden' }
    }
    // ÎNTÂI Vertex AI (Agent Platform, FĂRĂ abonament). Dacă acolo creează cei
    // 33, gata. Doar dacă Vertex nici măcar nu pornește (ne-conectat) SAU nu
    // creează niciunul, mai încercăm calea Enterprise (ca să vadă și diagnosticul
    // de licență/abonament). Așa ownerul primește ce merge, nu ce e blocat.
    const vertex = await creeazaAgentiVertex(user.email)
    if (vertex.creati > 0 || (vertex.lista.length >= 1 && !vertex.motiv)) {
      return vertex
    }
    const ent = await creeazaAgentiEnterprise(user.email)
    if (ent.creati > 0) return ent
    // Niciuna n-a creat — întoarce raportul cel mai informativ (Vertex are eroarea
    // verbatim a căii noi; dacă Vertex nici n-a pornit, dăm Enterprise).
    const raport = vertex.motiv && !vertex.primaEroare ? ent : vertex
    if (raport.motiv && raport.creati === 0 && raport.lista.length === 0) {
      reply.code(409)
      return { error: raport.motiv, licenta: raport.licenta, primaEroare: raport.primaEroare }
    }
    return raport
  })
}
