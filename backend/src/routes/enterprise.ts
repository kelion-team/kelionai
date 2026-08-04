import type { FastifyInstance } from 'fastify'
import { ROSTER, carteAgent } from '../services/agentiKelion.js'

// ── SCRIPTUL DE CREARE A AGENȚILOR ENTERPRISE, servit ca text ───────────────
//
// De ce există (Adrian, 4 aug): crearea agenților în CONSOLA Gemini Enterprise
// cere un cont cu LICENȚĂ ACTIVĂ, iar licența se activează doar la login
// interactiv de om — contul de serviciu al aplicației nu poate (măsurat de trei
// ori: FAILED_PRECONDITION „license not available", 403 pe
// billingAccountLicenseConfigs.list, activare doar la primul login în
// interfață). Deci ACEST script rulează cu contul OWNERULUI, din Cloud Shell-ul
// lui (unde e deja logat și licențiat) și înscrie agenții în consolă.
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
  const agenti = ROSTER.map((a) => ({ nume: a.nume, rol: a.rol, card: carteAgent(a) }))
  const data = JSON.stringify(agenti)
  return `#!/usr/bin/env python3
# Creeaza agentii lui Kelion in Gemini Enterprise, cu contul TAU (Cloud Shell).
# Tokenul vine din gcloud (contul tau logat, licentiat). Zero secrete aici.
import json, subprocess, urllib.request, urllib.error
P = ${JSON.stringify(PROIECT)}
AGENTI = ${data}
B = 'https://discoveryengine.googleapis.com/v1alpha'
A = f'projects/{P}/locations/global/collections/default_collection/engines/kelion-agenti/assistants/default_assistant'
try:
    T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
except Exception as e:
    print('Nu pot lua tokenul din gcloud:', e); raise SystemExit(1)

def api(m, path, body=None):
    r = urllib.request.Request(B + '/' + path, method=m,
        data=json.dumps(body).encode() if body else None,
        headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    try:
        return 200, json.loads(urllib.request.urlopen(r).read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

print('== Creez agentii lui Kelion in Gemini Enterprise ==')
st, j = api('GET', A + '/agents?pageSize=200')
if st != 200:
    print('Nu pot citi agentii existenti: HTTP', st, json.dumps(j)[:400])
    if st == 400 or st == 403:
        print('\\nProbabil contul tau nu are licenta ACTIVA pe proiectul', P)
    raise SystemExit(1)
ex = {a.get('displayName') for a in j.get('agents', [])}
c = s = f = 0
for a in AGENTI:
    nume = a['nume']; rol = a['rol']; card = a['card']
    if nume in ex:
        s += 1; continue
    st, res = api('POST', A + '/agents',
        {'displayName': nume, 'description': rol,
         'a2aAgentDefinition': {'jsonAgentCard': json.dumps(card, ensure_ascii=False)}})
    if st == 200:
        c += 1; print('  OK', nume)
    else:
        f += 1
        msg = res.get('error', {}).get('message', json.dumps(res))
        print('  X', nume, st, str(msg)[:200])
        if f == 1 and ('license' in str(msg).lower()):
            print('\\n>>> Contul tau NU are licenta Gemini Enterprise activa pe proiectul', P)
            print('>>> Aloca-ti o licenta pe ACEST proiect, apoi ruleaza din nou.')
            raise SystemExit(1)
print(f'bilant: creati {c}, existau deja {s}, esuati {f} (din {len(AGENTI)})')
st, j = api('GET', A + '/agents?pageSize=200')
L = [a.get('displayName') for a in j.get('agents', [])]
print('LISTA DIN API (' + str(len(L)) + '):')
for n in L:
    print('  -', n)
`
}

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  // Public, fără secrete — doar sursa scriptului (tokenul e al ownerului, la runtime).
  app.get('/api/enterprise/agenti.py', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return pythonScript()
  })
}
