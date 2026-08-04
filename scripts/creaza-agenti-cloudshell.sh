#!/usr/bin/env bash
# ── Creează agenții lui Kelion în Gemini Enterprise CU CONTUL OWNERULUI ──────
#
# De ce există (măsurat 4 aug 00:37): licența Gemini Enterprise se alocă pe
# UTILIZATORI-oameni; contul de serviciu al aplicației primește
# FAILED_PRECONDITION „license is not available" la crearea de agenți, oricâte
# roluri IAM are. Deci crearea se face O DATĂ cu contul licențiat al ownerului.
#
# CUM SE FOLOSEȘTE (un copy-paste):
#   1. Deschide https://shell.cloud.google.com (browser, gata autentificat).
#   2. Lipește TOT fișierul ăsta și apasă Enter.
#   3. La final vezi LISTA agenților citită înapoi din API — aia e dovada.
#
# Tokenul iese din `gcloud auth print-access-token` și RĂMÂNE în shellul tău —
# nu trece prin chat, nu-l vede nimeni. Scriptul e idempotent (nu face dubluri).
#
# Fiecare agent e o carte A2A care arată spre creierul lui Kelion
# (https://kelionai.app/api/a2a/<id>) — legătura „neuronală" cerută: agentul din
# Enterprise cheamă creierul Gemini al aplicației cu rolul lui. (Endpoint-ul
# /api/a2a e pasul următor în aplicație; până e live, agenții EXISTĂ în
# Enterprise cu tot cu roluri, doar apelul întoarce 404 — spus cinstit.)

set -euo pipefail
export TOKEN="$(gcloud auth print-access-token)"
export PROIECT="gen-lang-client-0460348646"

python3 - << 'PYEOF'
import json, os, urllib.request

TOKEN = os.environ['TOKEN']
PROIECT = os.environ['PROIECT']
B = 'https://discoveryengine.googleapis.com/v1alpha'
ASISTENT = f'projects/{PROIECT}/locations/global/collections/default_collection/engines/kelion-agenti/assistants/default_assistant'

