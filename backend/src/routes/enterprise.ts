import type { FastifyInstance } from 'fastify'

// ── SCRIPTUL DE CREARE A AGENȚILOR ENTERPRISE, servit ca text ───────────────
//
// De ce există (Adrian, 4 aug): crearea agenților în Gemini Enterprise cere un
// cont cu LICENȚĂ ACTIVĂ, iar licența se activează doar la login interactiv de
// om — contul de serviciu al aplicației nu poate (măsurat: FAILED_PRECONDITION,
// „active Gemini Enterprise license is not available"). Deci creaza contul
// OWNERULUI, din Cloud Shell-ul lui (unde e deja logat și licențiat).
//
// Problema mecanică a fost că paste-ul scriptului lung rupea terminalul. Soluția:
// aplicația SERVEȘTE scriptul la un link, iar ownerul rulează O SINGURĂ linie
// scurtă, care nu se rupe:
//
//     curl -s https://kelionai.app/api/enterprise/agenti.py | python3
//
// Scriptul NU conține niciun secret: tokenul vine din `gcloud auth
// print-access-token` (rulează în shell-ul ownerului, nu aici), deci e sigur să
// fie public. La final afișează LISTA agenților citită din API — dovada.

const PROIECT = 'gen-lang-client-0460348646'

// Rosterul: id · nume · rol. Fiecare devine o carte A2A ce arată spre creierul
// lui Kelion (/api/a2a/<id>) — legătura neuronală cerută.
const ROSTER: [string, string, string][] = [
  ['inginer-sef', 'Inginer-sef', 'Orchestreaza: sparge cererea in pasi si deleaga agentului potrivit.'],
  ['debug', 'Depanator avansat', 'Debugging: loguri, reproducere, modulul vinovat, fix minim.'],
  ['senzorial', 'Vaz Auz Memorie Gandire', 'Gestioneaza vederea, auzul, memoria si gandirea lui Kelion.'],
  ['adevar', 'Paznicul adevarului', 'Anti-fabulatie: ce nu se poate proba = nu pot verifica.'],
  ['cautator', 'Cautator pe net', 'Cautare web: surse multiple, citate, linkuri.'],
  ['solutii', 'Designer de solutii', 'Arhitect: 2-3 solutii cu compromisuri, alege una, o desface in pasi.'],
  ['electronist', 'Electronist', 'Scheme, componente, calcule, depanare hardware pas cu pas.'],
  ['designer', 'Designer grafic UI', 'Interfete, culori, tipografie, avatarul 3D. Specificatii exacte.'],
  ['scenograf', 'Scenograf', 'Decoruri, lumini, cadre, atmosfera pentru clipuri.'],
  ['textier', 'Textier', 'Texte de interfata, scenarii, replici, traduceri RO/EN.'],
  ['regizor', 'Regizor Cameraman Monteur', 'Video cap-coada: scenariu, regie, montaj, prompturi Veo.'],
  ['gmail', 'Agent Gmail', 'Email: citeste, rezuma, cauta, ciorne. Nu trimite fara confirmare.'],
  ['calendar', 'Agent Calendar', 'Evenimente, sloturi, creare cu confirmare. Atentie la fusuri.'],
  ['drive', 'Agent Drive', 'Cauta fisiere, citeste continut, rezuma documente.'],
  ['calatorii', 'Agent Calatorii Harti', 'Rute, distante, locuri, plan de drum cu costuri estimate.'],
  ['meteo', 'Agent Meteo', 'Vremea acum si prognoza, cu sursa si ora citirii.'],
  ['stiri', 'Agent Stiri', 'Stiri din surse multiple, cu link si data.'],
  ['traduceri', 'Agent Traduceri', 'Traduceri naturale RO/EN si alte limbi, cu tonul pastrat.'],
  ['muzica', 'Agent Muzica Tempo', 'Tempo/ritm, sincronizarea avatarului pe beat, recomandari.'],
  ['viziune', 'Agent Viziune', 'Analizeaza imagini si capturi ca un soim; spune si ce NU distinge.'],
  ['voce', 'Agent Voce', 'STT/TTS, dictie, emotie. Prima vorba sub o secunda.'],
  ['bani', 'Agent Bani', 'Solduri, tranzactii, costuri masurate. Nu inventeaza cifre.'],
  ['memorie', 'Agent Memorie Date', 'Baza de date: schema, interogari, migratii, igiena.'],
  ['browser', 'Agent Browser', 'Deschide pagini, citeste, apasa, cu verificare dupa fiecare pas.'],
  ['deploy', 'Agent Deploy CI', 'Build, teste, deploy, verificarea live==master.'],
  ['monitor', 'Agent Monitorizare', 'Health-checks, loguri, alarme pe praguri masurate.'],
  ['invatare', 'Agent Invatare', 'Lectii din loguri si greseli, ca reguli scurte.'],
  ['constructor', 'Agent Constructor', 'Cod: ordin -> cloneaza, modifica, testeaza, PR. Bara 0-100%.'],
  ['jules', 'Agent legatura Jules', 'Deleaga sarcini catre Jules: sursa, prompt, urmarire PR.'],
  ['imagini', 'Agent Imagini', 'Generare si editare de imagini; costul spus inainte.'],
  ['documente', 'Agent Documente', 'PDF-uri si acte: esenta, formulare, scrisori oficiale.'],
  ['cumparaturi', 'Agent Cumparaturi', 'Compara preturi si specificatii; preturile au data si sursa.'],
  ['igiena', 'Agent Igiena de cod', 'Dubluri, exporturi orfane, cod mort. Portile pe zero.'],
]

function pythonScript(): string {
  const roster = JSON.stringify(ROSTER)
  return `#!/usr/bin/env python3
# Creeaza agentii lui Kelion in Gemini Enterprise, cu contul TAU (Cloud Shell).
# Tokenul vine din gcloud (contul tau logat, licentiat). Zero secrete aici.
import json, subprocess, urllib.request, urllib.error
P = ${JSON.stringify(PROIECT)}
ROSTER = ${roster}
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

st, who = api('GET', 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + T) if False else (0, {})
print('== Creez agentii lui Kelion in Gemini Enterprise ==')
st, j = api('GET', A + '/agents?pageSize=200')
if st != 200:
    print('Nu pot citi agentii existenti: HTTP', st, json.dumps(j)[:400])
    if st == 400 or st == 403:
        print('\\nProbabil contul tau nu are licenta ACTIVA pe proiectul', P)
    raise SystemExit(1)
ex = {a.get('displayName') for a in j.get('agents', [])}
c = s = f = 0
for aid, nume, rol in ROSTER:
    if nume in ex:
        s += 1; continue
    card = {'protocolVersion': '0.2.6', 'name': nume, 'description': rol,
            'url': f'https://kelionai.app/api/a2a/{aid}', 'version': '1.0.0',
            'capabilities': {}, 'defaultInputModes': ['text/plain'],
            'defaultOutputModes': ['text/plain'],
            'skills': [{'id': aid, 'name': nume, 'description': rol, 'tags': ['kelion']}]}
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
print(f'bilant: creati {c}, existau deja {s}, esuati {f} (din {len(ROSTER)})')
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