ROSTER = [
    ('inginer-sef', 'Inginer-șef', 'Orchestratorul lui Kelion: primește orice cerere, o sparge în pași și o deleagă agentului potrivit. Română, scurt, cu pașii și cine ce face.'),
    ('debug-avansat', 'Depanator avansat', 'Debugging avansat: loguri, stack-trace-uri, reproducere pas cu pas, modulul vinovat, fix minim. Nu inventează cauze — cere dovada.'),
    ('senzorial', 'Văz · Auz · Memorie · Gândire', 'Gestionează simțurile lui Kelion: vederea, auzul (STT), memoria și lanțul de gândire. Semnalează orice simț căzut și cum se repune.'),
    ('anti-fabulatie', 'Paznicul adevărului', 'Anti-fabulație: fiecare afirmație are sursă, măsurătoare sau citire reală? Ce nu se poate proba = „nu pot verifica", niciodată cifră inventată.'),
    ('cautator-net', 'Căutător pe net', 'Căutare web: interogări bune, surse multiple, esența cu citate și linkuri. Separă faptele de opinii.'),
    ('designer-solutii', 'Designer de soluții', 'Arhitect: 2–3 soluții cu compromisuri, alege una, o desface în pași concreți cu riscuri și verificări.'),
    ('electronist', 'Electronist', 'Electronică: scheme, componente, calcule (Ohm, divizoare, filtre), depanare hardware pas cu pas, măsurători cu multimetrul/osciloscopul.'),
    ('designer-grafic', 'Designer grafic / UI', 'Design: interfețe, culori, tipografie, avatarul 3D. Specificații exacte (hex, px, spacing), nu vorbe generale.'),
    ('scenograf', 'Scenograf', 'Scenografie: decoruri, lumini, cadre, atmosferă pentru clipuri și scene cu avatarul. Descrie filmabil: plan, unghi, lumină, recuzită.'),
    ('textier', 'Textier', 'Copywriting: texte de interfață, scenarii, replici pentru avatar, titluri, traduceri RO/EN naturale.'),
    ('regizor-video', 'Regizor · Cameraman · Monteur', 'Video cap-coadă: scenariu, regie, cadre, montaj — tăieturi, ritm, muzică, subtitrări. Prompturi precise pentru Veo.'),
    ('gmail', 'Agent Gmail', 'Emailul: citește, rezumă, caută, compune ciorne. Nu trimite fără confirmare.'),
    ('calendar', 'Agent Calendar', 'Calendarul: evenimente, sloturi, creare/modificare cu confirmare. Atenție la fusuri orare.'),
    ('drive', 'Agent Drive', 'Google Drive: caută fișiere, citește conținut, rezumă documente.'),
    ('calatorii', 'Agent Călătorii & Hărți', 'Călătorii: rute, distanțe, locuri, plan de drum cu opriri și costuri estimate — estimările se spun ca estimări.'),
    ('meteo', 'Agent Meteo', 'Vremea: acum și prognoză, cu unități clare, sursă și ora citirii.'),
    ('stiri', 'Agent Știri', 'Știri: surse multiple, cu link și dată. Separă faptul de comentariu.'),
    ('traduceri', 'Agent Traduceri', 'Traduceri naturale RO↔EN și alte limbi, cu păstrarea tonului.'),
    ('muzica', 'Agent Muzică & Tempo', 'Muzică: tempo/ritm, sincronizarea avatarului pe beat, recomandări pe stare. Explică BPM.'),
    ('viziune', 'Agent Viziune', 'Vederea: analizează imagini și capturi ca un șoim — text mărunt, UI-uri, scheme. Spune exact ce vede și ce NU se distinge.'),
    ('voce', 'Agent Voce', 'Vocea: STT/TTS, dicție, pauze, emoție. Ținta: primul cuvânt sub o secundă.'),
    ('bani', 'Agent Bani', 'Banii: solduri, tranzacții, costuri pe măsurătoare reală. O citire eșuată nu devine „£0.00" — devine „nu pot verifica".'),
    ('memorie-db', 'Agent Memorie & Date', 'Baza de date: schemă, interogări, migrații. Nicio operație în masă fără să se uite întâi la ce șterge.'),
    ('browser', 'Agent Browser', 'Browserul de pe VPS: deschide, citește, apasă — cu verificare după fiecare acțiune. Raportează ce s-a randat de fapt.'),
    ('deploy', 'Agent Deploy & CI', 'Publicarea: build, teste, deploy, verificarea live==master. Nimic nu e „gata" fără dovada versiunii live.'),
    ('monitorizare', 'Agent Monitorizare & Alarme', 'Sănătatea aplicației: health-checks, loguri, alarme pe praguri măsurate.'),
    ('invatare', 'Agent Învățare', 'Auto-învățare: lecții din loguri și greșeli, scrise ca reguli scurte. Nu repetă o greșeală documentată.'),
    ('constructor', 'Agent Constructor', 'Constructorul de cod: ordin → clonează, modifică, testează, PR. Progres pe bară 0–100%.'),
    ('jules-legatura', 'Agent legătură Jules', 'Deleagă sarcini către Jules: sursa, promptul, urmărirea sesiunii și PR-ul. Merge-ul rămâne al ownerului.'),
    ('imagini', 'Agent Imagini', 'Generare și editare de imagini: prompturi precise, variante, retușuri. Costul se spune înainte.'),
    ('documente', 'Agent Documente', 'Documente: PDF-uri și acte, esența, formulare, scrisori oficiale.'),
    ('cumparaturi', 'Agent Cumpărături', 'Cumpărături: compară prețuri și specificații, semnalează capcane. Prețurile au dată și sursă.'),
    ('sanatate-app', 'Agent Igienă de cod', 'Igiena codului: dubluri, exporturi orfane, markeri de conflict, cod mort. Porțile pe zero.'),
]

def api(metoda, cale, corp=None):
    req = urllib.request.Request(f'{B}/{cale}', method=metoda,
        data=json.dumps(corp).encode() if corp else None,
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

st, j = api('GET', f'{ASISTENT}/agents?pageSize=200')
existenti = {a.get('displayName') for a in j.get('agents', [])} if st == 200 else set()
print(f'agenți existenți: HTTP {st} → {len(existenti)}')

creati = sariti = esuati = 0
for aid, nume, rol in ROSTER:
    if nume in existenti:
        sariti += 1
        continue
    card = {
        'protocolVersion': '0.2.6', 'name': nume,
        'description': f'{rol} (Echipa lui Kelion — kelionai.app; regula de aur: o valoare nemăsurată e „nu pot verifica".)',
        'url': f'https://kelionai.app/api/a2a/{aid}', 'version': '1.0.0',
        'capabilities': {}, 'defaultInputModes': ['text/plain'], 'defaultOutputModes': ['text/plain'],
        'skills': [{'id': aid, 'name': nume, 'description': rol[:180], 'tags': ['kelion']}],
    }
    st, j = api('POST', f'{ASISTENT}/agents', {
        'displayName': nume, 'description': rol.split('.')[0] + '.',
        'a2aAgentDefinition': {'jsonAgentCard': json.dumps(card, ensure_ascii=False)},
    })
    if st == 200:
        creati += 1
        print(f'  ✓ {nume}')
    else:
        esuati += 1
        print(f'  ✗ {nume}: HTTP {st} {str(j.get("error", {}).get("message", ""))[:140]}')

print(f'bilanț: creați {creati}, existau {sariti}, eșuați {esuati} (din {len(ROSTER)})')
st, j = api('GET', f'{ASISTENT}/agents?pageSize=200')
lista = [a.get('displayName') for a in j.get('agents', [])]
print(f'LISTA DIN API ({len(lista)}):')
for n in lista:
    print('  •', n)
PYEOF
